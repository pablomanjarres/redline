/**
 * Claim -> check routing: the pure decision layer for the intake and
 * claim-extraction feature. Given the confirmed claims, it decides which checks
 * run and with what config. This is engine logic, not UI: no React, no DOM, no
 * env, no Node builtins, so the "use client" session store and a plain Node
 * script can both import it and get the exact same answer. That shared home is
 * the point. The acceptance harness proves "user control flows through" by
 * importing routedChecksFrom from here, instead of hand-copying the session's
 * reducer where a drift between the two could never be caught.
 *
 * The load-bearing correctness guarantee lives in ownerClaimByCheck. A check
 * runs once with one config, so when several claims route to it exactly one has
 * to own that run. Both the displayed audit target (claimTextForCheck) and the
 * baked config (mergeRoutedConfig) read that one selection, so the claim the UI
 * names as the target and the claim whose params actually drive the check can
 * never disagree. That is the exact bug this module exists to keep fixed: Check
 * 3 once named the "Activated Treg-like" claim in its tile while it audited and
 * flagged the "Effector" state.
 */

import type { CheckConfigMap, CheckId, ExtractedClaim } from '@redline/contracts';

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
 * For each check, the ONE active claim that owns its single run. A check runs
 * once with one config, so exactly one claim can name the target that check
 * audits. The owner is the active claim routing to the check that is most
 * dedicated to it, measured as the fewest valid routes of its own, ties broken
 * by the order the claims appear (the first such claim wins). Both the displayed
 * audit target (claimTextForCheck) and the baked config (mergeRoutedConfig) read
 * this one selection, so the claim the UI names and the claim whose params drive
 * the check are always the same claim.
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
 * The route params of the claim that owns each check's single run. Reads the
 * ownerClaimByCheck selection, so the params baked into a check's config always
 * belong to the same claim the UI names as that check's target.
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
 * it drives. Check 3's tracked group arrives under `cluster` (the same key Check
 * 2 uses for a cluster label), but the Check-3 knob is named `track`. Without
 * this map the cluster param never matches a knob, so it is silently dropped and
 * Check 3 falls back to its default group, auditing a different state than the
 * one the owning claim (and the UI) names.
 */
export const ROUTE_PARAM_ALIASES: Partial<Record<CheckId, Record<string, string>>> = {
  3: { cluster: 'track' },
};

/**
 * Copy params, adding a config-knob key for any aliased route-param key present.
 * The original key is kept too (mergeRouteParams ignores keys the config does
 * not have, so a leftover `cluster` never reaches the config), and an existing
 * target key is never overwritten.
 *
 * @param params The route params to alias.
 * @param aliases The from->to alias map for this check, or undefined for none.
 * @returns The params with aliased knob keys added.
 */
export function aliasParams(
  params: Record<string, unknown>,
  aliases: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!aliases) return params;
  const out: Record<string, unknown> = { ...params };
  for (const [from, to] of Object.entries(aliases)) {
    if (
      Object.prototype.hasOwnProperty.call(params, from) &&
      !Object.prototype.hasOwnProperty.call(out, to)
    ) {
      out[to] = params[from];
    }
  }
  return out;
}

/**
 * Merge one claim route's params over a check config, keeping any knob the
 * params do not mention. A route's params bag is looser than a typed config (a
 * column param can arrive as a bare string where the config wants an array, and
 * carries extra keys like `reported` / `gene` / `cluster` that are not knobs),
 * so this coerces each mentioned param to the shape of the knob it overrides and
 * ignores keys the config does not have. That keeps the result a valid check
 * config the route can run, instead of a shape that would 400 and silently leave
 * a routed check unrun. Only knobs already present in `cfg` can be written, so
 * this layers, it never replaces.
 *
 * @param cfg One check's config object (the base knobs).
 * @param params The owning route's params to layer over it.
 * @returns A new config object with the mentioned knobs overridden.
 */
export function mergeRouteParams(
  cfg: Record<string, unknown>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cfg };
  for (const key of Object.keys(out)) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    const raw = params[key];
    const cur = out[key];
    if (Array.isArray(cur)) {
      if (Array.isArray(raw)) out[key] = raw.filter((x) => typeof x === 'string');
      else if (typeof raw === 'string' && raw !== '') out[key] = [raw];
    } else if (typeof cur === 'number') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (Number.isFinite(n)) out[key] = n;
    } else if (typeof cur === 'string') {
      if (typeof raw === 'string' && raw !== '') out[key] = raw;
    }
  }
  return out;
}

/**
 * Bake the owning claims' params into a copy of the config (route params over
 * knobs). Each check's params come from its ownerClaimByCheck selection and are
 * aliased first, so Check 3's `cluster` param lands on its `track` knob. Checks
 * no active claim routes to keep their base config untouched. The input `base`
 * is never mutated.
 *
 * @param base The current check config map.
 * @param claims The current claim list (null before extraction).
 * @returns A new config map with owning route params layered over the knobs.
 */
export function mergeRoutedConfig(
  base: CheckConfigMap,
  claims: ExtractedClaim[] | null,
): CheckConfigMap {
  const params = ownerRouteParams(claims);
  const cfg = cloneConfig(base);
  const target = cfg as Record<CheckId, Record<string, unknown>>;
  for (const id of IDS) {
    const p = params.get(id);
    if (p) target[id] = mergeRouteParams(target[id], aliasParams(p, ROUTE_PARAM_ALIASES[id]));
  }
  return cfg;
}

/**
 * The text to show as check `id`'s audit target: the owning active claim's text,
 * else the caller's fallback. Reads the SAME ownerClaimByCheck selection that
 * mergeRoutedConfig bakes into the config, so the claim the UI names and the
 * claim whose params drive the run are always the same claim.
 *
 * @param claims The current claim list (null before extraction).
 * @param id The check whose audit target to name.
 * @param fallback The text to show when no active claim routes to the check
 *   (the app passes the legacy per-scenario claim, else null).
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
