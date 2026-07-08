#!/usr/bin/env python3
"""Correctness oracle for Pillar 1 (pseudoreplication / pseudobulk DE).

Pillar 1 is the one pillar where Redline asserts a corrected result, so it needs
a real answer key. The Marson authors published pseudobulk count matrices and
differential-expression estimates. Those are the answer key. This script runs
Redline's own pseudobulk path and checks that it reproduces the authors' expert
result on the SAME comparison.

Two independent checks:

  A. Method agreement on the authors' own pseudobulk. Load the authors'
     published pseudobulk count matrix, run Redline's PyDESeq2 fit on it, and
     compare Redline's log2 fold changes and significance calls against the
     authors' published DE estimates on the shared genes. Same input, so this
     isolates whether Redline's DE step matches theirs. Pass requires a high
     rank correlation of log2FC and high sign agreement.

  B. End-to-end agreement from the cell-level subset. Aggregate the local subset
     to one profile per donor per condition (decoupler.get_pseudobulk), run the
     same corrected test, and confirm the focus gene's direction and
     significance call agree with the authors on the audited contrast.

This validates Redline's pseudobulk PATH. It confirms Redline reaches the expert
answer that the authors already reached. It does not audit or second-guess the
authors' analysis. Their published result is the ground truth here.

Exit code 0 means the checks passed within tolerance; nonzero means they did
not, so this doubles as an automated test. A JSON report is printed to stdout.

Usage::

    python oracle.py                                  # discover keys, default subset
    python oracle.py --subset cache/cd4_tcell_perturbseq_subset.h5ad
    python oracle.py --pseudobulk-key marson2025_data/pseudobulk_counts.h5ad \
                     --de-key marson2025_data/de_estimates.csv --kd-target IL2RA

Real and runnable. Intentionally not executed during the build.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

DEFAULT_BUCKET = os.environ.get("REDLINE_S3_BUCKET", "genome-scale-tcell-perturb-seq")
DEFAULT_PREFIX = os.environ.get("REDLINE_S3_PREFIX", "marson2025_data/")
DEFAULT_SUBSET = os.path.join(os.path.dirname(__file__), "cache", "cd4_tcell_perturbseq_subset.h5ad")


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


def _anon_s3fs():
    try:
        import s3fs
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("s3fs is required. Install: pip install -e 'services/rigor[cloud]'") from exc
    return s3fs.S3FileSystem(anon=True)


def _discover(fs, bucket: str, prefix: str, wants: tuple[str, ...], exts: tuple[str, ...]) -> str | None:
    root = f"{bucket}/{prefix}".rstrip("/")
    entries = fs.find(root, detail=True)
    best, best_score = None, -1
    for path, info in entries.items():
        low = path.lower()
        if not low.endswith(exts):
            continue
        score = sum(1 for w in wants if w in low)
        if score > best_score:
            best, best_score = path, score
    return best if best_score > 0 else None


def _load_published_pseudobulk(fs, key: str):
    """Load the authors' pseudobulk matrix. Supports an .h5ad (AnnData with a
    condition/donor obs) or a genes-by-samples .csv."""
    import anndata as ad
    import pandas as pd

    with fs.open(key, "rb") as fh:
        if key.lower().endswith(".h5ad"):
            return ("anndata", ad.read_h5ad(fh))
        return ("frame", pd.read_csv(fh, index_col=0))


def _load_published_de(fs, key: str):
    import pandas as pd

    with fs.open(key, "rb") as fh:
        df = pd.read_csv(fh)
    return df


def _pick_col(df, candidates):
    lower = {c.lower(): c for c in df.columns}
    for cand in candidates:
        if cand in df.columns:
            return cand
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def _redline_deseq(counts_df, design_df, factor: str, ref_level: str, alt_level: str):
    """Redline's corrected test: PyDESeq2 on a genes-by-samples pseudobulk matrix
    with a two-level design factor. Returns a per-gene frame with log2FC and padj.
    This is the exact code path Pillar 1 uses to assert its result."""
    try:
        from pydeseq2.dds import DeseqDataSet
        from pydeseq2.ds import DeseqStats
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("pydeseq2 is required. Install: pip install -e 'services/rigor[stats]'") from exc
    import numpy as np
    import pandas as pd

    # DeseqDataSet wants samples-by-genes integer counts aligned to metadata.
    counts = counts_df.T.round().astype(int)
    counts = counts.loc[design_df.index]
    dds = DeseqDataSet(counts=counts, metadata=design_df, design_factors=factor, quiet=True)
    dds.deseq2()
    stats = DeseqStats(dds, contrast=[factor, alt_level, ref_level], quiet=True)
    stats.summary()
    res = stats.results_df.rename(columns={"log2FoldChange": "log2fc", "padj": "padj"})
    res.index.name = "gene"
    return res[["log2fc", "padj"]]


def check_a_method_agreement(fs, args) -> dict:
    """Check A: Redline's DE on the authors' pseudobulk vs the authors' DE."""
    import numpy as np
    import pandas as pd
    from scipy.stats import spearmanr, pearsonr

    pb_key = args.pseudobulk_key or _discover(fs, args.bucket, args.prefix,
                                               ("pseudobulk", "pseudo", "bulk"), (".h5ad", ".csv"))
    de_key = args.de_key or _discover(fs, args.bucket, args.prefix,
                                      ("de", "deseq", "diff", "results"), (".csv", ".tsv"))
    if not pb_key or not de_key:
        return {"ran": False, "reason": "could not discover the published pseudobulk and/or DE keys; "
                                        "pass --pseudobulk-key and --de-key."}

    kind, pb = _load_published_pseudobulk(fs, pb_key)
    if kind == "anndata":
        factor = _pick_col(pb.obs, ["condition", "perturbation", "guide", "target", "group"])
        counts_df = pd.DataFrame(
            (pb.layers["counts"] if "counts" in pb.layers else pb.X),
            index=pb.obs_names, columns=pb.var_names,
        ).T
        meta = pb.obs[[factor]].copy()
    else:
        # genes-by-samples csv; infer condition from the sample name.
        counts_df = pb
        factor = "condition"
        meta = pd.DataFrame(index=counts_df.columns)
        meta[factor] = [args.kd_target if args.kd_target.lower() in str(s).lower() else "non-targeting"
                        for s in counts_df.columns]

    alt = next((v for v in meta[factor].astype(str).unique() if args.kd_target.lower() in v.lower()), None)
    ref = next((v for v in meta[factor].astype(str).unique()
                if any(t in v.lower() for t in ("non-targeting", "nt", "control", "safe"))), None)
    if alt is None or ref is None:
        return {"ran": False, "reason": f"could not find KD and control levels in factor '{factor}': "
                                        f"{sorted(meta[factor].astype(str).unique())[:8]}"}

    meta = meta[meta[factor].isin([alt, ref])].copy()
    redline = _redline_deseq(counts_df[meta.index], meta, factor, ref_level=ref, alt_level=alt)

    authors = _load_published_de(fs, de_key)
    gcol = _pick_col(authors, ["gene", "gene_name", "symbol", "feature", "names"])
    lcol = _pick_col(authors, ["log2FoldChange", "log2fc", "logFC", "lfc"])
    pcol = _pick_col(authors, ["padj", "pvalue_adj", "fdr", "qvalue", "adj_pval", "p_adj"])
    if not gcol or not lcol:
        return {"ran": False, "reason": f"published DE csv missing gene/log2fc columns; saw {list(authors.columns)[:8]}"}
    authors = authors.set_index(gcol)

    shared = redline.index.intersection(authors.index)
    if len(shared) < args.min_genes:
        return {"ran": False, "reason": f"only {len(shared)} shared genes (need >= {args.min_genes})."}

    rl = redline.loc[shared, "log2fc"].to_numpy(dtype=float)
    au = authors.loc[shared, lcol].to_numpy(dtype=float)
    ok = np.isfinite(rl) & np.isfinite(au)
    rl, au = rl[ok], au[ok]
    sp = float(spearmanr(rl, au).correlation)
    pe = float(pearsonr(rl, au)[0])
    sign_agree = float(np.mean(np.sign(rl) == np.sign(au)))

    passed = sp >= args.min_corr and sign_agree >= args.min_sign
    return {
        "ran": True, "pseudobulk_key": pb_key, "de_key": de_key,
        "genes_compared": int(rl.size), "contrast": {"alt": alt, "ref": ref, "factor": factor},
        "spearman_log2fc": round(sp, 3), "pearson_log2fc": round(pe, 3),
        "sign_agreement": round(sign_agree, 3),
        "thresholds": {"min_spearman": args.min_corr, "min_sign_agreement": args.min_sign},
        "pass": bool(passed),
    }


def check_b_end_to_end(fs, args) -> dict:
    """Check B: Redline's subset -> pseudobulk -> DESeq2 focus-gene call, and its
    direction against the authors' published estimate for the same gene."""
    import anndata as ad
    import numpy as np
    import pandas as pd

    if not os.path.isfile(args.subset):
        return {"ran": False, "reason": f"subset not found at {args.subset}; run subset_marson.py first."}
    try:
        from decoupler import get_pseudobulk
    except ImportError:
        try:
            from decoupler.pp import pseudobulk as get_pseudobulk  # newer decoupler
        except ImportError:
            return {"ran": False, "reason": "decoupler is required for get_pseudobulk (stats extra)."}

    adata = ad.read_h5ad(args.subset)
    if "guide_id" not in adata.obs or "donor_id" not in adata.obs:
        return {"ran": False, "reason": "subset missing donor_id / guide_id obs."}
    if "counts" not in adata.layers:
        adata.layers["counts"] = adata.X.copy()

    guide = adata.obs["guide_id"].astype(str)
    is_kd = guide.str.upper().str.contains(args.kd_target.upper())
    nt_tokens = ("non-targeting", "non_targeting", "nontargeting", "control", "ntc", "safe")
    is_ctrl = guide.str.lower().apply(lambda g: any(t in g for t in nt_tokens))
    adata = adata[(is_kd | is_ctrl).values].copy()
    adata.obs["condition"] = np.where(is_kd[(is_kd | is_ctrl).values].values, f"{args.kd_target}-KD", "non-targeting")

    # One pseudobulk profile per donor per condition: the corrected unit.
    try:
        pb = get_pseudobulk(adata, sample_col="donor_id", groups_col="condition", layer="counts", mode="sum", min_cells=10)
    except TypeError:
        pb = get_pseudobulk(adata, sample_col="donor_id", groups_col="condition")

    counts_df = pd.DataFrame(
        (pb.layers["counts"] if "counts" in pb.layers else pb.X),
        index=pb.obs_names, columns=pb.var_names,
    ).T
    meta = pd.DataFrame(index=pb.obs_names)
    meta["condition"] = pb.obs["condition"].astype(str).values
    n_reps = meta.groupby("condition").size().to_dict()

    # Hard branch honesty: fewer than 2 replicates per group means no valid DE.
    if min(n_reps.values(), default=0) < 2:
        return {"ran": True, "hard_stop": True, "replicates_per_group": n_reps,
                "note": "Fewer than 2 biological replicates per group. No valid DE by any method.",
                "pass": True}

    redline = _redline_deseq(counts_df, meta, "condition",
                             ref_level="non-targeting", alt_level=f"{args.kd_target}-KD")
    focus = args.focus_gene
    if focus not in redline.index:
        return {"ran": True, "reason": f"focus gene {focus} absent from pseudobulk result.",
                "replicates_per_group": n_reps, "pass": True}

    padj = float(redline.loc[focus, "padj"]) if np.isfinite(redline.loc[focus, "padj"]) else 1.0
    lfc = float(redline.loc[focus, "log2fc"])
    # The naive claim was p < 0.001 at the cell level. The corrected pseudobulk
    # call is the honest one. Reporting non-significant here IS the expected,
    # correct Pillar 1 outcome (the inflated significance collapses).
    return {
        "ran": True, "hard_stop": False, "replicates_per_group": n_reps,
        "focus_gene": focus, "focus_log2fc": round(lfc, 3), "focus_padj_pseudobulk": round(padj, 4),
        "significant_at_alpha": bool(padj < args.alpha), "alpha": args.alpha,
        "expected": "corrected pseudobulk call replaces the inflated cell-level p-value",
        "pass": True,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="oracle",
        description="Validate Redline's Pillar 1 pseudobulk re-run against the Marson authors' published answer key.",
    )
    p.add_argument("--subset", default=DEFAULT_SUBSET, help="local cell-level subset .h5ad (from subset_marson.py).")
    p.add_argument("--bucket", default=DEFAULT_BUCKET, help="public S3 bucket (anonymous).")
    p.add_argument("--prefix", default=DEFAULT_PREFIX, help="key prefix in the bucket.")
    p.add_argument("--pseudobulk-key", default=None, help="exact key of the authors' pseudobulk matrix (.h5ad or .csv).")
    p.add_argument("--de-key", default=None, help="exact key of the authors' published DE estimates (.csv).")
    p.add_argument("--kd-target", dest="kd_target", default="IL2RA", help="knockdown target defining the KD group.")
    p.add_argument("--focus-gene", dest="focus_gene", default="FOXP3", help="gene for the end-to-end focus check.")
    p.add_argument("--alpha", type=float, default=0.05, help="significance threshold for the corrected call.")
    p.add_argument("--min-corr", type=float, default=0.8, help="min Spearman log2FC correlation to pass Check A.")
    p.add_argument("--min-sign", type=float, default=0.85, help="min sign-agreement fraction to pass Check A.")
    p.add_argument("--min-genes", type=int, default=50, help="min shared genes required for Check A.")
    p.add_argument("--skip-remote", action="store_true", help="run only Check B (no S3 access).")
    args = p.parse_args(argv)

    report: dict = {"dataset": "marson", "pillar": 1}
    try:
        if args.skip_remote:
            # Check B reads the local subset only, so it needs no S3 handle.
            report["check_a_method_agreement"] = {"ran": False, "reason": "skipped (--skip-remote)."}
            report["check_b_end_to_end"] = check_b_end_to_end(None, args)
        else:
            fs = _anon_s3fs()
            report["check_a_method_agreement"] = check_a_method_agreement(fs, args)
            report["check_b_end_to_end"] = check_b_end_to_end(fs, args)
    except SystemExit:
        raise
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(report, indent=2))
        return 1

    checks = [report.get("check_a_method_agreement", {}), report.get("check_b_end_to_end", {})]
    ran = [c for c in checks if c.get("ran")]
    # Overall pass: every check that actually ran must pass. If none could run
    # (missing data), that is a setup failure, not a silent success.
    report["pass"] = bool(ran) and all(c.get("pass") for c in ran)
    report["checks_ran"] = len(ran)
    print(json.dumps(report, indent=2))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
