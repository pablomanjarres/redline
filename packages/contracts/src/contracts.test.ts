import { describe, expect, it } from 'vitest';
import {
  DatasetInventory,
  inventoryHasField,
  inventoryKnowsGene,
} from './inventory.js';
import { ExtractedClaim, enforceClaimHonesty } from './claims.js';
import {
  Check1Config,
  Check2Config,
  Check3Config,
  Check4Config,
} from './checks.js';
import type { CheckId } from './primitives.js';

// A small but realistic inventory: the naive-foil CD4 T-cell scenario, thinned
// to just the fields these tests need. It parses through the Zod schema so the
// fixture cannot drift from the contract.
const inv: DatasetInventory = DatasetInventory.parse({
  file: 'cd4_tcell_perturbseq_subset.h5ad',
  nCells: 52000,
  nGenes: 3200,
  obs: [
    { name: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, sample: ['donor_1', 'donor_2'] },
    { name: 'condition', dtype: 'categorical', levels: 2, missing: 0, sample: ['KD', 'NT'] },
    { name: 'lane', dtype: 'categorical', levels: 2, missing: 0, sample: ['Lane-A', 'Lane-B'] },
    { name: 'leiden', dtype: 'categorical', levels: 8, missing: 0, sample: ['0', '1'] },
  ],
  uns: [
    {
      key: 'rank_genes_groups',
      kind: 'de_result',
      shape: '3200 x 5',
      columns: ['names', 'pvals', 'logfoldchanges'],
      groups: ['KD', 'NT'],
      genes: ['FOXP3', 'IL2RA', 'TNFRSF9', 'ICOS'],
      preview: 'stored DE result',
    },
  ],
  clusterFields: ['leiden'],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts'],
  obsm: ['X_pca', 'X_umap'],
  varNamesSample: ['FOXP3', 'IL2RA', 'TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4'],
});

/** A schema-valid, in-scope, fully-grounded claim. Override to build variants. */
function claim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return ExtractedClaim.parse({
    id: 'c1',
    text: 'IL2RA knockdown upregulates FOXP3 across CD4 T cells.',
    source: 'stored_result',
    restsOn: 'stored DE result rank_genes_groups, grouping condition, gene FOXP3',
    evidenceRefs: { obsColumns: ['condition'], unsKeys: ['rank_genes_groups'], genes: ['FOXP3'] },
    checks: [{ check: 1, params: { grouping: 'condition', gene: 'FOXP3' } }],
    confidence: 'high',
    status: 'proposed',
    ...overrides,
  });
}

describe('inventoryHasField', () => {
  it('matches obs columns and cluster fields, case-sensitively', () => {
    expect(inventoryHasField(inv, 'condition')).toBe(true);
    expect(inventoryHasField(inv, 'leiden')).toBe(true); // a cluster field
    expect(inventoryHasField(inv, 'Condition')).toBe(false); // case-sensitive
    expect(inventoryHasField(inv, 'batch_xyz')).toBe(false);
    expect(inventoryHasField(inv, '')).toBe(false);
  });
});

describe('inventoryKnowsGene', () => {
  it('matches var_names and stored-result genes, case-insensitively', () => {
    expect(inventoryKnowsGene(inv, 'FOXP3')).toBe(true);
    expect(inventoryKnowsGene(inv, 'foxp3')).toBe(true); // case-insensitive
    expect(inventoryKnowsGene(inv, ' TIGIT ')).toBe(true); // trimmed
    expect(inventoryKnowsGene(inv, 'MADEUP1')).toBe(false);
    expect(inventoryKnowsGene(inv, '')).toBe(false);
  });
});

describe('enforceClaimHonesty', () => {
  it('empty in, empty out (never invents a claim to fill the list)', () => {
    expect(enforceClaimHonesty(inv, [])).toEqual([]);
  });

  it('leaves a legitimate, fully-grounded claim untouched', () => {
    const c = claim();
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got).toEqual(c);
  });

  it('forces an out-of-scope claim to carry zero checks', () => {
    const c = claim({
      status: 'out_of_scope',
      outOfScopeReason: 'Redline has no check for this kind of statement.',
      checks: [{ check: 1, params: { grouping: 'condition' } }],
    });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got?.status).toBe('out_of_scope');
    expect(got?.checks).toEqual([]);
  });

  it('drops a claim whose evidenceRefs cite a fabricated obs column', () => {
    const c = claim({
      evidenceRefs: { obsColumns: ['ghost_column'], unsKeys: [], genes: [] },
    });
    expect(enforceClaimHonesty(inv, [c])).toEqual([]);
  });

  it('drops a claim whose evidenceRefs cite a fabricated uns key', () => {
    const c = claim({
      evidenceRefs: { obsColumns: [], unsKeys: ['not_a_stored_result'], genes: [] },
    });
    expect(enforceClaimHonesty(inv, [c])).toEqual([]);
  });

  it('demotes (never deletes) a claim that references an unknown gene', () => {
    const c = claim({
      confidence: 'high',
      evidenceRefs: { obsColumns: ['condition'], unsKeys: ['rank_genes_groups'], genes: ['MADEUP1'] },
      checks: [{ check: 1, params: { grouping: 'condition', gene: 'MADEUP1' } }],
    });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got).toBeDefined();
    expect(got?.confidence).toBe('low');
    expect(got?.ambiguousRouting).toContain('MADEUP1');
    // routing is preserved, not deleted
    expect(got?.checks).toHaveLength(1);
    expect(got?.checks[0]?.check).toBe(1);
  });

  it('de-duplicates routes that target the same check id (first wins)', () => {
    const c = claim({
      checks: [
        { check: 1, params: { grouping: 'condition', gene: 'FOXP3' } },
        { check: 1, params: { grouping: 'condition' } },
        { check: 4, params: { interest: 'condition', nuisance: ['lane'] } },
      ],
    });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got?.checks.map((r) => r.check)).toEqual([1, 4]);
    // the first check-1 route is the one kept
    expect(got?.checks[0]?.params).toEqual({ grouping: 'condition', gene: 'FOXP3' });
  });

  it('drops a route whose column param names an absent obs column, keeps the rest', () => {
    const c = claim({
      checks: [
        { check: 1, params: { grouping: 'condition' } },
        { check: 4, params: { interest: 'condition', nuisance: ['batch_xyz'] } },
      ],
    });
    const [got] = enforceClaimHonesty(inv, [c]);
    // the check-4 route names a nuisance column the data lacks, so it is dropped;
    // the claim itself survives with its valid route.
    expect(got).toBeDefined();
    expect(got?.checks.map((r) => r.check)).toEqual([1]);
  });

  it('drops a route with an out-of-range check id, keeps the valid one', () => {
    // Defense in depth. Production validates model JSON with ExtractedClaim.parse
    // before this gate runs (see packages/reasoning/src/claims.ts), so a check id
    // outside 1..4 cannot reach enforceClaimHonesty through the typed API. The
    // VALID_CHECK_IDS filter still guards any caller that skips that validation.
    // To exercise it we hold the out-of-range id as a plain number, so a single
    // CheckId assertion is legal here (no `as unknown as`, no `any`), and we set
    // `checks` after claim() has parsed, so the invalid id survives to the gate.
    const outOfRangeCheck: number = 9;
    const c: ExtractedClaim = {
      ...claim(),
      checks: [
        { check: outOfRangeCheck as CheckId, params: {} },
        { check: 2, params: { grouping: 'condition' } },
      ],
    };
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got?.checks.map((r) => r.check)).toEqual([2]);
  });

  it('preserves order and never pads: N in, at most N out', () => {
    const keep1 = claim({ id: 'k1' });
    const fabricated = claim({
      id: 'drop',
      evidenceRefs: { obsColumns: ['ghost_column'], unsKeys: [], genes: [] },
    });
    const keep2 = claim({ id: 'k2', text: 'A distinct knockdown-responsive T-cell state.' });
    const got = enforceClaimHonesty(inv, [keep1, fabricated, keep2]);
    expect(got.map((c) => c.id)).toEqual(['k1', 'k2']);
  });
});

// ── Finding 1: an in-scope claim whose every route is pruned is surfaced, not
// silently left looking auditable while it audits nothing (honesty invariant d).
describe('enforceClaimHonesty: all-routes-pruned is surfaced (finding 1)', () => {
  // A grounded claim (evidenceRefs cite only present data, so rule 2 does not
  // drop it) whose route params point at obs columns the inventory lacks.
  const groundedRefs = { obsColumns: [], unsKeys: ['rank_genes_groups'], genes: [] };

  interface RoutingCase {
    name: string;
    checks: ExtractedClaim['checks'];
    // What the surfaced note must name (empty means: expect no surfacing).
    namesColumns: string[];
    // Which check ids should survive (empty means checks end up []).
    survivingChecks: number[];
    // Whether confidence should be demoted to 'low' by the rule.
    surfaced: boolean;
  }

  const cases: RoutingCase[] = [
    {
      name: 'every route names a missing column: surfaced, low, checks emptied',
      checks: [
        { check: 1, params: { grouping: 'ghost_group' } },
        { check: 4, params: { interest: 'phantom_condition', nuisance: ['nowhere'] } },
      ],
      namesColumns: ['ghost_group', 'phantom_condition', 'nowhere'],
      survivingChecks: [],
      surfaced: true,
    },
    {
      name: 'one valid route survives: not surfaced, confidence intact',
      checks: [
        { check: 1, params: { grouping: 'condition' } },
        { check: 4, params: { interest: 'condition', nuisance: ['ghost_batch'] } },
      ],
      namesColumns: [],
      survivingChecks: [1],
      surfaced: false,
    },
  ];

  it.each(cases)('$name', ({ checks, namesColumns, survivingChecks, surfaced }) => {
    const c = claim({ evidenceRefs: groundedRefs, checks });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got).toBeDefined();
    // Never reclassified: the scientist may still be making the claim.
    expect(got?.status).toBe('proposed');
    expect(got?.status).not.toBe('out_of_scope');
    expect(got?.checks.map((r) => r.check)).toEqual(survivingChecks);
    if (surfaced) {
      expect(got?.confidence).toBe('low');
      expect(got?.ambiguousRouting).toBeDefined();
      for (const col of namesColumns) expect(got?.ambiguousRouting).toContain(col);
    } else {
      // A partly-pruned claim that keeps a real route is left confident and unflagged.
      expect(got?.confidence).toBe('high');
      expect(got?.ambiguousRouting).toBeUndefined();
    }
  });

  it('leaves a claim that legitimately arrived with checks: [] untouched', () => {
    // Never routed anywhere in the first place, so there is no pruning to surface.
    const c = claim({ evidenceRefs: groundedRefs, checks: [] });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got).toEqual(c);
    expect(got?.confidence).toBe('high');
    expect(got?.ambiguousRouting).toBeUndefined();
  });

  it('does not surface an out-of-scope claim whose routes were emptied', () => {
    // out_of_scope claims carry their outOfScopeReason, not an all-pruned note.
    const c = claim({
      status: 'out_of_scope',
      outOfScopeReason: 'Redline has no check for this kind of statement.',
      checks: [{ check: 1, params: { grouping: 'ghost_group' } }],
    });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got?.status).toBe('out_of_scope');
    expect(got?.checks).toEqual([]);
    expect(got?.ambiguousRouting).toBeUndefined();
  });

  it('composes the all-pruned note with the unknown-gene note', () => {
    const c = claim({
      confidence: 'high',
      evidenceRefs: { obsColumns: [], unsKeys: ['rank_genes_groups'], genes: ['MADEUP1'] },
      checks: [{ check: 1, params: { grouping: 'ghost_group', gene: 'MADEUP1' } }],
    });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got?.confidence).toBe('low');
    expect(got?.checks).toEqual([]);
    expect(got?.ambiguousRouting).toContain('MADEUP1'); // gene note
    expect(got?.ambiguousRouting).toContain('ghost_group'); // pruned-route note
  });
});

// ── Finding 2: the gate guarantees unique, non-empty ids so the UI's patch- and
// remove-by-id and its React keys each address exactly one claim.
describe('enforceClaimHonesty: id uniqueness and backfill (finding 2)', () => {
  it('keeps the first colliding id and deterministically suffixes the rest', () => {
    const a = claim({ id: 'dup' });
    const b = claim({ id: 'dup', text: 'A distinct effector state.' });
    const d = claim({ id: 'dup', text: 'A third claim on the same id.' });
    const got = enforceClaimHonesty(inv, [a, b, d]);
    expect(got.map((c) => c.id)).toEqual(['dup', 'dup-2', 'dup-3']);
    // All ids are unique.
    expect(new Set(got.map((c) => c.id)).size).toBe(got.length);
  });

  it.each([
    ['an empty string', ''],
    ['spaces only', '   '],
    ['tabs and newlines', '\t \n'],
  ])('assigns a deterministic id from position when the id is %s', (_label, badId) => {
    const c = claim({ id: badId });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got?.id).toBe('claim-0'); // input index 0
    // Deterministic: the same input yields the same id every time.
    const [again] = enforceClaimHonesty(inv, [c]);
    expect(again?.id).toBe('claim-0');
  });

  it('backfills empty ids by input position, preserving uniqueness', () => {
    const good = claim({ id: 'real' });
    const blank1 = claim({ id: '', text: 'first blank' });
    const blank2 = claim({ id: '  ', text: 'second blank' });
    const got = enforceClaimHonesty(inv, [good, blank1, blank2]);
    expect(got.map((c) => c.id)).toEqual(['real', 'claim-1', 'claim-2']);
    expect(new Set(got.map((c) => c.id)).size).toBe(got.length);
  });

  it('de-collides a positional backfill id against a real claim id', () => {
    // A real claim already owns `claim-1`; the blank at index 1 must not clobber it.
    const collidingReal = claim({ id: 'claim-1' });
    const blank = claim({ id: '', text: 'blank at index 1' });
    const got = enforceClaimHonesty(inv, [collidingReal, blank]);
    expect(got.map((c) => c.id)).toEqual(['claim-1', 'claim-1-2']);
    expect(new Set(got.map((c) => c.id)).size).toBe(got.length);
  });

  it('is pure and idempotent: same input twice, and f(f(x)) == f(x)', () => {
    const input = [
      claim({ id: 'x1' }),
      claim({ id: 'x1', text: 'colliding id' }),
      claim({ id: '', text: 'blank id' }),
      claim({
        // an unknown-gene demotion, to exercise a note on the idempotency path
        id: 'g1',
        text: 'unknown gene claim',
        evidenceRefs: { obsColumns: ['condition'], unsKeys: ['rank_genes_groups'], genes: ['MADEUP1'] },
        checks: [{ check: 1, params: { grouping: 'condition', gene: 'MADEUP1' } }],
      }),
    ];
    const once = enforceClaimHonesty(inv, input);
    // Same input, called twice: identical output (deterministic, no mutation).
    const twice = enforceClaimHonesty(inv, input);
    expect(twice).toEqual(once);
    // Feeding the output back in changes nothing (idempotent). No stacked notes,
    // no re-suffixed ids, no re-demoted confidence.
    expect(enforceClaimHonesty(inv, once)).toEqual(once);
  });

  it('every pre-existing rule still holds under the id and routing changes', () => {
    // A single pass that exercises: fabrication drop, out_of_scope emptying,
    // unknown-gene demotion, route dedupe, and zero-in-zero-out together.
    expect(enforceClaimHonesty(inv, [])).toEqual([]);

    const fabricated = claim({
      id: 'fab',
      evidenceRefs: { obsColumns: ['ghost_column'], unsKeys: [], genes: [] },
    });
    const outOfScope = claim({
      id: 'oos',
      status: 'out_of_scope',
      outOfScopeReason: 'No check applies.',
      checks: [{ check: 1, params: { grouping: 'condition' } }],
    });
    const unknownGene = claim({
      id: 'gene',
      evidenceRefs: { obsColumns: ['condition'], unsKeys: ['rank_genes_groups'], genes: ['MADEUP1'] },
      checks: [{ check: 1, params: { grouping: 'condition', gene: 'MADEUP1' } }],
    });
    const duped = claim({
      id: 'route',
      checks: [
        { check: 1, params: { grouping: 'condition', gene: 'FOXP3' } },
        { check: 1, params: { grouping: 'condition' } },
      ],
    });

    const got = enforceClaimHonesty(inv, [fabricated, outOfScope, unknownGene, duped]);
    // fabrication dropped; the other three survive, order preserved.
    expect(got.map((c) => c.id)).toEqual(['oos', 'gene', 'route']);
    // out_of_scope emptied.
    expect(got[0]?.checks).toEqual([]);
    // unknown gene demoted, not deleted.
    expect(got[1]?.confidence).toBe('low');
    expect(got[1]?.checks).toHaveLength(1);
    // routes de-duplicated by check id, first wins.
    expect(got[2]?.checks.map((r) => r.check)).toEqual([1]);
    expect(got[2]?.checks[0]?.params).toEqual({ grouping: 'condition', gene: 'FOXP3' });
  });
});

// ── The identifying check-config knobs are optional and absent-by-default ─────
// Each knob name is the exact string the matching Python pillar reads via
// cfg_get, so a route param can reach the engine instead of being dropped. Every
// knob is optional: a base config that omits it still parses (no existing config
// breaks), and a config that carries it parses and round-trips unchanged.
describe('check configs: optional identifying knobs (F1 foundation)', () => {
  // Base configs exactly as the engine ships them today, with none of the new
  // optional knobs set. All four must still parse, so nothing existing breaks.
  const base1 = { unit: 'donor_id', grouping: 'condition', alpha: 0.05 };
  const base2 = { split: 0.5, grouping: 'leiden' };
  const base3 = { min: 0.2, max: 2.0, step: 0.2, track: 'Effector', scrub: 0.9 };
  const base4 = { interest: 'condition', nuisance: ['lane'] };

  it('Check1Config parses without gene, and the key stays absent (not undefined)', () => {
    const parsed = Check1Config.parse(base1);
    expect(parsed).toEqual(base1);
    expect('gene' in parsed).toBe(false);
  });

  it('Check1Config parses with gene and round-trips (Pillar 1 reads `gene`)', () => {
    const withGene = { ...base1, gene: 'FOXP3' };
    const parsed = Check1Config.parse(withGene);
    expect(parsed.gene).toBe('FOXP3');
    expect(parsed).toEqual(withGene);
    // Idempotent round-trip: parsing the parsed value changes nothing.
    expect(Check1Config.parse(parsed)).toEqual(parsed);
  });

  it('Check2Config parses without markers or target_group; both keys stay absent', () => {
    const parsed = Check2Config.parse(base2);
    expect(parsed).toEqual(base2);
    expect('markers' in parsed).toBe(false);
    expect('target_group' in parsed).toBe(false);
  });

  it('Check2Config parses with markers[] and target_group and round-trips', () => {
    // target_group is the exact name double_dipping.py reads; markers is the
    // exact name it reads for the marker set.
    const withState = {
      ...base2,
      markers: ['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4'],
      target_group: 'Activated Treg-like',
    };
    const parsed = Check2Config.parse(withState);
    expect(parsed.markers).toEqual(['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4']);
    expect(parsed.target_group).toBe('Activated Treg-like');
    expect(parsed).toEqual(withState);
    expect(Check2Config.parse(parsed)).toEqual(parsed);
  });

  it('Check3Config still carries track and gains no new knob (cluster -> track alias is engine-side)', () => {
    const parsed = Check3Config.parse(base3);
    expect(parsed).toEqual(base3);
    expect(parsed.track).toBe('Effector');
  });

  it('Check4Config parses without grouping; the key stays absent', () => {
    const parsed = Check4Config.parse(base4);
    expect(parsed).toEqual(base4);
    expect('grouping' in parsed).toBe(false);
  });

  it('Check4Config parses with grouping and round-trips (Pillar 4 falls back to `grouping`)', () => {
    const withGrouping = { ...base4, grouping: 'condition' };
    const parsed = Check4Config.parse(withGrouping);
    expect(parsed.grouping).toBe('condition');
    expect(parsed).toEqual(withGrouping);
    expect(Check4Config.parse(parsed)).toEqual(parsed);
  });
});

// ── ExtractedClaim.flagOnly: additive optional shape (spec section 8) ─────────
// The shape a later stage sets when the inventory shows a claim cannot be
// re-tested (for example no raw counts for a Check 1 or Check 2 claim). Nothing
// sets it in this stage, so a claim without it parses exactly as before, and the
// honesty backstop passes it through untouched when it is present.
describe('ExtractedClaim.flagOnly (spec section 8, shape only)', () => {
  const groundedClaim = {
    id: 'c1',
    text: 'IL2RA knockdown upregulates FOXP3 across CD4 T cells.',
    source: 'stored_result',
    restsOn: 'stored DE result rank_genes_groups, grouping condition, gene FOXP3',
    evidenceRefs: { obsColumns: ['condition'], unsKeys: ['rank_genes_groups'], genes: ['FOXP3'] },
    checks: [{ check: 1, params: { grouping: 'condition', gene: 'FOXP3' } }],
    confidence: 'high',
    status: 'proposed',
  };

  it('a claim without flagOnly parses and the key stays absent', () => {
    const parsed = ExtractedClaim.parse(groundedClaim);
    expect('flagOnly' in parsed).toBe(false);
  });

  it('a claim with flagOnly parses and round-trips', () => {
    const withFlagOnly = {
      ...groundedClaim,
      flagOnly: { reason: 'No raw counts, so pseudoreplication cannot be re-run.' },
    };
    const parsed = ExtractedClaim.parse(withFlagOnly);
    expect(parsed.flagOnly).toEqual({
      reason: 'No raw counts, so pseudoreplication cannot be re-run.',
    });
    expect(parsed).toEqual(withFlagOnly);
    expect(ExtractedClaim.parse(parsed)).toEqual(parsed);
  });

  it('enforceClaimHonesty preserves flagOnly on an active claim it keeps', () => {
    const c = ExtractedClaim.parse({
      ...groundedClaim,
      flagOnly: { reason: 'No raw counts to redo the test.' },
    });
    const [got] = enforceClaimHonesty(inv, [c]);
    expect(got?.flagOnly).toEqual({ reason: 'No raw counts to redo the test.' });
  });
});
