<p align="center">
  <img src=".github/redline-logo.svg" alt="Redline, statistical auditor for single-cell RNA-seq" width="640">
</p>

<p align="center"><strong>Break your own analysis before Reviewer 2 does.</strong></p>

<p align="center"><strong>Built with Claude: Life Sciences</strong> (Anthropic × Gladstone Institutes) · Builder track</p>

<p align="center">
  <a href="https://redline-sooty-zeta.vercel.app"><strong>Live demo</strong></a> ·
  <a href="https://github.com/pablomanjarres/redline">Repository</a> ·
  runs in your browser, zero API keys, nothing to install
</p>

---

## Written summary

Single-cell RNA-seq conclusions fail peer review on the statistics while the biology holds up. A standard pipeline treats 51,842 cells from four donors as 51,842 independent samples, so a marker gene looks significant at p = 6.2e-11, until a proper per-donor test puts it at 0.21. Reviewer 2 catches that. You didn't.

Redline audits those statistics on your own data before you submit. Hand it your .h5ad and the analysis you ran; it re-runs the load-bearing tests, marks the false discoveries on your own figures, cites the method that fixes each, and hands back corrected code that runs on your data. It flags eight error classes that QC tools and generic reviewers skip.

The honest number is a false-positive gap. On a 46-case benchmark of planted errors and clean controls, redline stays quiet on clean data at 0% false positives. One Claude call given the same write-up cries wolf 74% of the time.

I built redline with Claude Code running a loop that reviewed its own pull requests, which caught three real bugs, including a check that was committing the pseudoreplication the tool exists to catch. Try it with no API keys at https://redline-sooty-zeta.vercel.app

---

## See it in 60 seconds

1. Open [the live demo](https://redline-sooty-zeta.vercel.app). No key, nothing to install.
2. On the workbench, pick **Play it for me** and the tour drives itself, or **Walk me through it** to click at your own pace.
3. Watch Check 1. A p-value of 6.2e-11 claimed across 51,842 cells strikes through, and the honest p of 0.21 across the 4 real donors drops in beside it as the bar falls under the significance line. Redline names the failure mode, pseudoreplication, and cites Squair 2021.
4. Download the corrected Python bundle. Each script takes `--h5ad PATH` and runs on your own data.

---

## How it maps to the judging criteria

### Impact (25%)

Single-cell RNA-seq is the workhorse of the Gladstone reference dataset and of modern immunology, and its conclusions are only as sound as the statistics under them. The common failures are structural, not careless: testing cells as independent samples when they came from a handful of donors, defining a cluster on the data and then testing it for its own markers, calling significance on raw p-values across thousands of genes. QC tools do not look at any of this, and a generic reviewer only sees the finished manuscript.

Redline audits the load-bearing statistics on the scientist's own data and analysis, before publication, and catches eight classes of error that neither QC nor a generic agent flags. The value is quantified and honest: a reviewer that flags problems that are not there wastes the scientist's time, and a single Claude call does that on 74% of clean cases. Redline does it on 0%. Anyone running differential expression or marker analysis on scRNA-seq can point it at their own `.h5ad` today.

### Claude Use (25%)

Claude Code wrote redline, then reviewed its own pull requests to convergence and caught its own science bugs.

- **Claude reviews its own pull requests, unattended, on a timer.** `scripts/pr-watch.sh` runs under launchd every 600 seconds, finds unseen PRs, and spawns headless Claude on a `/pr-loop` skill. Each pass verifies the claim, attacks the PR's strongest sentence and tries to falsify it, roots-causes, fixes, re-verifies, and only stops when two consecutive passes find nothing new and `pr-verify.sh` exits 0. It never merges unless a human sets the flag.
- **That loop caught three real statistical bugs every test suite had passed**, including its confounding check (Pillar 4) feeding 1,140 individual cells to PyDESeq2 as replicates. The tool built to catch pseudoreplication was committing it. Root cause: a missing `leidenalg` made scanpy silently fall back to KMeans, and a test named `test_pillar3_runs_real_leiden_sweep` had passed without ever running Leiden.
- **About twenty parallel git-worktree agents**, one concern each, coordinated by the Zod contract seam in `packages/contracts` so they never collide.
- **A self-verification harness** that drives the live app with Playwright, grades every on-screen number against an independent oracle, and injects its own faults to prove it can still fail.
- **One engine, three Claude surfaces**: the web workbench, an MCP server, and a 12-tool Claude Skill that loads into Claude Science.

### Depth & Execution (20%)

- **Eight checks, each a real statistical method with a citation.** Pseudobulk differential expression with PyDESeq2 (Squair 2021), held-out marker validation after count-splitting (Gao, Bien & Witten 2022), resolution sweeps scored by the adjusted Rand index (Luecken and Theis 2019), design-matrix rank and Cramér's V for confounding (Hicks 2018), Benjamini-Hochberg FDR control (B&H 1995), and a count-aware test for assumption violations (Soneson and Robinson 2018).
- **Real compute, not a mock.** The Python engine runs genuine scanpy and PyDESeq2, covered by 99 test functions. A `ComputeTarget` seam swaps the demo fixture for a local engine, a Cloud Run job, or the scientist's own runner behind one contract, with the same UI.
- **Honesty enforced structurally.** When no valid fix exists (a full confound, n=1), the contract refuses to carry a corrected artifact, so redline cannot fabricate a fix. A passing check renders as Verified, with the same confidence as a flag.
- **The corrected result you see is the code you download**, in agreement by construction or the check fails its own harness.

### Demo (30%)

- **Live and reproducible with zero API keys.** The demo defaults to a locked deterministic fixture and a curated reasoning fallback, so it never depends on a network call to a model at the moment a judge is watching.
- **A guided tour with a hands-free presenter mode** that runs the real session actions and never shows a faked number.
- **The watchable moment**: the Check 1 p-value deflation on the scientist's own figure, deterministic, cited, and impossible to break on a bad connection.
- **You leave with something real**: a downloadable Python bundle that reproduces the honest re-analysis on your own data.

---

## What is honest about this

A submission is only as trustworthy as the claims it will not make.

- **The reference authors did their analysis correctly.** Redline audits a naive foil, the standard cluster-then-annotate-then-DE workflow a less-experienced scientist would run on the Gladstone data. It never implies an error in the published work.
- **Detection is the easy part.** Both redline and a plain Claude call catch essentially all planted errors, because detection shares method and case selection with the grader. The load-bearing result is the false-positive gap, 0% against 74%, and the benchmark write-up says so itself.
- **Two compute targets are built but not yet wired.** `cloudrun` and `endpoint` render disabled and clearly labeled until they are connected. Nothing pretends to be live that is not.

---

<p align="center">Built by Pablo Manjarres · <a href="https://redline-sooty-zeta.vercel.app">redline-sooty-zeta.vercel.app</a></p>
