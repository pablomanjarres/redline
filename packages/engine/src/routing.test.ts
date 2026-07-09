import { describe, it, expect } from 'vitest';
import { CHECK_KNOBS } from '@redline/contracts';
import type {
  CheckConfigMap,
  CheckId,
  CheckRoute,
  ExtractedClaim,
} from '@redline/contracts';
import { MARSON_DEFAULTS, MARSON_CLAIMS } from './fixtures/marson.js';
import {
  runKeyOf,
  runsFrom,
  configForRun,
  configForRunWithOutcome,
  routedChecksFrom,
  ownerClaimByCheck,
  ownerRouteParams,
  ROUTE_PARAM_ALIASES,
  NON_KNOB_PARAMS,
  aliasParams,
  mergeRouteParams,
  mergeRoutedConfig,
  claimTextForCheck,
  type RunDescriptor,
} from './routing.js';

// ── Builders ─────────────────────────────────────────────────────────────────
// Minimal valid ExtractedClaim objects. Routing only reads status, checks, id,
// and text, but the type demands the whole shape, so a builder fills honest
// defaults.

let seq = 0;
function claim(over: Partial<ExtractedClaim> & { checks: CheckRoute[] }): ExtractedClaim {
  seq += 1;
  return {
    id: over.id ?? `c-${seq}`,
    text: over.text ?? `claim ${seq}`,
    source: over.source ?? 'stored_result',
    restsOn: over.restsOn ?? 'a stored result',
    evidenceRefs: over.evidenceRefs ?? { obsColumns: [], unsKeys: [], genes: [] },
    checks: over.checks,
    confidence: over.confidence ?? 'high',
    status: over.status ?? 'proposed',
    ...(over.outOfScopeReason ? { outOfScopeReason: over.outOfScopeReason } : {}),
    ...(over.ambiguousRouting ? { ambiguousRouting: over.ambiguousRouting } : {}),
  };
}

/** The curated marson claim with the given id (the fixtures the app ships). */
function marson(id: string): ExtractedClaim {
  const c = MARSON_CLAIMS.find((x) => x.id === id);
  if (!c) throw new Error(`no marson fixture claim "${id}"`);
  return c;
}

/** The one run for (claimId, checkId), or throw. Avoids `!` / `as` in the tests. */
function runFor(runs: RunDescriptor[], claimId: string, checkId: CheckId): RunDescriptor {
  const r = runs.find((x) => x.claimId === claimId && x.checkId === checkId);
  if (!r) throw new Error(`no run ${runKeyOf(claimId, checkId)}`);
  return r;
}

const FOXP3 = 'marson-foxp3-significance'; // routes to Check 1 and Check 4
const TREG = 'marson-activated-treg-state'; // routes to Check 2 and Check 3
const EFFECTOR = 'marson-effector-state'; // routes to Check 3 only
const PSEUDOTIME = 'marson-pseudotime-trajectory'; // out_of_scope, no checks

// ── The Check-3 shown-vs-audited regression (F3 fixture fix in place) ────────

describe('Check 3 shows the same claim it audits (activated-treg vs effector regression)', () => {
  // The confirmed bug: on the default marson curated path, Check 3's tile named
  // the "Activated Treg-like" claim while the audit it ran and flagged was the
  // "Effector" state. Shown and audited disagreed. Both now read the one
  // ownerClaimByCheck selection, so they cannot.
  it('the claim named for Check 3 is the claim whose params drive the audited track', () => {
    const claims = MARSON_CLAIMS;

    // F3 fix: the base's Check-3 track default is 'Naive', which is NOT any
    // claim's target. So `track === 'Effector'` below can be true ONLY if the
    // owner's cluster param actually landed on the track knob. Auditing against
    // MARSON_DEFAULTS (track already 'Effector') let the assertion pass even
    // with the alias deleted; this cannot.
    const base: CheckConfigMap = {
      ...MARSON_DEFAULTS,
      3: { ...MARSON_DEFAULTS[3], track: 'Naive' },
    };

    // The owner of Check 3 is the Effector claim: it has one valid route (Check
    // 3), fewer than the Treg claim's two (Checks 2 and 3), so it is the more
    // dedicated owner. Deterministic.
    const owner = ownerClaimByCheck(claims).get(3);
    expect(owner?.id).toBe(EFFECTOR);

    // What the tile shows for Check 3.
    const shown = claimTextForCheck(claims, 3, 'legacy fallback');
    expect(shown).toBe(owner?.text);
    expect(shown).toBe(marson(EFFECTOR).text);
    // It is NOT the Treg claim the bug wrongly displayed, even though the Treg
    // claim also routes to Check 3.
    expect(shown).not.toBe(marson(TREG).text);

    // What the audit actually runs for Check 3.
    const track = mergeRoutedConfig(base, claims)[3].track;

    // The state the owning claim names in its own Check-3 route params is the
    // exact state the config audits. Shown == audited, and it overrode 'Naive'.
    const ownerRoute = owner?.checks.find((r) => r.check === 3);
    expect(ownerRoute?.params.cluster).toBe('Effector');
    expect(track).toBe(ownerRoute?.params.cluster);
    expect(track).toBe('Effector');
  });
});

// ── The run model: runsFrom (the F2 fix) ─────────────────────────────────────

describe('runsFrom emits one run per (active claim, valid route)', () => {
  it('emits exactly the 5 marson runs, in claim order then ascending check id', () => {
    const runs = runsFrom(MARSON_CLAIMS);
    expect(runs.map((r) => [r.claimId, r.checkId])).toEqual([
      [FOXP3, 1],
      [FOXP3, 4],
      [TREG, 2],
      [TREG, 3],
      [EFFECTOR, 3],
    ]);
    expect(runFor(runs, FOXP3, 1).key).toBe(runKeyOf(FOXP3, 1));
    expect(runFor(runs, EFFECTOR, 3).key).toBe(runKeyOf(EFFECTOR, 3));
    expect(runFor(runs, EFFECTOR, 3).claimText).toBe(marson(EFFECTOR).text);
  });

  it("carries each route's own params on its run", () => {
    const runs = runsFrom(MARSON_CLAIMS);
    expect(runFor(runs, TREG, 3).params.cluster).toBe('Activated Treg-like');
    expect(runFor(runs, EFFECTOR, 3).params.cluster).toBe('Effector');
  });

  it('an out_of_scope claim carries checks:[] by contract, so it emits zero runs', () => {
    // This is the invariant runsFrom relies on instead of special-casing.
    expect(marson(PSEUDOTIME).status).toBe('out_of_scope');
    expect(marson(PSEUDOTIME).checks).toEqual([]);
    expect(runsFrom([marson(PSEUDOTIME)])).toEqual([]);
  });

  it('(claimId, checkId) is unique across the emitted runs (gate deduped within a claim)', () => {
    const runs = runsFrom(MARSON_CLAIMS);
    const keys = new Set(runs.map((r) => r.key));
    expect(keys.size).toBe(runs.length);
  });

  it("orders a claim's routes by ascending check id regardless of input order", () => {
    const c = claim({ id: 'z', checks: [{ check: 4, params: {} }, { check: 1, params: {} }] });
    expect(runsFrom([c]).map((r) => r.checkId)).toEqual([1, 4]);
  });

  it('drops a removed claim (it contributes no runs)', () => {
    const claims = [
      claim({ id: 'keep', checks: [{ check: 1, params: {} }] }),
      claim({ id: 'gone', status: 'removed', checks: [{ check: 2, params: {} }] }),
    ];
    expect(runsFrom(claims).map((r) => r.claimId)).toEqual(['keep']);
  });

  it('null / empty inputs yield no runs', () => {
    expect(runsFrom(null)).toEqual([]);
    expect(runsFrom([])).toEqual([]);
  });
});

// ── The silent-discard regression: both Check-3 audits survive (F2) ──────────

describe('runsFrom does not discard the second claim routing to a check (silent-discard regression)', () => {
  // The confirmed blocker: on marson both the Activated Treg-like claim and the
  // Effector claim route to Check 3. ownerClaimByCheck kept one and dropped the
  // other, so one ratified audit never ran. Both runs now exist.
  it('both cluster claims produce a Check-3 run', () => {
    const check3 = runsFrom(MARSON_CLAIMS).filter((r) => r.checkId === 3);
    expect(check3).toHaveLength(2);
    expect(check3.map((r) => r.claimId).sort()).toEqual([TREG, EFFECTOR].sort());
  });

  it('the two Check-3 runs bake different tracks (neither audit is lost)', () => {
    const runs = runsFrom(MARSON_CLAIMS);
    const tregCfg = configForRun<3>(MARSON_DEFAULTS, runFor(runs, TREG, 3));
    const effCfg = configForRun<3>(MARSON_DEFAULTS, runFor(runs, EFFECTOR, 3));
    expect(tregCfg.track).toBe('Activated Treg-like');
    expect(effCfg.track).toBe('Effector');
    expect(tregCfg.track).not.toBe(effCfg.track);
  });
});

// ── configForRun bakes one run's params, and surfaces unmapped ones ──────────

describe('configForRun bakes one run over the base config', () => {
  it("bakes track='Activated Treg-like' for the Treg run and track='Effector' for the Effector run", () => {
    const runs = runsFrom(MARSON_CLAIMS);
    expect(configForRun<3>(MARSON_DEFAULTS, runFor(runs, TREG, 3)).track).toBe('Activated Treg-like');
    expect(configForRun<3>(MARSON_DEFAULTS, runFor(runs, EFFECTOR, 3)).track).toBe('Effector');
  });

  it('leaves untouched knobs intact and never mutates the base map', () => {
    const snapshot = structuredClone(MARSON_DEFAULTS);
    const runs = runsFrom(MARSON_CLAIMS);
    const cfg = configForRun<3>(MARSON_DEFAULTS, runFor(runs, EFFECTOR, 3));
    expect(cfg.min).toBe(MARSON_DEFAULTS[3].min);
    expect(cfg.scrub).toBe(MARSON_DEFAULTS[3].scrub);
    expect(MARSON_DEFAULTS).toEqual(snapshot);
  });

  it('applies the claimed gene and reports nothing unmapped (F1)', () => {
    const runs = runsFrom(MARSON_CLAIMS);
    const { config, unmapped } = configForRunWithOutcome<1>(MARSON_DEFAULTS, runFor(runs, FOXP3, 1));
    expect(config.unit).toBe('donor_id');
    expect(config.grouping).toBe('condition');
    // `gene` is an optional Check-1 knob, absent from the defaults. The knobs
    // come from the schema, so it lands rather than being reported unreachable.
    expect(config.gene).toBe('FOXP3');
    expect(unmapped).toEqual([]); // 'reported' is an allow-listed evidence key
  });
});

// ── The golden-path unmapped ledger (F1: surfaced, not silently dropped) ─────

describe('golden-path unmapped ledger on MARSON_DEFAULTS', () => {
  // Every route param a marson claim carries now reaches the pillar that audits
  // it. A non-empty entry here is a routing bug: the claim named something the
  // check never received, so the check audited a target the interface did not
  // name. This ledger is the CI guard for that.
  it('every run applies every param its claim carries', () => {
    const ledger = runsFrom(MARSON_CLAIMS).map((r) => ({
      claim: r.claimId,
      check: r.checkId,
      unmapped: configForRunWithOutcome(MARSON_DEFAULTS, r).unmapped.slice().sort(),
    }));
    expect(ledger).toEqual([
      { claim: FOXP3, check: 1, unmapped: [] },
      { claim: FOXP3, check: 4, unmapped: [] },
      { claim: TREG, check: 2, unmapped: [] },
      { claim: TREG, check: 3, unmapped: [] },
      { claim: EFFECTOR, check: 3, unmapped: [] },
    ]);
  });
});

// ── ROUTE_PARAM_ALIASES actually applies (and is load-bearing) ───────────────

describe('ROUTE_PARAM_ALIASES maps the Check-3 cluster param onto the track knob', () => {
  // A base whose Check-3 default track is NOT 'Effector', so a change is visible.
  const base: CheckConfigMap = {
    1: { unit: 'donor_id', grouping: 'condition', alpha: 0.05 },
    2: { split: 0.3, grouping: 'leiden' },
    3: { min: 0.2, max: 2.0, step: 0.2, track: 'Naive', scrub: 0.9 },
    4: { interest: 'condition', nuisance: ['lane'] },
  };
  const claims = [
    claim({ id: 'x', checks: [{ check: 3, params: { cluster: 'Effector' } }] }),
  ];

  it('a Check-3 claim carrying {cluster:"Effector"} sets cfg[3].track === "Effector"', () => {
    const cfg = mergeRoutedConfig(base, claims);
    expect(cfg[3].track).toBe('Effector'); // overrode the 'Naive' default
  });

  it('the raw cluster key does not survive into the config', () => {
    const cfg = mergeRoutedConfig(base, claims);
    // 'cluster' is renamed to 'track' by aliasing and is not itself a knob.
    expect(Object.prototype.hasOwnProperty.call(cfg[3], 'cluster')).toBe(false);
  });

  it('without the alias the cluster param names no knob and is reported unmapped (F1)', () => {
    // Feed the raw params straight to mergeRouteParams with no alias step.
    // 'cluster' matches no Check-3 knob, so track keeps its default and the key
    // is surfaced in `unmapped` instead of vanishing. This is the pre-fix
    // failure mode, now visible rather than silent.
    const merged = mergeRouteParams(base[3], { cluster: 'Effector' }, CHECK_KNOBS[3]);
    expect(merged.config.track).toBe('Naive');
    expect(Object.prototype.hasOwnProperty.call(merged.config, 'cluster')).toBe(false);
    expect(merged.unmapped).toContain('cluster');
  });

  it('aliasParams renames the source key onto the knob and drops the source', () => {
    const out = aliasParams({ cluster: 'Effector' }, ROUTE_PARAM_ALIASES[3]);
    expect(out.track).toBe('Effector');
    expect(Object.prototype.hasOwnProperty.call(out, 'cluster')).toBe(false);
    // An existing target is never overwritten; the redundant source is dropped.
    const pre = aliasParams({ cluster: 'Effector', track: 'Naive' }, ROUTE_PARAM_ALIASES[3]);
    expect(pre.track).toBe('Naive');
    expect(Object.prototype.hasOwnProperty.call(pre, 'cluster')).toBe(false);
  });

  it('maps the Check-2 cluster param onto the target_group knob', () => {
    const out = aliasParams({ cluster: 'Activated Treg-like' }, ROUTE_PARAM_ALIASES[2]);
    expect(out.target_group).toBe('Activated Treg-like');
    expect(Object.prototype.hasOwnProperty.call(out, 'cluster')).toBe(false);
  });
});

// ── mergeRouteParams reports what it could not apply (F1) ─────────────────────

describe('mergeRouteParams surfaces unmapped params instead of dropping them', () => {
  const cfg1 = { unit: 'donor_id', grouping: 'condition', alpha: 0.05 };

  it('a param that names no knob lands in unmapped, while real knobs apply', () => {
    const { config, unmapped } = mergeRouteParams(
      cfg1,
      { unit: 'guide_batch', pseudotime: 'monocle' },
      CHECK_KNOBS[1],
    );
    expect(config.unit).toBe('guide_batch');
    expect(unmapped).toEqual(['pseudotime']);
  });

  it('an allow-listed evidence key is never reported unmapped', () => {
    const { unmapped } = mergeRouteParams(
      cfg1,
      { reported: 'p = 6.2e-11', storedResult: 'de_KD_vs_NT' },
      CHECK_KNOBS[1],
    );
    expect(unmapped).toEqual([]);
  });

  it('a fully-mapped route reports no unmapped params', () => {
    const { unmapped } = mergeRouteParams(
      cfg1,
      { unit: 'donor_id', grouping: 'condition' },
      CHECK_KNOBS[1],
    );
    expect(unmapped).toEqual([]);
  });

  it('coerces a bare-string param into an array knob and reports nothing unmapped', () => {
    const cfg4 = { interest: 'condition', nuisance: ['lane'] };
    const { config, unmapped } = mergeRouteParams(
      cfg4,
      { interest: 'condition', nuisance: 'lane' },
      CHECK_KNOBS[4],
    );
    expect(config.nuisance).toEqual(['lane']);
    expect(unmapped).toEqual([]);
  });
});

describe('NON_KNOB_PARAMS', () => {
  it('lists the evidence/provenance keys that are not computation inputs', () => {
    expect(NON_KNOB_PARAMS.has('reported')).toBe(true);
    expect(NON_KNOB_PARAMS.has('storedResult')).toBe(true);
    expect(NON_KNOB_PARAMS.has('gene')).toBe(false); // gene IS a knob, never an evidence key
  });
});

// ── routedChecksFrom: active-only, sorted, deduped ──────────────────────────

describe('routedChecksFrom', () => {
  it('unions the routes of the curated marson claims into {1,2,3,4}, sorted', () => {
    expect(routedChecksFrom(MARSON_CLAIMS)).toEqual([1, 2, 3, 4]);
  });

  it('ignores a removed claim (its routes drop from the set)', () => {
    const claims = [
      claim({ id: 'keep', checks: [{ check: 1, params: {} }] }),
      claim({ id: 'gone', status: 'removed', checks: [{ check: 2, params: {} }] }),
    ];
    expect(routedChecksFrom(claims)).toEqual([1]); // 2 dropped with the removed claim
  });

  it('an out_of_scope claim (checks emptied by the honesty gate) contributes nothing', () => {
    expect(marson(PSEUDOTIME).status).toBe('out_of_scope');
    expect(marson(PSEUDOTIME).checks).toEqual([]);
    expect(routedChecksFrom([marson(PSEUDOTIME)])).toEqual([]);
  });

  it('a check no active claim routes to is absent from the set', () => {
    const claims = [claim({ checks: [{ check: 1, params: {} }] })];
    const routed = routedChecksFrom(claims);
    expect(routed).toEqual([1]);
    expect(routed).not.toContain(2);
    expect(routed).not.toContain(3);
    expect(routed).not.toContain(4);
  });
});

// ── Removing the last claim on a check removes the check ─────────────────────

describe('removing the last claim routed to a check removes that check', () => {
  it('removing the Treg claim drops Check 2 but keeps Check 3 (Effector still routes there)', () => {
    const withoutTreg = MARSON_CLAIMS.map((c) =>
      c.id === TREG ? { ...c, status: 'removed' as const } : c,
    );
    const routed = routedChecksFrom(withoutTreg);
    expect(routed).not.toContain(2); // Treg was the only claim routing to Check 2
    expect(routed).toContain(3); // Effector still routes to Check 3
    expect(routed).toEqual([1, 3, 4]);
  });

  it('removing both cluster claims drops Check 3 entirely', () => {
    const withoutBoth = MARSON_CLAIMS.map((c) =>
      c.id === TREG || c.id === EFFECTOR ? { ...c, status: 'removed' as const } : c,
    );
    expect(routedChecksFrom(withoutBoth)).not.toContain(3);
    expect(routedChecksFrom(withoutBoth)).toEqual([1, 4]);
  });
});

// ── Editing a claim's routing changes the routed set ────────────────────────

describe('editing a claim routing changes the routed set', () => {
  it('stripping the Check-4 route off the FOXP3 claim drops Check 4', () => {
    const edited = MARSON_CLAIMS.map((c) =>
      c.id === FOXP3 ? { ...c, checks: c.checks.filter((r) => r.check !== 4) } : c,
    );
    const routed = routedChecksFrom(edited);
    expect(routed).not.toContain(4); // FOXP3 was the only claim routing to Check 4
    expect(routed).toEqual([1, 2, 3]);
  });
});

// ── A user_added claim contributes its routes ───────────────────────────────

describe('a user_added claim contributes its routes', () => {
  it('adding a user_added claim routing to Check 2 brings Check 2 back', () => {
    const withoutTreg = MARSON_CLAIMS.map((c) =>
      c.id === TREG ? { ...c, status: 'removed' as const } : c,
    );
    expect(routedChecksFrom(withoutTreg)).not.toContain(2);

    const manual = claim({
      id: 'user-manual',
      source: 'user_added',
      status: 'user_added',
      checks: [{ check: 2, params: { grouping: 'leiden', cluster: 'Activated Treg-like' } }],
    });
    const withManual = [...withoutTreg, manual];
    expect(routedChecksFrom(withManual)).toContain(2);
    // And the manual claim is a real run.
    expect(runsFrom(withManual).some((r) => r.claimId === 'user-manual' && r.checkId === 2)).toBe(true);
  });
});

// ── mergeRoutedConfig layers, it never replaces (deprecated owner path) ──────

describe('mergeRoutedConfig layers route params without dropping untouched knobs', () => {
  const base: CheckConfigMap = {
    1: { unit: 'donor_id', grouping: 'condition', alpha: 0.05 },
    2: { split: 0.3, grouping: 'leiden' },
    3: { min: 0.2, max: 2.0, step: 0.2, track: 'Effector', scrub: 0.9 },
    4: { interest: 'condition', nuisance: ['lane'] },
  };

  it('a claim mentioning only Check 1 unit leaves grouping and alpha intact', () => {
    const claims = [claim({ checks: [{ check: 1, params: { unit: 'guide_batch' } }] })];
    const cfg = mergeRoutedConfig(base, claims);
    expect(cfg[1].unit).toBe('guide_batch'); // the mentioned knob changed
    expect(cfg[1].grouping).toBe('condition'); // untouched knob kept
    expect(cfg[1].alpha).toBe(0.05); // untouched knob kept
  });

  it('coerces a bare-string nuisance param into the array the Check-4 knob wants', () => {
    const claims = [
      claim({ checks: [{ check: 4, params: { interest: 'condition', nuisance: 'lane' } }] }),
    ];
    const cfg = mergeRoutedConfig(base, claims);
    expect(cfg[4].nuisance).toEqual(['lane']);
    expect(cfg[4].interest).toBe('condition');
  });

  it('does not mutate the base config', () => {
    const snapshot = structuredClone(base);
    const claims = [claim({ checks: [{ check: 3, params: { cluster: 'Naive' } }] })];
    const cfg = mergeRoutedConfig(base, claims);
    expect(cfg).not.toBe(base); // a fresh copy
    expect(base).toEqual(snapshot); // the input is untouched
    expect(cfg[3].track).toBe('Naive'); // and the copy did get the override
  });
});

// ── Two claims on one check: exactly one owner, deterministically chosen ─────

describe('two active claims routing to the same check yield exactly one owner', () => {
  it('the claim with fewer valid routes owns the shared check', () => {
    const broad = claim({ id: 'broad', checks: [{ check: 1, params: {} }, { check: 4, params: {} }] });
    const narrow = claim({ id: 'narrow', checks: [{ check: 1, params: {} }] });
    // Order broad-first so a naive "first wins" would pick broad; the tie-break
    // is fewest-routes, so narrow (one route) must win.
    const owner = ownerClaimByCheck([broad, narrow]).get(1);
    expect(owner?.id).toBe('narrow');
    expect(ownerRouteParams([broad, narrow]).has(1)).toBe(true);
  });

  it('a true tie (equal route counts) is broken by claim order, first wins', () => {
    const first = claim({ id: 'first', checks: [{ check: 1, params: {} }] });
    const second = claim({ id: 'second', checks: [{ check: 1, params: {} }] });
    expect(ownerClaimByCheck([first, second]).get(1)?.id).toBe('first');
    expect(ownerClaimByCheck([second, first]).get(1)?.id).toBe('second');
  });
});

// ── Null / empty inputs ─────────────────────────────────────────────────────

describe('null and empty claim lists', () => {
  const base = MARSON_DEFAULTS;

  it('yield an empty routed set', () => {
    expect(routedChecksFrom(null)).toEqual([]);
    expect(routedChecksFrom([])).toEqual([]);
  });

  it('yield no owners', () => {
    expect(ownerClaimByCheck(null).size).toBe(0);
    expect(ownerClaimByCheck([]).size).toBe(0);
    expect(ownerRouteParams(null).size).toBe(0);
  });

  it('leave the base config unmodified (deep-equal, fresh copy)', () => {
    expect(mergeRoutedConfig(base, null)).toEqual(base);
    expect(mergeRoutedConfig(base, [])).toEqual(base);
    expect(mergeRoutedConfig(base, null)).not.toBe(base);
  });

  it('claimTextForCheck returns the fallback when no claim owns the check', () => {
    expect(claimTextForCheck(null, 1, 'legacy')).toBe('legacy');
    expect(claimTextForCheck([], 1, null)).toBe(null);
  });
});

// ── The knobs a claim's params name actually reach the pillar ─────────────────
//
// mergeRouteParams used to decide a knob existed by looking at the keys of the
// base config VALUE. An optional knob (gene, markers, target_group) is absent
// from the defaults, so it could never be written: Check 1 audited without
// knowing the claimed gene, and Check 2 audited its default group while the
// interface named the scientist's claim. The knobs now come from the schema.
describe("a claim's identifying params reach the check that audits it", () => {
  const runs = runsFrom(MARSON_CLAIMS);
  const runFor = (claimId: string, checkId: 1 | 2 | 3 | 4) =>
    runs.find((r) => r.claimId === claimId && r.checkId === checkId)!;

  it('Check 1 receives the claimed gene', () => {
    const run = runFor('marson-foxp3-significance', 1);
    const { config, unmapped } = configForRunWithOutcome(MARSON_DEFAULTS, run);
    expect((config as { gene?: string }).gene).toBe('FOXP3');
    expect(unmapped).toEqual([]);
  });

  it('Check 2 receives the claimed markers and the claimed target group', () => {
    const run = runFor('marson-activated-treg-state', 2);
    const { config, unmapped } = configForRunWithOutcome(MARSON_DEFAULTS, run);
    const cfg = config as { markers?: string[]; target_group?: string };
    expect(cfg.markers).toEqual(['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4']);
    expect(cfg.target_group).toBe('Activated Treg-like');
    expect(unmapped).toEqual([]);
  });

  it('a knob the check does not declare is still reported, never dropped', () => {
    const run = { ...runFor('marson-effector-state', 3), params: { cluster: 'Effector', pseudotime: 'x' } };
    const { unmapped } = configForRunWithOutcome(MARSON_DEFAULTS, run);
    expect(unmapped).toEqual(['pseudotime']);
  });
});
