# Redline — build interfaces (read before writing any code)

This is the contract between the parallel build agents. Every file you write must
conform to what is written here so the pieces integrate on the first try. When in
doubt, the Zod types in `packages/contracts/src/*` are the source of truth — import
them, never redefine them.

## Repo layout & ownership

```
apps/web/                     Next.js 16 App Router (React 19). No Tailwind — CSS
                              variables (@redline/ui/tokens.css) + inline styles.
  src/app/                    Routes (URL-based). Server components by default.
  src/app/api/                Route handlers (compute + reasoning).
  src/state/                  Client session store (React context + localStorage).
  src/components/             App-specific components (shell, charts, panels).
  src/lib/                    api client, scenario helpers.
packages/contracts            Zod shapes (DONE — import, don't edit).
packages/ui                   Tokens + primitives (DONE — import, don't edit).
packages/engine               ComputeTarget seam + fixtures + runner.
packages/reasoning            Bedrock Reasoner + curated fallback.
services/rigor/redline/       Python engine (foundation + 4 pillars), MCP, job.
services/skill/               Claude Skill (SKILL.md + scripts).
docs/                         Architecture, demo storyboard, honesty rules.
```

## Import conventions

- `@redline/contracts` — all shared types. `@redline/ui` — tokens (`C`, `FONT`,
  `stateColor`, `stateLabel`) + primitives (`Button`, `Badge`, `Kicker`, `StatTile`,
  `Dot`, `Panel`). `@redline/ui/tokens.css` — imported once in `app/layout.tsx`.
- Inside `apps/web`, use `@/…` (maps to `apps/web/src/…`).
- ESM everywhere. In `packages/*` use explicit `.js` extensions on relative imports
  and `verbatimModuleSyntax` (so `import type` for type-only). `apps/web` relaxes both.

## The session store (owned by the web-spine agent) — `@/state/session`

A `'use client'` React context. Persists a subset of state to
`localStorage['redline_state_v2']` (`scenarioId`, `fields`, `fieldsConfirmed`, `cfg`,
plus the claim slice: `inventory`, `extractedClaims`, `claimsConfirmed`, `claimsSource`,
`notebook`, `prose`) and hydrates on mount. A stale `redline_state_v1` payload is ignored,
not migrated. Exposes `useSession()`:

```ts
interface SessionValue {
  scenarioId: ScenarioId;
  dataset: DatasetMeta;
  claims: Claim[];                           // legacy scenario claims (unchanged)
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  cfg: CheckConfigMap;                       // defaults from engine defaultConfigFor(id)
  results: Record<1|2|3|4, CheckResult | null>;
  running: Record<1|2|3|4, boolean>;
  reasoning: Record<1|2|3|4, string[]>;      // streamed lines, revealed on a timer
  reveal: Record<1|2|3|4, number>;
  // claim slice (the front door; see intake-and-claims.md)
  inventory: DatasetInventory | null;
  extractedClaims: ExtractedClaim[] | null;  // the new claim list; `claims` is untouched
  claimsSource: 'model' | 'curated' | null;  // 'curated' ⇒ show CURATED_CLAIMS_NOTICE
  claimsConfirmed: boolean;
  extracting: boolean;
  extractionLines: string[];                 // streamed like check reasoning
  extractionReveal: number;                  // use extractionLines.slice(0, reveal)
  notebook: string;                          // optional Intake attach point
  prose: string;                             // optional Intake attach point
  addingClaim: boolean;
  addClaimError: string | null;              // a 503 map failure, surfaced not swallowed
  routedChecks: CheckId[];                    // a check not in here renders no verdict
  // actions
  loadScenario(id: ScenarioId): void;
  resolveFields(): Promise<void>;            // POST /api/audit/fields
  setRole(fieldId: string, role: FieldRole): void;
  confirmFields(): Promise<void>;            // sets fieldsConfirmed, then inspect + extract (NOT the checks)
  setNotebook(text: string): void;
  setProse(text: string): void;
  inspect(): Promise<void>;                  // POST /api/audit/inspect; falls back to the scenario inventory
  extractClaims(): Promise<void>;            // POST /api/audit/claims; falls back to curatedClaimsFor
  setClaimStatus(id: string, status: ClaimStatus): void;   // confirm / remove
  setClaimText(id: string, text: string): void;            // marks status 'edited'
  setClaimRouting(id: string, checks: CheckRoute[]): void; // marks status 'edited'
  addClaim(text: string): Promise<void>;     // POST /api/audit/claims/map; on 503 sets addClaimError
  confirmClaims(): Promise<void>;            // writes routedChecks, then runs only the routed checks
  claimForCheck(id: 1|2|3|4): string | null; // the confirmed claim routed to a check, else null
  setCfg(id, patch, opts?: { rerun?: boolean }): void; // rerun !== false ⇒ re-run
  runCheck(id: 1|2|3|4): Promise<void>;      // POST /api/audit/check
  runAll(): void;                             // runs ONLY routedChecks; clears the rest to null
  report: AuditReport;                        // derived from results
}
```

Reasoning lines stream client-side: on `runCheck`, reveal one line every ~165ms
(matches the design) while the POST resolves; when it resolves, set the result and
reveal all lines. Use the engine's `reasoningLines(id, cfg)` for the copy. Extraction
streams the same way, off `extractionLines(scenarioId)` from `@redline/engine`.

## HTTP routes (owned by the api agent) — `apps/web/src/app/api/…`

All JSON. Validate bodies with the contracts' Zod schemas.

- `POST /api/audit/fields`, body `{ scenarioId }` → `{ fields: FieldSpec[] }`.
  Calls `getComputeTarget().inferFields(...)` (fixture returns the scenario fields;
  real target reads the `.h5ad`). May enrich reasoning via the Reasoner.
- `POST /api/audit/inspect`, body `{ scenarioId }` → `{ inventory: DatasetInventory }`.
  Calls `getComputeTarget().inspect(...)`, validated with `DatasetInventory.parse`.
- `POST /api/audit/claims`, body `{ scenarioId, inventory, fields, notebook?, prose? }` →
  `{ claims: ExtractedClaim[], source: 'model' | 'curated' }`. When `reasoner.available`,
  calls `extractClaims(...)` (`source: 'model'`); on `ReasonerUnavailable` or any error,
  falls back to `curatedClaimsFor(...)` (`source: 'curated'`). A model call returning zero
  claims stays `model` with an empty list, never padded with curated claims.
- `POST /api/audit/claims/map`, body `{ scenarioId, inventory, fields, text }` →
  `{ claim: ExtractedClaim }` via `reasoner.mapClaim(...)` (manual entry). No backend or
  any mapping failure ⇒ HTTP 503 `{ error: 'reasoning_unavailable' }`. It never
  fabricates a routing.
- `POST /api/audit/check`, body `{ scenarioId, checkId, config, fields }` →
  `CheckResult`. Calls `getComputeTarget().computeCheck(...)` for the numbers, then
  `createReasoner().narrate(...)` for the prose, and merges them.
- Keep handlers thin; all logic lives in `@redline/engine` + `@redline/reasoning`.

## ComputeTarget (owned by the engine agent) — `@redline/engine`

```ts
export interface ComputeInput {
  scenarioId: ScenarioId;
  checkId: 1 | 2 | 3 | 4;
  config: Check1Config | Check2Config | Check3Config | Check4Config;
  fields: FieldSpec[];
}
export interface ComputeTarget {
  readonly id: 'fixture' | 'local' | 'cloudrun' | 'endpoint';
  readonly available: boolean;
  inferFields(input: { scenarioId: ScenarioId }): Promise<FieldSpec[]>;
  inspect(input: { scenarioId: ScenarioId }): Promise<DatasetInventory>;
  computeCheck(input: ComputeInput): Promise<ComputeResult>;
}
export function getComputeTarget(): ComputeTarget; // reads REDLINE_COMPUTE_TARGET, default 'fixture'
export const DEFAULT_CONFIG: CheckConfigMap;
export function reasoningLines(id: 1|2|3|4, cfg: unknown): string[];
export function extractionLines(scenarioId: ScenarioId): string[];
export const SCENARIOS: Record<ScenarioId, Scenario>;   // each carries inventory + extractedClaims
export const INVENTORIES: Record<ScenarioId, DatasetInventory>;
export const MARSON_CLAIMS: ExtractedClaim[];
export const KETAMINE_CLAIMS: ExtractedClaim[];
```

The `fixture` target returns the hand-written `INVENTORIES[scenarioId]` from `inspect`;
the real targets send `{ op: 'inspect', scenarioId }` to the Python engine and validate
the reply with `DatasetInventory.parse`. `MARSON_CLAIMS` / `KETAMINE_CLAIMS` are the
curated per-scenario claim sets, defined in engine and re-exported; keep them in agreement
with any curated fallback in `@redline/reasoning`.

The **fixture** target is deterministic, always `available`, and reproduces the locked
demo numbers below. `local`/`cloudrun`/`endpoint` shell out / fetch the Python engine
and return the SAME `ComputeResult` shape; if their env is unwired, `available=false`
and the app stays on `fixture` (never present a dead control as live).

## Reasoner (owned by the reasoning agent) — `@redline/reasoning`

```ts
export interface Reasoner {
  readonly available: boolean;
  narrate(req: NarrativeRequest): Promise<Narrative>;
  proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]>;
  extractClaims(req: ClaimExtractionRequest): Promise<ExtractedClaim[]>;
  mapClaim(req: ClaimMappingRequest): Promise<ExtractedClaim>;
}
export function createReasoner(): Reasoner; // a live backend if configured, else calls throw
export class ReasonerUnavailable extends Error {}   // thrown when no backend, or a call fails
```

The curated claim fallback is NOT in the reasoner. It is one function in `@redline/engine`,
`curatedClaimsFor(scenarioId, inventory)`, the single home both fallback paths share (the
`/api/audit/claims` route and the session store). The UI shows its own `CURATED_CLAIMS_NOTICE`
(`@/components/claims/shared`) whenever `claimsSource === 'curated'`.

The backend prefers the first-party Claude API (`ANTHROPIC_API_KEY`) so anyone can run
Redline against their own key, then AWS Bedrock (`REDLINE_BEDROCK_MODEL_ID` + AWS creds);
`REDLINE_REASONING_BACKEND` forces one. NEVER the direct Anthropic HTTP API from app code.
On any missing-cred / error, `available` is `false` and the calls throw `ReasonerUnavailable`.
`narrate` falls back to the curated `Narrative` per (checkId, state); extraction falls back
to `curatedClaimsFor(...)` (from `@redline/engine`) with `CURATED_CLAIMS_NOTICE` shown, so the
app always renders and a curated list is never passed off as a live reading. Every extractor
and mapper output runs through `enforceClaimHonesty(inventory, claims)` before it is returned.
Keep the curated copy in exact agreement with the locked demo below.

## Chart components (owned by the charts agent) — `@/components/charts`

Pure SVG React, drawing with literal hex from `C` (tokens). Recreate the design source
(`Redline.dc.html` `chartSig/chartGroups/chartFrag/chartConfound/buildMini`) faithfully,
but typed and reading the contracts' chart union:

```ts
<SignificanceChart chart={SignificanceChart | HardStopChart} />   // check 1
<GroupsChart chart={GroupsChart} />                                // check 2
<FragilityChart chart={FragilityChart} cfg={Check3Config} />       // check 3 (scrub playhead)
<ConfoundChart chart={ConfoundChart} />                            // check 4
<MiniChart checkId={1|2|3|4} result={CheckResult} />               // card thumbnail
```

Animations use the `rl-*` keyframes already in tokens.css.

## Python engine JSON contract (owned by the python + mcp agents)

`redline.audit(...)` and every MCP tool / job return JSON that deserializes to the
contracts' shapes. One check → a `ComputeResult` (`checkId,state,headline,stats,chart`).
Foundation → `FieldSpec[]`. Field names, `chart.kind` values, and enum strings match the
Zod schemas EXACTLY (snake vs camel: use the camelCase keys the TS types use, e.g.
`log10p`, `badUnit`, `cramersV`). The MCP server exposes one tool per pillar plus
`redline_resolve_fields`. The job runner reads an `.h5ad` + a job spec and prints a
`ComputeResult`.

## Design & voice rules

- Pixel-faithful to `Redline.dc.html`. Same spacing, radii, fonts, colors, copy.
- Prose (any user-facing English): NO em dashes. No "not X, but Y" reframes. No AI-tell
  vocabulary. Direct and concrete. This includes report copy, reasoning lines, docs.
- Accessibility: real semantic elements, `aria-label` on icon buttons, focus-visible
  rings (already in tokens.css), keyboard-operable controls, `prefers-reduced-motion`
  respected for the `rl-*` animations.
- Never add Co-Authored-By lines (the main session commits).

## Honesty invariants (from the build spec — enforce in code and copy)

- Auditor, not corrector. Only Pillar 1 (pseudoreplication) asserts a corrected result.
- Never cry wolf. A passed check reports a confident clean verdict. Pillar 3 tracking a
  stable group returns `clean`.
- Pillar 2 is evidence ("this many markers survive a held-out test"), not a certified
  FDR correction. Name ClusterDE as the stronger method.
- Grouping variable is configurable, never hardcoded to "cell type".
- The Marson scenario audits a NAIVE FOIL constructed on that data, never the authors'
  own (rigorous) analysis. Copy must never imply the authors erred.
- The front door (intake and claim extraction). Extraction is a real model call that
  adapts to the data; `enforceClaimHonesty` in `packages/contracts/src/claims.ts` is the
  deterministic gate every model output passes through. Never fabricate a claim to fill
  the list; an out-of-scope claim is labeled with an empty `checks` array; a check with no
  routed claim renders no verdict; a curated fallback list is always labeled. The claim
  and inventory shapes live in `packages/contracts/src/claims.ts` and
  `packages/contracts/src/inventory.ts`. See `intake-and-claims.md` and `honesty-rules.md`
  rules 9 through 14.

## Locked demo fixtures (the golden path — fixtures MUST reproduce these)

Two built-in scenarios. Both flow: intake → field resolution → four checks → report.

### Scenario `ketamine` (fallback; exact numbers)
Read `/Users/pablo/.claude/jobs/11ace18c/tmp/redline-unzip/redline-data-audit-interface/project/redline-engine.js`
and reproduce its `dataset`, `claims`, `inferFields()`, `reasoning()`, `computeCheck()`,
`CIT`, `defaults`, and `meta` EXACTLY (mapping its `mice`→`units/profiles`,
`cond`→`group`, `mean`→`value`). This is the locked reference; do not alter its numbers.

### Scenario `marson` (hero; primary demo)
The Marson/Pritchard genome-scale CD4+ T-cell Perturb-seq set (Zhu, Dann et al. 2025),
subset. Construct a NAIVE-FOIL analysis (standard cluster→annotate→cell-state DE) that
produces the same dramatic, legible catches, with T-cell-appropriate biology:
- `dataset`: file `cd4_tcell_perturbseq_subset.h5ad`, title "CD4+ T cells · IL2RA
  knockdown vs non-targeting · Perturb-seq", ~52,000 cells, ~3,200 genes, 4 donors
  (`replicateLabel: "donors"`), 9 fields, 2.4 GB.
- `claims` → checks: (1) "IL2RA knockdown significantly upregulates FOXP3 across CD4 T
  cells (p < 0.001)."; (2) "An activated Treg-like state defined by 4 markers, enriched
  under knockdown."; (3) "A distinct knockdown-responsive T-cell state."; (4)
  "Differential expression between knockdown and non-targeting control."
- Check 1: naive cell-level p ≈ 6.2e-11 (n ≈ 51,842) collapses to pseudobulk across 4
  donors, p ≈ 0.21, non-significant. Unit = `donor_id` (4). `litter_id`-analogue hard
  stop = a `guide_batch` with 2 levels → n=1/group hard stop.
- Check 2: a spurious "Activated Treg-like" state; 4 markers (choose plausible activation
  genes that are NOT IL2RA itself, e.g. TNFRSF9, ICOS, TIGIT, CTLA4) separate at
  discovery AUC ≈ 0.90 and collapse to held-out AUC ≈ 0.57 (0/4 survive).
- Check 3: track "Effector" (spurious; present only at resolution 0.8–1.2) → flagged;
  "Naive" (stable across the sweep) → clean. The flagged cluster must be genuinely a
  resolution artifact.
- Check 4: perturbation/condition confounded with a technical `lane` (KD on Lane-A, NT on
  Lane-B), Cramér's V = 1.00, not separable. Without the technical var selected → flag_only.
- Fields (9), roles: `donor_id` (unit, high), `condition` (grouping: guide vs NT, high),
  `cell_barcode` (observation, high), `lane` (nuisance, medium — lines up with condition),
  `guide_id` (derived/grouping, medium), `n_genes` (covariate), `pct_mito` (covariate),
  `leiden` (derived, medium), `phase` (cell-cycle; nuisance, low).
- Citations: same method papers as `ketamine` (Squair 2021; Gao/Bien/Witten 2022 or
  Neufeld count-splitting; Luecken & Theis 2019; Hicks et al. 2018), with real URLs from
  the master brief's reference list where available.

`marson` is the default scenario the app loads first.
