import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  FieldProposalRequest,
  NarrativeRequest,
} from '@redline/contracts';
import { createReasoner, ReasonerUnavailable } from './reasoner.js';
import { buildFieldProposalPrompt, buildNarrativePrompt } from './prompts.js';

// The unconfigured path must not depend on ambient env. Snapshot and clear every
// var that selects a backend: the Claude API key, the Bedrock model id, and the
// forced-backend switch.
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

  it('carries a held-out AUC interval into the check-2 prompt and asks the model to cite it', () => {
    const req: NarrativeRequest = {
      checkId: 2,
      state: 'flagged',
      claim: 'A distinct activated Treg-like state, defined by 4 markers.',
      datasetTitle: narrativeReq.datasetTitle,
      evidence: {
        holdAUC: 0.57,
        holdAUCMedian: 0.57,
        holdAUCCILow: 0.54,
        holdAUCCIHigh: 0.61,
        splitReps: 200,
      },
    };
    const { system, user } = buildNarrativePrompt(req);
    // the interval bounds and the repetition count reach the model
    expect(user).toContain('holdAUCCILow');
    expect(user).toContain('0.54');
    expect(user).toContain('200');
    // and the prompt instructs it to report the interval, not one point
    expect(system).toContain('95 percent interval');
    expect(user).toContain('95 percent interval');
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
