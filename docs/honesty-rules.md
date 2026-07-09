# Honesty rules

These are invariants, not preferences. They hold in code and in copy, on every surface.
A rigor tool that overclaims is the exact thing it exists to catch, so Redline holds
itself to the standard it audits others against. Each rule below says what it means, and
where in the contracts and the engine it is enforced.

## 1. Correct, and show your work

Redline gives advice, corrects the analysis, and previews the corrected result. This
replaces the old "auditor, not corrector" rule, which limited the assertion of a
corrected result to Pillar 1. The rule that keeps the new behavior defensible:
everything Redline asserts, recommends, or corrects is shown, reproducible, and cited.
The corrected code is downloadable and runs. The preview is the output of that code. The
recommendation names the method and its limits. No silent black-box authority.

- **In the contract:** `CorrectedCode.inline` is the script that reproduces the honest
  re-analysis. `PreviewArtifact.after` is its output, the corrected result rendered.
  `Recommendation.citation` names the method behind the fix.
- **The three-way consistency requirement:** the reported numbers (`Evidence.numbers`),
  the preview (`PreviewArtifact.after`), and the output of the downloadable code all
  agree within tolerance. Every emitted script prints, as its last line of stdout,
  `REDLINE_RESULT {json}` whose keys are exactly the keys of that check's
  `Evidence.numbers`. The acceptance harness runs the script and diffs its JSON against
  what Redline reported and against the preview. If the preview and the code disagree,
  one of them is faked, and the harness fails. The enforcing test is
  `services/rigor/tests/test_correction.py::test_three_way_consistency_holds_for_every_fired_check`
  (its `assert_three_way` helper is itself covered by
  `test_assert_three_way_catches_a_faked_preview`).

This does not license overclaiming. A method's strength is stated honestly (rule 3), and
a fix that does not exist is never invented (rule 9).

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

## 3. Check 2 is evidence, not a certified FDR correction. Check 5 is a real correction.

Two checks touch the false discovery rate, and they are not the same thing. Do not
conflate them.

Check 2 (double dipping) uses count splitting via Poisson thinning, a simple, defensible
method that does not fully control the false discovery rate in the most severe cases, and
data thinning has documented real-world limitations. Frame Check 2's output as evidence
("this many markers survive a valid held-out test"), never as a certified correction.
Name ClusterDE as the stronger method on the roadmap.

Check 5 (multiple testing) IS a Benjamini-Hochberg correction. It applies BH adjustment
to a set of raw p-values and reports how many hits survive FDR control. It may be
described as a correction, because it is one. Its limit travels with it (rule 10): BH
controls the false discovery rate, not the family-wise error rate.

- **In the contract:** Check 2's `GroupsChart` reports `discAUC`, `holdAUC`, and a
  surviving marker count. It does not report a corrected FDR or a corrected p-value. Check
  5's `FdrChart` reports `rawHits`, `adjustedHits`, the `method` (`bh` or `by`), and per
  gene `q` values with a `survives` flag.
- **In copy:** for Check 2, "N of 4 markers survive a held-out test" is allowed, "the
  FDR-corrected marker set is" is not, and always cite the stronger method by name. For
  Check 5, "N of M raw hits survive Benjamini-Hochberg control at q < alpha" is allowed,
  because that is what the check computes.

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

## 9. No fabricated fixes

When there is no valid fix (a full confound, n=1, an unsalvageable design), Redline says
so plainly, in the finding, in the recommendation, and in the preview. An honest "this
cannot be fixed from this data" is worth more than a fake correction. Redline never
invents a fix that does not exist.

- **Enforced structurally:** `PreviewArtifact` (Zod `.superRefine`, and the Python
  `__post_init__` mirror) refuses to carry an `after` artifact when `unsalvageable` is
  true. A fabricated fix is a parse error, not a review comment. The same guard sits on
  `Evidence` in the Python engine: an unsalvageable finding with a `corrected_artifact`
  raises before it can be serialized.
- **Feasibility is deterministic.** `Recommendation.feasibility` is decided by the engine,
  never by the model. The reasoning layer's honesty backstop overwrites whatever the model
  returned against the engine's verdict, and a model that proposes a statistical fix in an
  unsalvageable slot is treated as unavailable, so the curated copy wins.
- **Concrete case:** Check 1 resolved to a two-level `guide_batch` gives n=1 per group.
  No valid differential expression exists by any method. The state is `hard_stop`, the
  feasibility is `needs_new_data` or `unsalvageable`, and no corrected result is shown
  anywhere. Check 4 with a fully collinear condition and lane (Cramer's V = 1.00) is
  `flag_only` and `unsalvageable`: the effect is not identifiable, and Redline shows no
  corrected volcano.

## 10. A method's limits travel with its result

A known limitation rides on the corrected result (`PreviewArtifact.caveat`), not only on
the flag. The count-split caveat, the "BH controls the false discovery rate and not the
family-wise error rate" caveat, and any other documented limit are carried beside the
`after` artifact so a reader who looks only at the corrected figure still sees the limit.

- **In the contract:** `PreviewArtifact.caveat` and `Recommendation` prose both carry the
  limit. `Evidence.caveat` is where the module sets it, and it flows through `preview`
  unchanged.
- **In copy:** state the limit in the same breath as the corrected number, never as a
  detached footnote that a reader can miss.

## How to use this doc

Before you write any user-facing string (a reasoning line, a report sentence, a headline,
a caption), check it against these ten rules. Before you assert or preview a correction,
check rules 1, 9, and 10. Before you wire any control, check rule 6. Before you script any
demo beat, check rule 5. If a change would make Redline claim more than it can defend, the
change is wrong, not the rule.
