import { cellsToText, type NotebookCell } from './notebook';

/**
 * A ready-to-audit sample analysis, so a judge can test the intake without
 * writing one. It is the Marson demo's naive foil: the standard
 * cluster-then-annotate-then-DE workflow a less-experienced scientist would run
 * on the CD4+ T-cell IL2RA-knockdown data, reproducing the four load-bearing
 * claims Redline audits. The claims below match the built-in `marson` reference
 * list, so the example reads coherently whether extraction runs live or falls
 * back to the curated claims. Never the authors' own (rigorous) analysis.
 *
 * Authored as notebook cells, so "Load example" renders as a real notebook and
 * "Download sample" hands back a real `.ipynb`. `EXAMPLE_NOTEBOOK` is the same
 * content flattened to the text the extraction agent reads, one source of truth.
 */

export const EXAMPLE_FILENAME = 'de_analysis.ipynb';

export const EXAMPLE_CELLS: NotebookCell[] = [
  {
    type: 'markdown',
    source:
      '# DE analysis: IL2RA knockdown vs non-targeting\nCD4+ T cells, Perturb-seq. Standard single-cell workflow: cluster, annotate cell states, test markers, then run differential expression.',
  },
  {
    type: 'code',
    source: 'import scanpy as sc\n\nadata = sc.read_h5ad("cd4_tcell_perturbseq_subset.h5ad")',
  },
  {
    type: 'markdown',
    source: '## Cluster at the default resolution',
  },
  {
    type: 'code',
    source:
      'sc.pp.normalize_total(adata, target_sum=1e4)\nsc.pp.log1p(adata)\nsc.pp.highly_variable_genes(adata, n_top_genes=2000)\nsc.pp.scale(adata, max_value=10)\nsc.tl.pca(adata, n_comps=50)\nsc.pp.neighbors(adata, n_neighbors=15)\nsc.tl.leiden(adata, resolution=1.0)   # default resolution',
  },
  {
    type: 'markdown',
    source: '## Annotate each cluster into a cell state from canonical markers',
  },
  {
    type: 'code',
    source:
      'states = {\n    "Treg":                ["FOXP3", "IL2RA", "IKZF2", "IL10"],\n    "Activated Treg-like": ["TNFRSF9", "ICOS", "TIGIT", "CTLA4"],\n    "Naive":               ["CCR7", "SELL", "TCF7", "LEF1"],\n}\nfor name, genes in states.items():\n    sc.tl.score_genes(adata, genes, score_name=name)\nadata.obs["cell_state"] = adata.obs[list(states)].idxmax(axis=1)\n\n# Marker genes per state, ranked on the same cells used to define the states.\nsc.tl.rank_genes_groups(adata, "cell_state", method="wilcoxon")',
  },
  {
    type: 'markdown',
    source: '## FOXP3 in knockdown vs control',
  },
  {
    type: 'code',
    source:
      'sc.tl.rank_genes_groups(\n    adata, "condition", groups=["IL2RA-KD"], reference="non-targeting", method="wilcoxon"\n)\n# FOXP3: p = 6.2e-11 across 51,842 cells -> significant.',
  },
  {
    type: 'markdown',
    source:
      '## Conclusions\n- IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001).\n- An activated Treg-like state (TNFRSF9, ICOS, TIGIT, CTLA4) is enriched under knockdown.\n- A distinct knockdown-responsive T-cell state.\n- Differential expression between knockdown and non-targeting control.',
  },
];

export const EXAMPLE_NOTEBOOK = cellsToText(EXAMPLE_CELLS);

export const EXAMPLE_PROSE = `CD4+ T cells were profiled under IL2RA knockdown versus non-targeting control by Perturb-seq (about 52,000 cells across 4 donors). IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001). Clustering at resolution 1.0 revealed an activated Treg-like state defined by TNFRSF9, ICOS, TIGIT, and CTLA4, enriched under knockdown, and a distinct knockdown-responsive T-cell state. Differential expression between knockdown and non-targeting control recovered the marker genes above.`;
