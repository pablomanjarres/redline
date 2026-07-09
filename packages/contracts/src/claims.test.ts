import { describe, expect, it } from 'vitest';
import { assessExtraction, enforceClaimHonesty } from './claims.js';

// ── the two smuggles a review found: a claim with no routes, and a fake label ──
describe('enforceClaimHonesty: rules 8 and 9', () => {
  const inv = {
    file: 'a.h5ad',
    nCells: 100,
    nGenes: 3,
    // levels === sample.length, so the sample ENUMERATES the column. Only then can
    // the inventory disprove a label.
    obs: [
      { name: 'leiden', dtype: 'categorical' as const, levels: 2, missing: 0, sample: ['Naive', 'Effector'] },
      { name: 'partial', dtype: 'categorical' as const, levels: 9, missing: 0, sample: ['a', 'b'] },
    ],
    uns: [],
    clusterFields: ['leiden'],
    varNamesSample: ['FOXP3'],
    layers: [],
    obsm: [],
    hasRawCounts: true,
    countsSource: 'X',
  };

  const base = {
    id: 'c1',
    text: 'a claim',
    source: 'stored_result' as const,
    restsOn: 'the DE result',
    evidenceRefs: { obsColumns: [], unsKeys: [], genes: [] },
    confidence: 'high' as const,
    status: 'proposed' as const,
  };

  it('rule 9: a claim that cites nothing and routes nowhere cannot stay at high confidence', () => {
    const [out] = enforceClaimHonesty(inv, [{ ...base, checks: [] }]);
    expect(out).toBeDefined();
    expect(out!.confidence).toBe('low');
    expect(out!.ambiguousRouting).toMatch(/nothing audits it/i);
  });

  it('rule 9 stays quiet for a grounded claim that simply routes nowhere', () => {
    // A claim citing a real obs column but proposing no check is a legitimate
    // shape; rule 6 deliberately says nothing, and neither does rule 9.
    const grounded = { ...base, evidenceRefs: { obsColumns: ['leiden'], unsKeys: [], genes: [] }, checks: [] };
    const [out] = enforceClaimHonesty(inv, [grounded]);
    expect(out!.confidence).toBe('high');
    expect(out!.ambiguousRouting).toBeUndefined();
  });

  it('rule 8: a cluster label the grouping column provably lacks is pruned and surfaced', () => {
    const [out] = enforceClaimHonesty(inv, [
      { ...base, checks: [{ check: 3, params: { grouping: 'leiden', cluster: 'Ketamine-Responder-9000' } }] },
    ]);
    expect(out!.checks).toHaveLength(0);
    expect(out!.confidence).toBe('low');
    expect(out!.ambiguousRouting).toMatch(/Ketamine-Responder-9000/);
  });

  it('rule 8: a real cluster label survives', () => {
    const [out] = enforceClaimHonesty(inv, [
      { ...base, checks: [{ check: 3, params: { grouping: 'leiden', cluster: 'Effector' } }] },
    ]);
    expect(out!.checks).toHaveLength(1);
    expect(out!.confidence).toBe('high');
  });

  it('rule 8 stays silent when the sample cannot disprove the label', () => {
    // `partial` has 9 levels but only 2 sampled: absence proves nothing.
    const [out] = enforceClaimHonesty(inv, [
      { ...base, checks: [{ check: 3, params: { grouping: 'partial', cluster: 'z' } }] },
    ]);
    expect(out!.checks).toHaveLength(1);
    expect(out!.confidence).toBe('high');
  });

  it('is still idempotent and does not mutate its input', () => {
    const input = [{ ...base, checks: [] }];
    const snapshot = JSON.stringify(input);
    const once = enforceClaimHonesty(inv, input);
    const twice = enforceClaimHonesty(inv, once);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(twice).toEqual(once);
  });
});

// ── assessExtraction: the auditor must not go quiet on a dataset with results ──
describe('assessExtraction', () => {
  const withResults = {
    file: 'a.h5ad', nCells: 100, nGenes: 3,
    obs: [{ name: 'leiden', dtype: 'categorical' as const, levels: 2, missing: 0, sample: ['0', '1'] }],
    uns: [
      { key: 'rank_genes_groups', kind: 'marker_table' as const, shape: '2 x 50', columns: [], groups: ['0', '1'], genes: ['FOXP3'], preview: '' },
      { key: 'de_by_condition', kind: 'de_result' as const, shape: '3200 x 5', columns: ['pval'], groups: [], genes: ['FOXP3'], preview: '' },
    ],
    clusterFields: ['leiden'], varNamesSample: ['FOXP3'], layers: [], obsm: [],
    hasRawCounts: true, countsSource: 'X',
  };
  const noResults = { ...withResults, uns: [{ key: 'pca', kind: 'unknown' as const, shape: '', columns: [], groups: [], genes: [], preview: '' }] };

  const claim = (over: Record<string, unknown> = {}) => ({
    id: 'c', text: 't', source: 'stored_result' as const, restsOn: 'r',
    evidenceRefs: { obsColumns: [], unsKeys: [], genes: [] },
    checks: [{ check: 1 as const, params: { unit: 'donor', grouping: 'leiden' } }],
    confidence: 'high' as const, status: 'proposed' as const, ...over,
  });

  it('an empty claim list against a dataset WITH stored results is suspicious', () => {
    const a = assessExtraction(withResults, []);
    expect(a.auditableClaims).toBe(0);
    expect(a.evidenceKeys).toEqual(['rank_genes_groups', 'de_by_condition']);
    expect(a.suspiciouslyEmpty).toBe(true);
  });

  it('an empty claim list against a dataset WITHOUT stored results is not suspicious', () => {
    const a = assessExtraction(noResults, []);
    expect(a.suspiciouslyEmpty).toBe(false);
    expect(a.evidenceKeys).toEqual([]);
  });

  it('the suppression variant: every claim marked out_of_scope is still suspicious', () => {
    const a = assessExtraction(withResults, [claim({ status: 'out_of_scope', checks: [] }), claim({ id: 'c2', status: 'out_of_scope', checks: [] })]);
    expect(a.auditableClaims).toBe(0);
    expect(a.suspiciouslyEmpty).toBe(true);
  });

  it('a claim present but routed to no check does not count as auditable', () => {
    const a = assessExtraction(withResults, [claim({ checks: [] })]);
    expect(a.auditableClaims).toBe(0);
    expect(a.suspiciouslyEmpty).toBe(true);
  });

  it('one real auditable claim clears the signal', () => {
    const a = assessExtraction(withResults, [claim()]);
    expect(a.auditableClaims).toBe(1);
    expect(a.suspiciouslyEmpty).toBe(false);
  });
});
