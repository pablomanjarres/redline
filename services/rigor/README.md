# redline-rigor

The Redline rigor engine: the foundation step (design resolution) plus a registry
of statistical checks on single-cell RNA-seq analysis. Importable as `redline`,
runnable as an MCP server or a Cloud Run job, and packageable as a Claude Skill.

Redline gives advice, corrects the analysis, and previews the corrected result.
The rule that keeps that defensible: everything it asserts, recommends, or
corrects is shown, reproducible, and cited. The corrected code is downloadable
and runs, the preview is the output of that code, and the recommendation names
the method and its limits. When there is no valid fix (a full confound, n=1, an
unsalvageable design) Redline says so plainly and shows no corrected result
anywhere. It never invents a fix that does not exist, and that refusal is
structural: `PreviewArtifact` raises if you try to attach a corrected result to
an unsalvageable finding.

Two honesty lines still hold. A clean check reports clean, confidently, in green;
Redline never manufactures a flag. And Check 2 (double dipping) is evidence, a
held-out check, not a certified FDR correction, so it names ClusterDE as the
stronger method. Check 5 (multiple testing) is a real Benjamini-Hochberg
correction; the two are not the same and the copy keeps them apart. The grouping
variable under audit (a cell type, a cell state, a condition, a perturbation) is
resolved from the data, never hardcoded.

## Install

```bash
# Base install (foundation, contracts, the numpy/scipy/scikit-learn paths):
pip install -e services/rigor

# Full statistical toolchain (scanpy, decoupler, PyDESeq2, statsmodels) and the MCP server:
pip install -e "services/rigor[stats,mcp]"

# Everything, including the dev tools:
pip install -e "services/rigor[stats,mcp,cloud,dev]"
```

The heavy stack (`scanpy`, `decoupler`, `pydeseq2`, `statsmodels`) is imported
lazily inside the checks that use it. The base install runs the foundation, the
contract layer, and every check's fallback path. When the `stats` extras are
present the honest pseudobulk test is a PyDESeq2 refit, the re-clustering uses
scanpy leiden, and the multiple-testing correction uses the statsmodels BH path
(a hand-rolled Benjamini-Hochberg fallback in `redline/correction/stats.py` keeps
the base install light).

## The registry and the module interface

The active check set is a registry the engine iterates: `redline.modules.REGISTRY`,
a dict keyed by check id. Each claim is offered to every registered check via
`applies_to`; the applicable ones run. Adding a check is adding a module and
registering it, and nothing else in the engine changes. The module inherits the
whole correction surface (corrected code, recommended actions, fix-and-preview)
from one interface, `redline.modules.base.CheckModule`:

```
applies_to  ->  does this check apply to this claim and design?
detect      ->  run the diagnostic. A Candidate finding, or Clean.
prove       ->  run the honest re-analysis. Corrected statistics + artifact.
correct     ->  emit runnable code that reproduces `prove`.
preview     ->  the corrected downstream result, rendered.
recommend   ->  concrete next actions, grounded in this finding's numbers.
```

`detect` and `prove` are deterministic. `correct` fills a hand-written template
from `prove`'s parameters, so the executable skeleton is never model-written. A
module reads roles off the resolved `Design` (`design.unit`, `design.grouping`,
`design.nuisance`), never a hardcoded column name, and reads its knobs off
`design.knob(...)`. The claim it speaks to carries the genes and group under
audit.

## The eight checks

The founding four (`core`) and the rigor checks built on the same interface
(`rigor`):

1. **Pseudoreplication.** Aggregate to pseudobulk per replicate and re-test at the
   independent unit. This check asserts the corrected result. Fewer than two
   replicates per group is a hard stop, not a number.
2. **Double dipping.** Split the counts (Poisson thinning), re-cluster one half,
   and re-score the claimed markers on the held-out half. Evidence of survival,
   not a certified correction; ClusterDE is the stronger method.
3. **Fragility.** Sweep clustering resolution and report whether the tracked group
   stays a discrete cluster or appears only in a narrow band. A stable group
   returns clean.
4. **Confounding.** Cross-tabulate the grouping of interest against each technical
   variable (Cramer's V) and test whether the effect survives a multi-factor
   refit. A grouping that moves one-to-one with a technical variable is not
   separable from it.
5. **Multiple testing.** Re-test across every gene and apply a real
   Benjamini-Hochberg (or Benjamini-Yekutieli) correction, then report how many
   raw hits survive the adjusted threshold.
6. **Unmodeled covariate.** Refit the effect of interest with the known batch
   structure added to the model, when the two are separable, and report whether
   the claim survives.
7. **Resolution choice.** Sweep resolution, score each setting by a stability
   criterion (silhouette or ARI), and report whether the chosen cluster count is
   the one the criterion supports.
8. **Test assumptions.** Check whether the data meet the assumptions of the test
   the analysis used, and report the assumption-respecting result.

## Data-completeness gating

Checks 1 and 2 need raw integer counts (a `counts` layer, or `.raw`, or a
count-shaped `.X`). When they are absent the check degrades to `flag_only` with an
explicit message and never fabricates a re-run.

## Run

```python
import anndata as ad
from redline import audit, run_check, resolve_fields

adata = ad.read_h5ad("cd4_tcell_perturbseq_subset.h5ad")

# Foundation: propose obs column roles (unit / grouping / observation / ...).
fields = resolve_fields(adata)

# Full audit: foundation + every applicable check + an assembled summary.
report = audit(adata)                    # {"fields": [...], "results": [...], "report": {...}}

# One check at a time (what the MCP tools and the job runner call):
result = run_check(
    1, adata,
    config={"unit": "donor_id", "grouping": "condition", "alpha": 0.05},
    fields=fields,
)
```

`audit(data, analysis=None, fields=None)` resolves the design (or uses the
`fields` you pass), offers the claim to every registered check, runs the ones that
apply, and returns per-check results plus a summary. Checks that do not apply are
absent from `results`; the report copy counts whatever ran. `analysis` is an
optional dict of hints (`gene`, `markers`, `target_group`, `track`, or a per-check
`config` map). `run_check(check_id, adata, config, fields)` runs one check and
returns the flat `EngineResult`: the `ComputeResult` keys (`checkId`, `state`,
`headline`, `stats`, `chart`) plus, when the check produced them, `correctedCode`,
`recommendations`, and `preview`.

Every return value serializes (via `.to_json()`, applied for you at these entry
points) to the exact shapes in `@redline/contracts`: camelCase keys such as
`checkId`, `log10p`, `badUnit`, `cramersV`, `discAUC`, `holdAUC`, `perGroup`,
`negLog10P`, `adjustedHits`.

## The corrected-code emitter

Every check that proves a correction emits a runnable script (a `CorrectedCode`
object: `filename`, `inline`, `entrypoint`, `params`, `language`). The script
takes `--h5ad PATH` and, as its last line of stdout, prints:

```
REDLINE_RESULT {"original": <number|string>, "corrected": <number|string>, ...}
```

The JSON keys are exactly the keys of that check's numbers, so the script is its
own oracle: run it and diff its `REDLINE_RESULT` against the numbers Redline
reported and against the preview. If they disagree, one of them is faked. On an
unsalvageable finding the script prints the verdict and emits `"corrected": null`
plus `"unsalvageable": true`; it never prints a fabricated number.

```python
from redline import run_check

result = run_check(5, adata, config={"alpha": 0.05, "method": "bh"}, fields=fields)
script = result["correctedCode"]["inline"]        # the emitted Python
open("redline_check5.py", "w").write(script)
# python redline_check5.py --h5ad cd4_tcell_perturbseq_subset.h5ad
```

## Surfaces

- **MCP server** (`redline-mcp`): `redline_resolve_fields`, one
  `redline_check_*` tool per check, `redline_corrected_code` for the emitted
  script, and `redline_audit` for the whole registry-driven audit. Each returns a
  JSON string.
- **Job runner** (`redline-job`): reads a job spec (`{"h5ad", "checkId", "config",
  "fields"}`, `checkId` any of 1..8) and prints one line of `EngineResult` JSON.
- **Remote adapter** (`python -m redline.remote_adapter`): the web app's
  RemoteTarget bridge. Ops `resolve_fields`, `check`, and `preview` (which returns
  just one check's `preview` object so a heavier preview can run as its own job).

## Test

```bash
pip install -e "services/rigor[dev]"     # add [stats] to exercise the PyDESeq2/scanpy/statsmodels paths
pytest services/rigor
```

`tests/test_contracts.py` checks the JSON shapes and camelCase keys with no
scientific stack installed. `tests/test_pillars.py` builds a tiny synthetic
AnnData and asserts pseudobulk collapses an inflated p-value, the counts gate
flags missing raw counts, and each check returns the right result.
