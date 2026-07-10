/**
 * Resolve which run a `/checks/[id]` URL points at. Pure and React-free so it can
 * be unit-tested without a session or a router.
 *
 * The [id] segment is a RunKey (`${claimId}::${checkId}`). The links that build it
 * run the key through `encodeURIComponent`, which turns "::" into "%3A%3A", and
 * Next's `useParams()` hands that segment back STILL percent-encoded. So the raw
 * param ("claim_001%3A%3A1") never equals a decoded run key ("claim_001::1"): the
 * segment must be decoded before it is matched, or every real run resolves to
 * nothing and its tile reads "This run is not on the board". (This is the bug this
 * module fixes; `Pipeline.tsx` already decodes the same segment for its active
 * state, so the two now agree.)
 *
 * A bare canonical check number is a convenience alias for that check's FIRST run
 * (the guided tour and the canonical `/checks/3` links use it). A real RunKey
 * always contains "::", so a bare number can never collide with one. The guard is
 * `^\d+$` rather than a hardcoded `1..4` so the alias tracks every registered
 * check, including the rigor checks 5-8 (and any added later) instead of silently
 * dead-ending on them.
 */

/** Decode a URL path segment, tolerating a malformed escape (a lone `%`). */
export function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape can never be a real run key, so match on the raw string
    // rather than throwing the whole route into an error boundary.
    return raw;
  }
}

/**
 * Find the run a URL segment names: the exact (decoded) RunKey, else a bare
 * canonical check number resolving to that check's first run, else undefined.
 * Structurally typed on `{ key, checkId }` so callers pass `PreparedRun[]` and
 * tests pass plain literals.
 */
export function resolveRun<T extends { key: string; checkId: number }>(
  runs: readonly T[],
  rawParam: string,
): T | undefined {
  const key = decodeParam(rawParam);
  const exact = runs.find((r) => r.key === key);
  if (exact) return exact;
  if (/^\d+$/.test(key)) return runs.find((r) => String(r.checkId) === key);
  return undefined;
}
