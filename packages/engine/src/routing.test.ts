import { describe, it, expect } from 'vitest';
import type {
  CheckConfigMap,
  CheckRoute,
  ExtractedClaim,
} from '@redline/contracts';
import { MARSON_DEFAULTS, MARSON_CLAIMS } from './fixtures/marson.js';
import {
  routedChecksFrom,
  ownerClaimByCheck,
  ownerRouteParams,
  ROUTE_PARAM_ALIASES,
  aliasParams,
  mergeRouteParams,
  mergeRoutedConfig,
  claimTextForCheck,
} from './routing.js';

// ── Builders ─────────────────────────────────────────────────────────────────
// Minimal valid ExtractedClaim objects. Routing only reads status, checks, and
// text, but the type demands the whole shape, so a builder fills honest defaults.

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

const FOXP3 = 'marson-foxp3-significance'; // routes to Check 1 and Check 4
const TREG = 'marson-activated-treg-state'; // routes to Check 2 and Check 3
const EFFECTOR = 'marson-effector-state'; // routes to Check 3 only
const PSEUDOTIME = 'marson-pseudotime-trajectory'; // out_of_scope, no checks

// ── The regression this module exists to keep fixed ─────────────────────────

describe('Check 3 shows the same claim it audits (activated-treg vs effector regression)', () => {
  // The confirmed bug: on the default marson curated path, Check 3's tile named
  // the "Activated Treg-like" claim while the audit it ran and flagged was the
  // "Effector" state. Shown and audited disagreed. Both now read the one
  // ownerClaimByCheck selection, so they cannot.
  it('the claim named for Check 3 is the claim whose params drive the audited track', () => {
    const claims = MARSON_CLAIMS;
    const base = MARSON_DEFAULTS;

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
    // exact state the config audits. Shown == audited.
    const ownerRoute = owner?.checks.find((r) => r.check === 3);
    expect(ownerRoute?.params.cluster).toBe('Effector');
    expect(track).toBe(ownerRoute?.params.cluster);
    expect(track).toBe('Effector');
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
    // 'cluster' is not a Check-3 knob, so mergeRouteParams must not carry it.
    expect(Object.prototype.hasOwnProperty.call(cfg[3], 'cluster')).toBe(false);
  });

  it('without the alias the cluster param is silently dropped (proves the alias is load-bearing)', () => {
    // Same base, but feed the raw params straight to mergeRouteParams with no
    // alias step. 'cluster' matches no knob, so track keeps its default and the
    // key never lands. This is exactly the pre-fix failure the alias prevents.
    const merged = mergeRouteParams(base[3], { cluster: 'Effector' });
    expect(merged.track).toBe('Naive');
    expect(Object.prototype.hasOwnProperty.call(merged, 'cluster')).toBe(false);
  });

  it('aliasParams keeps the source key and only fills a missing target', () => {
    const out = aliasParams({ cluster: 'Effector' }, ROUTE_PARAM_ALIASES[3]);
    expect(out.track).toBe('Effector');
    expect(out.cluster).toBe('Effector'); // original kept; mergeRouteParams drops it later
    // An existing target is never overwritten.
    const pre = aliasParams({ cluster: 'Effector', track: 'Naive' }, ROUTE_PARAM_ALIASES[3]);
    expect(pre.track).toBe('Naive');
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
    // This is the shape enforceClaimHonesty produces: out_of_scope => checks [].
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
    // Start from the Treg removal, which dropped Check 2.
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
  });
});

// ── mergeRoutedConfig layers, it never replaces ─────────────────────────────

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
    // And Check 1 has exactly one owner selection (a Map holds one value per id).
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
