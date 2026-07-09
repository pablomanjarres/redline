import { z } from 'zod';
import { CheckId, Confidence } from './primitives.js';
import { FieldSpec } from './fields.js';
import { DatasetInventory, inventoryHasField, inventoryKnowsGene } from './inventory.js';

/**
 * The claim object (spec section 5). An extracted claim is one auditable
 * statement the analysis makes, routed to the checks that can test it. The
 * extraction agent proposes these; the scientist ratifies them on the Claim
 * Review screen before anything runs in the Workbench.
 */

/** Where a claim came from. */
export const ClaimSource = z.enum(['stored_result', 'notebook', 'prose', 'user_added']);
export type ClaimSource = z.infer<typeof ClaimSource>;

/**
 * The lifecycle of a claim. `out_of_scope` is a claim Redline cannot audit: it
 * is shown to the user, clearly labeled, and never silently audited.
 */
export const ClaimStatus = z.enum([
  'proposed',
  'confirmed',
  'edited',
  'removed',
  'user_added',
  'out_of_scope',
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

/**
 * One routing of a claim to a check, with the specifics that check needs. The
 * `params` bag carries the grouping, gene, markers, cluster, unit, nuisance,
 * and reported statistic a check consumes. By convention the column-naming
 * params (`grouping`, `unit`, `nuisance`, `interest`) carry EXACT `obs` column
 * names, and the gene-naming params (`gene`, `markers`) carry gene symbols, so
 * the honesty backstop below can verify both against the inventory.
 */
export const CheckRoute = z.object({
  check: CheckId,
  params: z.record(z.string(), z.unknown()),
});
export type CheckRoute = z.infer<typeof CheckRoute>;

/**
 * The machine-checkable evidence a claim rests on: the `obs` columns, the `uns`
 * keys, and the genes it cites. The honesty backstop checks each of these
 * against the inventory so a claim built on data that is not present is caught
 * deterministically, not left to the model.
 */
export const EvidenceRefs = z.object({
  obsColumns: z.array(z.string()),
  unsKeys: z.array(z.string()),
  genes: z.array(z.string()),
});
export type EvidenceRefs = z.infer<typeof EvidenceRefs>;

export const ExtractedClaim = z.object({
  id: z.string(),
  /** The claim in plain language, as a scientist would state it. */
  text: z.string(),
  source: ClaimSource,
  /** The evidence in words: which stored result / grouping / genes / cluster. */
  restsOn: z.string(),
  /** The same evidence, machine-checkable. */
  evidenceRefs: EvidenceRefs,
  checks: z.array(CheckRoute),
  confidence: Confidence,
  status: ClaimStatus,
  /** Why a claim is outside scope (present when status is `out_of_scope`). */
  outOfScopeReason: z.string().optional(),
  /** Surfaced when routing is uncertain; never resolved silently (spec 8). */
  ambiguousRouting: z.string().optional(),
  /**
   * Set at extraction time when the inventory shows the claim cannot be
   * re-tested, so it is marked flag-only rather than audited against data that
   * cannot support the check (spec section 8, consistent with the engine's
   * degradation rule in docs/honesty-rules.md rule 7). The example case is a
   * claim routed to Check 1 or Check 2, which both require raw integer counts,
   * when `hasRawCounts === false` on the inventory. `reason` states what is
   * missing. This is the shape only: the detection at extraction time and the
   * UI that renders it land in a later stage, so nothing sets this field yet.
   */
  flagOnly: z.object({ reason: z.string() }).optional(),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaim>;

// ── Extraction I/O envelopes (spec sections 5, 7) ────────────────────────────

/** Everything the extraction agent reads: the inventory plus optional text. */
export const ClaimExtractionRequest = z.object({
  datasetTitle: z.string(),
  inventory: DatasetInventory,
  fields: z.array(FieldSpec),
  notebook: z.string().optional(),
  prose: z.string().optional(),
});
export type ClaimExtractionRequest = z.infer<typeof ClaimExtractionRequest>;

export const ClaimExtractionResponse = z.object({
  claims: z.array(ExtractedClaim),
});
export type ClaimExtractionResponse = z.infer<typeof ClaimExtractionResponse>;

/** Manual claim entry (spec section 7): the user types one sentence, the agent maps it. */
export const ClaimMappingRequest = z.object({
  datasetTitle: z.string(),
  inventory: DatasetInventory,
  fields: z.array(FieldSpec),
  text: z.string(),
});
export type ClaimMappingRequest = z.infer<typeof ClaimMappingRequest>;

export const ClaimMappingResponse = z.object({
  claim: ExtractedClaim,
});
export type ClaimMappingResponse = z.infer<typeof ClaimMappingResponse>;

// ── The honesty backstop ─────────────────────────────────────────────────────

/** Only 1, 2, 3, 4 are real checks; anything else is dropped at runtime. */
const VALID_CHECK_IDS: ReadonlySet<number> = new Set([1, 2, 3, 4]);

/**
 * Param keys whose values are `obs` column NAMES. Extraction must put exact
 * column names here so this guard can verify them.
 *
 * Genes live under the gene param keys and are checked (rule 5). Cluster labels
 * live under `cluster` and are checked by rule 8, but only when the inventory can
 * prove it: `obs.sample` is a sample, so a label absent from it is not necessarily
 * fabricated. Rule 8 says when it is.
 */
const COLUMN_PARAM_KEYS = ['grouping', 'unit', 'nuisance', 'interest'] as const;

/** Param keys whose values are gene symbols. */
const GENE_PARAM_KEYS = ['gene', 'markers'] as const;

function asParams(p: unknown): Record<string, unknown> {
  return p !== null && typeof p === 'object' && !Array.isArray(p)
    ? (p as Record<string, unknown>)
    : {};
}

/** Coerce a param value (string or array of strings) into a list of non-empty strings. */
function asStrings(v: unknown): string[] {
  if (typeof v === 'string') return v === '' ? [] : [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x !== '');
  return [];
}

/** The obs column a route's `cluster` label is drawn from, if the route names one. */
function routeClusterLabel(params: unknown): { column: string; label: string } | null {
  if (typeof params !== 'object' || params === null) return null;
  const p = params as Record<string, unknown>;
  const label = p.cluster;
  const column = p.grouping;
  if (typeof label !== 'string' || typeof column !== 'string') return null;
  if (label.trim() === '' || column.trim() === '') return null;
  return { column, label };
}

/**
 * Can the inventory DISPROVE this cluster label?
 *
 * `obs.sample` is a sample, not an enumeration, so a label missing from it proves
 * nothing in general. It proves something exactly when the sample is complete:
 * when the column's level count is known and the sample holds at least that many
 * distinct values. Only then is a missing label a fabrication.
 */
function labelIsProvablyAbsent(inv: DatasetInventory, column: string, label: string): boolean {
  const col = inv.obs.find((c) => c.name === column);
  if (!col || col.levels === null) return false;
  const distinct = new Set(col.sample);
  if (distinct.size < col.levels) return false; // the sample is partial; we cannot tell
  return !distinct.has(label);
}

function routeColumnRefs(params: unknown): string[] {
  const p = asParams(params);
  const out: string[] = [];
  for (const k of COLUMN_PARAM_KEYS) out.push(...asStrings(p[k]));
  return out;
}

function geneParamRefs(params: unknown): string[] {
  const p = asParams(params);
  const out: string[] = [];
  for (const k of GENE_PARAM_KEYS) out.push(...asStrings(p[k]));
  return out;
}

function dedupeStrings(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

function dedupeRoutesByCheck(routes: CheckRoute[]): CheckRoute[] {
  const seen = new Set<number>();
  const out: CheckRoute[] = [];
  for (const r of routes) {
    if (!seen.has(r.check)) {
      seen.add(r.check);
      out.push(r);
    }
  }
  return out;
}

/**
 * Append a note to a claim's `ambiguousRouting` message without duplicating it.
 * The de-dup keeps the whole gate idempotent: re-running it on its own output
 * does not stack a second copy of the same note. Deterministic, no clock.
 */
function appendNote(existing: string | undefined, note: string): string {
  if (existing === undefined || existing === '') return note;
  if (existing.includes(note)) return existing;
  return `${existing} ${note}`;
}

/**
 * Return `base` if it is unused, otherwise the first `${base}-N` (N counting up
 * from 2) that is free. Deterministic and stable: no randomness, no clock, no
 * counter that survives across calls, so the gate stays pure and its output is
 * asserted by tests.
 */
function uniqueId(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * enforceClaimHonesty: the deterministic honesty backstop for extraction.
 *
 * Extraction is a model call (packages/reasoning), so its output can drift,
 * hallucinate a column, or route to a check that cannot exist for this data.
 * This pure function is the non-negotiable gate the model output passes through
 * before it reaches the user or the Workbench. It is order-preserving and
 * idempotent: it maps the input in order, never adds or reorders, and re-running
 * it on its own output returns that output unchanged.
 *
 * Rules (each cites the spec line it enforces):
 *
 *  1. Zero in, zero out. It maps over the input and only ever drops or edits a
 *     claim. It never adds, pads, reorders, or fills the list. (Spec 11: "Never
 *     fabricate a claim to fill the list", invariant a.)
 *
 *  2. Pure fabrication is dropped. A claim whose evidenceRefs cite an `obs`
 *     column or an `uns` key the inventory does not contain is removed outright.
 *     Genes are deliberately NOT a drop reason here (see rule 5). (Spec 11,
 *     invariant e.)
 *
 *  3. Out-of-scope claims carry no checks. Any claim with status `out_of_scope`
 *     has its checks forced to []. It is labeled, never silently audited.
 *     (Spec 8 and 11, invariant b.)
 *
 *  4. Impossible routes are dropped, then de-duplicated. A CheckRoute is removed
 *     when its check id is not 1|2|3|4, or when a column-naming param
 *     (grouping, unit, nuisance, interest) points at an `obs` column absent from
 *     the inventory. Surviving routes are de-duplicated by check id (first
 *     occurrence wins). (Spec 5 and 8.)
 *
 *  5. An unknown gene demotes, it does not delete. A claim that references a
 *     gene the inventory does not know is kept, its confidence dropped to `low`,
 *     and ambiguousRouting set, so the uncertainty is surfaced to the user
 *     rather than resolved silently. (Spec 8 and 11, invariant e: demote, never
 *     silently drop.)
 *
 *  6. All-routes-pruned is surfaced, not silently emptied. An active
 *     (non-out_of_scope, non-removed) claim that ARRIVED with routes but lost
 *     every one to rule 4 must not be left looking auditable while it audits
 *     nothing. Its confidence is dropped to `low` and ambiguousRouting names the
 *     missing columns that dropped the routes, so the scientist is handed the
 *     problem instead of it being resolved silently. It is NOT deleted and NOT
 *     marked out_of_scope: the scientist may still be making the claim. This is
 *     distinct from a claim that legitimately arrived with checks: [] and was
 *     never routed anywhere, which is left untouched. (Spec 8 "Ambiguous
 *     routing, present the options"; honesty rule 12 / invariant d, "Surface
 *     uncertainty rather than resolving it silently".)
 *
 *  7. Ids are unique and non-empty in the output. The UI patches and removes a
 *     claim by id, and React keys on it, so two claims sharing an id would edit
 *     or remove both at once and collide keys. The gate keeps the first claim's
 *     id and gives any later colliding claim a deterministic, stable, suffixed
 *     id (`${id}-2`, `${id}-3`, ...). A claim that arrives with an empty or
 *     whitespace-only id gets a deterministic id derived from its input position
 *     (`claim-<index>`). No randomness and no clock, so the assignment is stable
 *     across runs and idempotent (a non-empty unique id is left as-is on a
 *     second pass). (Spec 5: each claim carries a stable id.)
 */
export function enforceClaimHonesty(
  inv: DatasetInventory,
  claims: ExtractedClaim[],
): ExtractedClaim[] {
  const knownUnsKeys = new Set(inv.uns.map((u) => u.key));
  const usedIds = new Set<string>();
  const out: ExtractedClaim[] = [];

  claims.forEach((claim, index) => {
    // Rule 2: pure fabrication (a cited obs column or uns key that is absent).
    const fabricatedObs = claim.evidenceRefs.obsColumns.some((c) => !inventoryHasField(inv, c));
    const fabricatedUns = claim.evidenceRefs.unsKeys.some((k) => !knownUnsKeys.has(k));
    if (fabricatedObs || fabricatedUns) return;

    // Gather every gene the claim references, before routing is touched (rule 5).
    const geneRefs = dedupeStrings([
      ...claim.evidenceRefs.genes,
      ...claim.checks.flatMap((r) => geneParamRefs(r.params)),
    ]);
    const unknownGenes = geneRefs.filter((g) => !inventoryKnowsGene(inv, g));

    // A claim is "active" when it is a live proposal, not one already set aside
    // (out_of_scope) or struck (removed). Only active claims that arrived with
    // routes are candidates for the all-routes-pruned surface (rule 6).
    const isActive = claim.status !== 'out_of_scope' && claim.status !== 'removed';
    const arrivedWithRoutes = isActive && claim.checks.length > 0;

    // Rule 3: an out-of-scope claim carries no checks.
    let routes = claim.status === 'out_of_scope' ? [] : claim.checks;
    // Rule 4: drop impossible routes, then de-duplicate by check id.
    routes = routes.filter((r) => VALID_CHECK_IDS.has(r.check));
    routes = routes.filter((r) => routeColumnRefs(r.params).every((c) => inventoryHasField(inv, c)));

    // Rule 8: a cluster label the inventory can DISPROVE is a fabricated audit
    // target. Auditing "the Ketamine-Responder-9000 state" against a dataset whose
    // grouping column has no such level would run a check on nothing.
    const fabricatedLabels: string[] = [];
    routes = routes.filter((r) => {
      const ref = routeClusterLabel(r.params);
      if (!ref) return true;
      if (labelIsProvablyAbsent(inv, ref.column, ref.label)) {
        fabricatedLabels.push(`${ref.label} (in ${ref.column})`);
        return false;
      }
      return true;
    });
    routes = dedupeRoutesByCheck(routes);

    let confidence = claim.confidence;
    let ambiguousRouting = claim.ambiguousRouting;

    if (fabricatedLabels.length > 0) {
      confidence = 'low';
      ambiguousRouting = appendNote(
        ambiguousRouting,
        `Routes on cluster label(s) the grouping column does not contain (${fabricatedLabels.join(
          ', ',
        )}). Confirm the routing before auditing.`,
      );
    }

    // Rule 5: an unknown gene demotes the claim and surfaces the uncertainty.
    if (unknownGenes.length > 0) {
      confidence = 'low';
      ambiguousRouting = appendNote(
        ambiguousRouting,
        `References gene(s) the dataset inventory does not contain (${unknownGenes.join(
          ', ',
        )}). Confirm the routing before auditing.`,
      );
    }

    // Rule 6: an active claim that arrived with routes but lost every one to
    // pruning is surfaced, not left looking auditable while it audits nothing.
    if (arrivedWithRoutes && routes.length === 0) {
      confidence = 'low';
      const missingColumns = dedupeStrings(
        claim.checks
          .flatMap((r) => routeColumnRefs(r.params))
          .filter((c) => !inventoryHasField(inv, c)),
      );
      const why =
        missingColumns.length > 0
          ? `the dataset inventory does not contain the column(s) they route on (${missingColumns.join(
              ', ',
            )})`
          : `none of them can run against this dataset`;
      ambiguousRouting = appendNote(
        ambiguousRouting,
        `Every proposed check was dropped because ${why}, so nothing routes to a check. Confirm the routing or remove the claim before auditing.`,
      );
    }

    // Rule 9: an active claim that rests on nothing AND audits nothing.
    //
    // A claim with no routes is legitimate on its own (rule 6 deliberately stays
    // quiet: nothing was pruned, so there is nothing to surface). A claim with no
    // evidenceRefs is legitimate on its own too. Together they describe a sentence
    // the model wrote with no citation into the data and no check that could test
    // it, presented to the scientist at whatever confidence it asserted. That is
    // the one shape nothing else catches.
    const restsOnNothing =
      claim.evidenceRefs.obsColumns.length === 0 &&
      claim.evidenceRefs.unsKeys.length === 0 &&
      claim.evidenceRefs.genes.length === 0;
    if (isActive && !arrivedWithRoutes && routes.length === 0 && restsOnNothing) {
      confidence = 'low';
      ambiguousRouting = appendNote(
        ambiguousRouting,
        'This claim cites nothing in the dataset and routes to no check, so nothing audits it. Ground it, route it, or set it aside.',
      );
    }

    // Rule 7: guarantee a unique, non-empty id.
    const base = claim.id.trim() === '' ? `claim-${index}` : claim.id;
    const id = uniqueId(base, usedIds);
    usedIds.add(id);

    const next: ExtractedClaim = { ...claim, id, checks: routes, confidence };
    if (ambiguousRouting !== undefined) next.ambiguousRouting = ambiguousRouting;
    out.push(next);
  });

  return out;
}
