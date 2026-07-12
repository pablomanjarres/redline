import { describe, expect, it } from 'vitest';
import { decodeParam, resolveRun } from './resolve';

// A stand-in for the session's PreparedRun[]: two claims routed to Check 1 (so a
// bare "1" must pick the first), plus a rigor-check (7) run to guard the 5-8 path.
const runs = [
  { key: 'claim_001::1', checkId: 1 },
  { key: 'claim_005::1', checkId: 1 },
  { key: 'claim_002::3', checkId: 3 },
  { key: 'marson-effector-state::7', checkId: 7 },
];

describe('resolveRun', () => {
  it('resolves a percent-encoded run key (the exact shape Next useParams returns)', () => {
    // "%3A%3A" is how encodeURIComponent renders the "::" in every RunKey link.
    expect(resolveRun(runs, 'claim_001%3A%3A1')?.key).toBe('claim_001::1');
  });

  it('resolves a literal, already-decoded run key too', () => {
    expect(resolveRun(runs, 'claim_002::3')?.key).toBe('claim_002::3');
  });

  it('resolves a rigor-check (5-8) run key, not only the founding four', () => {
    expect(resolveRun(runs, 'marson-effector-state%3A%3A7')?.key).toBe('marson-effector-state::7');
  });

  it('resolves a bare canonical check number to that check’s first run', () => {
    expect(resolveRun(runs, '1')?.key).toBe('claim_001::1');
    expect(resolveRun(runs, '3')?.key).toBe('claim_002::3');
  });

  it('resolves a bare rigor check number (regression: the old /^[1-4]$/ dead-ended on 5-8)', () => {
    expect(resolveRun(runs, '7')?.key).toBe('marson-effector-state::7');
  });

  it('returns undefined when no run matches (an honest empty state, never a fabricated verdict)', () => {
    expect(resolveRun(runs, 'claim_999%3A%3A2')).toBeUndefined();
    expect(resolveRun(runs, '9')).toBeUndefined();
  });
});

describe('decodeParam', () => {
  it('decodes the encoded colons', () => {
    expect(decodeParam('claim_001%3A%3A1')).toBe('claim_001::1');
  });

  it('is a safe no-op on a malformed escape rather than throwing', () => {
    expect(decodeParam('%')).toBe('%');
    expect(decodeParam('claim_001::1')).toBe('claim_001::1');
  });
});
