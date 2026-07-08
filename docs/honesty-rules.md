# Honesty rules

These are invariants, not preferences. They hold in code and in copy, on every surface.
A rigor tool that overclaims is the exact thing it exists to catch, so Redline holds
itself to the standard it audits others against. Each rule below says what it means, and
where in the contracts and the engine it is enforced.

## 1. Auditor, not corrector

Redline surfaces and quantifies problems and fragility. It does not hand back one
authoritative "corrected" result, because for most of these problems the field has no
agreed-on fix, and overclaiming a correction is a defensibility risk in front of expert
judges.

**The single exception is Pillar 1 (pseudoreplication).** Aggregating to pseudobulk and
re-testing is the accepted-correct method (Squair et al. 2021), so Pillar 1 may assert
the corrected result. Every other pillar reports evidence and sensitivity, never a
certified correction.

- **In the contract:** the `Narrative.corrected` field carries an asserted rewrite only
  for Check 1. For Checks 2, 3, and 4 it carries a defensible restatement of what can and
  cannot be concluded, not a new authoritative number.
- **In copy:** Check 1 may say "the corrected result is." Checks 2, 3, 4 say "the
  evidence shows" or "this cannot be concluded from this comparison."

## 2. Never cry wolf

When a check passes, Redline says so plainly and confidently. It never manufactures a
flag to have something to show. A clean analysis is a real answer, and reporting clean is
a feature, not a failure. The reference dataset's real answer includes clean, and a judge
who points Redline at the authors' rigorous analysis must see it correctly report clean.

- **In the contract:** the `CheckState` enum includes `clean`. On a clean verdict,
  `Narrative.error` is `null` and `Narrative.original` is `null`; `corrected` carries the
  confident clean statement.
- **In the UI:** clean renders as **Verified** in green (`stateLabel('clean')`), stated
  with the same weight as a flag.
- **Concrete case:** in Check 3, tracking a stable state (the "Naive" state on the Marson
  scenario, the "Homeostatic" group on the fallback) returns `clean`. The stability
  fraction is shown as a good stat, not a bad one. Do not soften a clean verdict into a
  hedge, and do not invent a flag to fill the panel.

## 3. Pillar 2 is evidence, not a certified FDR correction

Count splitting via Poisson thinning is a simple, defensible method, but it does not
fully control the false discovery rate in the most severe cases, and data thinning has
documented real-world limitations. Frame Pillar 2's output as evidence ("this many
markers survive a valid held-out test"), never as a certified correction. Name ClusterDE
as the stronger method on the roadmap.

- **In the contract:** `GroupsChart` reports `discAUC` and `holdAUC` and a surviving
  marker count. It does not report a corrected FDR or a corrected p-value.
- **In copy:** "N of 4 markers survive a held-out test" is allowed. "The FDR-corrected
  marker set is" is not. Always cite the stronger method by name.

## 4. The grouping variable is configurable, never hardcoded to "cell type"

The thing being compared or clustered is a configurable grouping variable: a cell type,
a cell state, an experimental condition, or a perturbation. Every pillar operates on a
resolved role, never on a hardcoded column name and never on "cell type."

- **In the contract:** `FieldRole` is the load-bearing abstraction. A pillar reads the
  `unit`, `grouping`, `nuisance`, and `derived` roles resolved in the foundation step. It
  never reads a literal column name or assumes a biological category.
- **In the foundation step:** the design is proposed by the model with a confidence
  level and confirmed by the scientist before anything runs. A wrong role makes every
  downstream flag wrong, which is worse than silence, so this gate is structural.
- **In copy:** say "the grouping variable" or the resolved role, never "the cell type,"
  unless the scientist confirmed that the grouping is in fact a cell type.

## 5. The naive foil, never imply the authors erred

Redline demonstrates on a naive analysis constructed on the reference data, never on the
authors' published analysis. The Marson/Pritchard authors did their work rigorously and
there is no error in it to catch. Copy must never imply otherwise. Their rigor is the
gold standard Redline helps others reach. See `dataset.md` for the full framing. This is
a hard constraint on every demo script, caption, and report line.

## 6. The configurable-compute honesty rule (never present a dead control as live)

Where the heavy statistics run is configurable (`fixture`, `local`, `cloudrun`,
`endpoint`). The default is the fixture, and the default real target is Redline's own
GCP dispatch. A user-provided endpoint is an optional target.

If a target's environment is not fully wired by demo time, it is **disabled and clearly
labeled as not yet available**. Never present a non-functional control as working. The
honest and sufficient message is "configurable, currently pointed at our compute." A dead
button labeled as live is not.

- **In the contract:** every `ComputeTarget` exposes `available: boolean`. When its env
  is unwired, `available` is `false`, the app stays on `fixture`, and the control for
  that target renders disabled with a plain label. The compute-environment surface shows
  the real state, never a hopeful one.
- **In copy:** describe the target as configurable and name the one that is actually
  running. Do not describe a target that is not wired as if it were.

## 7. Data-completeness gating (check first, always)

Pseudobulk (Pillar 1) and count splitting (Pillar 2) require raw integer counts. Look
for raw counts in `.raw` or a `counts` layer. If the object only carries normalized or
scaled values, Redline cannot re-run those analyses. It degrades gracefully to flag-only
for the affected pillars and says so explicitly. It never fabricates a re-run from
unsuitable data.

- **In the contract:** the `flag_only` state and the `Narrative.missing` field carry the
  "could not verify, here is what is needed" message. The chart's `verified` flag is
  `false` on this path.
- **In copy:** state what is missing and what would unblock the check ("raw counts in a
  `counts` layer," "a held-out set of at least 500 cells per group"), never a guessed
  number.

## 8. The hard branch: too few replicates

If a group has fewer than two real biological replicates, no valid differential
expression exists by any method. Redline states this flatly (`hard_stop`) rather than
producing numbers. On the Marson scenario, resolving the unit to a two-level
`guide_batch` gives n=1 per group and triggers this branch.

- **In the contract:** `CheckState` includes `hard_stop`; `HardStopChart` reports the
  unit count and the per-group count instead of a p-value.
- **In copy:** "no valid test is possible" and what to do about it (assign a field with
  replicate units, or collect more), never a fabricated statistic.

## How to use this doc

Before you write any user-facing string (a reasoning line, a report sentence, a headline,
a caption), check it against these eight rules. Before you wire any control, check rule 6.
Before you script any demo beat, check rule 5. If a change would make Redline claim more
than it can defend, the change is wrong, not the rule.
