/**
 * Claim -> check routing: the pure decision layer for the intake and
 * claim-extraction feature. Given the confirmed claims, it decides which checks
 * run and with what config. This is engine logic, not UI: no React, no DOM, no
 * env, no Node builtins, so the "use client" session store and a plain Node
 * script can both import it and get the exact same answer. That shared home is
 * the point.
 *
 * The unit of work is one (claim, check) RUN, not one check. Spec section 9:
 * "For each confirmed claim, each routed check receives its parameters and
 * runs." When two claims route to the same check, each is its own run with its
 * own params, and nothing is discarded. `runsFrom` is that model; `configForRun`
 * bakes a single run's params over the base config. See `runsFrom` below.
 *
 * The legacy owner-per-check functions (`ownerClaimByCheck`, `ownerRouteParams`,
 * `mergeRoutedConfig`, `claimTextForCheck`) pick ONE owning claim per check and
 * silently drop the rest. They are kept only while apps/web still imports them,
 * and are marked `@deprecated`. New callers use `runsFrom` + `configForRun`.
 */

import { CHECK_KNOBS } from '@redline/contracts';
import type { CheckConfigMap, CheckId, ExtractedClaim, KnobKind } from '@redline/contracts';

const IDS: CheckId[] = [1, 2, 3, 4];
const VALID_IDS: ReadonlySet<CheckId> = new Set<CheckId>(IDS);

/** The claims that still count: everything the user has not removed. */
function activeClaims(claims: ExtractedClaim[] | null): ExtractedClaim[] {
  return (claims ?? []).filter((c) => c.status !== 'removed');
}

/** Deep-copy a config map so baking route params never mutates the caller's. */
function cloneConfig(c: CheckConfigMap): CheckConfigMap {
  return typeof structuredClone === 'function'
    ? structuredClone(c)
    : (JSON.parse(JSON.stringify(c)) as CheckConfigMap);
}

// ── The run model (fixes F2 at the engine layer) ─────────────────────────────

/** A run's stable key: `${claimId}::${checkId}`. */
export type RunKey = string;

/**
 * One (claim, check) unit of work. A check that several claims route to yields
 * one RunDescriptor per claim, so every ratified claim's audit runs and none is
 * silently discarded. `claimText` is carried so the surface that renders the run
 * names the exact claim whose params drive it (the two can never disagree,
 * because they come from the same descriptor).
 */
export interface RunDescriptor {
  key: RunKey;
  claimId: string;
  claimText: string;
  checkId: CheckId;
  params: Record<string, unknown>;
}

/** The stable key for a (claim, check) run. */
export function runKeyOf(claimId: string, checkId: CheckId): RunKey {
  return `${claimId}::${checkId}`;
}

/**
 * Every (active claim, valid route) as its own run. Active means the claim is
 * not `removed`; an `out_of_scope` claim carries `checks: []` by contract
 * (enforceClaimHonesty), so it contributes zero runs with no special-casing
 * here. A route to an id outside 1|2|3|4 is ignored.
 *
 * Order is deterministic: claims in their list order, and within a claim its
 * routes in ascending check id. enforceClaimHonesty de-duplicates a claim's
 * routes by check id upstream, so (claimId, checkId) is unique across the
 * result; this function relies on that invariant rather than re-deduping (a
 * test asserts it).
 *
 * This is the F2 fix: when two claims route to one check (on marson, both the
 * Activated Treg-like and the Effector claim route to Check 3), both appear
 * here. The old ownerClaimByCheck kept one and dropped the other.
 *
 * @param claims The current claim list (null before extraction).
 * @returns One RunDescriptor per (active claim, valid route), in order.
 */
export function runsFrom(claims: ExtractedClaim[] | null): RunDescriptor[] {
  const out: RunDescriptor[] = [];
  for (const c of activeClaims(claims)) {
    const validRoutes = c.checks.filter((r) => VALID_IDS.has(r.check));
    const ordered = [...validRoutes].sort((a, b) => a.check - b.check);
    for (const r of ordered) {
      out.push({
        key: runKeyOf(c.id, r.check),
        claimId: c.id,
        claimText: c.text,
        checkId: r.check,
        params: r.params,
      });
    }
  }
  return out;
}

/**
 * The set of checks a confirmed, non-removed claim routes to, in ascending id
 * order. A route to an id outside 1|2|3|4 is ignored. This is the list the
 * Workbench runs; a check absent from it renders no verdict (honesty rule 13).
 *
 * @param claims The current claim list (null before extraction).
 * @returns The routed check ids, sorted ascending, with no duplicates.
 */
export function routedChecksFrom(claims: ExtractedClaim[] | null): CheckId[] {
  const routed = new Set<CheckId>();
  for (const c of activeClaims(claims)) {
    for (const r of c.checks) if (VALID_IDS.has(r.check)) routed.add(r.check);
  }
  return IDS.filter((id) => routed.has(id));
}

/**
 * @deprecated Superseded by `runsFrom` (the (claim, check) run model). This
 * picks ONE owning claim per check and drops the rest, which is the F2 bug.
 * Kept only until apps/web migrates off it.
 *
 * For each check, the ONE active claim that owns its single run. The owner is
 * the active claim routing to the check that is most dedicated to it, measured
 * as the fewest valid routes of its own, ties broken by the order the claims
 * appear (the first such claim wins).
 *
 * @param claims The current claim list (null before extraction).
 * @returns A map from check id to the claim that owns that check's run. A check
 *   no active claim routes to is simply absent from the map.
 */
export function ownerClaimByCheck(
  claims: ExtractedClaim[] | null,
): Map<CheckId, ExtractedClaim> {
  const active = activeClaims(claims);
  const owners = new Map<CheckId, ExtractedClaim>();
  for (const id of IDS) {
    let best: ExtractedClaim | null = null;
    let bestRoutes = Infinity;
    for (const c of active) {
      const validRoutes = c.checks.filter((r) => VALID_IDS.has(r.check));
      if (!validRoutes.some((r) => r.check === id)) continue;
      if (validRoutes.length < bestRoutes) {
        best = c;
        bestRoutes = validRoutes.length;
      }
    }
    if (best) owners.set(id, best);
  }
  return owners;
}

/**
 * @deprecated Superseded by `runsFrom` (read each run's `params`). Reads the
 * ownerClaimByCheck selection, so it inherits the F2 single-owner drop. Kept
 * only until apps/web migrates.
 *
 * The route params of the claim that owns each check's single run.
 *
 * @param claims The current claim list (null before extraction).
 * @returns A map from check id to that check's owning route params.
 */
export function ownerRouteParams(
  claims: ExtractedClaim[] | null,
): Map<CheckId, Record<string, unknown>> {
  const m = new Map<CheckId, Record<string, unknown>>();
  for (const [id, c] of ownerClaimByCheck(claims)) {
    const route = c.checks.find((r) => r.check === id);
    if (route) m.set(id, route.params);
  }
  return m;
}

/**
 * Per-check aliases from an extraction route-param key to the engine config knob
 * it drives. The extraction model emits a cluster/state label under the key
 * `cluster`, but the engine knobs are named per check: Check 2's double-dipping
 * target is `target_group` (the exact knob double_dipping.py reads) and Check
 * 3's tracked group is `track` (fragility.py). Without this map the `cluster`
 * param matches no knob, is reported unmapped, and the check falls back to its
 * default group, auditing a different state than the owning claim names.
 */
export const ROUTE_PARAM_ALIASES: Partial<Record<CheckId, Record<string, string>>> = {
  2: { cluster: 'target_group' },
  3: { cluster: 'track' },
};

/**
 * Rename aliased route-param keys onto the config-knob key they drive. An alias
 * says "this route-param key IS this knob", so the value is moved from the
 * source key to the knob key and the source key is dropped. That keeps the
 * merged param bag honest: after aliasing, a key that names no knob genuinely
 * failed to land, so `mergeRouteParams` can report it as unmapped without a
 * false positive from a redundant alias source. An existing knob key is never
 * overwritten (a claim that already set the knob directly wins).
 *
 * @param params The route params to alias.
 * @param aliases The from->to alias map for this check, or undefined for none.
 * @returns A new params object with each aliased key renamed to its knob.
 */
export function aliasParams(
  params: Record<string, unknown>,
  aliases: Record<string, string> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };
  if (!aliases) return out;
  for (const [from, to] of Object.entries(aliases)) {
    if (from === to) continue;
    if (!Object.prototype.hasOwnProperty.call(out, from)) continue;
    if (!Object.prototype.hasOwnProperty.call(out, to)) out[to] = out[from];
    delete out[from];
  }
  return out;
}

/**
 * Route-param keys that are evidence or provenance, not computation inputs, so
 * naming no config knob is expected and is NOT a routing bug. `storedResult`
 * identifies which stored result the claim draws from and `reported` carries the
 * statistic the analysis reported; neither is fed to the pillar. `mergeRouteParams`
 * excludes these from `unmapped` so the signal stays meaningful. This is an
 * explicit, reviewable allow-list rather than a silent drop.
 */
export const NON_KNOB_PARAMS: ReadonlySet<string> = new Set<string>(['storedResult', 'reported']);

/** The result of merging one route's params over a check config. */
export interface MergeOutcome {
  /** The config with the mentioned knobs overridden (a fresh object). */
  config: Record<string, unknown>;
  /**
   * Every param key that named no knob on this config (after aliasing) and is
   * not an allow-listed evidence key. A non-empty list is a routing bug: a param
   * the claim carried could not reach the pillar. The caller should surface it,
   * never swallow it. This is the F1 fix (the old merge dropped these in
   * silence).
   */
  unmapped: string[];
}

/**
 * Merge one claim route's params over a check config, keeping any knob the
 * params do not mention, and REPORTING any param that could not be applied. A
 * route's params bag is looser than a typed config (a column param can arrive as
 * a bare string where the config wants an array), so this coerces each mentioned
 * param to the shape of the knob it overrides. The knobs come from the check's
 * schema (`CHECK_KNOBS`), not from the keys the base config value happens to
 * carry, so an optional knob absent from the defaults (`gene`, `markers`,
 * `target_group`) can still be written. Only declared knobs are written, so this
 * layers, it never replaces.
 *
 * A param key that names no knob on `cfg` lands in `unmapped` (unless it is an
 * allow-listed evidence key in `NON_KNOB_PARAMS`). Callers must pass params
 * through `aliasParams` first so a route-param key that has a knob under another
 * name (for example `cluster` -> `track`) is not falsely reported. An entry in
 * `unmapped` is a routing bug: the param never reached the pillar.
 *
 * @param cfg One check's config object (the base knobs).
 * @param params The owning route's params to layer over it (already aliased).
 * @returns The merged config and the list of params that named no knob.
 */
export function mergeRouteParams(
  cfg: Record<string, unknown>,
  params: Record<string, unknown>,
  knobs: Record<string, KnobKind>,
): MergeOutcome {
  const out: Record<string, unknown> = { ...cfg };
  const unmapped: string[] = [];
  for (const key of Object.keys(params)) {
    const kind = knobs[key];
    if (!kind) {
      // The param names no knob this check declares. Evidence keys are expected;
      // everything else is a param that could not be applied (F1).
      if (!NON_KNOB_PARAMS.has(key)) unmapped.push(key);
      continue;
    }
    const raw = params[key];
    let next: unknown;
    if (kind === 'string[]') {
      if (Array.isArray(raw)) next = raw.filter((x) => typeof x === 'string');
      else if (typeof raw === 'string' && raw !== '') next = [raw];
    } else if (kind === 'number') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (Number.isFinite(n)) next = n;
    } else if (typeof raw === 'string' && raw !== '') {
      next = raw;
    }
    // A param the knob exists for but whose value cannot be coerced never
    // reaches the pillar either, so it is reported rather than dropped.
    if (next === undefined) unmapped.push(key);
    else out[key] = next;
  }
  return { config: out, unmapped };
}

/** One check's config plus the params of its run that could not be applied. */
export interface RunConfigOutcome<Id extends CheckId = CheckId> {
  config: CheckConfigMap[Id];
  /** Params the run carried that named no knob (a routing bug). See `MergeOutcome`. */
  unmapped: string[];
}

/**
 * Bake a single run's params over the base config for that run's check, and
 * report any param that could not be applied. The run's params are aliased first
 * (so Check 3's `cluster` lands on its `track` knob), then merged over a fresh
 * copy of the base check config. The base map is never mutated.
 *
 * @param base The current check config map.
 * @param run The run whose params to bake (from `runsFrom`).
 * @returns The check's config for this run, plus its unmapped params.
 */
export function configForRunWithOutcome<Id extends CheckId>(
  base: CheckConfigMap,
  run: RunDescriptor,
): RunConfigOutcome<Id> {
  const id = run.checkId;
  const cfg = cloneConfig(base);
  const target = cfg as Record<CheckId, Record<string, unknown>>;
  const outcome = mergeRouteParams(
    target[id],
    aliasParams(run.params, ROUTE_PARAM_ALIASES[id]),
    CHECK_KNOBS[id],
  );
  target[id] = outcome.config;
  return { config: cfg[id] as CheckConfigMap[Id], unmapped: outcome.unmapped };
}

/**
 * Bake a single run's params over the base config for that run's check. Thin
 * wrapper over `configForRunWithOutcome` that returns just the config; callers
 * that need to surface a routing bug read `configForRunWithOutcome().unmapped`.
 *
 * @param base The current check config map.
 * @param run The run whose params to bake (from `runsFrom`).
 * @returns The check's config for this run.
 */
export function configForRun<Id extends CheckId>(
  base: CheckConfigMap,
  run: RunDescriptor,
): CheckConfigMap[Id] {
  return configForRunWithOutcome<Id>(base, run).config;
}

/**
 * One run, ready to execute: a RunDescriptor plus the config that run POSTs and
 * the params its route carried that named no knob (the F1 honesty ledger, so a
 * param that cannot reach a pillar is surfaced, never silently dropped).
 */
export interface PreparedRun extends RunDescriptor {
  config: CheckConfigMap[CheckId];
  unmapped: Array<{ check: CheckId; key: string }>;
}

/**
 * Every (active claim, valid route) as a run ready to execute, in the
 * deterministic order `runsFrom` gives. This is the one call the Workbench needs:
 * it replaces routedChecksFrom (unique check ids) + mergeRoutedConfig (single
 * owner), so two claims routed to one check yield two runs with their own params,
 * not one run with the winner's params and the loser silently dropped.
 *
 * @param base The current check config map (the knob defaults, per check).
 * @param claims The current claim list (null before extraction).
 * @returns One PreparedRun per (active claim, valid route).
 */
export function prepareRuns(
  base: CheckConfigMap,
  claims: ExtractedClaim[] | null,
): PreparedRun[] {
  return runsFrom(claims).map((run) => {
    const { config, unmapped } = configForRunWithOutcome(base, run);
    return { ...run, config, unmapped };
  });
}

/** One check's unmapped params, tagged with the check id (see `mergeRoutedConfigWithOutcome`). */
export interface RoutedConfigOutcome {
  config: CheckConfigMap;
  /** Every (check, param) the owner's route carried that named no knob. */
  unmapped: Array<{ check: CheckId; key: string }>;
}

/**
 * @deprecated Superseded by `configForRunWithOutcome` over `runsFrom`. Bakes
 * only the single owning claim's params per check (the F2 single-owner path),
 * but does surface unmapped params instead of dropping them. Kept only until
 * apps/web migrates.
 *
 * Bake the owning claims' params into a copy of the config, and collect every
 * param that named no knob. The input `base` is never mutated.
 *
 * @param base The current check config map.
 * @param claims The current claim list (null before extraction).
 * @returns The baked config map and the (check, param) pairs that did not apply.
 */
export function mergeRoutedConfigWithOutcome(
  base: CheckConfigMap,
  claims: ExtractedClaim[] | null,
): RoutedConfigOutcome {
  const params = ownerRouteParams(claims);
  const cfg = cloneConfig(base);
  const target = cfg as Record<CheckId, Record<string, unknown>>;
  const unmapped: Array<{ check: CheckId; key: string }> = [];
  for (const id of IDS) {
    const p = params.get(id);
    if (!p) continue;
    const outcome = mergeRouteParams(
      target[id],
      aliasParams(p, ROUTE_PARAM_ALIASES[id]),
      CHECK_KNOBS[id],
    );
    target[id] = outcome.config;
    for (const key of outcome.unmapped) unmapped.push({ check: id, key });
  }
  return { config: cfg, unmapped };
}

/**
 * @deprecated Superseded by `configForRun` over `runsFrom`. Reads the
 * ownerClaimByCheck selection, so it inherits the F2 single-owner drop. Kept
 * only until apps/web migrates.
 *
 * Bake the owning claims' params into a copy of the config (route params over
 * knobs). Checks no active claim routes to keep their base config untouched. The
 * input `base` is never mutated.
 *
 * @param base The current check config map.
 * @param claims The current claim list (null before extraction).
 * @returns A new config map with owning route params layered over the knobs.
 */
export function mergeRoutedConfig(
  base: CheckConfigMap,
  claims: ExtractedClaim[] | null,
): CheckConfigMap {
  return mergeRoutedConfigWithOutcome(base, claims).config;
}

/**
 * @deprecated Superseded by `RunDescriptor.claimText` from `runsFrom` (each run
 * carries the exact claim text whose params drive it). Reads the
 * ownerClaimByCheck selection, so it inherits the F2 single-owner drop. Kept
 * only until apps/web migrates.
 *
 * The text to show as check `id`'s audit target: the owning active claim's text,
 * else the caller's fallback.
 *
 * @param claims The current claim list (null before extraction).
 * @param id The check whose audit target to name.
 * @param fallback The text to show when no active claim routes to the check.
 * @returns The owning claim's text, or the fallback.
 */
export function claimTextForCheck(
  claims: ExtractedClaim[] | null,
  id: CheckId,
  fallback: string | null,
): string | null {
  const owner = ownerClaimByCheck(claims).get(id);
  return owner ? owner.text : fallback;
}
