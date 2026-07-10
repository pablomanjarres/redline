# Redline — self-verification harness (build contract)

This is the authoritative spec for the `/verifications` self-verification harness and the
gap-closing work that makes a fresh run read **READY**. It implements the acceptance spec
(`Resources/redline-acceptance-spec` in the master brief set). Read `INTERFACES.md` and the
Zod types in `packages/contracts/src/*` first; this doc adds to that contract, it never
redefines a shape.

The harness exists to make one failure impossible to hide from ourselves: a build that
renders the right number while the number is hardcoded, the knob is cosmetic, and the
"reasoning" is a template. The harness runs the demo workflow against the live app, compares
every displayed statistic to an **independent oracle**, decides whether each piece is
**actually wired or faked**, and publishes the verdict.

## 0. The core reality this closes

Under the default `fixture` compute target (the bulletproof demo path), the numbers are
locked constants: Checks 1, 2, 4 do not recompute when their knobs move, field resolution
never calls a model, reasoning falls back to curated copy, and editing a field role changes
nothing (the fixture drops `input.fields`). That is correct for a zero-credential Vercel
demo, and it stays the default. The harness runs the app in a **second, real configuration**
(`REDLINE_COMPUTE_TARGET=local` + Bedrock on) where the numbers are genuinely recomputed by
the Python engine and the prose is genuinely written by Claude, then proves that they are.

The demo instance on `:3002` (fixture) is never touched. The harness boots its own instance.

## 1. Verdict vocabulary (per check, per case)

- **WIRED** — matches the oracle within tolerance AND responds correctly to its probes.
- **STATIC** — renders a value but does not recompute when inputs change (cosmetic).
- **BROKEN** — recomputes but does not match the oracle (real compute, wrong result).
- **TEMPLATED** — model-produced text does not adapt across cases / does not reference the data.
- **MISSING** — screen or state not built.

Only WIRED passes. READY = every check WIRED across cases A and B, real model calls firing
for field resolution and reasoning, field resolution adapting across cases, case C green
(Verified), case D degrading to flag-only, and no unlabeled dead controls.

## 2. The four cases

Each case is a small, deterministic, seeded `.h5ad` foil (pure numpy/anndata, no S3, no
network) plus an oracle entry. Foils are small enough (a few thousand cells, ~200 genes) that
the real engine (PyDESeq2 pseudobulk, scanpy Leiden sweep, count-split AUC, design-matrix
rank) runs in seconds. The foils encode the *design*, not the exact demo integers; the oracle
computes the authoritative numbers per run and the app is graded against the oracle, not the
storyboard screenshots.

| Case | Foil | Design | Expected verdicts |
|------|------|--------|-------------------|
| **A canonical** | `caseA_marson_foil.h5ad` | 4 donors, condition≡lane (perfect confound), spurious "Effector" cluster present only in a narrow resolution window, count-split-collapsing marker set, donor-correlated FOXP3 | 01 FLAGGED, 02 FLAGGED, 03 FLAGGED (Effector), 04 FLAGGED |
| **B generalization** | `caseB_pfc_foil.h5ad` | DIFFERENT column names (`patient`, `treatment`, `batch`, `sample`), different magnitudes, its own flaws + own oracle | field resolution maps renamed columns correctly; 4 checks case-B-correct |
| **C clean** | `caseC_clean.h5ad` | DE aggregated to enough real replicates with a genuine donor-consistent effect, a cluster robust across the sweep, a separable design (condition ⟂ batch) | applicable checks VERIFIED (green), not flagged |
| **D incomplete** | `caseD_nocounts.h5ad` | normalized/log values only, no raw integer counts | Checks 01, 02 FLAG-ONLY with a plain "raw counts required" message; no crash, no fabricated re-run |

Case B is the definitive AI-wiring test: field-resolution proposals identical to case A
despite different columns, or any check returning case-A numbers on case-B data, is FAKED.
Case C is the never-cry-wolf test. Case D is graceful degradation.

Foils and their obs schema live in `services/rigor/data/foils/` built by
`services/rigor/data/build_foils.py` (deterministic; `python -m data.build_foils --out cache/`).
Minimal AnnData each pillar needs: `X` (or `layers['counts']` for the raw-count pillars),
`obs` with the role-bearing columns, optionally a `leiden`/derived column. Case D omits
`layers['counts']` and stores only normalized `X` so `gating.require_counts` trips.

## 3. The oracle (independent ground truth) — `services/rigor/redline/oracle/`

A standalone module with **no import of the app engine's per-check code**. It recomputes the
expected result for each case from the foil using the real deterministic methods, and writes
`cache/oracle/<case>.json`. CLI: `python -m redline.oracle --case A --foil <path> --out <dir>`.

Per check it emits the authoritative numbers plus the expected verdict:

- **01 pseudoreplication** — aggregate to the resolved unit; Welch's t on the per-unit means
  (the fixture's stated method) and an independent PyDESeq2 pseudobulk cross-value; report
  `naiveP`, `honestP`, `n`, `icc`, `verdict`. (The existing `data/oracle.py` Check B, offline,
  is the seed for the PyDESeq2 cross-value.)
- **02 double dipping** — Poisson count-split at the ratio; fit the marker set on the discovery
  split, score on held-out; report `discAUC`, `holdAUC`, `markersHolding`, `verdict`.
- **03 fragility** — Leiden (or an independent stable clustering) sweep over `[min,max]` step
  `step`; track the named group; report `stability`, `settings`, `presentRange`, `verdict`.
- **04 confounding** — design matrix from the resolved condition vs technical columns; report
  `cramersV`, `rankDeficient`, `separable`, `verdict`.

The oracle is intentionally an INDEPENDENT reimplementation (its own Welch/ICC/AUC/thinning/
rank code) so agreement with the app's engine is a real cross-check, not a tautology.

Tolerances: p compared on log10 scale within ε=0.5; AUC and stability within 0.05; counts
exact; `separable`/`rankDeficient` boolean-exact; verdict exact.

## 4. Instrumentation the harness needs (small, honest, additive)

These are test-instrumentation and provenance additions. They do not change demo behavior.

1. **`data-testid` anchors** across the reader surfaces so the driver reads DOM by stable
   selectors, not text-proximity. Required ids (kebab): on the check stage
   `check-verdict`, `stat-{slug}` (one per `StatReadout`, slug from label), `field-role-{id}`
   on `/fields`, `knob-{name}` on each InstrumentRail control, `rerun-check`; on the report
   `report-row-{n}`. Keep existing `aria-label`s.
2. **Compute provenance** on `ComputeResult`: add optional `provenance?: { target, engine, ran,
   nonce, elapsedMs }` where `target ∈ fixture|local|cloudrun|endpoint`, `ran` is the real
   method that executed (e.g. `"PyDESeq2 pseudobulk"`, `"scanpy Leiden sweep (10)"`,
   `"count-split AUC"`, `"design-matrix rank"`), `nonce` is a fresh per-invocation id from the
   Python engine, `elapsedMs` the real compute time. This is how the driver proves a real job
   fired (nonce changes + nonzero elapsed + real method name) vs an instant cached swap. The
   fixture sets `target:'fixture'` and no `ran`.
3. **Reasoning source** on `Narrative`/`CheckResult`: add `source?: 'bedrock'|'anthropic'|
   'curated'`, set in each branch of `/api/audit/check` (bedrock/anthropic on a real narrate,
   curated on fallback). No secrets in the payload.
4. **Field-resolution as a real model call.** Wire `reasoner.proposeFields` into
   `/api/audit/fields` (today it is dead code): when the reasoner is available, propose the
   roles with Claude and return `{ fields, source: 'bedrock' }`; otherwise fall back to the
   compute target's `inferFields` and return `source: 'fixture'`. The field proposal must be a
   genuine function of the dataset's columns so it adapts across cases A and B.
5. **The upload control only renders when it works.** On the fixture demo the dataset is already
   loaded and there is no upload control; a live "Upload .h5ad" file picker appears only when a
   compute target is connected. No control renders live before its target is wired.

All new fields are OPTIONAL so the fixture path and existing tests stay valid, and the no-em-dash
voice gate + honesty invariants in `honesty-rules.md` still hold on all new copy.

## 5. Real-compute wiring (the `local` engine)

`job_runner.compute_result(checkId, h5adPath, cfg) -> ComputeResult(dict)` is the real
entrypoint (proven in `tests/test_real_stack.py`: real PyDESeq2 for pillar 1, real Leiden for
pillar 3, on synthetic AnnData). `remote_adapter.py` bridges `RemoteTarget` (stdin envelope
`{op,scenarioId,checkId,config,fields}`) to it. Work:

- Ensure every knob recomputes: 01 `unit`+`alpha` (n and significance follow the unit;
  significance call follows alpha), 02 `split` (held-out AUC + markers-holding recompute), 03
  `min/max/step`+`track` (stability + present-range recompute; `scrub` stays view-only), 04
  `interest`+`nuisance` (rank/Cramér's V recompute from the columns).
- **Probe 2B (foundation drives the audit):** the engine must derive the replicate unit from
  the confirmed `fields` roles, so changing `donor_id` from unit to observation changes check
  01's n and p. `RemoteTarget` already forwards `fields`; make the pillar read the resolved
  role, not a detached cfg knob.
- Pin the Python deps to a working set and fix the two currently-failing tests
  (`test_stable_group_is_reported_clean` 0.6≥0.8, `test_audit_end_to_end_shape` 'module' not
  callable) so the engine baseline is green before the harness trusts it.
- Extend `ScenarioId` + the fixture `REGISTRY` + intake list to the four cases, each mapped to
  its foil via `REDLINE_{CASE}_H5AD`.

## 6. The harness — `services/verify/`

A TypeScript/Node package (Playwright + the comparator + the reporter), one command:
`pnpm --filter @redline/verify run verify`.

1. **Oracle step.** Ensure foils exist (build if missing via the Python venv), run
   `python -m redline.oracle` per case, load `cache/oracle/<case>.json`.
2. **Driver (Playwright).** Boot a dedicated app instance (port 3009) with env:
   `REDLINE_COMPUTE_TARGET=local`, `REDLINE_ENGINE_CMD="<venv> -m redline.remote_adapter"`,
   `REDLINE_{CASE}_H5AD=<foil>`, `REDLINE_REASONING_BACKEND=bedrock`, `AWS_REGION=us-east-1`,
   `REDLINE_BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-5-20251101-v1:0`. For each case: load
   it, accept/inspect the field mapping, open each check, read the displayed stats + verdict
   (by `data-testid`), then actuate the probes:
   - **liveness** — move each live knob off its default; assert the displayed number changed
     (STATIC if not). Confirm the fragility `scrub` is view-only (no request, picture moves) and
     do NOT flag it dead.
   - **real compute** — press RE-RUN; assert the provenance `nonce` changed, `elapsedMs>0`, and
     `ran` names a real method (not an instant swap).
   - **foundation drives audit (2B)** — flip `donor_id` unit→observation, confirm, reopen check
     01; assert n and p changed.
   - **AI wiring** — assert `source==='bedrock'` on the field proposal and on each narrative,
     and that the field proposal for case B differs from case A (renamed columns mapped), and
     that a narrative's corrected sentence carries the case-specific numbers and differs from
     the curated template (content-diff against `curatedNarrative` imported from the engine).
   - **dead controls** — enumerate interactive elements; any with no handler and no
     disabled+label is reported.
   Capture, per (case, check): displayed values, which controls changed state, provenance, and
   the model-call source.
3. **Comparator.** Per (case, check): compare displayed vs oracle within tolerance, evaluate
   the probes, assign a verdict from §1. Assemble the AI-wiring result and the dead-control
   list.
4. **Reporter.** Write the run to `apps/web/src/verifications/latest-run.json` (a committed
   store the page reads) with `{ ready, timestamp, cases[], aiWiring, deadControls }`.

New Zod shapes for the run live in `packages/contracts/src/verification.ts`
(`VerificationRun`, `CaseVerdict`, `CheckVerdict`, `ProbeOutcome`, `OracleValue`, `AiWiring`,
`DeadControl`) and are imported by both the reporter and the page.

## 7. The `/verifications` page — `apps/web/src/app/(app)/verifications/`

Internal QA surface, plain and legible (clarity over polish). Reads `latest-run.json`.

- Top banner: **READY** only if every check in every case is WIRED, case C green, case D
  degrades correctly, no unlabeled dead controls. Otherwise **NOT READY** with the failing list.
- Per case (A, B, C, D): a row per check — verdict chip (WIRED/STATIC/BROKEN/TEMPLATED/MISSING),
  displayed value next to the oracle value, and probe outcomes.
- AI-wiring panel: did a real model call fire for field resolution and for reasoning, and did
  field resolution differ appropriately between case A and case B.
- Dead-controls list: any interactive control that changed nothing and was not labeled.
- A re-run button (`POST /api/verify/run` shells the harness) and the run timestamp.

## 8. Harness self-honesty (do not ship a rubber stamp)

The worst outcome is a harness that rubber-stamps the fixture. Before trusting a READY, prove
the harness can fail: a self-test injects (a) a knob whose result is frozen → must report
STATIC, (b) a displayed number perturbed off the oracle → must report BROKEN, (c) a narrative
forced to the curated template under `source:'bedrock'` → must report TEMPLATED. These live in
`services/verify/self-test` and run in CI. If any injection is not caught, the harness is not
trustworthy and the run is not READY.

## 9. Build order

1. Foils (`build_foils.py`) + the four-case registry + oracle (all four checks, all cases).
2. Instrumentation: contracts `verification.ts` + provenance/source fields + `data-testid`s +
   field-resolution model call + dead-control fix. Pin Python deps; green the engine tests.
3. Real-compute knob + `fields` wiring in the pillars (liveness + probe 2B).
4. Harness: driver, comparator, reporter; then the `/verifications` page.
5. Run end to end; close whatever the harness flags; add the self-honesty injections; re-run to
   READY (or report the precise, honest NOT-READY with exactly what remains).

Commit granularly, one logical step per commit, no `Co-Authored-By` lines. Update this doc in
the same PR if the contract changes.
