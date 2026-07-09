import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FieldProposalRequest,
  NarrativeRequest,
  RecommendationRequest,
} from '@redline/contracts';
import { createReasoner, ReasonerUnavailable } from './reasoner.js';
import { buildFieldProposalPrompt, buildNarrativePrompt } from './prompts.js';

// A fake Bedrock backend. isConfigured and getModelId stay the real, env-driven
// functions, so `available` stays honest and the unconfigured tests still hold.
// Only the network call (invokeMessages) is swapped for a stub we drive per test.
const { fakeInvoke } = vi.hoisted(() => ({ fakeInvoke: vi.fn() }));
vi.mock('./bedrock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bedrock.js')>();
  return { ...actual, invokeMessages: fakeInvoke };
});

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
});

function recRequest(
  feasibilities: RecommendationRequest['feasibilities'],
): RecommendationRequest {
  return {
    checkId: 1,
    state: 'flagged',
    claim: 'IL2RA knockdown upregulates FOXP3 across CD4 T cells (p < 0.001).',
    datasetTitle: 'CD4+ T cells · IL2RA knockdown vs non-targeting · Perturb-seq',
    evidence: { 'pseudobulk p': '0.21', unit: 'donor_id', replicates: 4 },
    feasibilities,
    fields: ['donor_id', 'condition'],
    method: {
      authors: 'Squair et al.',
      year: 2021,
      venue: 'Nature Communications',
      note: 'Pseudobulk aggregation controls false discoveries.',
    },
  };
}

function recPayload(recs: Array<Record<string, unknown>>): string {
  const base = {
    action: 'Aggregate to pseudobulk per donor_id and re-test.',
    rationale: 'The cell-level p is inflated by non-independence.',
    changes: 'The p-value rises to 0.21 across the four donors.',
    feasibility: 'fixable_now',
  };
  return JSON.stringify({ recommendations: recs.map((r) => ({ ...base, ...r })) });
}

describe('recommend (honesty backstop)', () => {
  beforeEach(() => {
    process.env.REDLINE_BEDROCK_MODEL_ID = 'test-model';
    fakeInvoke.mockReset();
  });

  it('available stays env-derived and never hits the network', () => {
    expect(createReasoner().available).toBe(true);
    expect(fakeInvoke).not.toHaveBeenCalled();
  });

  it('truncates to the number of feasibility slots the engine decided', async () => {
    fakeInvoke.mockResolvedValue(recPayload([{}, {}, {}]));
    const recs = await createReasoner().recommend(
      recRequest(['fixable_now', 'needs_new_data']),
    );
    expect(recs).toHaveLength(2);
    expect(recs[0]?.feasibility).toBe('fixable_now');
    expect(recs[1]?.feasibility).toBe('needs_new_data');
  });

  it('forces an upgraded feasibility back to the engine verdict', async () => {
    // An honest unsalvageable recommendation the model tried to tag fixable_now.
    // Its prose proposes no fix, so only the feasibility is overwritten.
    fakeInvoke.mockResolvedValue(
      recPayload([
        {
          feasibility: 'fixable_now',
          action:
            'State plainly that no valid differential test exists for FOXP3 with one replicate per group.',
          changes: 'Nothing changes; with one unit per condition there is no valid test to run.',
          rationale:
            'A single unit per condition means the effect cannot be separated from that unit.',
        },
      ]),
    );
    const recs = await createReasoner().recommend(recRequest(['unsalvageable']));
    expect(recs).toHaveLength(1);
    expect(recs[0]?.feasibility).toBe('unsalvageable');
  });

  it('rejects when an unsalvageable slot proposes a statistical fix', async () => {
    fakeInvoke.mockResolvedValue(
      recPayload([{ action: 'Add lane as a covariate to the model.' }]),
    );
    await expect(
      createReasoner().recommend(recRequest(['unsalvageable'])),
    ).rejects.toBeInstanceOf(ReasonerUnavailable);
  });

  // The deny-list must not be defeated by a soft opener that hides the verb, or
  // by a fix smuggled into `changes`/`rationale` instead of `action`.
  // Honest filler for the fields NOT under test in each case, so the only fix
  // signal is the one field the case exercises (not the shared base changes).
  const HONEST = {
    action: 'State that the claim cannot be supported on this data.',
    changes: 'The claim is withdrawn; no corrected result is available.',
    rationale: 'The design leaves the effect entangled with a technical split.',
  };
  const soFtFixes: Array<{ label: string; rec: Record<string, unknown> }> = [
    {
      label: '"You could aggregate..." (soft opener hides the verb)',
      rec: { ...HONEST, action: 'You could aggregate to pseudobulk per donor_id and re-test.' },
    },
    {
      label: '"Consider adding ... as a covariate"',
      rec: { ...HONEST, action: 'Consider adding lane as a covariate to the donor-level model.' },
    },
    {
      label: '"The comparison becomes valid once you add lane as a covariate"',
      rec: { ...HONEST, action: 'The comparison becomes valid once you add lane as a covariate.' },
    },
    {
      // isolates the -ing inflection of an e-ending verb (no method/outcome marker).
      label: 'an "-ing" verb form ("Aggregating the counts...")',
      rec: { ...HONEST, action: 'Aggregating the counts to the unit level and re-testing.' },
    },
    {
      label: 'a fabricated corrected p-value hidden in `changes`',
      rec: { ...HONEST, changes: 'Aggregating to pseudobulk per donor_id lifts the effect to p = 0.21.' },
    },
    {
      label: 'a "becomes significant" outcome hidden in `rationale`',
      rec: { ...HONEST, rationale: 'Once lane enters the model the effect becomes significant again.' },
    },
  ];
  for (const { label, rec } of soFtFixes) {
    it(`rejects an unsalvageable slot that smuggles a fix: ${label}`, async () => {
      fakeInvoke.mockResolvedValue(recPayload([rec]));
      await expect(
        createReasoner().recommend(recRequest(['unsalvageable'])),
      ).rejects.toBeInstanceOf(ReasonerUnavailable);
    });
  }

  // ...but a genuine honest unsalvageable recommendation must survive, or the
  // backstop would fall back to curated copy forever. This is the real curated
  // marson check-4 recommendation, fed back as if the model returned it.
  it('accepts an honest unsalvageable recommendation (no over-rejection)', async () => {
    fakeInvoke.mockResolvedValue(
      recPayload([
        {
          action: 'Do not report a perturbation effect from this comparison.',
          rationale:
            "Every knockdown sample ran on Lane-A and every non-targeting sample on Lane-B (Cramer's V = 1.00), so the two variables are one split.",
          changes: 'The confounded contrast is withdrawn rather than reported.',
        },
      ]),
    );
    const recs = await createReasoner().recommend(recRequest(['unsalvageable']));
    expect(recs).toHaveLength(1);
    expect(recs[0]?.feasibility).toBe('unsalvageable');
    expect(recs[0]?.action).toContain('Do not report');
  });

  it('"collect a balanced design" is not mistaken for a fix', async () => {
    fakeInvoke.mockResolvedValue(
      recPayload([
        {
          action: 'Collect a balanced design with at least three replicate units per group.',
          rationale: 'The current design has one unit per condition.',
          changes: 'A balanced design would make a donor-level test possible.',
        },
      ]),
    );
    const recs = await createReasoner().recommend(recRequest(['unsalvageable']));
    expect(recs).toHaveLength(1);
    expect(recs[0]?.feasibility).toBe('unsalvageable');
  });

  it('treats zero returned recommendations as a failure (curated fallback wins)', async () => {
    fakeInvoke.mockResolvedValue(JSON.stringify({ recommendations: [] }));
    await expect(
      createReasoner().recommend(recRequest(['fixable_now'])),
    ).rejects.toBeInstanceOf(ReasonerUnavailable);
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
