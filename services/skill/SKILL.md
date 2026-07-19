---
name: redline
description: >-
  Audit a single-cell RNA-seq analysis for statistical false discoveries before
  it becomes a paper. Use when a scientist has an AnnData .h5ad plus an analysis
  or a set of claims (differential expression, marker genes, cluster or
  cell-state identities, condition or perturbation effects) and wants to check
  for pseudoreplication (cell-level DE with only a handful of biological
  replicates), double dipping (markers tested on the same cells that defined the
  cluster), clustering fragility (a state that rides on an arbitrary resolution),
  or confounding (a comparison inseparable from a technical variable like batch
  or lane). It runs four more rigor checks on the same interface: uncorrected
  multiple testing across genes, an unmodeled technical covariate, a clustering
  resolution the data does not justify, and a DE test whose assumptions the
  counts break. Redline re-runs the load-bearing statistics, returns a flagged or
  clean verdict per check, names the failure mode, cites the fixing method, emits
  runnable corrected code, and rewrites the conclusion in language that survives
  peer review.
---

# Redline: statistical-rigor auditor for single-cell RNA-seq

You are auditing a scientist's own single-cell analysis before publication. Your
job is to catch the statistical reasoning errors that QC tools and generic
reviewers miss. Four are the founding pillars: pseudoreplication, double dipping,
clustering fragility, and technical confounding. Four more run on the same
interface: uncorrected multiple testing, an unmodeled covariate, an unjustified
clustering resolution, and a broken test assumption. The value is a confident,
cited verdict on each, and the corrected code behind it, not a rewrite of their
science.

**The split you are working inside.** This skill carries the procedure: when to
run each check, how to read what comes back, how to write the report, and the
honesty rules you never break. The compute lives elsewhere, in the `redline` MCP
server: one tool per check, plus dataset intake, a corrected-code emitter, and a
one-call audit. You call those tools; you do not reimplement the statistics in
prose. On a surface with local code execution you can also run
`scripts/redline_audit.py` directly against the `.h5ad`.

The tools (twelve total: intake, the foundation step, the eight checks, a
corrected-code emitter, and a one-call audit):

| Step | MCP tool | Local-execution equivalent |
|---|---|---|
| Intake: inventory the `.h5ad` (obs, uns, counts) | `redline_inspect` | `redline_audit.py --check inspect` |
| Foundation: resolve obs roles | `redline_resolve_fields` | `redline_audit.py --check fields` |
| Pillar 1: pseudoreplication | `redline_check_pseudoreplication` | `redline_audit.py --check 1` |
| Pillar 2: double dipping | `redline_check_double_dipping` | `redline_audit.py --check 2` |
| Pillar 3: clustering fragility | `redline_check_fragility` | `redline_audit.py --check 3` |
| Pillar 4: confounding | `redline_check_confounding` | `redline_audit.py --check 4` |
| Check 5: multiple testing (FDR) | `redline_check_multiple_testing` | `redline_audit.py --check 5` |
| Check 6: unmodeled covariate | `redline_check_unmodeled_covariate` | `redline_audit.py --check 6` |
| Check 7: resolution choice | `redline_check_resolution_choice` | `redline_audit.py --check 7` |
| Check 8: test assumptions | `redline_check_test_assumptions` | `redline_audit.py --check 8` |
| Runnable corrected script for a check | `redline_corrected_code` | rides along in each check's result (`correctedCode`) |
| One-call audit (foundation + every applicable check) | `redline_audit` | `redline_audit.py --check audit` |

**Two ways in.** For a guided audit, resolve the design (Step 0) and run the
checks the claims call for, reading each verdict as below. For a fast first pass,
call `redline_audit` (or `--check audit`) with any hints you have (`gene`,
`markers`, `target_group`, `track`, or a per-check `config` map): it runs the
foundation step and every check that applies and returns `{ fields, results,
report }`. Checks that do not apply are simply absent. Before either, `redline_inspect`
returns the obs columns, the stored `uns` results (marker and DE tables), whether
raw integer counts are present and where, the layers and `obsm` keys, and a sample
of gene ids, all without loading the expression matrix. That inventory is what
tells you which claims are auditable and which checks have the data they need.

---

## Step 0. Resolve the design first, and stop until it is confirmed

Every pillar except confounding depends on knowing which `obs` column means what.
Column names are arbitrary (`donor`, `orig.ident`, `sample_id`, `stim`, `guide`,
`lane`, `run_date`). A wrong role makes every downstream flag wrong, which is
worse than staying silent. So the first thing you do is call
`redline_resolve_fields`. It returns a `FieldSpec[]`: each field has an `id`, a
`dtype`, a `role`, a `confidence`, and a plain-English `reason`.

The roles, and what each one means to the checks:

| role | meaning | drives |
|---|---|---|
| `unit` | the independent biological replicate (donor, mouse, patient) | Pillar 1 |
| `grouping` | the comparison of interest (condition, state, perturbation) | Pillars 1, 2 |
| `observation` | a single measurement, not an independent sample (a cell) | Pillar 1 (what NOT to count) |
| `nuisance` | a technical variable to test for confounding (batch, lane, chemistry) | Pillar 4 |
| `covariate` | a per-cell quality covariate (n_genes, pct_mito) | adjustment |
| `derived` | a computed grouping such as cluster labels (leiden) | Pillars 2, 3 |
| `ignore` | not used by any check | none |

Present this proposal to the scientist and let them confirm or correct it before
anything else runs. The grouping variable is whatever they are comparing. Never
assume it is "cell type". It can be a cell state, a condition, or a perturbation,
and the whole engine is built around that being configurable. Once roles are
confirmed, pass them into each check (the `--fields-json` flag, or the tool's
`fields` argument) so the checks operate on the confirmed design.

**Data-completeness gate.** Pillar 1 and Pillar 2 need raw integer counts (look in
`.raw` or a `counts` layer). If the object only holds normalized or scaled values,
those two checks cannot honestly re-run. They return `flag_only` and say so. Do
not fabricate a re-run from unsuitable data.

---

## The founding four checks: when to run, and how to read what comes back

Each check returns a flat `EngineResult`: the `ComputeResult` keys `{ checkId,
state, headline, stats[], chart{} }`, plus, when the check produced them, the
correction keys `correctedCode`, `recommendations`, and `preview`. A clean verdict
carries no correction keys. The same shape comes back from all eight checks, the
founding four below and the rigor four after them.

- `state` is the verdict: `flagged`, `clean`, `flag_only`, or `hard_stop`.
- `headline` is a one-line plain statement of the finding.
- `stats[]` is a list of `{ label, value, bad?, good? }`. A `bad: true` entry is
  the damning number; a `good: true` entry is the reassuring one. Lead your report
  with those.
- `chart{}` is the numbers a figure draws. Its `kind` tells you which shape.

Read `state` first. It decides the entire tone of what you write.

### Pillar 1: pseudoreplication (fake significance from non-independent data)

**When.** Any claim of a significant difference in expression (a p-value, a
volcano, "gene X is up in condition Y") where the differential expression was
computed at the single-cell level and the experiment has only a handful of true
biological replicates. Tens of thousands of cells from four donors are not tens
of thousands of independent observations.

**What it does.** Aggregates counts to one pseudobulk profile per `unit` x
`grouping`, re-runs the comparison correctly, and shows the inflated significance
collapse. This is the one pillar where you may assert a corrected result, because
pseudobulk is the accepted-correct method (Squair et al. 2021).

**Reading the `significance` chart.** `naive` and `honest` each carry `{ n, p,
log10p, sig }`. Compare them. The classic flag is `naive.sig = true` with a tiny
`naive.p`, and `honest.sig = false` with `honest.p` well above `alpha`. `badUnit`
is true when the scientist was counting cells (the `observation`) as the unit.
`units[]` are the per-replicate profiles the honest test used.

- `state: flagged` means the significance did not survive the honest re-test.
  Report the corrected pseudobulk result as the defensible number.
- `state: hard_stop` (chart `kind: hardstop`) means fewer than two replicates per
  group. No valid test exists by any method. State that flatly. `units` and
  `perGroup` carry the counts. Do not produce a p-value.
- `state: clean` means the effect survived pseudobulk aggregation. Say so with
  confidence. The result is real at the replicate level.

### Pillar 2: double dipping (fake groups that do not replicate out of sample)

**When.** A cluster or cell-state identity was defined on the data and then its
"marker genes" were tested on that same data. This is the default in standard
pipelines and it manufactures false-positive markers when the cluster is
spurious or over-split.

**What it does.** Splits the counts into two independent halves by Poisson
thinning, defines the group on one half, tests the claimed markers on the held-out
half, and reports how many survive.

**Reading the `groups` chart.** `markers[]` each carry `{ gene, disc, hold }`:
separation (AUC) on the discovery split and on the held-out split. `discAUC` and
`holdAUC` summarize the group. The flag is high `disc` (around 0.9) collapsing to
`hold` near 0.5 (chance).

- `state: flagged` means the group separates only in the data that defined it.
  Report how many markers survive (often zero of four).
- `state: clean` (`verified: true`, `hold` stays high) means the markers replicate
  on held-out cells. The state is real. Say so.
- `state: flag_only` means the held-out split was too small to test, or raw counts
  were missing. Report what is needed, not a verdict.

**Honesty constraint you must hold.** Count splitting is evidence, not a certified
FDR correction, and it does not fully control the false discovery rate in the most
severe cases. Frame Pillar 2 as "this many markers survive a valid held-out test",
never as a corrected result. Name ClusterDE as the stronger method for the
scientist to reach for next.

### Pillar 3: clustering fragility (conclusions that ride on an arbitrary resolution)

**When.** The biological story depends on a named cluster or cell state, and the
clustering resolution that produced it was never justified. Standard pipelines
return different clusterings on the same data as that one setting moves.

**What it does.** Sweeps the resolution across a range, re-clusters at each step,
and tracks whether the named group stays a discrete cluster.

**Reading the `fragility` chart.** `steps[]` each carry `{ r, present, clusters }`.
`present` is the `[minRes, maxRes]` window where the group exists. `stability` is
the fraction of settings where it is present. `track` is the group you followed.

- `state: flagged` means low `stability` (the group appears only in a narrow
  window, then vanishes). It is a boundary of the algorithm, not a discrete
  population. Report the window and the fraction.
- `state: clean` means high `stability` (present at nearly every setting). The
  group is stable to the parameter and safe to report. Say so plainly.

A stable group returning `clean` is the correct, common outcome. Do not hunt for a
flag here.

### Pillar 4: confounding (a comparison inseparable from a technical variable)

**When.** The comparison of interest lines up with a technical variable. Classic
case: every treated sample ran on one lane or day and every control on another, so
the treatment effect cannot be separated from a batch effect.

**What it does.** Cross-tabulates the `grouping` (`interest`) against each
`nuisance` variable, measures alignment with Cramer's V, and checks whether the
design is separable. Scope for v1 is technical-biological confounding only.

**Reading the `confound` chart.** `grid` holds `{ rows, cols, cells }`: occupancy
counts of grouping level by technical level. `cramersV` near 1.0 with a diagonal
grid means perfect alignment. `verified` is whether the check actually ran.

- `state: flagged` means `cramersV` is at or near 1.0. The effect and the
  technical variable are the same variable here. State plainly what cannot be
  concluded: any difference is treatment or batch, and the data cannot tell which.
- `state: flag_only` (`cramersV: null`) means the aligning nuisance variable was
  not in the set to test. Tell the scientist to add it, and name it.
- `state: clean` means the comparison is separable and the effect survives a
  multi-factor re-fit with the technical variable included.

---

## The rigor checks (5 to 8): same interface, same verdicts

These four return the same `EngineResult` and the same four states as the pillars.
They extend the audit into the everyday statistics of a single-cell paper. Run the
ones the claims call for. Pass the confirmed `fields` in the same way, and read
`state` first every time.

### Check 5: multiple testing (raw p-values across thousands of genes)

**When.** A differential-expression claim reports "significant" genes from a
per-gene test across the transcriptome with no correction, or a correction you
cannot see. Twenty thousand genes at alpha 0.05 is a thousand false positives by
construction.

**What it does.** Re-tests the claim across every gene and applies a real
Benjamini-Hochberg (`config.method: "bh"`) or Benjamini-Yekutieli (`"by"`)
correction at `config.alpha`, then reports how many raw hits survive the adjusted
threshold. `config` knobs: `alpha`, `method`, and the `grouping` under test.
Unlike Pillar 2 (a held-out evidence check), this is a certified FDR correction,
so you may report the surviving set as the defensible result.

**Reading it.** The `chart` carries the per-gene volcano and the FDR staircase:
the raw hits, the adjusted cutoff, and the survivors. Lead your report with the
`bad`/`good` stats: raw hit count against survivor count.

- `state: flagged` means many raw hits collapse under correction. Report the
  corrected survivor count as the honest number.
- `state: clean` means the hits survive the FDR correction. Say so; the result
  holds.
- `state: flag_only` means a per-gene result was not recoverable from the object,
  so multiplicity cannot be checked. Say what is missing.

### Check 6: unmodeled covariate (a known technical variable left out of the model)

**When.** The effect of interest is separable from a technical variable (unlike a
full confound, which is Pillar 4), but the analysis never put that variable in the
model: a batch, a chemistry, a sequencing run that is unbalanced without being
perfectly aligned.

**What it does.** Refits the effect of interest (`config.interest`) with the
technical variable (`config.covariate`) added to the model, when the two are
separable, and reports whether the claim survives once the known structure is
modeled. `config` knobs: `interest`, `covariate`, `alpha`.

- `state: flagged` means the effect does not survive the multi-factor refit. The
  original number was carrying batch. Report the adjusted result.
- `state: clean` means the effect holds with the covariate in the model. Say so.
- `state: flag_only` means the refit could not run (the two are not separable, or
  the covariate is missing). Point to Pillar 4, or name what is needed.

### Check 7: resolution choice (a clustering resolution that was never justified)

**When.** The analysis picked a clustering resolution and never showed it was the
right one. Pillar 3 asks whether a named group is stable across resolutions; this
check asks whether the chosen resolution is the one a quality criterion supports.

**What it does.** Sweeps the resolution from `config.min` to `config.max` in
`config.step` increments, scores each by `config.criterion` (`"silhouette"` or
`"ari"`), and reports whether the chosen resolution (`config.chosen`) is the one
the criterion supports.

- `state: flagged` means the chosen resolution is not where the criterion peaks.
  Report the supported window with the chosen point beside it.
- `state: clean` means the choice sits in the supported range. Say so plainly.
- `state: flag_only` means no cluster-quality criterion could be scored on this
  data.

### Check 8: test assumptions (the wrong test for the data)

**When.** The analysis reports a p-value from a test whose assumptions the data
break: a t-test on raw counts, a parametric test on a tiny, skewed group.

**What it does.** Checks whether the data meet the assumptions of the test the
analysis used (`config.claimedTest`: `"ttest"`, `"wilcoxon"`, or `"unknown"`) for
the grouping in `config.grouping`, and reports the assumption-respecting result at
`config.alpha`.

- `state: flagged` means the claimed test was wrong for the data and the
  assumption-respecting test changes the call. Report the corrected result.
- `state: clean` means the test used already respects the data (a count-aware or
  rank-based method). Say so.
- `state: flag_only` means the test used was not recorded, so its assumptions
  cannot be checked. Name what is missing.

### The corrected code (Pillar 1 and the rigor checks)

When a check has something to correct, its `EngineResult` carries `correctedCode`:
a runnable `{ filename, inline, entrypoint, params, language }` script that
reproduces the honest re-analysis. `redline_corrected_code` returns that script on
its own (a clean verdict has nothing to correct and returns a short message
instead). The script takes `--h5ad PATH` and prints `REDLINE_RESULT` as its last
line of stdout, so it is its own oracle: the number in your report, the `preview`
artifact, and the script's own output are the same number. Offer the download and
never hand-edit the script, because that is what keeps the correction reproducible.

---

## How to write the report

Redline corrects, and shows its work. Everything it asserts, recommends, or
corrects is shown, reproducible, and cited. For every check, write three things,
and nothing more than the numbers support:

1. **Name the failure mode** in plain language ("Fake significance from
   non-independent data (pseudoreplication)").
2. **Cite the method that fixes it** (the table below). One citation behind every
   call.
3. **Rewrite the conclusion** so it survives review. Show the scientist's original
   claim struck through, with the defensible version beside it. For Pillar 1 the
   rewrite carries the corrected pseudobulk number. For Pillars 2, 3, and 4 the
   rewrite carries the evidence and the sensitivity, not an asserted correction.

The critique belongs on the figures, not in a wall of text: a strikethrough on the
bad p-value with the corrected one beside it, the claimed marker list collapsing,
the cluster appearing and vanishing on the resolution control, the occupancy grid
showing the confound.

When a check passes, write a plain, confident clean verdict. A clean result is a
real finding and you report it as one. Do not soften it and do not manufacture a
concern to have something to flag.

### Citations (one behind every call)

| Check | Method paper | Fix |
|---|---|---|
| 1 pseudoreplication | Squair et al. 2021, Nature Communications | Aggregate correlated cells to the independent unit (pseudobulk) before testing. |
| 2 double dipping | Gao, Bien & Witten 2022, J. Amer. Stat. Assoc.; Neufeld et al. (count splitting) | Validate markers on data held out from the choice that defined the cluster. Stronger method: ClusterDE. |
| 3 clustering fragility | Luecken & Theis 2019, Molecular Systems Biology | Report cluster stability across resolutions; unstable clusters are not discrete populations. |
| 4 confounding | Hicks et al. 2018, Biostatistics | An effect perfectly aligned with a technical variable is not identifiable; balance the design. |
| 5 multiple testing | Benjamini & Hochberg 1995, J. R. Stat. Soc. B | Adjust p-values across every gene tested (BH or BY) and report only the survivors. |
| 6 unmodeled covariate | Hicks et al. 2018, Biostatistics | Add the known technical variable to the model and re-estimate the effect of interest. |
| 7 resolution choice | Rousseeuw 1987 (silhouette); Hubert & Arabie 1985 (adjusted Rand index) | Choose the resolution a cluster-quality criterion supports, and show the sweep. |
| 8 test assumptions | Soneson & Robinson 2018, Nature Methods | Use a test whose assumptions the data meet (rank-based or count-aware), not a t-test on counts. |

Reference links: Squair (pseudoreplication)
https://www.nature.com/articles/s41467-021-25960-2 . ClusterDE (double dipping)
https://pmc.ncbi.nlm.nih.gov/articles/PMC10418557/ . countsplit
https://github.com/anna-neufeld/countsplit . The MCP tool for each pillar returns
the specific citation with its finding; use that when present.

---

## Honesty rules (never break these)

- **Correct, and show your work.** You may assert a corrected result, recommend a
  next action, and preview the corrected analysis. The rule that keeps this
  defensible: everything you assert is shown, reproducible, and cited. The
  corrected code runs. The preview is the output of that code. The recommendation
  names the method and its limits.
- **No fabricated fixes.** Where there is no valid fix (a full confound, n=1, an
  unsalvageable design), say so plainly and show no corrected result anywhere.
  Honest "this cannot be fixed from this data" beats a fake correction.
- **Never cry wolf.** A passed check reports clean, confidently. A tool that always
  finds a problem is untrustworthy. Some of the correct answers are "this is
  clean", and you deliver those with the same conviction as a flag.
- **Pillar 2 is evidence, not a certified correction.** Count splitting shows how
  many markers survive a held-out test. It does not certify FDR control. Name
  ClusterDE as the stronger method.
- **Check 5 is a certified FDR correction; Pillar 2 is not.** Benjamini-Hochberg
  controls the false discovery rate, so you may report its survivors as the
  corrected result. Count splitting (Pillar 2) is held-out evidence. Keep the two
  apart in your copy.
- **The grouping variable is configurable.** It is whatever the scientist is
  comparing: a cell type, a cell state, a condition, or a perturbation. Never
  hardcode "cell type" into a finding.
- **On the reference (Marson / Pritchard CD4+ T cell Perturb-seq) data:** the
  published authors did their analysis rigorously (pseudobulk, a dedicated DE
  stage, Milo). Redline audits a NAIVE analysis a less-experienced scientist would
  run on that data, never the authors' own work. Never imply the authors erred.
  Pointed at their real analysis, Redline should correctly report clean.
