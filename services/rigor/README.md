# redline-rigor

The Redline rigor engine: the foundation step (design resolution) plus the four
statistical checks on single-cell RNA-seq analysis. Importable as `redline`,
runnable as an MCP server or a Cloud Run job, and packageable as a Claude Skill.

Redline audits an analysis; it does not hand back a single rewritten result. It
surfaces and quantifies where a result is statistically invalid or fragile. Only
Pillar 1 (pseudoreplication) asserts a corrected result, because pseudobulk
aggregation is the accepted-correct method. Pillars 2, 3 and 4 report evidence and
sensitivity, and a check that passes returns a confident clean verdict. The
grouping variable under audit (a cell type, a cell state, a condition, a
perturbation) is resolved from the data, never hardcoded.

## Install

```bash
# Base install (foundation, contracts, the numpy/scipy/scikit-learn paths):
pip install -e services/rigor

# Full statistical toolchain (scanpy, decoupler, PyDESeq2) and the MCP server:
pip install -e "services/rigor[stats,mcp]"

# Everything, including the dev tools:
pip install -e "services/rigor[stats,mcp,cloud,dev]"
```

The heavy stack (`scanpy`, `decoupler`, `pydeseq2`) is imported lazily inside the
pillars that use it. The base install runs the foundation, the contract layer,
and every pillar's fallback path. When the `stats` extras are present the honest
pseudobulk test is a PyDESeq2 refit and the re-clustering uses scanpy leiden.

## Run

```python
import anndata as ad
from redline import audit, run_check, resolve_fields

adata = ad.read_h5ad("cd4_tcell_perturbseq_subset.h5ad")

# Foundation: propose obs column roles (unit / grouping / observation / ...).
fields = resolve_fields(adata)

# Full audit: foundation + all four checks + an assembled summary.
report = audit(adata)                    # {"fields": [...], "results": [...], "report": {...}}

# One check at a time (what the MCP tools and the job runner call):
result = run_check(
    1, adata,
    config={"unit": "donor_id", "grouping": "condition", "alpha": 0.05},
    fields=fields,
)
```

`audit(data, analysis=None, fields=None)` resolves the design (or uses the
`fields` you pass), runs all four checks with sensible default knobs, and returns
per-check `ComputeResult`s plus a summary. `analysis` is an optional dict of
overrides (`gene`, `markers`, `target_group`, `track`, or a per-check `config`
map). `run_check(check_id, adata, config, fields)` returns one `ComputeResult`.

Every return value serializes (via `.to_json()`, applied for you at these entry
points) to the exact shapes in `@redline/contracts`: camelCase keys such as
`checkId`, `log10p`, `badUnit`, `cramersV`, `discAUC`, `holdAUC`, `perGroup`.

## The four pillars

1. **Pseudoreplication.** `decoupler.get_pseudobulk` per replicate x grouping,
   then PyDESeq2 for the corrected test (Welch t on the per-replicate means when
   the heavy stack is absent). Hard stop when a group has fewer than 2 replicates.
   This pillar asserts the corrected result.
2. **Double dipping.** Count splitting by numpy Poisson thinning
   (`train = Binomial(count, eps)`, `test = count - train`), re-cluster the train
   half (scanpy leiden, or KMeans fallback), re-score the claimed markers on the
   held-out half. Framed as evidence, not a certified FDR correction; ClusterDE is
   the stronger method on the roadmap.
3. **Fragility.** `sc.tl.leiden` across a resolution sweep, `adjusted_rand_score`
   between adjacent settings, per-cluster persistence. Mechanical mode and a
   claim-specific mode that tracks a named cluster. A stable group returns clean.
4. **Confounding.** Design-matrix rank / collinearity plus nestedness (Cramér's V)
   on the resolved grouping against technical columns, then a multi-factor
   PyDESeq2 refit (`~ condition + batch`) to test whether the effect survives.
   Technical-biological confounding only for v1.

## Data-completeness gating

Pillars 1 and 2 need raw integer counts (a `counts` layer, or `.raw`, or a
count-shaped `.X`). When they are absent the pillar degrades to `flag_only` with
an explicit message and never fabricates a re-run.

## Test

```bash
pip install -e "services/rigor[dev]"     # add [stats] to exercise the PyDESeq2/scanpy paths
pytest services/rigor
```

`tests/test_contracts.py` checks the JSON shapes and camelCase keys with no
scientific stack installed. `tests/test_pillars.py` builds a tiny synthetic
AnnData and asserts pseudobulk collapses an inflated p-value, the counts gate
flags missing raw counts, and each pillar returns the right `ComputeResult`.
```
