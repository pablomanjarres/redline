<p align="center">
  <img src=".github/redline-logo.svg" alt="Redline, statistical auditor for single-cell RNA-seq" width="860">
</p>

<p align="center"><strong>Break your own analysis before Reviewer 2 does.</strong></p>

<p align="center">
  <a href="https://redline-sooty-zeta.vercel.app"><strong>Open the live demo</strong></a> · runs in your browser, zero API keys, nothing to install.
</p>

<p align="center"><em>A statistical-rigor auditor for single-cell RNA-seq. It re-runs the load-bearing statistics on your own data and marks the false discoveries on your own figures, before they become a paper.</em></p>

<p align="center">
  <a href="https://redline-sooty-zeta.vercel.app"><img alt="Live demo" src="https://img.shields.io/badge/live_demo-online-2ea043?style=flat&logo=vercel&logoColor=white" /></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" />
  <img alt="Python" src="https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white" />
  <img alt="React 19" src="https://img.shields.io/badge/React_19-20232A?style=flat&logo=react&logoColor=61DAFB" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white" />
  <img alt="Zod" src="https://img.shields.io/badge/Zod-3E67B1?style=flat&logo=zod&logoColor=white" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-CE2A1E?style=flat&logo=modelcontextprotocol&logoColor=white" />
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-CE2A1E?style=flat" />
  <img alt="status building" src="https://img.shields.io/badge/status-building-A9741A?style=flat" />
  <img alt="Built with Claude: Life Sciences" src="https://img.shields.io/badge/Built_with_Claude-Life_Sciences-CE2A1E?style=flat&logo=anthropic&logoColor=white" />
</p>

Redline audits the statistics behind a single-cell RNA-seq analysis before that analysis becomes a paper. A scientist hands it their data (an AnnData `.h5ad`) and the analysis they ran. Redline re-runs the load-bearing steps itself, then turns adversarial on the results: it finds where a conclusion is statistically invalid, or only looks significant because of how the data was handled. Every finding lands on the scientist's own figure, names the exact failure mode, cites the method paper that fixes it, and rewrites the conclusion in language that survives peer review.

QC is a solved, commoditized layer, and a generic reviewer reads a finished manuscript. Redline works one level in from both: on your own data and your own code, on the statistical reasoning, before any of it is published. It catches eight classes of error that no QC tool and no generic agent flags: four founding pillars plus four rigor checks built on the same interface.

> [!IMPORTANT]
> **For judges (60 seconds).** Open the live demo at https://redline-sooty-zeta.vercel.app. No API key, nothing to install.
> On the workbench, pick **Play it for me** to let the tour drive itself, or **Walk me through it** to click through at your own pace.
> Watch Check 1. A p-value of 6.2e-11 claimed across 51,842 cells gets struck through, and the honest p of 0.21 across the 4 real donors drops in beside it as the bar falls under the significance line. Redline names the failure mode, pseudoreplication, and cites Squair 2021.

<p align="center">
  <img src=".github/lab-critter-walk.gif" alt="Redline's lab critter mascot walking in, Reviewer 2 in a lab coat" width="880">
</p>

## What it catches

The four founding pillars:

- **Fake significance from non-independent data (pseudoreplication).** Cells from one donor are not independent samples. Testing 40,000 cells as 40,000 observations when they came from four donors inflates type-1 error massively. Redline aggregates counts to one profile per biological replicate and re-runs the comparison correctly with PyDESeq2 (Squair et al. 2021). On screen the tiny p-value gets struck through, the corrected value drops in beside it, and the volcano deflates from fireworks to nearly empty. If a group has fewer than two real replicates, no valid test exists by any method, and Redline states that flatly instead of printing a number.
- **Fake groups (double dipping).** Clusters defined on the data and then tested for their own marker genes on that same data manufacture false positives. It is the default in standard pipelines, and Seurat itself warns about it. Redline splits the counts into two statistically independent halves (Poisson thinning), clusters on one half, tests markers on the other, and reports how many of the claimed markers survive. The claimed marker list collapses on screen. Count splitting is evidence, not a certified FDR correction, and Redline says so and names ClusterDE as the stronger method on the roadmap.
- **Fragile conclusions (clustering instability).** The biological story often rides on an arbitrary clustering resolution the scientist never justified. Redline sweeps the resolution across a range, measures agreement between settings with the adjusted Rand index, and tracks whether a named cluster survives the sweep. A slider re-runs clustering live and the claimed cell state appears and vanishes.
- **Confounded comparisons.** The comparison of interest can be inseparable from a technical variable, for instance when the treated and control samples were processed on different days. Redline builds the design matrix from the confirmed columns, checks whether condition and batch are collinear or fully nested, then re-fits with the technical variable included to see if the effect survives. It flags what cannot be concluded, in plain language. (v1 covers technical-biological confounding; composition shifts are out of scope.)

The four rigor checks, on the same interface:

- **Significance claimed on raw p-values (multiple testing).** Calling genes significant on raw p-values across thousands of tests inflates false discoveries. Redline applies Benjamini-Hochberg control and reports how many raw hits survive at the chosen q threshold. This is a real FDR correction, and its limit travels with it: BH controls the false discovery rate, not the family-wise error rate.
- **Known batch structure left out of the model (unmodeled covariate).** A batch or covariate that is separable from the effect but omitted from the model can carry a spurious result. Redline re-fits the comparison with the covariate term added and shows the claimed statistic beside the corrected one.
- **A cluster count chosen without a stability criterion (resolution choice).** When the resolution was picked without justification, Redline sweeps it, scores each setting by a stability criterion (silhouette or the adjusted Rand index), and shows whether the chosen resolution sits in the supported range.
- **A test whose assumptions the data violate (test assumptions).** Redline re-runs the comparison with the assumption-appropriate test and shows the corrected p beside the one the claimed test produced.

## The rules Redline never breaks

- **Correct, and show your work.** Redline corrects the analysis and previews the corrected result. Everything it asserts, recommends, or corrects is shown, reproducible, and cited: the corrected code is downloadable and runs, the preview is the output of that code, and the recommendation names the method and its limits. The reported numbers, the preview, and the output of the downloadable code agree within tolerance, or the check fails its own harness.
- **No fabricated fixes.** When there is no valid fix (a full confound, n=1, an unsalvageable design), Redline says so plainly and shows no corrected result anywhere. This is enforced structurally: the contract refuses to carry a corrected artifact on an unsalvageable finding. An honest "this cannot be fixed from this data" is worth more than a fake correction.
- **Never cry wolf.** When a check passes, Redline says so plainly and confidently. It never manufactures a flag to have something to show. A clean analysis is a real answer, and a passed check renders as **Verified** in green, stated with the same confidence Redline gives a flag. A tool that always finds a problem is a tool nobody trusts. We measured this. On a 46-case benchmark of planted errors and clean controls, Redline stays quiet on clean data at a **0% false-positive rate**, while a single Claude call given the same write-up cries wolf **74%** of the time. Both arms catch essentially all of the planted errors, but detection there is near-definitional, so the honest, load-bearing number is the false-positive gap: **0% versus 74%**. See `services/rigor/bench`.

## How it works

One engine, every surface. The core is a rigor engine that exposes a foundation step plus the registered checks (four founding pillars and four rigor checks on the same module interface), each as an independent MCP tool, and packages as a Claude Skill so the same code drops into Claude Science. A plots-first web workbench renders the scientist's figures and overlays the findings on them.

Before any check runs, a **foundation step** resolves the design. Column names in an `.h5ad` are arbitrary (`donor`, `orig.ident`, `stim`, `batch`, guide IDs), so Redline's foundation step inspects the `obs` columns and proposes which one is the biological replicate, which is the grouping variable being compared, and which are technical nuisances, each with a reason and a confidence level. The scientist confirms or corrects it. Nothing else runs until the design is confirmed, because a wrong role makes every downstream flag wrong. Every check operates on that resolved role, never on a hardcoded "cell type."

With the design confirmed, a second step reads the analysis and proposes the claims to audit. The scientist does not hand-write claims and Redline does not parse code. An agent inspects the stored results in the `.h5ad` (marker tables, differential-expression tables), plus an optional notebook or a pasted description, and proposes each auditable claim already routed to the checks that can test it and marked with a confidence. A bare `.h5ad` with stored results is enough. The scientist confirms, edits, or removes the list on a review screen, adds any the agent missed, and only the confirmed claims run. A deterministic backstop drops any claim built on data the object does not contain, so nothing is fabricated and then audited. See `docs/intake-and-claims.md`.

A `ComputeTarget` seam decides where the statistics actually run, behind one return contract:

```text
fixture    locked deterministic demo          (default, always available)
local      spawn the Python engine locally    (real scanpy / PyDESeq2)
cloudrun   dispatch a GCP Cloud Run job        (heavy jobs, isolated)
endpoint   a runner the scientist controls     (SSH cluster or their own cloud)
```

The UI never changes, only the target does. A target that is not yet wired stays disabled and clearly labeled until it is.

```text
redline/
├── apps/
│   └── web/            # plots-first workbench (Next.js -> Vercel)               · built
├── packages/
│   ├── contracts/      # @redline/contracts: Zod shapes every surface speaks      · built
│   ├── ui/             # @redline/ui: tokens, palette, React primitives           · built
│   ├── engine/         # orchestration + the ComputeTarget seam + demo fixtures   · built
│   └── reasoning/      # reasoning layer (Claude): names, cites, rewrites the finding · built
└── services/           # Python side, outside the pnpm graph
    ├── rigor/          # scanpy / PyDESeq2 engine: MCP server + GCP Cloud Run job  · built
    └── skill/          # the same engine as a Claude Skill (for Claude Science)    · built
```

Every finding is numbers plus narrative plus correction: a `ComputeResult` (the verdict, the stats, the chart payload) from the compute target, merged with a `Narrative` (the named failure mode, the citation, the struck-through claim, the defensible rewrite) from the reasoning layer, and a `Correction` (the runnable corrected script, the recommended next actions, the corrected result rendered beside the claim) from the same module. All three are Zod-typed in `@redline/contracts`, so the fixture, the Python engine, the reasoning layer, and the UI all speak one shape.

## What you leave with

Redline does not stop at the flags. For every corrected check it hands back a runnable Python script that reproduces the honest re-analysis, and it assembles them into a downloadable bundle: a README that explains what was wrong and what each script fixes, a consolidated notebook, and one script per flagged check. Each script takes `--h5ad PATH` and runs on the scientist's own data. The corrected result the app shows is the output of that code, and the two agree by construction, so what you download is exactly what you saw. When a finding cannot be fixed from the data, the bundle says so and ships no fabricated correction. See `docs/correction-layer.md`.

## What's inside

| Path | What it is | Status |
|---|---|---|
| `packages/contracts` | `@redline/contracts`: Zod schemas for every shape the system exchanges. Field roles and verdicts (`primitives`), resolved `obs` columns (`fields`), seven discriminated chart payloads (`charts`), the compute-plus-narrative-plus-correction finding (`checks`), the correction shapes (`correction`), scenarios and datasets (`dataset`), the reasoning request/response (`reasoning`), and the assembled `AuditReport`. | built |
| `packages/ui` | `@redline/ui`: the design system. The audit-instrument tokens (a light instrument surface, a reserved red for findings, a blue signal), Archivo and JetBrains Mono, and verdict-to-color / verdict-to-label helpers. | built |
| `packages/engine` | Orchestration across the foundation step and the eight registered checks, the `ComputeTarget` dispatch seam, and the locked deterministic fixtures that keep the demo path bulletproof. | built |
| `packages/reasoning` | The reasoning layer. Claude names the failure mode, cites the fixing method, rewrites the conclusion, and writes the clean verdict when a check passes, over the first-party Claude API (the path you run, with your own key) or AWS Bedrock (the hosted demo), with a curated deterministic fallback when no key is set. | built |
| `apps/web` | The plots-first workbench. Next.js, one panel per check with its knobs exposed, findings marked on the figures. Deploys to Vercel. | built |
| `services/rigor` | The real statistics in Python (scanpy, decoupler, PyDESeq2, numpy), exposed as an MCP server and runnable as a GCP Cloud Run job. | built |
| `services/skill` | The rigor engine packaged as a Claude Skill (`SKILL.md` plus scripts), so the same core loads natively into Claude Science. | built |
| `services/rigor/bench` | The detection benchmark: 46 labeled cases with planted statistical errors and clean controls, an independent ground-truth labeler, and the Redline-vs-single-Claude-call comparison (a 0% versus 74% false-positive gap, same model in both arms). Reproduces from committed transcripts (`--replay` / `--score-only`). | built |

## How Claude Code built this

Redline was built by a fleet of Claude Code agents with the guardrails wired in. 282 commits, 23 merged PRs. Along the way Claude reviewed its own pull requests, caught its own statistical bugs, and drove the running app to prove the numbers on screen were real.

- **Claude reviews its own PRs to convergence, unattended.** `scripts/pr-watch.sh` runs under launchd every 600 seconds. It finds any pull request it has not seen against a watermark, pages my phone, and spawns headless Claude on the `/pr-loop` skill. Each pass runs six steps: verify the claim, attack the PR's strongest sentence and try to falsify it with evidence, investigate to root cause, fix at the root, re-verify, check direction. The loop stops only when two consecutive passes turn up zero new confirmed findings and `scripts/pr-verify.sh` exits 0. It reviews and it fixes, and it never merges unless a human sets the merge flag. Every kill switch defaults off.
- **The loop caught three real statistical bugs that every test suite had passed.** Reviewing six merged PRs, it found that Pillar 2 flagged clean analyses, that clustering fragility missed 5 of 6 continuum cases, and that Pillar 4 fed 1,140 individual cells to PyDESeq2 as if they were replicates. The check written to catch pseudoreplication was committing it, and reporting the result to the scientist. Root cause: the `[stats]` extra shipped scanpy without `leidenalg`, scanpy imports it lazily inside `sc.tl.leiden`, a bare `except` swallowed the error, and every clustering call had been silently running KMeans. The test named `test_pillar3_runs_real_leiden_sweep` passed the whole time without once running Leiden. The lesson went straight into the verifier: install the real stack and assert `sc.tl.leiden` actually partitions a graph before believing any passing test.
- **About twenty parallel agents, one concern each, behind a contract seam.** The build fanned out across git worktrees off a single repo, each worktree an agent owning one feature: the correction layer, the detection benchmark, the guided tour, the verification harness, the PR loop itself. They did not collide because the Zod types in `packages/contracts` are the one source of truth every surface imports, and `docs/build/INTERFACES.md` is the authoritative seam. An integrator merges; the build agents write only the files they own.
- **A self-verification harness that injects its own faults.** `/verifications` drives the live app with Playwright and grades every number on screen against an independent oracle that never imports the app's engine. Each number earns one verdict: WIRED, STATIC, BROKEN, TEMPLATED, or MISSING, and only WIRED passes. To prove the harness itself can fail, it injects faults on purpose: a frozen knob has to report STATIC, a perturbed number has to report BROKEN, a templated narrative has to report TEMPLATED. If a single injected fault slips through, the run does not pass.
- **A benchmark that argues against its own headline.** The 46-case benchmark reports Redline catching 100% of planted errors at a 0% false-positive rate against a single Claude call at 74%. Then the write-up tells you to read the 100% with suspicion, because detection there is near-definitional, and names the honest, load-bearing result as the 0% versus 74% false-positive gap. Same model in both arms. The only variable is whether the test gets re-run.
- **One engine, three Claude surfaces.** The same rigor core ships as the web workbench, an MCP server (`services/rigor/redline/mcp_server.py`), and a 12-tool Claude Skill (`services/skill/SKILL.md`) that loads into Claude Science. The twelve tools are intake, field resolution, the eight checks, the corrected-code emitter, and a one-call full audit. Each runs as a hosted tool or offline against a scientist's own `.h5ad`.

## The reference dataset

Redline is dataset-agnostic, but it is built and validated against one reference set: the Marson/Pritchard genome-scale CD4+ T-cell Perturb-seq data (Zhu, Dann et al. 2025), Gladstone's flagship single-cell resource and the dataset this hackathon highlighted. It sits on an open S3 bucket (`s3://genome-scale-tcell-perturb-seq/marson2025_data/`, no credentials), MIT licensed, with raw counts so the re-runs are real. Its structure (4 donors, 3 conditions) is a native fit for the pseudoreplication and confounding checks.

The full set is 1.7 TB (individual matrices 15–148 GiB), so the complete recompute across the checks runs on a machine with the data, not in the hosted demo. The two small published summary tables (`sample_metadata`, `DE_stats`, MIT) are committed in `services/rigor/data/real/`, and `services/rigor/data/build_real_marson.py` derives real numbers from them with no matrix: the real experimental design and the real batch confound (`culture_condition` × sequencing run, Cramér's V = 0.50: every 48-hour sample ran in batch R2). The app surfaces those on its Environment page. The matrix-dependent checks (the naive cell-level p, double-dipping AUC, clustering fragility) run through the Python engine (`REDLINE_COMPUTE_TARGET=local`, `redline.remote_adapter`).

One hard rule governs every demo. The authors did their analysis rigorously: they provide pseudobulk matrices and a dedicated DE stage, and the computational lead authored Milo. There is no error in their published work to catch, and Redline never implies otherwise. Redline audits a naive foil instead, the standard cluster-then-annotate-then-DE workflow a less-experienced scientist would run on the same data. Their rigor is the standard Redline helps others reach. Pointed at a clean analysis, Redline reports clean.

## Tech stack

TypeScript, Node 22, pnpm, and turbo, with Zod contracts binding every surface. React 19 and Next.js for the workbench. Python with scanpy, decoupler, and PyDESeq2 for the real statistics: pseudobulk differential expression, count-split reclustering, Leiden resolution sweeps, and design-matrix rank checks. Claude writes the reasoning layer (the failure-mode name, the citation, the defensible rewrite) over the first-party Claude API, or AWS Bedrock for the hosted demo. MCP for the engine surface, packaged as a Claude Skill for Claude Science. GCP Cloud Run for the heavy jobs, Vercel for the web app.

## Getting started

Requires Node 22 or newer and pnpm.

```bash
git clone https://github.com/pablomanjarres/redline.git
cd redline

pnpm install
pnpm build        # builds the four packages, then the Next.js workbench
pnpm typecheck
pnpm test         # engine (42) + reasoning (11) + guided tour (32)
```

### Take the tour

Open the workbench and it offers a guided walkthrough on the first visit. It darkens
everything except the control you should touch next and explains what that control does,
what to put there, and why the check behind it matters, across all four catches, the clean
verdict, the report, and the engine surface.

Pick **Walk me through it** to drive, or **Play it for me** to watch it run hands free.
Append `?tour=1` to reopen it, or `?tour=0` to keep it shut. See `docs/guided-tour.md`.

### Configuration

Copy `.env.example` to `.env.local` and set only what you need. Nothing is hardcoded.

```bash
# Reasoning — Claude. Set a key and Claude writes the findings; unset = curated fallback.
ANTHROPIC_API_KEY=sk-ant-...                # first-party Claude API (the path you run)
# REDLINE_ANTHROPIC_MODEL=claude-opus-4-8   # optional; defaults to Claude Opus 4.8
# The hosted demo pins AWS Bedrock instead (REDLINE_REASONING_BACKEND=bedrock) — see .env.example.

# Where the heavy statistics run: fixture (default) | local | cloudrun | endpoint
REDLINE_COMPUTE_TARGET=fixture

# Reference dataset: open S3, no credentials required, MIT licensed.
REDLINE_S3_BUCKET=genome-scale-tcell-perturb-seq
REDLINE_S3_PREFIX=marson2025_data/
```

## Status

Hackathon v1. Built for **Built with Claude: Life Sciences** (Anthropic × Gladstone Institutes).

The stack is on disk and runs end to end: the contracts and design system, the orchestration engine with its `ComputeTarget` seam and the locked fixtures, the plots-first workbench (deployed to Vercel), the Claude reasoning layer (first-party Claude API, or Bedrock for the hosted demo, with a curated fallback), and the Python rigor service (the eight checks, the MCP server, the Cloud Run job runner, and the Claude Skill packaging). The `next build` is green, and the hosted demo is live at https://redline-sooty-zeta.vercel.app, running on the fixture target with zero cloud credentials. Point `REDLINE_COMPUTE_TARGET` at the Python engine to run the real statistics on your own `.h5ad`.

## License

MIT. See [LICENSE](./LICENSE).

---

<p align="center">
  Built with Claude: Life Sciences (Anthropic × Gladstone Institutes) · Built by Pablo Manjarres
</p>
