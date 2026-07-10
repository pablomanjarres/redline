/**
 * A ready-to-audit sample analysis, so a judge can test the intake without
 * writing one. It is the Marson demo's naive foil: the standard
 * cluster-then-annotate-then-DE workflow a less-experienced scientist would run
 * on the CD4+ T-cell IL2RA-knockdown data, reproducing the four load-bearing
 * claims Redline audits. The claims below match the built-in `marson` reference
 * list, so the example reads coherently whether extraction runs live or falls
 * back to the curated claims. Never the authors' own (rigorous) analysis.
 *
 * Single source of truth for both the "Load example" prefill and the
 * "Download sample" file, so the two never drift.
 */

export const EXAMPLE_FILENAME = 'de_analysis.py';

export const EXAMPLE_NOTEBOOK = `# de_analysis.py
# CD4+ T cells, IL2RA knockdown vs non-targeting (Perturb-seq).
# Standard single-cell workflow: cluster, annotate states, test markers, run DE.

import scanpy as sc

adata = sc.read_h5ad("cd4_tcell_perturbseq_subset.h5ad")

# Normalize, then cluster at the default resolution.
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, n_top_genes=2000)
sc.pp.scale(adata, max_value=10)
sc.tl.pca(adata, n_comps=50)
sc.pp.neighbors(adata, n_neighbors=15)
sc.tl.leiden(adata, resolution=1.0)   # default resolution

# Annotate each cluster into a cell state from canonical markers.
states = {
    "Treg":                ["FOXP3", "IL2RA", "IKZF2", "IL10"],
    "Activated Treg-like": ["TNFRSF9", "ICOS", "TIGIT", "CTLA4"],
    "Naive":               ["CCR7", "SELL", "TCF7", "LEF1"],
}
for name, genes in states.items():
    sc.tl.score_genes(adata, genes, score_name=name)
adata.obs["cell_state"] = adata.obs[list(states)].idxmax(axis=1)

# Marker genes per state, ranked on the same cells used to define the states.
sc.tl.rank_genes_groups(adata, "cell_state", method="wilcoxon")

# FOXP3 in knockdown vs control, tested per cell.
sc.tl.rank_genes_groups(
    adata, "condition", groups=["IL2RA-KD"], reference="non-targeting", method="wilcoxon"
)
# FOXP3: p = 6.2e-11 across 51,842 cells -> significant.

# Conclusions:
# 1. IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001).
# 2. An activated Treg-like state (TNFRSF9, ICOS, TIGIT, CTLA4) is enriched under knockdown.
# 3. A distinct knockdown-responsive T-cell state.
# 4. Differential expression between knockdown and non-targeting control.
`;

export const EXAMPLE_PROSE = `CD4+ T cells were profiled under IL2RA knockdown versus non-targeting control by Perturb-seq (about 52,000 cells across 4 donors). IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001). Clustering at resolution 1.0 revealed an activated Treg-like state defined by TNFRSF9, ICOS, TIGIT, and CTLA4, enriched under knockdown, and a distinct knockdown-responsive T-cell state. Differential expression between knockdown and non-targeting control recovered the marker genes above.`;
