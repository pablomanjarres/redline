import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ClaimExtractionRequest,
  DatasetInventory,
  ExtractedClaim,
  FieldSpec,
} from '@redline/contracts';
import { createReasoner, ReasonerUnavailable } from './reasoner.js';
import { buildClaimExtractionPrompt, buildClaimMappingPrompt } from './prompts.js';
import { parseClaimsReply } from './claims.js';

// The unconfigured path must not depend on ambient env, exactly like reasoner.test.ts.
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

const invMarson: DatasetInventory = {
  file: 'cd4_tcell_perturbseq_subset.h5ad',
  nCells: 51842,
  nGenes: 3200,
  obs: [
    { name: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, sample: ['D1', 'D2'] },
    { name: 'condition', dtype: 'categorical', levels: 2, missing: 0, sample: ['IL2RA-KD', 'non-targeting'] },
    { name: 'lane', dtype: 'categorical', levels: 2, missing: 0, sample: ['Lane-A', 'Lane-B'] },
    { name: 'leiden', dtype: 'categorical', levels: 14, missing: 0, sample: ['0', '1'] },
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
    {
      key: 'treg_markers',
      kind: 'marker_table',
      shape: '4 x 2',
      columns: ['gene', 'auc'],
      groups: ['Activated Treg-like'],
      genes: ['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4'],
      preview: 'markers TNFRSF9 ICOS TIGIT CTLA4',
    },
  ],
  clusterFields: ['leiden'],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts'],
  obsm: ['X_pca', 'X_umap'],
  varNamesSample: ['FOXP3', 'IL2RA', 'TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4'],
};

const invPbmc: DatasetInventory = {
  file: 'pbmc_ifnb.h5ad',
  nCells: 20000,
  nGenes: 2000,
  obs: [
    { name: 'sample_id', dtype: 'categorical', levels: 8, missing: 0, sample: ['P1', 'P2'] },
    { name: 'stim', dtype: 'categorical', levels: 2, missing: 0, sample: ['IFNB', 'control'] },
    { name: 'batch', dtype: 'categorical', levels: 2, missing: 0, sample: ['b1', 'b2'] },
    { name: 'louvain', dtype: 'categorical', levels: 9, missing: 0, sample: ['0', '1'] },
  ],
  uns: [
    {
      key: 'de_ifnb',
      kind: 'de_result',
      shape: '2000 x 4',
      columns: ['names', 'pvals'],
      groups: ['IFNB', 'control'],
      genes: ['ISG15', 'IFIT1'],
      preview: 'DE ISG15',
    },
  ],
  clusterFields: ['louvain'],
  hasRawCounts: false,
  countsSource: null,
  layers: [],
  obsm: ['X_pca'],
  varNamesSample: ['ISG15', 'IFIT1', 'CXCL10', 'STAT1'],
};

const marsonFields: FieldSpec[] = [
  { id: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, role: 'unit', confidence: 'high', reason: 'The replicate.' },
  { id: 'condition', dtype: 'categorical', levels: 2, missing: 0, role: 'grouping', confidence: 'high', reason: 'The contrast.' },
];

const pbmcFields: FieldSpec[] = [
  { id: 'sample_id', dtype: 'categorical', levels: 8, missing: 0, role: 'unit', confidence: 'high', reason: 'The replicate.' },
  { id: 'stim', dtype: 'categorical', levels: 2, missing: 0, role: 'grouping', confidence: 'high', reason: 'The contrast.' },
];

const extractionReq: ClaimExtractionRequest = {
  datasetTitle: 'CD4+ T cells · IL2RA knockdown vs non-targeting · Perturb-seq',
  inventory: invMarson,
  fields: marsonFields,
  notebook: 'sc.tl.rank_genes_groups(adata, "condition")  # FOXP3 up under knockdown',
  prose: 'We find an activated Treg-like state enriched under IL2RA knockdown.',
};

/** A claim that passes the backstop clean against invMarson. */
const validClaim: ExtractedClaim = {
  id: 'ok',
  text: 'IL2RA knockdown upregulates FOXP3.',
  source: 'stored_result',
  restsOn: 'A stored DE result testing FOXP3.',
  evidenceRefs: { obsColumns: ['condition'], unsKeys: ['rank_genes_groups'], genes: ['FOXP3'] },
  checks: [{ check: 1, params: { grouping: 'condition', unit: 'donor_id', gene: 'FOXP3' } }],
  confidence: 'high',
  status: 'proposed',
};

describe('createReasoner (unconfigured claim methods)', () => {
  it('reports available === false when no backend is set', () => {
    expect(createReasoner().available).toBe(false);
  });

  it('extractClaims() throws ReasonerUnavailable when no backend is set', async () => {
    await expect(createReasoner().extractClaims(extractionReq)).rejects.toBeInstanceOf(
      ReasonerUnavailable,
    );
  });

  it('mapClaim() throws ReasonerUnavailable when no backend is set', async () => {
    await expect(
      createReasoner().mapClaim({
        datasetTitle: extractionReq.datasetTitle,
        inventory: invMarson,
        fields: marsonFields,
        text: 'Ketamine changes microglia.',
      }),
    ).rejects.toBeInstanceOf(ReasonerUnavailable);
  });
});

describe('buildClaimExtractionPrompt', () => {
  it('embeds the obs column names, uns keys, and genes from the inventory', () => {
    const { system, user } = buildClaimExtractionPrompt(extractionReq);
    expect(typeof system).toBe('string');
    expect(system.length).toBeGreaterThan(0);
    expect(user).toContain('donor_id');
    expect(user).toContain('condition');
    expect(user).toContain('rank_genes_groups');
    expect(user).toContain('treg_markers');
    expect(user).toContain('FOXP3');
    expect(user).toContain('TNFRSF9');
  });

  it('embeds the notebook and prose text verbatim when given', () => {
    const { user } = buildClaimExtractionPrompt(extractionReq);
    expect(user).toContain('sc.tl.rank_genes_groups');
    expect(user).toContain('activated Treg-like state enriched under IL2RA knockdown');
  });

  it('omits the notebook and prose sections when they are absent', () => {
    const { user } = buildClaimExtractionPrompt({
      datasetTitle: extractionReq.datasetTitle,
      inventory: invMarson,
      fields: marsonFields,
    });
    expect(user).not.toContain('Notebook (verbatim):');
    expect(user).not.toContain('Pasted analysis text (verbatim):');
  });

  it('carries the many-to-many routing table in the system prompt', () => {
    const { system } = buildClaimExtractionPrompt(extractionReq);
    expect(system).toContain('cluster/state defined by markers -> Check 2 and Check 3');
    expect(system).toContain('a distinct population exists -> Check 3');
  });

  it('produces different user messages for two different inventories', () => {
    const a = buildClaimExtractionPrompt(extractionReq).user;
    const b = buildClaimExtractionPrompt({
      datasetTitle: 'PBMC · IFN-beta vs control',
      inventory: invPbmc,
      fields: pbmcFields,
    }).user;
    expect(a).not.toEqual(b);
    expect(b).toContain('sample_id');
    expect(b).toContain('stim');
    expect(b).not.toContain('donor_id');
  });
});

describe('buildClaimMappingPrompt', () => {
  it('embeds the user-typed claim and the inventory', () => {
    const { user } = buildClaimMappingPrompt({
      datasetTitle: extractionReq.datasetTitle,
      inventory: invMarson,
      fields: marsonFields,
      text: 'FOXP3 goes up under knockdown.',
    });
    expect(user).toContain('FOXP3 goes up under knockdown.');
    expect(user).toContain('condition');
    expect(user).toContain('user_added');
  });
});

describe('parseClaimsReply (the honesty backstop at the parse seam)', () => {
  it('strips a claim whose evidence cites a fabricated obs column', () => {
    const reply = JSON.stringify({
      claims: [
        {
          id: 'fabricated',
          text: 'A claim about a column that does not exist.',
          source: 'stored_result',
          restsOn: 'A stored result on a missing column.',
          evidenceRefs: { obsColumns: ['made_up_column'], unsKeys: [], genes: [] },
          checks: [{ check: 1, params: { grouping: 'made_up_column' } }],
          confidence: 'high',
          status: 'proposed',
        },
        validClaim,
      ],
    });
    const out = parseClaimsReply(reply, invMarson);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('ok');
  });

  it('empties the checks array of an out-of-scope claim', () => {
    const reply = JSON.stringify({
      claims: [
        {
          id: 'oos',
          text: 'A pseudotime trajectory orders the cells.',
          source: 'prose',
          restsOn: 'A trajectory analysis.',
          evidenceRefs: { obsColumns: [], unsKeys: [], genes: [] },
          checks: [{ check: 2, params: { grouping: 'leiden' } }],
          confidence: 'low',
          status: 'out_of_scope',
          outOfScopeReason: 'Redline does not audit trajectory inference.',
        },
      ],
    });
    const out = parseClaimsReply(reply, invMarson);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('out_of_scope');
    expect(out[0]?.checks).toEqual([]);
  });

  it('returns an empty list for an empty reply, never padding it', () => {
    expect(parseClaimsReply(JSON.stringify({ claims: [] }), invMarson)).toEqual([]);
  });

  it('recovers JSON from a fenced code block', () => {
    const fenced = '```json\n' + JSON.stringify({ claims: [validClaim] }) + '\n```';
    expect(parseClaimsReply(fenced, invMarson)).toHaveLength(1);
  });

  it('recovers JSON after leading prose', () => {
    const leading = 'Here are the claims I found:\n' + JSON.stringify({ claims: [validClaim] });
    expect(parseClaimsReply(leading, invMarson)).toHaveLength(1);
  });
});

// The curated fallback claim list moved to @redline/engine (curatedClaimsFor),
// the single home the app shares across both fallback paths. Its coverage lives
// in packages/engine/src/inventory.test.ts (the curated MARSON_CLAIMS /
// KETAMINE_CLAIMS survive enforceClaimHonesty unchanged, differ across
// inventories, and equal each scenario's extractedClaims).
