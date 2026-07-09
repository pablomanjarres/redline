# The correction and rigor layer

Redline does not stop at naming the error. It hands back the corrected analysis as
runnable code, says what to do next, and renders the result the scientist should have had.
This doc is the reference for that layer: the module interface every check implements, the
registry that lists them, the four correction capabilities, and the eight checks that
carry them.

Read `honesty-rules.md` first. This layer changed the governing rule (rule 1 now reads
"correct, and show your work"), and the guardrails in rules 9 and 10 are what keep the
change defensible.

## The governing principle

Everything Redline asserts, recommends, or corrects is shown, reproducible, and cited. The
corrected code is downloadable and runs. The preview is the output of that code. The
recommendation names the method and its limits.

The corollary is load-bearing: when there is no valid fix (a full confound, n=1, an
unsalvageable design), Redline says so plainly and shows no corrected result anywhere. It
never invents a fix that does not exist. This is enforced structurally, not by convention.
`PreviewArtifact` (Zod `.superRefine` in `packages/contracts/src/correction.ts`, and the
Python `__post_init__` mirror in `services/rigor/redline/contracts.py`) refuses to carry
an `after` artifact when `unsalvageable` is true, and `Evidence.__post_init__` refuses to
carry a `corrected_artifact` when the feasibility is `unsalvageable`. A fabricated fix is a
parse error.

## The CheckModule interface

One interface backs every check, founding pillar or rigor add-on. It lives in
`services/rigor/redline/modules/base.py`. Implement six methods, inherit the whole
correction surface.

```
applies_to  ->  does this check apply to this claim and this design?
detect      ->  run the diagnostic. A Candidate with raw numbers, or Clean.
prove       ->  run the honest re-analysis. Corrected statistics and artifact.
correct     ->  emit runnable code that reproduces prove.
preview     ->  the corrected downstream result, rendered beside the claim.
recommend   ->  one to three concrete next actions, grounded in the numbers.
```

Plus two declared fields: `citation` (the `MethodRef` naming the method paper, which every
assertion carries) and `knobs` (the parameters the check exposes to the UI panel).

**Why detect and prove are separate.** `detect` answers "is there a problem here" and
returns either a `Candidate` (with the raw, uncorrected numbers) or `Clean` (nothing
wrong, reported confidently in green, with no correction payload because there is nothing
to correct). `prove` runs only when `detect` fired, and it does the heavier honest
re-analysis: it computes the corrected statistic, builds the corrected artifact, and sets
the feasibility. Splitting them keeps the cheap diagnostic separate from the expensive
re-run, and it keeps a clean verdict from ever carrying a correction it does not need.

**The driver.** `CheckModule.run(claim, adata, design)` composes the six methods:
`detect`, and on a `Clean` result it returns the compute result with an empty correction.
On a `Candidate` it calls `prove`, then `correct`, `recommend`, and `preview`, and returns
`(computeResult, correction)` as JSON that deserializes to `EngineResult`. A module never
writes this loop itself.

**What a module reads.** A module reads resolved roles off the `Design` object (`unit`,
`grouping`, `derived`, `nuisance`, and the knob values), never a hardcoded column name and
never "cell type". That is honesty rule 4 expressed as the only accessor a module gets, and
it is what makes the Case B generality test pass: the same check on a different dataset
injects that dataset's field names.

## The registry

Two registries, kept in lockstep.

- `services/rigor/redline/modules/__init__.py` holds the Python `REGISTRY`, a dict keyed
  by check id over the eight `MODULE` singletons. The driver iterates it: each extracted
  claim is offered to every registered module via `applies_to`, and the applicable ones
  run. `CORE_IDS = (1, 2, 3, 4)`, `RIGOR_IDS = (5, 6, 7, 8)`.
- `packages/contracts/src/registry.ts` holds `CHECK_REGISTRY`, the TypeScript source of
  truth for check id, name, one-line description, error class, and group (`core` or
  `rigor`). Every surface derives from it: the pipeline rail, the workbench board, the
  session maps, the report, and the reasoning layer's per-check guidance. `CHECK_IDS`,
  `CHECK_COUNT`, `isCheckId`, and `checkRecord` come from here, so no surface ever
  enumerates checks with a `4` literal.

### How do I add a rigor check

Add a literal to `CheckId` (`packages/contracts/src/primitives.ts`), a row to
`CHECK_REGISTRY` (`packages/contracts/src/registry.ts`), and a module file under
`services/rigor/redline/modules/` registered in that package's `__init__.py`. Every surface
that reads the registry (the pipeline rail, the workbench board, the session maps, the
report, the reasoning guidance) then picks up the new check with no further edit.

Two per-check maps do not read the registry and must be extended by hand, because they hold
per-check code rather than metadata:

- the emitted-script template plus its required slots in
  `services/rigor/redline/correction/templates.py` (`TEMPLATES` and `SLOTS`), and the
  filename for the new id in `services/rigor/redline/correction/__init__.py` (`FILENAMES`),
  which `render_corrected_code` reads. Without both, `correct` raises.
- the fixture's corrected-code builder for the demo path
  (`script1`..`scriptN` in `packages/engine/src/fixtures/shared.ts`), wired into the
  scenario fixtures. The `local`/`cloudrun`/`endpoint` targets get the code from the Python
  template above, but the deterministic `fixture` target carries its own copy, so a new
  check needs a builder here too or the fixture returns a finding with no corrected code.

With those in place the module inherits corrected code, recommended actions, and
fix-and-preview from the interface.

The `core` versus `rigor` split exists only so the UI can group the checks and the report
can say which surface fired. Both groups implement exactly the same interface.

## Capability 1: deterministic code generation

The corrected analysis is a runnable Python script, `CorrectedCode`. The generation is
deterministic, with no model call. The executable skeleton and its comments are a
hand-written, per-check template in `services/rigor/redline/correction/templates.py`.
`prove` puts exactly the parameters that check needs into `Evidence.params`, and `correct`
injects only those params into the template with `repr()`, so every value round-trips as a
valid Python literal. `render_corrected_code` parses the result with `ast.parse` before it
can reach a user, so a broken template fails at render time instead of on the scientist's
machine. No model writes any part of the script. The model-written prose in a finding is
the narrative (the failure-mode name, the struck-through claim, the recommendation
rationale), produced separately by the reasoning layer, and it never touches the code.
`CorrectedCode.params` records what was injected, which is what the harness reads to prove
the script is parameterized rather than hardcoded to the canonical dataset.

**The output contract that makes the code its own oracle.** Every emitted script, as its
last line of stdout, prints:

```
REDLINE_RESULT {"original": <number|string>, "corrected": <number|string>, ...}
```

The JSON keys are exactly the keys of that check's `Evidence.numbers`. The acceptance
harness runs the script and diffs its JSON against the numbers Redline reported and against
the preview. If they disagree, one of them is faked. The enforcing test is
`services/rigor/tests/test_correction.py::test_three_way_consistency_holds_for_every_fired_check`
(with `test_emitted_code_runs_and_reproduces_on_case_a` and `..._on_case_b` running the
emitted scripts in a subprocess); on the fixture side it is the
`packages/engine/src/engine.test.ts` case "every corrected script prints a REDLINE_RESULT
line and reads --h5ad". On an unsalvageable finding the script
prints the non-separability verdict and emits `"corrected": null` plus
`"unsalvageable": true`, and it never prints a fabricated number. Every emitted script
takes `--h5ad PATH` and defaults to the `h5ad` hint, so the same script runs on the
scientist's own file.

## Capability 2: recommendations

`recommend` returns one to three `Recommendation` objects: an `action` (the concrete step,
imperative, naming the resolved fields of this dataset), a `rationale` tied to this
finding's numbers, the `changes` it would produce, a `feasibility`, and an optional
`citation`.

`feasibility` is one of `fixable_now`, `needs_new_data`, or `unsalvageable`, and it is
decided by the deterministic engine, never by the model. The prose around the
recommendation is model-written upstream in the reasoning layer, but the feasibility verdict
is the engine's. The backstop: `enforceRecommendationHonesty` overwrites whatever the model
returned to match the engine's verdict, and a model that proposes a statistical fix in an
unsalvageable slot is treated as unavailable so the curated copy wins. An honest
"unsalvageable" can never be talked up into a fix that does not exist.

## Capability 3: fix and preview

`PreviewArtifact` is the corrected downstream result, rendered. `before` is what the
scientist claimed; `after` is the analysis they should have had, and it is the output of
the very code in `CorrectedCode`. The UI shows a before/after toggle over the two charts.

This is real compute. On the fixture target the numbers are locked; on the `local`,
`cloudrun`, and `endpoint` targets the re-analysis runs as a dispatched job (the pseudobulk
re-test, the count-split reclustering, the resolution sweep), and the app never blocks on
it. The default `preview` reuses `prove`'s corrected artifact, which keeps the preview and
the emitted code in agreement by construction; a module overrides it only for a heavier
render, and that render must still be the output of the same computation the code performs.

**The three-way consistency requirement.** The reported numbers (`Evidence.numbers`), the
preview (`PreviewArtifact.after`), and the output of the downloadable code all agree within
tolerance. If the preview and the code disagree, one of them is faked, and the harness
fails. This is the mechanism behind honesty rule 1.

`preview` returns `None` for a `flag_only` state, where the check could not run the honest
re-analysis (usually missing raw counts) and so nothing was proven and nothing may be
shown. On an `unsalvageable` finding `preview` still renders, with `after: null` and the
plain-language reason, because saying "this cannot be fixed from this data" is itself the
honest result.

## Capability 4: the eight checks

Checks 1 to 4 are the founding pillars. Checks 5 to 8 are the rigor checks built on the
same module interface. The method paper for each is the module's `citation` field; the four
pillar citations are locked in `packages/engine/src/fixtures/shared.ts`.

| # | Name | What it detects | How it proves it | How it corrects | Method |
|---|------|-----------------|------------------|-----------------|--------|
| 1 | Pseudoreplication | Non-independent cells tested as independent samples, inflating a p-value | Aggregates counts to one profile per resolved `unit`, re-tests across units with PyDESeq2 | Emits the pseudobulk + PyDESeq2 script; asserts the corrected p and the deflated volcano | Squair et al. 2021, Nature Communications |
| 2 | Double dipping | Clusters defined on the data and tested for their own markers on that same data | Poisson count-split into two independent halves, cluster on one, test markers on the held-out half, count survivors | Emits the count-split script; reports how many markers survive as evidence, names ClusterDE as stronger | Gao, Bien & Witten 2022, J. Amer. Stat. Assoc. |
| 3 | Fragility | A named cell state that hinges on an arbitrary clustering resolution | Sweeps resolution `min` to `max` by `step`, tracks whether the group survives, measures agreement | Emits the resolution-sweep script; shows the stability fraction and the range where the group exists | Luecken & Theis 2019, Molecular Systems Biology |
| 4 | Confounding | A grouping variable inseparable from a technical variable | Builds the design grid, computes Cramer's V and checks separability of `interest` against `technical` | Emits the collinearity-check script; on full confound refits with the technical term to show non-identifiability | Hicks et al. 2018, Biostatistics |
| 5 | Multiple testing | Significance claimed on raw p-values across many tests | Applies Benjamini-Hochberg (or BY) adjustment to the raw p-values, counts how many survive at `alpha` | Emits the BH-adjustment script; reports raw hits vs adjusted hits. This is a real FDR correction | Benjamini & Hochberg 1995, J. R. Stat. Soc. B |
| 6 | Unmodeled covariate | Known batch structure left out of an otherwise separable model | Refits the `interest` effect with the `covariate` term added, compares the claimed statistic to the corrected one | Emits the re-fit script; asserts the corrected volcano when the covariate is separable from the effect | Hicks et al. 2018, Biostatistics |
| 7 | Resolution choice | A cluster count chosen without a stability criterion | Sweeps resolution, scores each setting by the `criterion` (silhouette or ARI), marks `chosen` against the `supported` range | Emits the sweep-and-criterion script; shows whether the chosen resolution sits in the supported band | Luecken & Theis 2019, Molecular Systems Biology |
| 8 | Test assumptions | A test whose assumptions the data violate | Re-runs the comparison with the assumption-appropriate test and compares to the `claimed_test` result | Emits the corrected-test script; asserts the corrected p from the valid test | Soneson & Robinson 2018, Nature Methods |

The method paper in each module's `citation` field is the source of truth for the last
column; this table is kept in step with it. The citations above are the ones the modules
carry (`services/rigor/redline/modules/m0*.py`): check 6 and check 4 both cite Hicks et al.
2018, check 7 and check 3 both cite Luecken & Theis 2019, and check 8 cites Soneson &
Robinson 2018. Checks 1, 6, and 8 are
differential-expression findings and share the `VolcanoChart` as their corrected artifact;
check 5 uses `FdrChart`; checks 3 and 7 share the `FragilityChart`, with check 7 filling
`chosen` and `supported`.

## Scope discipline

Commoditized QC stays out: ambient RNA, doublet detection, and basic count and gene
filtering are solved and are not what Redline sells. The eight checks are rigor and
inference checks, the errors that survive QC and reach the manuscript. That is the wedge.

## The extended Finding

`CheckResult` (`packages/contracts/src/checks.ts`) is `ComputeResult.merge(Narrative)`
extended with the `Correction` shape (`correctedCode`, `recommendations`, `preview`, all
optional). `EngineResult` is `ComputeResult` extended with the same `Correction` shape,
which is what a `ComputeTarget` returns before the reasoning layer adds the prose.

Every correction field is optional, so a check that cannot correct, or a compute target
that does not run a preview, simply omits it and the card renders what it has. The shape is
extended with `.extend()` rather than a second `.merge()` deliberately: the sibling add-ons
(the critic assessment, the per-stat confidence intervals) attach their own optional keys
to the same `CheckResult` in the same block, so the three layers compose without
restructuring the type.

## Compute and cost

The cost of a finding is proportional to what it does. Code generation is free: it fills a
static template and calls no model. Recommendations are a cheap model call over the
finding's numbers (the feasibility verdict is the engine's, not the model's). The preview is
the expensive part, real compute dispatched as a job, and
it is where the heavy statistics run. More registered checks means more compute per audit,
proportionally, and nothing more. Adding a check adds one module and its job, not a rewrite.
