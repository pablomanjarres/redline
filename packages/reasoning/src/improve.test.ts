import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClaimImprovementRequest, DatasetInventory } from '@redline/contracts';
import { createReasoner, ReasonerUnavailable } from './reasoner.js';
import { IMPROVE_SYSTEM_PROMPT, buildClaimImprovementPrompt } from './prompts.js';

// The unconfigured path must not depend on ambient env, exactly like the other
// reasoning tests: snapshot and clear every var that selects a backend.
const SNAPSHOT: Record<string, string | undefined> = {
  REDLINE_BEDROCK_MODEL_ID: process.env.REDLINE_BEDROCK_MODEL_ID,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  REDLINE_REASONING_BACKEND: process.env.REDLINE_REASONING_BACKEND,
};

beforeEach(() => {
  delete process.env.REDLINE_BEDROCK_MODEL_ID;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.REDLINE_REASONING_BACKEND;
});

afterAll(() => {
  for (const [key, value] of Object.entries(SNAPSHOT)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const inventory: DatasetInventory = {
  file: 'cd4_tcell_perturbseq_subset.h5ad',
  nCells: 51842,
  nGenes: 3200,
  obs: [
    { name: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, sample: ['D1', 'D2'] },
    { name: 'condition', dtype: 'categorical', levels: 2, missing: 0, sample: ['IL2RA-KD', 'non-targeting'] },
  ],
  uns: [
    {
      key: 'rank_genes_groups',
      kind: 'de_result',
      shape: '3200 x 5',
      columns: ['names', 'pvals'],
      groups: ['IL2RA-KD', 'non-targeting'],
      genes: ['FOXP3', 'IL2RA'],
      preview: 'DE FOXP3 p=6.2e-11',
    },
  ],
  clusterFields: ['leiden'],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts'],
  obsm: ['X_pca'],
  varNamesSample: ['FOXP3', 'IL2RA'],
};

const improveReq: ClaimImprovementRequest = {
  datasetTitle: 'CD4+ T cells · IL2RA knockdown vs non-targeting · Perturb-seq',
  inventory,
  fields: [],
  text: 'foxp3 goes up when you knock down il2ra',
  restsOn: 'A stored DE result on the condition column testing FOXP3.',
  checks: [1],
};

describe('buildClaimImprovementPrompt', () => {
  it('embeds the current wording, the inventory, restsOn, and the routed checks', () => {
    const { system, user } = buildClaimImprovementPrompt(improveReq);
    expect(typeof system).toBe('string');
    expect(system.length).toBeGreaterThan(0);
    expect(user).toContain('foxp3 goes up when you knock down il2ra');
    expect(user).toContain('condition');
    expect(user).toContain('rank_genes_groups');
    expect(user).toContain('A stored DE result on the condition column testing FOXP3.');
    // The routed check is carried as context so the rewrite matches what tests it.
    expect(user).toContain('Check 1');
  });

  it('omits the restsOn section when it is absent', () => {
    const { user } = buildClaimImprovementPrompt({
      datasetTitle: improveReq.datasetTitle,
      inventory,
      fields: [],
      text: 'FOXP3 rises under knockdown.',
    });
    expect(user).not.toContain('What the claim rests on:');
    expect(user).toContain('(none routed yet)');
  });

  it('pins the output contract and the keep-the-same-meaning rule in the system prompt', () => {
    expect(IMPROVE_SYSTEM_PROMPT).toContain('{ "text": "..." }');
    expect(IMPROVE_SYSTEM_PROMPT).toContain('Keep the same claim and the same meaning');
    // The voice rules Redline enforces on every user-facing string.
    expect(IMPROVE_SYSTEM_PROMPT).toContain('No em dashes');
  });
});

describe('improveClaim (unconfigured)', () => {
  it('reports available === false and throws ReasonerUnavailable when no backend is set', async () => {
    expect(createReasoner().available).toBe(false);
    await expect(createReasoner().improveClaim(improveReq)).rejects.toBeInstanceOf(ReasonerUnavailable);
  });
});

describe('improveClaim (injected backend)', () => {
  it('returns the rewritten text, trimmed, from a { text } reply', async () => {
    const reasoner = createReasoner({
      invoke: async () => '  {"text": "IL2RA knockdown upregulates FOXP3 across CD4 T cells."}  ',
    });
    const improved = await reasoner.improveClaim(improveReq);
    expect(improved).toBe('IL2RA knockdown upregulates FOXP3 across CD4 T cells.');
  });

  it('recovers the rewrite from a fenced reply', async () => {
    const reply = '```json\n{"text": "IL2RA knockdown raises FOXP3 in CD4 T cells."}\n```';
    const reasoner = createReasoner({ invoke: async () => reply });
    expect(await reasoner.improveClaim(improveReq)).toBe('IL2RA knockdown raises FOXP3 in CD4 T cells.');
  });

  it('rejects an empty rewrite rather than blanking the wording', async () => {
    const reasoner = createReasoner({ invoke: async () => '{"text": "   "}' });
    await expect(reasoner.improveClaim(improveReq)).rejects.toBeInstanceOf(ReasonerUnavailable);
  });

  it('rejects an unparseable reply', async () => {
    const reasoner = createReasoner({ invoke: async () => 'not json at all' });
    await expect(reasoner.improveClaim(improveReq)).rejects.toBeInstanceOf(ReasonerUnavailable);
  });
});
