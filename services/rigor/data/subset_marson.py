#!/usr/bin/env python3
"""Subset the Marson / Pritchard CD4+ T-cell Perturb-seq reference dataset.

The full dataset (Zhu, Dann et al. 2025) is ~22 million cells and is not runnable
as-is. This script pulls a small, balanced slice from the OPEN S3 bucket
(``s3://genome-scale-tcell-perturb-seq/marson2025_data/``) and writes a local
``.h5ad`` with RAW INTEGER COUNTS preserved, so the downstream pillars that need
counts (Pillar 1 pseudobulk, Pillar 2 count-splitting) can re-run honestly.

Access is anonymous. The bucket is public with no-sign-request, so no AWS
credentials are read or required. We open the remote object in AnnData backed
mode, read only ``obs`` to plan the selection, then materialize just the chosen
rows. Nothing here is a secret and nothing is written outside the gitignored
``services/rigor/data/cache/`` directory.

What this produces is the HONEST SUBSTRATE, not the demo analysis. The naive
analysis Redline audits is built on top of this by ``build_naive_foil.py``. The
authors' own analysis is rigorous and is never the thing being audited.

Usage::

    python subset_marson.py                       # defaults: ~52k cells, cache/
    python subset_marson.py --size 4000 --seed 7
    python subset_marson.py --s3-key marson2025_data/cell_counts.h5ad
    python subset_marson.py --output /tmp/mini.h5ad --perturbations IL2RA,CTLA4

Selection: IL2RA (the hero knockdown) plus a handful of other perturbations plus
all non-targeting controls, balanced across the 4 donors and 3 stimulation
conditions. ``--size`` caps cells per (donor, condition, guide-group) stratum.

This script is real and runnable. It is intentionally not executed during the
build; run it once to populate the local cache before running the real compute
target or the oracle.
"""

from __future__ import annotations

import argparse
import os
import sys

# Public bucket coordinates. Defaults come from the repo .env.example so the S3
# location lives in exactly one place; flags override for anyone pointing at a
# mirror or a pinned object key.
DEFAULT_BUCKET = os.environ.get("REDLINE_S3_BUCKET", "genome-scale-tcell-perturb-seq")
DEFAULT_PREFIX = os.environ.get("REDLINE_S3_PREFIX", "marson2025_data/")

# The hero knockdown and a small set of other well-powered perturbations. IL2RA
# is the CD25 alpha chain of the IL-2 receptor and is the claim under audit.
DEFAULT_PERTURBATIONS = ["IL2RA", "CTLA4", "TNFRSF9", "FOXP3", "PDCD1", "TIGIT"]

# Candidate obs column names across the naming conventions this data may ship
# with. The resolver walks each list and takes the first present column; a CLI
# flag pins the exact name when the heuristics guess wrong.
DONOR_CANDIDATES = ["donor_id", "donor", "individual", "patient", "subject", "sample_donor"]
CONDITION_CANDIDATES = ["stim", "stimulation", "condition", "treatment", "state"]
GUIDE_CANDIDATES = ["guide_id", "guide", "perturbation", "gene", "target", "sgRNA", "grna", "feature_call"]
NGENES_CANDIDATES = ["n_genes", "n_genes_by_counts", "nFeature_RNA", "detected_genes"]
MITO_CANDIDATES = ["pct_mito", "pct_counts_mt", "percent_mito", "percent.mt", "pct_counts_mito"]
PHASE_CANDIDATES = ["phase", "Phase", "cell_cycle_phase", "cc_phase"]

# Tokens that mark a non-targeting control guide, matched case-insensitively.
NONTARGETING_TOKENS = ["non-targeting", "non_targeting", "nontargeting", "safe-harbor", "safe_harbor", "control", "ntc", "neg", "scramble"]


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


def _anon_s3fs():
    """Anonymous s3fs filesystem. Raises a clear message if s3fs is missing."""
    try:
        import s3fs
    except ImportError as exc:  # pragma: no cover - environment guard
        raise SystemExit(
            "s3fs is required to read the public bucket. Install the cloud extra:\n"
            "  pip install -e 'services/rigor[cloud]'   (or: pip install s3fs)"
        ) from exc
    # anon=True means no credential lookup at all. The bucket is public.
    return s3fs.S3FileSystem(anon=True)


def _discover_key(fs, bucket: str, prefix: str) -> str:
    """Find the cell-level raw-count ``.h5ad`` under the prefix.

    The bucket holds cell-level count matrices, pseudobulk matrices, DE
    estimates, and notebooks. We want the cell-level counts. Heuristic: among the
    ``.h5ad`` objects, prefer names that mention cells or counts and exclude the
    pseudobulk and DE artifacts; break ties by largest size (the cell matrix is
    the big one). Pin ``--s3-key`` to skip this entirely.
    """
    root = f"{bucket}/{prefix}".rstrip("/")
    try:
        entries = fs.find(root, detail=True)
    except Exception as exc:  # pragma: no cover - network guard
        raise SystemExit(f"could not list s3://{root}/ anonymously: {exc}") from exc

    h5ads = [(p, info.get("size", 0)) for p, info in entries.items() if p.lower().endswith(".h5ad")]
    if not h5ads:
        raise SystemExit(
            f"no .h5ad objects found under s3://{root}/. "
            "List the bucket and pass --s3-key explicitly."
        )

    def score(pair: tuple[str, int]) -> tuple[int, int]:
        name = pair[0].lower()
        wants = any(t in name for t in ("cell", "count", "raw"))
        avoids = any(t in name for t in ("pseudobulk", "pseudo", "_de", "de_", "deseq", "results", "meta"))
        # Higher is better: prefer cell/count names, penalize pseudobulk/DE, then
        # prefer larger files (the cell-level matrix is the largest object).
        return (int(wants) - int(avoids), pair[1])

    best = max(h5ads, key=score)
    eprint(f"discovered cell-level counts object: s3://{best[0]}  ({best[1] / 1e9:.2f} GB)")
    return best[0]


def _pick(columns, candidates, override):
    if override:
        if override not in columns:
            raise SystemExit(f"requested column '{override}' is not in obs; available: {list(columns)}")
        return override
    for name in candidates:
        if name in columns:
            return name
    return None


def _is_nontargeting(value: object) -> bool:
    s = str(value).lower()
    return any(tok in s for tok in NONTARGETING_TOKENS)


def _integerish(matrix) -> bool:
    """True if the matrix holds raw integer counts (allowing a float dtype that
    stores whole numbers, which is how many pipelines save counts)."""
    import numpy as np

    data = matrix.data if hasattr(matrix, "data") else np.asarray(matrix).ravel()
    if data.size == 0:
        return True
    if np.issubdtype(data.dtype, np.integer):
        return True
    sample = data[: min(data.size, 200_000)]
    return bool(np.all(np.isfinite(sample)) and np.allclose(sample, np.round(sample)))


def build_subset(args: argparse.Namespace) -> str:
    import anndata as ad
    import numpy as np
    import pandas as pd

    rng = np.random.default_rng(args.seed)
    fs = _anon_s3fs()
    key = args.s3_key or _discover_key(fs, args.bucket, args.prefix)

    eprint(f"opening s3://{key} in backed mode (reads obs without loading counts)...")
    with fs.open(key, "rb") as handle:
        backed = ad.read_h5ad(handle, backed="r")
        obs = backed.obs.copy()
        columns = list(obs.columns)

        donor_col = _pick(columns, DONOR_CANDIDATES, args.donor_col)
        cond_col = _pick(columns, CONDITION_CANDIDATES, args.condition_col)
        guide_col = _pick(columns, GUIDE_CANDIDATES, args.guide_col)
        if donor_col is None or guide_col is None:
            raise SystemExit(
                "could not resolve the donor and guide columns from obs. "
                f"obs columns are: {columns}. "
                "Pass --donor-col and --guide-col explicitly."
            )
        eprint(f"resolved columns: donor='{donor_col}' condition='{cond_col}' guide='{guide_col}'")

        # Plan the row selection from obs alone.
        guides = obs[guide_col].astype(str)
        wanted = {p.strip().upper() for p in args.perturbations.split(",") if p.strip()}
        is_nt = guides.map(_is_nontargeting)
        is_wanted = guides.str.upper().apply(lambda g: any(w in g for w in wanted))
        keep_pool = is_nt | is_wanted

        # Group-of-interest for balancing: non-targeting collapses to one group,
        # every wanted perturbation is its own group. Stratify by donor and, when
        # present, stimulation condition, capping cells per stratum at --size.
        group_key = np.where(is_nt, "non-targeting", guides.str.upper().values)
        strata_cols = {donor_col: obs[donor_col].astype(str).values, "_group": group_key}
        if cond_col is not None:
            strata_cols[cond_col] = obs[cond_col].astype(str).values
        plan = pd.DataFrame(strata_cols, index=obs.index)
        plan = plan[keep_pool.values]

        chosen_index: list = []
        strata_names = [donor_col, "_group"] + ([cond_col] if cond_col is not None else [])
        for _, stratum in plan.groupby(strata_names, sort=False):
            idx = stratum.index.to_numpy()
            if idx.size > args.size:
                idx = rng.choice(idx, size=args.size, replace=False)
            chosen_index.extend(idx.tolist())

        if not chosen_index:
            raise SystemExit(
                "selection is empty. Check --perturbations against the guide column "
                f"values, e.g. {sorted(set(guides.head(50)))[:10]}"
            )

        # Materialize only the chosen rows. Backed slicing pulls just these cells.
        eprint(f"materializing {len(chosen_index)} cells from {plan.shape[0]} candidates...")
        pos = obs.index.get_indexer(pd.Index(chosen_index))
        subset = backed[pos].to_memory()

    # Preserve raw counts. The engine looks for counts in ``.raw`` or a ``counts``
    # layer; guarantee both point at integer counts.
    counts = subset.layers["counts"] if "counts" in subset.layers else subset.X
    if not _integerish(counts):
        if subset.raw is not None and _integerish(subset.raw.X):
            counts = subset.raw.X
        else:
            raise SystemExit(
                "the cell-level object does not expose raw integer counts in X, "
                "a 'counts' layer, or .raw. Pillars 1 and 2 need raw counts. "
                "Point --s3-key at the raw cell-level matrix."
            )
    subset.X = counts
    subset.layers["counts"] = counts.copy()
    subset.raw = subset

    # Normalize the obs schema to the names the foundation step and the locked
    # scenario expect, keeping the originals discoverable in provenance.
    ren = {donor_col: "donor_id"}
    if guide_col != "guide_id":
        ren[guide_col] = "guide_id"
    subset.obs = subset.obs.rename(columns=ren)
    subset.obs["donor_id"] = subset.obs["donor_id"].astype(str)
    subset.obs["guide_id"] = subset.obs["guide_id"].astype(str)
    subset.obs["cell_barcode"] = subset.obs_names.astype(str)
    subset.obs["is_control"] = subset.obs["guide_id"].map(_is_nontargeting)
    if cond_col is not None and cond_col not in ("donor_id", "guide_id"):
        subset.obs["stim"] = subset.obs[cond_col].astype(str)

    subset.uns["redline_subset"] = {
        "source_bucket": args.bucket,
        "source_key": key,
        "n_cells": int(subset.n_obs),
        "n_genes": int(subset.n_vars),
        "donors": sorted(subset.obs["donor_id"].unique().tolist()),
        "guides": sorted(subset.obs["guide_id"].unique().tolist()),
        "per_stratum_cap": int(args.size),
        "seed": int(args.seed),
        "note": "Honest substrate subset. The audited naive analysis is built by build_naive_foil.py.",
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    subset.write_h5ad(args.output)
    eprint(
        f"wrote {subset.n_obs} cells x {subset.n_vars} genes to {args.output}\n"
        f"  donors: {subset.uns['redline_subset']['donors']}\n"
        f"  guides: {subset.uns['redline_subset']['guides']}"
    )
    return args.output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="subset_marson",
        description="Subset the open Marson CD4+ T-cell Perturb-seq dataset into a local .h5ad with raw counts.",
    )
    parser.add_argument("--size", type=int, default=1400,
                        help="max cells per (donor, condition, guide-group) stratum (default 1400, ~52k cells total).")
    parser.add_argument("--perturbations", default=",".join(DEFAULT_PERTURBATIONS),
                        help="comma-separated perturbation targets to include alongside all non-targeting controls.")
    parser.add_argument("--output", default=os.path.join(os.path.dirname(__file__), "cache", "cd4_tcell_perturbseq_subset.h5ad"),
                        help="output .h5ad path (default services/rigor/data/cache/, gitignored).")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET, help="public S3 bucket (no credentials used).")
    parser.add_argument("--prefix", default=DEFAULT_PREFIX, help="key prefix inside the bucket.")
    parser.add_argument("--s3-key", default=None, help="exact object key of the cell-level counts .h5ad (skips discovery).")
    parser.add_argument("--donor-col", default=None, help="override the obs column that names the biological donor.")
    parser.add_argument("--condition-col", default=None, help="override the obs column that names the stimulation condition.")
    parser.add_argument("--guide-col", default=None, help="override the obs column that names the guide / perturbation target.")
    parser.add_argument("--seed", type=int, default=0, help="random seed for the per-stratum subsample.")
    args = parser.parse_args(argv)

    try:
        out = build_subset(args)
    except SystemExit:
        raise
    except Exception as exc:  # surface a clean failure
        eprint(f"subset_marson: {type(exc).__name__}: {exc}")
        return 1
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
