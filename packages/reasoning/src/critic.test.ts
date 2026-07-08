import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CriticRequest } from '@redline/contracts';
import { createReasoner, ReasonerUnavailable } from './reasoner.js';
import { buildCriticPrompt, CRITIC_SYSTEM_PROMPT } from './critic-prompts.js';

// Clear every backend-selecting var so the unconfigured path is deterministic.
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

// A genuine pseudoreplication flag from Case A: naive tiny, honest not significant.
const req: CriticRequest = {
  checkId: 1,
  computeState: 'flagged',
  claim: 'IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001).',
  datasetTitle: 'CD4+ T cells · IL2RA knockdown vs non-targeting · Perturb-seq',
  evidence: { naiveP: '2.4e-07', honestP: '0.77', n: 4 },
  method: 'pseudobulk aggregation, Welch t on per-unit means',
  design: 'unit=donor_id, grouping=condition',
};

describe('buildCriticPrompt', () => {
  it('is adversarial: it permits veto and downgrade and warns against rubber-stamping', () => {
    expect(CRITIC_SYSTEM_PROMPT).toContain('veto');
    expect(CRITIC_SYSTEM_PROMPT).toContain('downgrade');
    expect(CRITIC_SYSTEM_PROMPT).toContain('worse than no critic');
    // The voice gate holds on the critic prompt too.
    expect(CRITIC_SYSTEM_PROMPT).not.toContain('—');
  });

  it('carries the numbers, the actor verdict, the method, and the per-check remit', () => {
    const { system, user } = buildCriticPrompt(req);
    expect(system).toBe(CRITIC_SYSTEM_PROMPT);
    expect(user).toContain('honestP: 0.77');
    expect(user).toContain('naiveP: 2.4e-07');
    expect(user).toContain('flagged');
    expect(user).toContain('Welch t on per-unit means');
    // Check 1 remit tells the critic to veto when the honest p is significant.
    expect(user).toContain('VETO if');
    expect(user.toLowerCase()).toContain('pseudoreplication');
  });

  it('names the strict JSON contract fields', () => {
    expect(CRITIC_SYSTEM_PROMPT).toContain('keys_on');
    expect(CRITIC_SYSTEM_PROMPT).toContain('justification');
    expect(CRITIC_SYSTEM_PROMPT).toContain('confidence');
  });
});

describe('critique (unconfigured)', () => {
  it('throws ReasonerUnavailable when no backend is wired', async () => {
    await expect(createReasoner().critique(req)).rejects.toBeInstanceOf(ReasonerUnavailable);
  });
});

describe('critique (injected Messages seam)', () => {
  it('reports available and a bedrock source when a seam is injected', () => {
    const r = createReasoner({ invoke: async () => '{}' });
    expect(r.available).toBe(true);
    expect(r.source).toBe('bedrock');
  });

  it('parses a strict judgment reply', async () => {
    const reply = JSON.stringify({
      verdict: 'confirm',
      keys_on: 'honestP=0.77',
      justification: 'The honest p is not significant, so the effect does not survive the replicate-level test.',
      confidence: 'high',
    });
    const r = createReasoner({ invoke: async () => reply });
    const judgment = await r.critique(req);
    expect(judgment.verdict).toBe('confirm');
    expect(judgment.keys_on).toBe('honestP=0.77');
    expect(judgment.confidence).toBe('high');
  });

  it('recovers JSON from a fenced reply', async () => {
    const reply =
      'Here is my ruling:\n```json\n' +
      JSON.stringify({ verdict: 'veto', keys_on: 'honestP=4.8e-06', justification: 'The honest p is significant.', confidence: 'high' }) +
      '\n```';
    const judgment = await createReasoner({ invoke: async () => reply }).critique(req);
    expect(judgment.verdict).toBe('veto');
  });

  it('throws ReasonerUnavailable on an unparseable reply (caller fails safe toward showing)', async () => {
    const r = createReasoner({ invoke: async () => 'no json here at all' });
    await expect(r.critique(req)).rejects.toBeInstanceOf(ReasonerUnavailable);
  });

  it('throws ReasonerUnavailable when the reply is not a valid verdict', async () => {
    const reply = JSON.stringify({ verdict: 'maybe', keys_on: 'x', justification: 'y', confidence: 'high' });
    await expect(createReasoner({ invoke: async () => reply }).critique(req)).rejects.toBeInstanceOf(
      ReasonerUnavailable,
    );
  });

  it('passes the built prompt through to the seam', async () => {
    let seen = '';
    const r = createReasoner({
      invoke: async ({ user }) => {
        seen = user;
        return JSON.stringify({ verdict: 'confirm', keys_on: 'n=4', justification: 'ok', confidence: 'medium' });
      },
    });
    await r.critique(req);
    expect(seen).toContain('honestP: 0.77');
  });
});
