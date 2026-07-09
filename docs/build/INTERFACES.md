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
services/rigor/redline/       Python engine (foundation + 8 checks: modules/ + correction/), MCP, job.
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

A `'use client'` React context. Persists `{scenarioId, fields, fieldsConfirmed, cfg}`
to `localStorage['redline_state_v1']` and hydrates on mount. Exposes `useSession()`:

```ts
interface SessionValue {
  scenarioId: ScenarioId;
  dataset: DatasetMeta;
  claims: Claim[];
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  cfg: CheckConfigMap;                       // defaults from engine DEFAULT_CONFIG
  results: Record<CheckId, CheckResult | null>;   // build with checkRecord()
  running: Record<CheckId, boolean>;
  reasoning: Record<CheckId, string[]>;      // streamed lines, revealed on a timer
  reveal: Record<CheckId, number>;
  // actions
  loadScenario(id: ScenarioId): void;
  resolveFields(): Promise<void>;            // POST /api/audit/fields
  setRole(fieldId: string, role: FieldRole): void;
  confirmFields(): Promise<void>;            // then runs the registered checks
  setCfg(id, patch, opts?: { rerun?: boolean }): void; // rerun !== false ⇒ re-run
  runCheck(id: CheckId): Promise<void>;      // POST /api/audit/check
  runAll(): void;
  report: AuditReport;                        // derived from results
}
```

Reasoning lines stream client-side: on `runCheck`, reveal one line every ~165ms
(matches the design) while the POST resolves; when it resolves, set the result and
reveal all lines. Use the engine's `reasoningLines(id, cfg)` for the copy.

## HTTP routes (owned by the api agent) — `apps/web/src/app/api/…`

All JSON. Validate bodies with the contracts' Zod schemas.

- `POST /api/audit/fields` — body `{ scenarioId }` → `{ fields: FieldSpec[] }`.
  Calls `getComputeTarget().inferFields(...)` (fixture returns the scenario fields;
  real target reads the `.h5ad`). May enrich reasoning via the Reasoner.
- `POST /api/audit/check` — body `{ scenarioId, checkId, config, fields }` →
  `CheckResult`. Calls `getComputeTarget().computeCheck(...)` for the numbers, then
  `createReasoner().narrate(...)` for the prose, and merges them.
- Keep handlers thin; all logic lives in `@redline/engine` + `@redline/reasoning`.

## ComputeTarget (owned by the engine agent) — `@redline/engine`

```ts
export interface ComputeInput {
  scenarioId: ScenarioId;
  checkId: CheckId;                 // 1..8; use CheckId / CHECK_IDS, never a literal range
  config: AnyCheckConfig;           // the Check<N>Config for that id (see CheckConfigMap)
  fields: FieldSpec[];
}
export interface ComputeTarget {
  readonly id: 'fixture' | 'local' | 'cloudrun' | 'endpoint';
  readonly available: boolean;
  inferFields(input: { scenarioId: ScenarioId }): Promise<FieldSpec[]>;
  computeCheck(input: ComputeInput): Promise<EngineResult>;   // numbers + correction
}
export function getComputeTarget(): ComputeTarget; // reads REDLINE_COMPUTE_TARGET, default 'fixture'
export const DEFAULT_CONFIG: CheckConfigMap;
export function reasoningLines(id: CheckId, cfg: unknown): string[];
export const SCENARIOS: Record<ScenarioId, Scenario>;
```

The **fixture** target is deterministic, always `available`, and reproduces the locked
demo numbers below. `local`/`cloudrun`/`endpoint` shell out / fetch the Python engine
and return the SAME `ComputeResult` shape; if their env is unwired, `available=false`
and the app stays on `fixture` (never present a dead control as live).

## Reasoner (owned by the reasoning agent) — `@redline/reasoning`

```ts
export interface Reasoner {
  narrate(req: NarrativeRequest): Promise<Narrative>;
  proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]>;
}
export function createReasoner(): Reasoner; // Bedrock if AWS creds+model, else curated fallback
```

Bedrock via `@aws-sdk/client-bedrock-runtime`, model id from `REDLINE_BEDROCK_MODEL_ID`,
region from `AWS_REGION`, standard AWS credential chain. NEVER the direct Anthropic API.
On any missing-cred / error, fall back to the curated `Narrative` per (checkId, state)
so the app always renders. The curated copy for the fixtures is the text in the locked
demo below — keep the two in exact agreement.

## Chart components (owned by the charts agent) — `@/components/charts`

Pure SVG React, drawing with literal hex from `C` (tokens). Recreate the design source
(`Redline.dc.html` `chartSig/chartGroups/chartFrag/chartConfound/buildMini`) faithfully,
but typed and reading the contracts' chart union:

```ts
<SignificanceChart chart={SignificanceChart | HardStopChart} />   // check 1
<GroupsChart chart={GroupsChart} />                                // check 2
<FragilityChart chart={FragilityChart} cfg={Check3Config} />       // check 3 (scrub playhead)
<ConfoundChart chart={ConfoundChart} />                            // check 4
<MiniChart checkId={CheckId} result={CheckResult} />               // card thumbnail
```

Animations use the `rl-*` keyframes already in tokens.css.

## Python engine JSON contract (owned by the python + mcp agents)

`redline.audit(...)` and every MCP tool / job return JSON that deserializes to the
contracts' shapes. One check → a `ComputeResult` (`checkId,state,headline,stats,chart`).
Foundation → `FieldSpec[]`. Field names, `chart.kind` values, and enum strings match the
Zod schemas EXACTLY (snake vs camel: use the camelCase keys the TS types use, e.g.
`log10p`, `badUnit`, `cramersV`). The MCP server exposes one tool per registered check plus
`redline_resolve_fields`. The job runner reads an `.h5ad` + a job spec and prints a
`ComputeResult`.

## The correction and rigor layer (the seams this layer adds)

Full reference: `docs/correction-layer.md`. The Zod source of truth is
`packages/contracts/src/correction.ts` and `checks.ts`; the Python mirror is
`services/rigor/redline/contracts.py` and `modules/base.py`. Import, never redefine.

### The shapes

```ts
// checks.ts
EngineResult   = ComputeResult.extend(Correction.shape);           // what a target returns
CheckResult    = ComputeResult.merge(Narrative).extend(Correction.shape); // what the UI renders
Correction     = { correctedCode?, recommendations?, preview? };   // every field optional

// correction.ts
CorrectedCode  = { language: 'python', filename, inline, entrypoint, params };
Recommendation = { action, rationale, changes, feasibility, citation? };
Feasibility    = 'fixable_now' | 'needs_new_data' | 'unsalvageable';   // engine decides, not the model
PreviewArtifact= { methodLabel, caveat?, unsalvageable, before: Chart, after: Chart | null };
CorrectedBundle= { readme, notebook, scripts: CorrectedScript[] };
CorrectedScript= { checkId, title, filename, code };
Knob           = { key, label, kind: 'number'|'select'|'multiselect'|'text', min?, max?, step?, options? };
```

`PreviewArtifact` carries a `.superRefine`: `unsalvageable === true` requires `after` to be
`null`, and `unsalvageable === false` requires `after` to be non-null. A fabricated fix on a
dead-end design is a parse error. The Python `PreviewArtifact.__post_init__` and
`Evidence.__post_init__` enforce the same rule before serialization. Do not work around it.

### The registry

`CHECK_REGISTRY: Record<CheckId, CheckMeta>` in `packages/contracts/src/registry.ts` is the
single source of truth for the check set. `CheckMeta = { id, name, sub, errorClass, group }`,
`group` is `'core'` (checks 1 to 4) or `'rigor'` (checks 5 to 8). Derive every loop from
`CHECK_IDS`, use `CHECK_COUNT` (never "8"), `checkRecord(init)` to build a per-check map, and
`isCheckId(n)` to narrow. The Python mirror is `modules/__init__.py` (`REGISTRY`, `CORE_IDS`,
`RIGOR_IDS`). Adding a check: a `CheckId` literal, a `CHECK_REGISTRY` row, a module file
registered in `modules/__init__.py`, and a code template. Nothing else enumerates checks.

### The emitted-script output contract (the code as its own oracle)

Every script the correction layer emits prints, as its LAST line of stdout:

```
REDLINE_RESULT {"original": <number|string>, "corrected": <number|string>, ...}
```

The JSON keys are exactly the keys of that check's `Evidence.numbers`. The acceptance
harness runs the script and diffs its JSON against the numbers Redline reported and against
`PreviewArtifact.after`. If they disagree, one of them is faked. On an unsalvageable finding
the script prints the non-separability verdict and emits `"corrected": null` plus
`"unsalvageable": true`, never a fabricated number. Every script takes `--h5ad PATH` and
defaults to the `h5ad` param.

### The CorrectedCode parameter contract (per check)

`prove()` puts exactly these keys in `Evidence.params`, and that check's template consumes
exactly these. Values come from the resolved design, never hardcoded, which is what makes the
Case B generality test pass. `h5ad` is a hint only.

| Check | Params in `Evidence.params` |
|---|---|
| 1 pseudoreplication | `h5ad, unit, grouping, ref, alt, gene, covariates(list), alpha` |
| 2 double dipping | `h5ad, grouping, target_group, markers(list), split, seed` |
| 3 fragility | `h5ad, track, track_column, min, max, step, seed` |
| 4 confounding | `h5ad, interest, technical, separable(bool)` |
| 5 multiple testing | `h5ad, unit, grouping, ref, alt, alpha, method, tests` |
| 6 unmodeled covariate | `h5ad, interest, covariate, ref, alt, unit, alpha` |
| 7 resolution choice | `h5ad, min, max, step, criterion, chosen, seed` |
| 8 test assumptions | `h5ad, grouping, ref, alt, unit, claimed_test, alpha` |

### The routes (owned by the api/web agents)

- `POST /api/audit/check` now returns an `EngineResult` (numbers + correction), then the
  Reasoner adds the `Narrative` and the handler merges to `CheckResult`.
- `POST /api/audit/preview` dispatches the heavy re-analysis (pseudobulk re-test, count-split
  reclustering, resolution sweep) as a job on the `local`/`cloudrun`/`endpoint` targets, so a
  runaway re-run never blocks the app. The Python `remote_adapter` handles a `preview` op with
  the same envelope as `check`.
- `GET /api/bundle` returns the `CorrectedBundle`: a README, a consolidated notebook, and one
  runnable script per flagged check. This is the artifact the scientist leaves with.

## Design & voice rules

- Pixel-faithful to `Redline.dc.html`. Same spacing, radii, fonts, colors, copy.
- Prose (any user-facing English): NO em dashes. No "not X, but Y" reframes. No AI-tell
  vocabulary. Direct and concrete. This includes report copy, reasoning lines, docs.
- Accessibility: real semantic elements, `aria-label` on icon buttons, focus-visible
  rings (already in tokens.css), keyboard-operable controls, `prefers-reduced-motion`
  respected for the `rl-*` animations.
- Never add Co-Authored-By lines (the main session commits).

## Honesty invariants (from the build spec — enforce in code and copy)

Full detail in `docs/honesty-rules.md` (now ten rules).

- Correct, and show your work. Redline corrects the analysis and previews the corrected
  result. Everything it asserts, recommends, or corrects is shown, reproducible, and cited:
  `CorrectedCode.inline` is the script, `PreviewArtifact.after` is its output, and the two
  must agree with the reported numbers within tolerance or the harness fails.
- No fabricated fixes. On an unsalvageable finding (full confound, n=1, dead-end design)
  there is no corrected result anywhere. Enforced structurally: `PreviewArtifact` and the
  Python `Evidence`/`PreviewArtifact` refuse an `after` artifact when `unsalvageable`.
- Never cry wolf. A passed check reports a confident clean verdict. Check 3 tracking a
  stable group returns `clean`.
- Check 2 is evidence ("this many markers survive a held-out test"), not a certified FDR
  correction; name ClusterDE as the stronger method. Check 5 IS a Benjamini-Hochberg
  correction and may be described as one. Do not conflate them.
- Grouping variable is configurable, never hardcoded to "cell type".
- The Marson scenario audits a NAIVE FOIL constructed on that data, never the authors'
  own (rigorous) analysis. Copy must never imply the authors erred.

## Locked demo fixtures (the golden path — fixtures MUST reproduce these)

Two built-in scenarios. Both flow: intake → field resolution → the registered checks → report.

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
