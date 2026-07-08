# The reference dataset

Redline is dataset-agnostic. It is built, demoed, and validated against one reference
set. This doc covers that set, how to reach it, the framing rule that governs every
demo, and the correctness oracle that turns the demo into a real test.

## The hero: Marson / Pritchard CD4+ T-cell Perturb-seq

The **Marson / Pritchard genome-scale CD4+ T-cell Perturb-seq** dataset (Zhu, Dann et
al. 2025), from the Gladstone-UCSF Institute of Genomic Immunology with Stanford. It is
Gladstone's flagship single-cell resource and the dataset the hackathon highlighted,
which is why it is the hero.

- **Structure:** about 22 million primary human CD4+ T cells, 4 donors, 3 stimulation
  conditions, CRISPRi knockdown of expressed genes.
- **Why it fits Redline:** the 4-donor, 3-condition structure is a native fit for
  Pillar 1 (pseudoreplication, which needs the real replicate count) and Pillar 4
  (confounding, which needs a technical axis to test against biology).
- **Preprint:** https://www.biorxiv.org/content/10.64898/2025.12.23.696273v1
- **CZI Virtual Cells Platform:**
  https://virtualcellmodels.cziscience.com/dataset/genome-scale-tcell-perturb-seq
- **Analysis code (MIT):** https://github.com/emdann/GWT_perturbseq_analysis_2025

## Access (open S3, no credentials)

- Open S3 bucket, no-sign-request, no credentials required:
  `s3://genome-scale-tcell-perturb-seq/marson2025_data/`
- Contents: cell-level count matrices (raw integer counts, so Redline can re-run),
  pseudobulk-level count matrices, differential-expression estimates, and the full
  analysis notebooks. MIT licensed.
- Also deposited at GEO/SRA: `GSE314342` / `SRP643211`.

The app reads the bucket via two env vars, both defaulted so nothing is hardcoded:

```bash
REDLINE_S3_BUCKET=genome-scale-tcell-perturb-seq
REDLINE_S3_PREFIX=marson2025_data/
```

## The subset used for build and demo

22 million cells is not runnable as-is. The build and demo run on a small slice: a
handful of perturbations plus non-targeting controls, across the 4 donors and 3
conditions. The `marson` scenario in the engine locks that subset:

- **File:** `cd4_tcell_perturbseq_subset.h5ad`
- **Title:** "CD4+ T cells, IL2RA knockdown vs non-targeting, Perturb-seq"
- **Size:** about 52,000 cells, about 3,200 genes, 4 donors (`replicateLabel: "donors"`),
  9 resolved fields, 2.4 GB.

### The 9 resolved fields

| Field         | Role        | Confidence | Note |
|---------------|-------------|------------|------|
| `donor_id`    | unit        | high       | The 4 independent biological replicates. |
| `condition`   | grouping    | high       | The comparison: guide vs non-targeting. |
| `cell_barcode`| observation | high       | One per cell. Measurements, not samples. |
| `lane`        | nuisance    | medium     | Two levels that line up with condition (a possible confound). |
| `guide_id`    | derived     | medium     | The perturbation identity. A derived grouping. |
| `n_genes`     | covariate   | high       | Per-cell quality covariate. |
| `pct_mito`    | covariate   | high       | Per-cell quality covariate. |
| `leiden`      | derived     | medium     | Cluster labels the scientist computed. |
| `phase`       | nuisance    | low        | Cell-cycle phase. Confirm whether to adjust or ignore. |

### The four claims, mapped to the four checks

1. "IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001)."
2. "An activated Treg-like state defined by 4 markers, enriched under knockdown."
3. "A distinct knockdown-responsive T-cell state."
4. "Differential expression between knockdown and non-targeting control."

### The locked catches (fixture must reproduce these)

- **Check 1 (pseudoreplication).** Naive cell-level p about 6.2e-11 (n about 51,842)
  collapses to pseudobulk across the 4 donors, p about 0.21, non-significant. Unit is
  `donor_id` (4). The hard-stop branch: a `guide_batch` with 2 levels gives n=1 per
  group, and Redline states flatly that no valid test exists.
- **Check 2 (double dipping).** A spurious "Activated Treg-like" state. Four markers
  (TNFRSF9, ICOS, TIGIT, CTLA4, all plausible activation genes and none of them IL2RA
  itself) separate at discovery AUC about 0.90 and collapse to held-out AUC about 0.57.
  0 of 4 survive.
- **Check 3 (clustering fragility).** Track "Effector" (spurious, present only at
  resolution 0.8 to 1.2) and it is flagged. Track "Naive" (stable across the sweep) and
  it is clean. The flagged cluster is genuinely a resolution artifact.
- **Check 4 (confounding).** The perturbation is confounded with the technical `lane`
  (knockdown on Lane-A, non-targeting on Lane-B). Cramér's V is 1.00, not separable.
  With the technical variable left out, Redline degrades to flag-only.

### Citations behind the calls

Same method papers as the fallback scenario: Squair et al. 2021 (pseudoreplication);
Gao, Bien and Witten 2022, or Neufeld count-splitting (double dipping); Luecken and
Theis 2019 (clustering stability); Hicks et al. 2018 (confounding). Real URLs live in
the master brief's reference list.

## The hard framing rule (read before building any demo)

Redline demonstrates on a **naive foil constructed on this data**, never on the
authors' published analysis. The authors did it rigorously: they provide pseudobulk
matrices and a dedicated DE stage, and the computational lead authored Milo. There is
no pseudoreplication error in the published work to catch.

Do not build, script, or imply a demo where Redline catches the authors' mistake. It
does not exist, and implying it in a Gladstone room, which may contain these authors or
their colleagues, backfires hard. The correct framing is: "here is the standard-workflow
analysis a less-experienced scientist would run on this data, and here are the errors
the expert authors correctly avoided." Their rigor is the gold standard Redline helps
others reach.

The naive foil is built in standard cluster-then-annotate-then-DE style (cluster the T
cells into activation and polarization states, annotate them, run cell-state-level DE)
so the demo stays legible even though the substrate is Perturb-seq. Any cluster Redline
flags as spurious must be genuinely spurious, a resolution or technical artifact with no
coherent marker program, and never a real-but-subtle T-cell state. An immunologist judge
will catch a false accusation.

## The pseudobulk oracle (validation, bake into tests)

The authors' published pseudobulk matrices and DE estimates are an answer key. Pillar
1's honest re-run should reproduce their expert result on the same comparison. This is
an automated correctness test for the pseudobulk path, not just a talking point. When
the real Python engine runs Pillar 1 on the same comparison the authors published, the
corrected result should land on their published number. Wire that comparison as a test
in `services/rigor`, so the one pillar that asserts a correction is checked against
ground truth and not just against itself.

## The fallback scenario

`ketamine` is a second built-in scenario (prefrontal cortex, ketamine vs saline, 6
mice), locked to exact numbers and used as a deterministic fallback. It exercises the
same four checks with the same shapes. `marson` is the default the app loads first. Both
are self-contained and run entirely on the fixture target.

## Redline stays dataset-agnostic

This is the reference set, not a hardcoded dependency. The failure modes Redline catches
(pseudoreplication, double dipping, clustering fragility, confounding) are universal
across datasets, platforms, and biological questions. That is why seeding a demo dataset
with them is honest: the tool genuinely generalizes to a judge's own data.
