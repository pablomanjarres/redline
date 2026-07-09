# Reference dataset: Marson CD4+ T-cell Perturb-seq

These scripts prepare the reference dataset Redline builds, demos, and validates
against: the Marson / Pritchard genome-scale CD4+ T-cell Perturb-seq set (Zhu,
Dann et al. 2025). They are real and runnable. They are intentionally not run
during the build. Run them once to populate the local cache before you exercise
the real compute target or the oracle.

Everything anonymous, no credentials. The source bucket is public with
no-sign-request, so nothing here reads or needs AWS keys. The heavy `.h5ad`
outputs land in `cache/`, which is gitignored and never committed. The small,
real published summary tables in `real/` (a few MB) ARE committed, so the repo
carries real numbers without the 1.7 TB of matrices.

```
services/rigor/data/
  subset_marson.py       S3 -> small local subset (.h5ad, raw counts preserved)
  build_naive_foil.py    subset -> the naive analysis Redline audits
  oracle.py              Pillar 1 correctness check vs the authors' published answer key
  build_real_marson.py   real/ tables -> real design + confound + DE (no matrix)
  real/                  COMMITTED small real tables + derived real-marson.json
  cache/                 gitignored heavy outputs (the .h5ad files)
```

## Real numbers without the 1.7 TB (committed)

The full dataset is 1.7 TB (individual matrices 15-148 GiB), so the four checks
cannot re-run in CI or on serverless. But two small, real published tables are
committed under `real/` and carry genuine numbers:

- `real/sample_metadata.suppl_table.csv` (2.9 KB) - the real design: 4 donors
  with covariates, 3 conditions, 2 sequencing runs.
- `real/DE_stats.suppl_table.csv` (4.6 MB) - the authors' real donor-level DE
  result, one row per perturbation x condition (33,983 rows).

`build_real_marson.py` reads them (pure standard library; runs on stock Python)
and writes `real/real-marson.json`:

```bash
python build_real_marson.py
# real design (4 donors), condition x run Cramér's V = 0.50, 21,216/33,983 sig KDs
```

What that grounds, with no expression matrix:

- **the experimental design** (foundation) and **Check 4 confounding** are fully
  real. The real confound: every 48-hour-stimulation sample ran in batch R2, so
  `culture_condition` is partly inseparable from `10xrun_id` (Cramér's V = 0.50).
- **Check 1's replication structure** - the 4 donors and real per-perturbation
  cell counts (the true replicate unit vs the naive cell count).

What still needs the full `.h5ad` (the `cache/` foil):

- the exact naive cell-level p-value, **Check 2** double-dipping AUC, and
  **Check 3** clustering fragility. Build the foil (below) and run the engine.

The app surfaces the real derived numbers on its Environment page.

## Wiring the engine to the app (`remote_adapter.py`)

The web app's `RemoteTarget` sends `{op, scenarioId}`; the engine's `redline-job`
expects `{h5ad}`. `redline.remote_adapter` bridges them: it maps `scenarioId` to
a local `.h5ad` path and dispatches to the engine.

```bash
export REDLINE_COMPUTE_TARGET=local
export REDLINE_ENGINE_CMD="python -m redline.remote_adapter"
export REDLINE_MARSON_H5AD=/abs/path/cache/cd4_tcell_perturbseq_subset.foil.h5ad
```

Until that points at a real file, `getComputeTarget()` falls back to the
deterministic fixture, so nothing is presented as live that is not.

## The hard framing constraint (read before touching the demo)

The Marson authors analyzed this dataset rigorously. They provide pseudobulk
matrices and a dedicated differential-expression stage, and the computational
lead authored Milo. There is no pseudoreplication error in their published work
to catch, and Redline never implies there is one.

Redline audits a **naive foil** instead: the standard
cluster-then-annotate-then-DE workflow a less-experienced scientist would run on
the same data. That naive workflow carries the textbook errors Redline exists to
catch. The authors' rigor is the standard Redline helps others reach. Pointed at
a clean analysis, Redline reports clean.

`build_naive_foil.py` constructs that foil. It never reproduces or audits the
authors' own analysis. Any cluster it marks as spurious is verified spurious by a
held-out test before it is flagged, so an immunologist watching the demo sees a
real artifact, not a false accusation.

## S3 layout

Open bucket, MIT licensed, also deposited at GEO/SRA (GSE314342 / SRP643211):

```
s3://genome-scale-tcell-perturb-seq/marson2025_data/
  cell-level count matrices      raw integer counts, so Pillars 1 and 2 can re-run
  pseudobulk-level count matrices aggregated per replicate x condition
  differential-expression estimates  the authors' published DE (the answer key)
  analysis notebooks             the authors' rigorous pipeline (reference only)
```

The bucket and prefix default from the repo `.env.example`
(`REDLINE_S3_BUCKET`, `REDLINE_S3_PREFIX`), so the location lives in one place.
Every script discovers the exact object keys by listing the prefix and takes a
`--s3-key` / `--pseudobulk-key` / `--de-key` override when the heuristics guess
wrong. Structure: ~22 million primary human CD4+ T cells, 4 donors, 3 stimulation
conditions, CRISPRi knockdown of expressed genes. The 4-donor, 3-condition shape
is a native fit for Pillar 1 (pseudoreplication) and Pillar 4 (confounding).

## Subset recipe (`subset_marson.py`)

22 million cells is not runnable as-is. The subset pulls a small, balanced slice:
IL2RA (the hero knockdown) plus a handful of other perturbations plus all
non-targeting controls, balanced across the 4 donors and the 3 stimulation
conditions.

How it works, without downloading the whole matrix:

1. Open the cell-level counts object over anonymous `s3fs` in AnnData backed
   mode, which reads `obs` without pulling the counts.
2. Resolve the donor, condition, and guide columns by name heuristics (override
   with `--donor-col` / `--condition-col` / `--guide-col`).
3. Plan the selection from `obs` alone, capping cells per
   (donor, condition, guide-group) stratum at `--size`.
4. Materialize only the chosen rows and write a local `.h5ad`.

Raw integer counts are preserved in both a `counts` layer and `.raw`, and the
script refuses to proceed if it cannot find integer counts, because Pillars 1 and
2 have no honest re-run without them. The obs schema is normalized to `donor_id`,
`guide_id`, `cell_barcode`, and a `stim` column, with provenance in
`uns['redline_subset']`.

```bash
# defaults: ~52k cells, output to cache/cd4_tcell_perturbseq_subset.h5ad
python subset_marson.py

# smaller slice for a quick pass
python subset_marson.py --size 4000 --seed 7

# pin the exact object and perturbation set
python subset_marson.py --s3-key marson2025_data/cell_counts.h5ad \
                        --perturbations IL2RA,CTLA4,TIGIT
```

## Naive foil (`build_naive_foil.py`)

Reads the subset and runs the standard scanpy workflow a less-experienced
scientist would run, then writes one `.h5ad` that carries everything the four
pillars audit:

- raw counts kept in a `counts` layer and `.raw` (Pillars 1 and 2),
- a leiden clustering at an **unjustified** resolution (default 1.0),
- activation / polarization cell-state annotations over those clusters,
- the naive **double-dipped** cell-level DE per cell state in `uns`,
- the 9 resolved obs columns the foundation step expects (`donor_id`,
  `condition`, `cell_barcode`, `lane`, `guide_id`, `n_genes`, `pct_mito`,
  `leiden`, `phase`),
- a `uns['redline_foil']` provenance block.

The four naive claims map to the four pillars:

1. IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001).
   Naive because it tests at the single-cell level, treating ~52k cells as
   independent when they came from 4 donors.
2. An activated Treg-like state defined by 4 markers (TNFRSF9, ICOS, TIGIT,
   CTLA4), enriched under knockdown. Naive because the markers were tested on the
   same cells that defined the state (double dipping).
3. A distinct knockdown-responsive T-cell state. Naive because the state exists
   only inside a narrow resolution window.
4. Differential expression between knockdown and non-targeting control. Naive
   because condition and the technical `lane` are collinear.

Two honesty mechanisms are built into the foil:

- **Spurious clusters are verified, never asserted.** The script Poisson-thins
  the counts into two independent halves and measures each cluster's marker
  separation on the held-out half. A cluster is eligible to be flagged for Pillar
  2 only if its markers collapse to chance out of sample. It runs a resolution
  sweep and flags a cluster for Pillar 3 only if it fails to persist across
  neighboring resolutions. If nothing meets the threshold, the script warns that
  the foil would report clean rather than inventing a flag.
- **The confound is labeled as injected.** The naive separate-lane design (KD on
  Lane-A, non-targeting on Lane-B) is written into `obs['lane']` and documented
  in provenance as injected, so the Pillar 4 confound is honest about its origin.

```bash
# reads cache/cd4_tcell_perturbseq_subset.h5ad, writes ..._subset.foil.h5ad
python build_naive_foil.py

# tune the naive resolution or the spurious-cluster thresholds
python build_naive_foil.py --resolution 1.2 --min-collapse 0.25
```

The foil file is the object the real compute target audits for the `marson`
scenario. Point the local / cloudrun target at
`cache/cd4_tcell_perturbseq_subset.foil.h5ad`.

## Oracle (`oracle.py`) validates Pillar 1

Pillar 1 is the one pillar where Redline asserts a corrected result, so it needs
a real answer key. The authors' published pseudobulk matrices and DE estimates
are that key. The oracle runs Redline's own pseudobulk path and checks that it
reproduces the authors' expert result on the same comparison. Two checks:

- **Check A, method agreement on the authors' own pseudobulk.** Load the authors'
  published pseudobulk matrix, run Redline's PyDESeq2 fit on it, and compare
  Redline's log2 fold changes and significance calls to the authors' published DE
  on the shared genes. Same input isolates whether Redline's DE step matches
  theirs. Pass requires a high Spearman correlation of log2FC and high sign
  agreement.
- **Check B, end to end from the subset.** Aggregate the local subset to one
  profile per donor per condition (`decoupler.get_pseudobulk`), run the same
  corrected PyDESeq2 test, and report the focus gene's direction and corrected
  significance call. When fewer than 2 replicates per group exist, it reports the
  hard stop honestly instead of producing numbers.

Reporting non-significant at the pseudobulk level is the expected, correct Pillar
1 outcome. The inflated cell-level p-value collapses once cells are aggregated to
their 4 donors. This validates Redline's pseudobulk path. It confirms Redline
reaches the expert answer the authors already reached. It does not audit the
authors.

Exit code 0 means the checks passed within tolerance, nonzero means they did not,
so the oracle doubles as an automated correctness test. A JSON report prints to
stdout.

```bash
# discover keys, run both checks against the default subset
python oracle.py

# pin the published artifacts and run only the local end-to-end check
python oracle.py --pseudobulk-key marson2025_data/pseudobulk_counts.h5ad \
                 --de-key marson2025_data/de_estimates.csv
python oracle.py --skip-remote
```

## Dependencies

Install the extras from `services/rigor/pyproject.toml`:

```bash
pip install -e 'services/rigor[cloud,stats]'
# cloud: boto3, s3fs (anonymous S3 reads)
# stats: scanpy, decoupler, pydeseq2 (the real re-run toolchain)
```

## Synthetic case fixtures (`build_case_fixtures.py`)

The intake, inspection, and claim-extraction paths need small `.h5ad` objects to
run against, and the real Marson subset is multi-gigabyte and gitignored.
`build_case_fixtures.py` synthesizes three tiny, seeded objects for that. They are
**synthetic test fixtures and never real data**: nothing in them is real biology,
the gene names are chosen only so the inventory and the routing are legible, and
each object carries `uns['redline_fixture']` with a plain-language note saying so.
Do not cite a number from them.

The three cases and what each one exercises:

- **`case_a.h5ad`** (Marson-shaped foil, about 600 cells, 4 donors, about 120
  genes). Carries both a scanpy `rank_genes_groups` marker table (TNFRSF9, ICOS,
  TIGIT, CTLA4 among the cluster-0 markers) and a stored `de_results` DE table
  (FOXP3 at a tiny p-value). This is the full worked example: extraction should
  fan out across all four checks, exactly as the built Workbench expects.
- **`case_b.h5ad`** (ketamine-shaped, about 500 cells, about 100 genes).
  Deliberately disjoint from case A: different `obs` columns entirely (`mouse_id`,
  `treatment`, `batch`, `cell_type`), different genes (BDNF, HOMER1, ARC, NPAS4),
  a DE result with different column names (`pvalue`, `log2FoldChange`, `baseMean`),
  and no marker table. It proves the extractor is not hardcoded. Identical claims
  across case A and case B would mean the extractor is faked, so the different
  shapes force it to adapt.
- **`case_c_bare.h5ad`** (counts and `obs`, and nothing stored in `uns`). The
  honest empty state: with no stored result and no cluster field there is nothing
  to audit, so it proves Redline says "no auditable claims" plainly instead of
  inventing any to fill the list.

Rebuild them (seconds, deterministic):

```bash
cd services/rigor && source .venv/bin/activate
python -m data.build_case_fixtures                                    # writes to data/fixtures/
python services/rigor/data/build_case_fixtures.py --out /tmp/fixtures  # elsewhere
```

The per-case seeds live in one place, `SEEDS` at the top of the module, and every
random draw derives from them, so a rebuild reproduces the same RNG stream, the
same counts matrix, the same `obs`, and the same stored results. On the current
toolchain (anndata 0.13, h5py 3.16) two builds are byte-identical (same sha256);
the portable guarantee the tests assert is that they are semantically identical
(same inventory, same counts via `np.array_equal`), which holds across library
versions. `services/rigor/tests/test_inspect.py::test_rebuild_is_deterministic`
builds the three cases twice and checks this.

**Generated, not committed.** The root `.gitignore` has a global `*.h5ad` rule, so
these three (about 1.3 MB total) are not in git. That is deliberate: no consumer
reads them from the fixed `data/fixtures/` path. `test_inspect.py` builds them into
a tmp directory, and the acceptance harness (`scripts/verify-intake.mjs`) runs on
in-memory inventories, so committing a binary artifact would carry no benefit.
Because the build is deterministic and cheap, a future consumer that does want them
at the fixed path should call `ensure_fixtures()` from the module, which builds any
missing file on demand instead of hitting a bare `FileNotFoundError`.

## References

- Hero dataset preprint (Zhu, Dann et al. 2025): https://www.biorxiv.org/content/10.64898/2025.12.23.696273v1
- Analysis code and open S3 access (MIT): https://github.com/emdann/GWT_perturbseq_analysis_2025
- Pseudoreplication (Squair et al. 2021, Nature Communications): https://www.nature.com/articles/s41467-021-25960-2
- Count splitting (Neufeld et al.): https://github.com/anna-neufeld/countsplit
- PyDESeq2 (pseudobulk DE, AnnData-native): https://github.com/scverse/PyDESeq2
