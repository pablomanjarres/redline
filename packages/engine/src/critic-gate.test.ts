import { describe, expect, it } from 'vitest';
import type { CriticJudgment } from '@redline/contracts';
import { applyCriticGate, unverifiedAssessment } from './critic-gate.js';

const judgment = (verdict: CriticJudgment['verdict']): CriticJudgment => ({
  verdict,
  keys_on: 'honestP=0.77',
  justification: 'test reason',
  confidence: 'high',
});

describe('applyCriticGate', () => {
  it('confirm keeps the finding flagged', () => {
    const { state, assessment } = applyCriticGate('flagged', judgment('confirm'), 'bedrock');
    expect(state).toBe('flagged');
    expect(assessment.verdict).toBe('confirm');
    expect(assessment.unverified).toBe(false);
    expect(assessment.source).toBe('bedrock');
  });

  it('downgrade keeps the finding flagged but marks the advisory verdict (lowered, not suppressed)', () => {
    const { state, assessment } = applyCriticGate('flagged', judgment('downgrade'), 'bedrock');
    expect(state).toBe('flagged');
    expect(assessment.verdict).toBe('downgrade');
  });

  it('veto flips the finding to clean', () => {
    const { state, assessment } = applyCriticGate('flagged', judgment('veto'), 'bedrock');
    expect(state).toBe('clean');
    expect(assessment.verdict).toBe('veto');
  });

  it('carries the keyed-on number and justification onto the assessment', () => {
    const { assessment } = applyCriticGate('flagged', judgment('veto'), 'anthropic');
    expect(assessment.keysOn).toBe('honestP=0.77');
    expect(assessment.justification).toBe('test reason');
    expect(assessment.confidence).toBe('high');
  });
});

describe('unverifiedAssessment (fail safe)', () => {
  it('shows the finding by default and marks it unverified', () => {
    const a = unverifiedAssessment();
    expect(a.unverified).toBe(true);
    expect(a.verdict).toBe('confirm'); // confirm == keep showing the finding
    expect(a.source).toBe('curated');
  });

  it('carries a supplied reason', () => {
    const a = unverifiedAssessment('the call timed out');
    expect(a.justification).toContain('timed out');
  });
});
