import type { DatasetInventory, ScenarioId } from '@redline/contracts';

// ---------------------------------------------------------------------------
// The hand-written dataset inventories (spec section 3) for the two fixture
// scenarios. This is the thin inspection a real inspector would read from an
// AnnData `.h5ad` without loading the expression matrix: the `obs` columns and
// their types, the stored `uns` results, the cluster label fields, and whether
// raw counts are present. Giving the fixture path a real inventory is what lets
// the whole intake and extraction flow run with zero credentials and no `.h5ad`.
//
// Two hard properties hold here and the inventory test guards them:
//
//  1. Each inventory faithfully mirrors its scenario. Every resolved FieldSpec id
//     in `fixtures/{marson,ketamine}.ts` appears as an `obs` column here, and the
//     cell and gene counts match the DatasetMeta. The inventory never contradicts
//     the fixture, so extraction, routing, and the honesty backstop all agree on
//     what columns and genes exist.
//
//  2. The two datasets are genuinely different data. Their gene sets are fully
//     disjoint (human CD4 T-cell symbols here, mouse microglia symbols in the
//     ketamine set) and every distinctive column differs (donor_id / lane /
//     guide_id / phase versus mouse_id / seq_batch / sex). This is the anti-faking
//     guard: a faked extractor that emitted one scenario's claims against the
//     other's inventory would be caught by `enforceClaimHonesty`, because the
//     genes and the distinctive columns it cites are absent. The only columns the
//     two share are the generic scRNA-seq fields any dataset carries (condition,
//     cell_barcode, n_genes, pct_mito, leiden), which they legitimately both have.
//
// All prose below (previews) follows the voice rules: no em dashes, no banned
// vocabulary, direct and concrete.
// ---------------------------------------------------------------------------

/**
 * Marson (hero). The naive-foil analysis on the Marson/Pritchard CD4+ T-cell
 * IL2RA-knockdown Perturb-seq subset. Human gene symbols, uppercase.
 */
export const MARSON_INVENTORY: DatasetInventory = {
  file: 'cd4_tcell_perturbseq_subset.h5ad',
  nCells: 51842,
  nGenes: 3200,
  obs: [
    {
      name: 'donor_id',
      dtype: 'categorical',
      levels: 4,
      missing: 0,
      sample: ['D1', 'D2', 'D3', 'D4'],
    },
    {
      name: 'condition',
      dtype: 'categorical',
      levels: 2,
      missing: 0,
      sample: ['IL2RA-KD', 'non-targeting'],
    },
    {
      name: 'cell_barcode',
      dtype: 'identifier',
      levels: 51842,
      missing: 0,
      sample: ['AAACCTGAGACTGTAA-1', 'AAACCTGCATacggga-1'],
    },
    {
      name: 'lane',
      dtype: 'categorical',
      levels: 2,
      missing: 0,
      sample: ['Lane-A', 'Lane-B'],
    },
    {
      name: 'guide_id',
      dtype: 'categorical',
      levels: 4,
      missing: 0,
      sample: ['IL2RA-g1', 'IL2RA-g2', 'NT-g1', 'NT-g2'],
    },
    { name: 'n_genes', dtype: 'numeric', levels: null, missing: 0, sample: ['1204', '2310', '1876'] },
    { name: 'pct_mito', dtype: 'numeric', levels: null, missing: 0, sample: ['1.2', '3.8', '2.1'] },
    { name: 'leiden', dtype: 'categorical', levels: 14, missing: 0, sample: ['0', '1', '2', '3'] },
    { name: 'phase', dtype: 'categorical', levels: 3, missing: 0, sample: ['G1', 'S', 'G2M'] },
  ],
  uns: [
    {
      key: 'rank_genes_groups',
      kind: 'marker_table',
      shape: '5 groups x 50 genes',
      columns: ['names', 'scores', 'logfoldchanges', 'pvals', 'pvals_adj'],
      groups: ['Naive', 'Effector', 'Activated Treg-like', 'Cytotoxic', 'Memory'],
      genes: ['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4', 'IKZF2', 'GZMB'],
      preview:
        'Stored marker table over the annotated leiden states. The Activated Treg-like state is topped by TNFRSF9, ICOS, TIGIT, and CTLA4.',
    },
    {
      key: 'de_KD_vs_NT',
      kind: 'de_result',
      shape: '3200 genes x 5',
      columns: ['names', 'logfoldchanges', 'pvals', 'pvals_adj', 'scores'],
      groups: ['IL2RA-KD', 'non-targeting'],
      genes: ['FOXP3', 'IL2RA', 'IL7R'],
      preview:
        'Stored cell-level differential expression, IL2RA knockdown versus non-targeting. FOXP3 is reported up at p = 6.2e-11.',
    },
  ],
  clusterFields: ['leiden'],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts', 'logcounts'],
  obsm: ['X_pca', 'X_umap'],
  varNamesSample: [
    'IL2RA',
    'FOXP3',
    'TNFRSF9',
    'ICOS',
    'TIGIT',
    'CTLA4',
    'IKZF2',
    'CD3D',
    'CD4',
    'IL7R',
    'CCR7',
    'GZMB',
  ],
};

/**
 * Ketamine (locked fallback). Prefrontal-cortex ketamine versus saline scRNA-seq.
 * Mouse gene symbols, title case. Column names and gene set are deliberately
 * different from Marson so the extractor cannot be hardcoded.
 */
export const KETAMINE_INVENTORY: DatasetInventory = {
  file: 'pfc_ketamine_scRNAseq.h5ad',
  nCells: 48213,
  nGenes: 2431,
  obs: [
    {
      name: 'mouse_id',
      dtype: 'categorical',
      levels: 6,
      missing: 0,
      sample: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
    },
    {
      name: 'condition',
      dtype: 'categorical',
      levels: 2,
      missing: 0,
      sample: ['ketamine', 'saline'],
    },
    {
      name: 'cell_barcode',
      dtype: 'identifier',
      levels: 48213,
      missing: 0,
      sample: ['TTGCCGTCATGC-1', 'TTGCGTACAGGT-1'],
    },
    {
      name: 'seq_batch',
      dtype: 'categorical',
      levels: 2,
      missing: 0,
      sample: ['2024-11-03', '2024-11-05'],
    },
    { name: 'n_genes', dtype: 'numeric', levels: null, missing: 0, sample: ['980', '2100', '1543'] },
    { name: 'pct_mito', dtype: 'numeric', levels: null, missing: 0, sample: ['0.9', '4.1', '2.4'] },
    { name: 'leiden', dtype: 'categorical', levels: 12, missing: 0, sample: ['0', '1', '2', '3'] },
    { name: 'sex', dtype: 'categorical', levels: 2, missing: 0, sample: ['M', 'F'] },
  ],
  uns: [
    {
      key: 'rank_genes_groups',
      kind: 'marker_table',
      shape: '5 groups x 50 genes',
      columns: ['names', 'scores', 'logfoldchanges', 'pvals', 'pvals_adj'],
      groups: ['Homeostatic', 'Responder', 'Activated microglia', 'Interferon', 'Proliferating'],
      genes: ['Il1b', 'Tnf', 'Ccl4', 'Nfkbia', 'C1qa', 'C1qb'],
      preview:
        'Stored marker table over the annotated leiden states. The Activated microglia state is topped by Il1b, Tnf, Ccl4, and Nfkbia.',
    },
    {
      key: 'de_ket_vs_sal',
      kind: 'de_result',
      shape: '2431 genes x 5',
      columns: ['names', 'logfoldchanges', 'pvals', 'pvals_adj', 'scores'],
      groups: ['ketamine', 'saline'],
      genes: ['Bdnf', 'Fos', 'Egr1'],
      preview:
        'Stored cell-level differential expression, ketamine versus saline. Bdnf is reported up at p = 3.1e-9.',
    },
  ],
  clusterFields: ['leiden'],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts', 'logcounts'],
  obsm: ['X_pca', 'X_umap'],
  varNamesSample: [
    'Bdnf',
    'Il1b',
    'Tnf',
    'Ccl4',
    'Nfkbia',
    'Cx3cr1',
    'P2ry12',
    'Tmem119',
    'Aif1',
    'Csf1r',
    'Fos',
    'Egr1',
  ],
};

/**
 * Inventory by scenario, so a compute target can inspect one by id.
 *
 * Partial on purpose. Only the two demo scenarios carry a locked inventory. The
 * verification foils (pfc, clean, nocounts) have no fixture numbers at all: their
 * inventory only exists on a real compute target, which reads the .h5ad. Typing
 * this as a total Record would force us to invent one, and an invented inventory
 * is a fabricated dataset description shown to a scientist.
 */
export const INVENTORIES: Partial<Record<ScenarioId, DatasetInventory>> = {
  marson: MARSON_INVENTORY,
  ketamine: KETAMINE_INVENTORY,
};
