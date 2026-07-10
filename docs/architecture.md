# Redline architecture

Read this first. Then read the doc that matches your task (`honesty-rules.md`,
`dataset.md`, `demo-storyboard.md`, `deploy.md`). The seam contract that binds the
build agents together lives in `docs/build/INTERFACES.md`, and the Zod types in
`packages/contracts/src/*` are the source of truth for every shape below.

## One engine, every surface

Redline is one rigor engine that runs everywhere a scientist works. The core is a
foundation step (design resolution) plus a registry of independent checks: four
founding pillars and eight registered checks in total, checks 5 to 8 built on the same
module interface. Each check is its own module with its own input contract, detection
logic, re-run routine, corrected-code template, exposed knobs, and verdict. There is no
monolithic `audit()` function. The registry (`services/rigor/redline/modules/` on the
Python side, `CHECK_REGISTRY` in `packages/contracts/src/registry.ts` on the TS side) is
the single source of truth for which checks exist, and adding one is adding a module and a
registry row. See `correction-layer.md` for the module interface and the correction
capabilities. The tower has independent floors, and the same floors serve three surfaces:

- **The plots-first web workbench** (`apps/web`). The demo surface. Renders the
  scientist's figures and marks the findings on them.
- **The MCP server** (`services/rigor`). The engine as tools. One tool per registered
  check plus `redline_resolve_fields`. This is where the heavy Python statistics live.
- **The Claude Skill** (`services/skill`). The same engine as procedural knowledge
  (`SKILL.md` plus scripts) so it drops into Claude Science and Claude Code natively.

Because the core is a Skill plus an MCP server, the identical artifact runs in Claude
Code, Claude Science, Claude Desktop, and the API. Build with no surface-specific
paths and no hardcoded secrets, or portability breaks.

## The monorepo map

```
redline/
  apps/
    web/                     Next.js 16 App Router (React 19). Deploys to Vercel.
      src/app/page.tsx       Intake: the .h5ad drop and the two optional attach points.
      src/app/(app)/         The workbench shell (Sidebar + TopBar).
        fields/              Foundation: the design-resolution panel.
        claims/              Claim Review: the extracted claims, confirmed or corrected.
        workbench/           The check overview (one card per registered check).
        checks/[id]/         One check panel with its knobs, chart, and correction.
        report/              The assembled audit across every registered check.
        environment/         The compute-target surface (fixture / local / cloudrun / endpoint).
        verifications/       The self-verification surface: the actor-critic run record.
      src/app/api/audit/     Route handlers: /fields, /inspect, /claims, /claims/map, /check,
                             /preview; plus /bundle (the /check path runs the critic).
      src/state/session.tsx  Client session store (React context + localStorage).
      src/components/         shell, intake, fields, claims, workbench, check, charts, report.
      src/lib/                api client, formatting.
  packages/
    contracts/               @redline/contracts: the Zod shapes every surface speaks. Built.
    ui/                      @redline/ui: tokens (palette C, FONT, stateColor, stateLabel) + primitives. Built.
    engine/                  @redline/engine: the ComputeTarget seam, fixtures, DEFAULT_CONFIG, SCENARIOS, the critic gate.
    reasoning/               @redline/reasoning: Claude via Bedrock + curated fallback. narrate, proposeFields, critique.
    critic-verify/           @redline/critic-verify: the actor-critic acceptance harness (Add-on 1).
  services/
    rigor/                   Python engine (scanpy / decoupler / PyDESeq2 / numpy): MCP server + Cloud Run job.
    skill/                   The same engine packaged as a Claude Skill for Claude Science.
  docs/                      Architecture, honesty rules, dataset, storyboard, deploy.
```

TypeScript, Node 22, pnpm, and turbo hold the JS side. The Python side sits outside
the pnpm graph and talks to it only through a JSON return contract that deserializes
to the same Zod shapes.

## The request path

Both built-in scenarios flow the same way: intake, then field resolution, then claim
extraction, then the registered checks, then a report. Nothing downstream runs until the
design is confirmed, and nothing runs in the Workbench until the claim list is confirmed.
The front door (intake and claim extraction) is covered in `intake-and-claims.md`.

```
  page.tsx (intake)
        |  loadScenario('marson'); optional notebook / prose
        v
  /fields  --POST /api/audit/fields-->  getComputeTarget().inferFields()
        |                                  (fixture returns the scenario fields;
        |                                   real target reads the .h5ad's obs columns)
        |  confirmFields()  (the scientist confirms each role; then inspect + extract)
        v
  /claims  --POST /api/audit/inspect-->  getComputeTarget().inspect()   -> DatasetInventory
        |  --POST /api/audit/claims -->  createReasoner().extractClaims() -> ExtractedClaim[]
        |        (no backend -> curatedClaimsFor(), labeled; the honesty backstop always runs)
        |  --POST /api/audit/claims/map-> createReasoner().mapClaim()     (manual entry)
        |  confirmClaims()  (the scientist ratifies; writes routedChecks)
        v
  /workbench + /checks/[id]   (runs only the routed checks)
        |  runCheck(id)  --POST /api/audit/check-->
        |        getComputeTarget().computeCheck()   -> EngineResult (numbers + chart + verdict + correction)
        |        if verdict is flagged and a backend is wired:
        |          createReasoner().critique()       -> CriticJudgment (confirm | downgrade | veto)
        |          applyCriticGate()                 -> effective verdict + CriticAssessment
        |        createReasoner().narrate()          -> Narrative     (for the effective verdict)
        |        merge                                -> CheckResult
        |  previewCheck(id)  --POST /api/audit/preview--> the heavy re-analysis, dispatched as a job
        v
  /report   AuditReport derived from the CheckResults
  /bundle   --GET /api/bundle--> CorrectedBundle (readme + notebook + one script per flagged check)
```

The correction layer adds two seams to this path. The `check` op now returns an
`EngineResult` (the module's `run()` driver produces `(computeResult, correction)`), so the
corrected code and the recommendations arrive with the numbers. A separate `preview` op on
the remote adapter dispatches the heavy re-analysis (the pseudobulk re-test, the count-split
reclustering, the resolution sweep) as a job, so a runaway re-run cannot block the app. The
bundle route assembles the downloadable artifact (`CorrectedBundle`: a README, a
consolidated notebook, and one runnable script per flagged check) that the scientist leaves
with. See `correction-layer.md`.

Route handlers stay thin. They validate the body with the contract schemas and
delegate: all numeric logic lives in `@redline/engine`, all prose in
`@redline/reasoning`. The client store (`useSession`) streams the reasoning lines on
a timer (one line about every 165ms, from `reasoningLines(id, cfg)`) while the POST
resolves, so the agent's reasoning reads as live even on the fixture path.

## The numbers / prose split

Every finding is two halves that meet in the contract. This split is load-bearing: it
lets the deterministic fixture and the real Python engine produce identical numbers,
and it isolates the one part that calls a model.

- **`ComputeResult`** is the statistics. `{ checkId, state, headline, stats, chart }`.
  Produced by a `ComputeTarget`: the locked fixture, or the real Python rigor engine.
  Deterministic. No model call. The `chart` is a discriminated union keyed on `kind`
  (`significance`, `hardstop`, `groups`, `fragility`, `confound`, plus `volcano` and `fdr`
  for the corrected artifacts of the rigor checks), so the figure knows exactly what to
  draw.
- **`Narrative`** is the prose. `{ error, citation, original, corrected, missing? }`.
  Produced by the reasoning layer (Claude via Bedrock) or its curated fallback. It
  names the failure mode, cites the method paper that fixes it, strikes through the
  scientist's claim, and rewrites it in defensible language. On a clean verdict
  `error` and `original` are `null` and `corrected` carries the confident clean
  statement.

- **`Correction`** is the third part, added by the correction layer. `{ correctedCode?,
  recommendations?, preview? }`. Produced by the same deterministic module that produced
  the numbers: the runnable script that reproduces the honest re-analysis, the concrete
  next actions, and the corrected downstream result rendered beside the claim. Every field
  is optional, so a check that cannot correct simply omits it. What a `ComputeTarget`
  returns is `EngineResult = ComputeResult.extend(Correction.shape)`: the numbers plus
  whatever correction the module could produce, before the prose is added.

Between the numbers and the prose sits the **actor-critic pass** (Add-on 1, see
`docs/build/ADDON-1-ACTOR-CRITIC.md`). A candidate finding (a `flagged`
`ComputeResult`) is never shown on one pass. When a backend is wired,
`createReasoner().critique()` makes an independent, adversarial Claude call that
returns a `CriticJudgment` (`confirm | downgrade | veto`), and `applyCriticGate` maps
it to the effective verdict: confirm keeps the flag, downgrade lowers it to a soft
advisory, veto flips it to clean. A parse failure fails safe toward showing the
finding, marked critic-unverified. `CheckResult` carries the resulting
`CriticAssessment` and the pre-critic `computeState`, and the finding card shows the
critic line. This makes never-cry-wolf a mechanism: the acceptance harness
(`@redline/critic-verify`, surfaced at `/verifications`) proves the critic vetoes
over-fired flags on the clean foil and downgrades an underpowered split, not only
confirms.

`CheckResult = ComputeResult.merge(Narrative).extend(Correction.shape)` (plus the critic
fields) is what the UI renders per check: numbers, prose, and correction. The `state` enum
(`flagged`, `clean`, `flag_only`, `hard_stop`) is the effective verdict the whole system
agrees on; `ready` and `running` are UI-only transient states and are deliberately not part
of the engine's return contract. The correction shape is attached with `.extend()` so the
sibling add-ons (the critic assessment, the per-stat confidence intervals) can attach their
own optional keys to the same `CheckResult` without restructuring the type. See
`correction-layer.md`.

## The ComputeTarget seam

Where the statistics actually run is configuration, not a fork in the code. One
interface, four targets, one return shape.

```ts
interface ComputeTarget {
  readonly id: 'fixture' | 'local' | 'cloudrun' | 'endpoint';
  readonly available: boolean;
  inferFields(input: { scenarioId }): Promise<FieldSpec[]>;
  inspect(input: { scenarioId }): Promise<DatasetInventory>;   // the thin inspection step
  computeCheck(input: ComputeInput): Promise<ComputeResult>;
}
getComputeTarget(): ComputeTarget;   // reads REDLINE_COMPUTE_TARGET, default 'fixture'
```

| Target     | What it does                                   | When it is available |
|------------|------------------------------------------------|----------------------|
| `fixture`  | Locked deterministic demo numbers              | Always. The golden path. |
| `local`    | Spawns the Python engine on this machine        | When the Python env is wired. |
| `cloudrun` | Dispatches a GCP Cloud Run job                  | When the GCP project is configured. |
| `endpoint` | A runner the scientist controls (SSH / their cloud) | When the user endpoint is wired. |

The UI never changes when the target changes. Only the destination moves. The job
payload and the return contract are identical regardless of target. A target whose
env is not wired reports `available: false`, the app stays on `fixture`, and the
control for that target renders disabled and clearly labeled. Redline never presents a
dead control as live. See `honesty-rules.md` for why this is a hard rule and not a
nicety.

`inspect()` runs on the same seam. It returns a `DatasetInventory` (the `obs` columns,
the `uns` stored results, the cluster fields, whether raw counts are present) read from
metadata alone. It never loads the expression matrix `X`, so the front door stays cheap
even on a multi-gigabyte object. That inventory is what the claim-extraction agent reads;
see `intake-and-claims.md`.

This is the same dispatch seam that lets a scientist run the heavy jobs on
infrastructure they control while their data stays on their side, which mirrors how
Claude Science submits jobs to a lab's own HPC over SSH or to a Modal account.

## Cross-cloud: AWS runs the product and the brain, GCP runs the heavy compute

Claude orchestrates both clouds. There is no need to unify them.

**AWS.**
- **Bedrock** serves every Claude reasoning call, through
  `@aws-sdk/client-bedrock-runtime`, model id from `REDLINE_BEDROCK_MODEL_ID`, region
  from `AWS_REGION`, standard credential chain. Never the direct Anthropic API. On any
  missing credential or error the reasoning layer falls back to curated deterministic
  copy so the app always renders.
- **The rigor engine, the app backend, and the UI** run containerized on **Fargate**,
  so the product lives in one account with one deploy. (The public demo of `apps/web`
  also deploys to Vercel on the fixture target, which needs zero cloud credentials. See
  `deploy.md`.)

**GCP.**
- The genuinely heavy jobs (the pseudobulk re-analysis, the count-split reclustering
  and re-test, the resolution sweep) run as isolated **Cloud Run jobs**. GPU only if a
  check actually needs it, which v1 does not.
- Dispatch pattern: the AWS engine hands a job to GCP, GCP runs it, GCP returns the
  numbers. Separating the app from the number-crunching means a runaway analysis
  cannot take the app down.

The default `cloudrun` target points at Redline's own GCP project. The `endpoint`
target points at a user-provided runner. Both are the same seam; only the destination
differs.

## Portability as a Claude Skill

The engine packages as a Claude Skill from day one. This is the canonical split
Anthropic documents: the MCP server provides access to the tools, and the Skill
(`SKILL.md` plus scripts) teaches Claude when to apply each check, how to read the
output, and how to write the report and the clean verdict.

One caveat shapes the design. On the API, skills cannot make external network calls or
install packages, and custom skills do not auto-sync across surfaces. That is exactly
why the compute lives in the MCP server and the Skill carries only procedural
knowledge. In Claude Science and Claude Code, local code execution is available, so the
heavy diagnostics run there.

The demo closes on this: the same engine driving the standalone app is loaded live as
a Skill inside Claude Science, which proves Redline is infrastructure that outlasts the
week and not a one-surface toy. The live path in the demo stays on the standalone app;
Claude Science is the closer, not the critical path, so the crash surface stays small.

## Why it holds together

Every surface speaks one contract. The fixture, the Python engine, the reasoning
layer, and the UI all import the same Zod types from `@redline/contracts` and never
redefine them. That single shape is why the pieces integrate on the first try and why
swapping the compute target or the reasoning backend changes nothing the user sees.
