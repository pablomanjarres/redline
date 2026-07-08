import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  FieldProposalRequest,
  NarrativeRequest,
} from '@redline/contracts';
import { createReasoner, ReasonerUnavailable } from './reasoner.js';
import { buildFieldProposalPrompt, buildNarrativePrompt } from './prompts.js';

// The unconfigured path must not depend on ambient env. Snapshot and clear.
const ORIGINAL_MODEL_ID = process.env.REDLINE_BEDROCK_MODEL_ID;

beforeEach(() => {
  delete process.env.REDLINE_BEDROCK_MODEL_ID;
});

afterAll(() => {
  if (ORIGINAL_MODEL_ID === undefined) {
    delete process.env.REDLINE_BEDROCK_MODEL_ID;
  } else {
    process.env.REDLINE_BEDROCK_MODEL_ID = ORIGINAL_MODEL_ID;
  }
});

const narrativeReq: NarrativeRequest = {
  checkId: 1,
  state: 'flagged',
  claim:
    'IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001).',
  datasetTitle:
    'CD4+ T cells · IL2RA knockdown vs non-targeting · Perturb-seq',
  evidence: {
    'cell-level p': '6.2e-11',
    'pseudobulk p': '0.21',
    unit: 'donor_id',
    replicates: 4,
  },
};

const fieldReq: FieldProposalRequest = {
  datasetTitle:
    'CD4+ T cells · IL2RA knockdown vs non-targeting · Perturb-seq',
  columns: [
    { id: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, sample: 'D1, D2' },
    { id: 'condition', dtype: 'categorical', levels: 2, missing: 0 },
    { id: 'n_genes', dtype: 'numeric', levels: null, missing: 0 },
  ],
};

describe('createReasoner (unconfigured)', () => {
  it('reports available === false when no model id is set', () => {
    expect(createReasoner().available).toBe(false);
  });

  it('narrate() throws ReasonerUnavailable when no model id is set', async () => {
    const reasoner = createReasoner();
    await expect(reasoner.narrate(narrativeReq)).rejects.toBeInstanceOf(
      ReasonerUnavailable,
    );
  });

  it('proposeFields() throws ReasonerUnavailable when no model id is set', async () => {
    const reasoner = createReasoner();
    await expect(reasoner.proposeFields(fieldReq)).rejects.toBeInstanceOf(
      ReasonerUnavailable,
    );
  });
});

describe('buildNarrativePrompt', () => {
  it('returns a system + user pair carrying the claim, dataset, and evidence', () => {
    const { system, user } = buildNarrativePrompt(narrativeReq);
    expect(typeof system).toBe('string');
    expect(system.length).toBeGreaterThan(0);
    expect(user).toContain(narrativeReq.claim);
    expect(user).toContain(narrativeReq.datasetTitle);
    expect(user).toContain('pseudobulk p');
    expect(user).toContain('0.21');
    expect(user).toContain('flagged');
  });

  it('names the pillar-1 failure mode and its method paper in the system prompt', () => {
    const { system } = buildNarrativePrompt(narrativeReq);
    expect(system).toContain('Pseudoreplication');
    expect(system).toContain('Squair');
  });
});

describe('buildFieldProposalPrompt', () => {
  it('returns a system + user pair listing every column', () => {
    const { system, user } = buildFieldProposalPrompt(fieldReq);
    expect(typeof system).toBe('string');
    expect(user).toContain('donor_id');
    expect(user).toContain('condition');
    expect(user).toContain('n_genes');
    expect(user).toContain(fieldReq.datasetTitle);
  });

  it('keeps the grouping role configurable rather than hardcoded to cell type', () => {
    const { system } = buildFieldProposalPrompt(fieldReq);
    expect(system).toContain('configurable');
    expect(system).toContain('never hardcoded');
  });
});
