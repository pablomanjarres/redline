#!/usr/bin/env python3
"""Build the NAIVE-FOIL analysis that Redline audits on the Marson data.

READ THIS FIRST. HARD FRAMING CONSTRAINT.

The Marson / Pritchard authors analyzed this dataset rigorously. They provide
pseudobulk matrices and a dedicated differential-expression stage, and the
computational lead authored Milo. There is no pseudoreplication error in their
published work to catch. This script never reproduces or audits their analysis.

What this script builds is the FOIL: the standard cluster-then-annotate-then-DE
workflow a less-experienced scientist would run on the same data. That naive
workflow contains the textbook errors Redline exists to catch. The authors'
rigor is the standard Redline helps others reach. Any cluster this script marks
as spurious is verified spurious by a held-out test before it is ever flagged,
so an immunologist looking at the demo sees a real artifact, not a false call.

The foil it writes carries, in one ``.h5ad``:
  - raw integer counts in a ``counts`` layer and ``.raw`` (Pillars 1 and 2 need
    them),
  - a leiden clustering at an UNJUSTIFIED resolution (default 1.0),
  - activation / polarization cell-state annotations over those clusters,
  - the naive cell-level (double-dipped) DE per cell state in ``uns``,
  - the 9 resolved obs columns the foundation step expects,
  - a ``uns['redline_foil']`` provenance block naming the focus gene, the unit,
    the grouping, the injected technical confound, and the two spurious clusters
    (verified by held-out collapse and by narrow-resolution persistence).

The naive scientist's four load-bearing claims, mapped to the four pillars:
  1. "IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells."
  2. "An activated Treg-like state defined by 4 markers, enriched under knockdown."
  3. "A distinct knockdown-responsive T-cell state."
  4. "Differential expression between knockdown and non-targeting control."

Usage::

    python build_naive_foil.py                          # reads the default subset
    python build_naive_foil.py --resolution 1.0 --seed 0
    python build_naive_foil.py --input cache/mini.h5ad --output cache/mini.foil.h5ad

Real and runnable. Intentionally not executed during the build.
"""

from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(__file__)
DEFAULT_INPUT = os.path.join(HERE, "cache", "cd4_tcell_perturbseq_subset.h5ad")
DEFAULT_OUTPUT = os.path.join(HERE, "cache", "cd4_tcell_perturbseq_subset.foil.h5ad")

# The claim under audit. IL2RA is the CRISPRi target; FOXP3 is the readout the
# naive analysis calls significant at the single-cell level.
FOCUS_GENE = "FOXP3"
KD_TARGET = "IL2RA"

# Canonical CD4+ T-cell state signatures (real markers). Used only to ANNOTATE
# clusters into legible names. The spurious-cluster selection below does not
# trust these labels; it verifies with a held-out test.
STATE_SIGNATURES = {
    "Naive": ["CCR7", "SELL", "TCF7", "LEF1", "IL7R"],
    "Effector": ["IFNG", "TBX21", "GZMB", "CCL5", "NKG7"],
    "Cytotoxic": ["GZMK", "GZMA", "PRF1", "KLRG1"],
    "Th17": ["RORC", "IL17A", "CCR6", "IL23R"],
    "Tfh": ["CXCR5", "PDCD1", "BCL6", "ICA1"],
    "Treg": ["FOXP3", "IL2RA", "IKZF2", "IL10"],
    "Activated Treg-like": ["TNFRSF9", "ICOS", "TIGIT", "CTLA4"],
}

# Tirosh et al. cell-cycle gene sets, trimmed to the common core. Used to fill a
# ``phase`` column when the subset does not already carry one.
S_GENES = ["MCM5", "PCNA", "TYMS", "MCM2", "MCM4", "RRM1", "UNG", "GINS2", "MCM6", "CDCA7", "SLBP", "RRM2", "CDC6", "CDC45"]
G2M_GENES = ["HMGB2", "CDK1", "NUSAP1", "UBE2C", "BIRC5", "TPX2", "TOP2A", "CKS2", "CENPF", "CCNB2", "CKS1B", "CDC20", "AURKA", "BUB1"]


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


def _sc():
    try:
        import scanpy as sc
    except ImportError as exc:  # pragma: no cover - environment guard
        raise SystemExit(
            "scanpy is required to build the naive foil. Install the stats extra:\n"
            "  pip install -e 'services/rigor[stats]'"
        ) from exc
    return sc


def _counts_layer(adata):
    """Return raw integer counts, preferring a ``counts`` layer, then ``.raw``,
    then ``X``. Refuses to proceed on normalized values."""
    import numpy as np

    def integerish(m) -> bool:
        d = m.data if hasattr(m, "data") else np.asarray(m).ravel()
        if d.size == 0:
            return True
        s = d[: min(d.size, 200_000)]
        return bool(np.issubdtype(d.dtype, np.integer) or np.allclose(s, np.round(s)))

    if "counts" in adata.layers and integerish(adata.layers["counts"]):
        return adata.layers["counts"]
    if adata.raw is not None and integerish(adata.raw.X):
        return adata.raw.X
    if integerish(adata.X):
        return adata.X
    raise SystemExit(
        "no raw integer counts found (looked in layers['counts'], .raw, X). "
        "The naive foil, like Pillars 1 and 2, cannot run without raw counts."
    )


def _poisson_thin(counts, eps: float, rng):
    """Split a sparse count matrix into two independent halves by Poisson
    thinning: for each count c draw train ~ Binomial(c, eps), test = c - train.
    Binomial(0, p) is 0, so only the stored nonzeros need a draw."""
    import numpy as np
    import scipy.sparse as sp

    csr = sp.csr_matrix(counts)
    data = np.rint(csr.data).astype(np.int64)
    train_data = rng.binomial(data, eps).astype(np.float32)
    test_data = (data - train_data).astype(np.float32)
    train = sp.csr_matrix((train_data, csr.indices, csr.indptr), shape=csr.shape)
    test = sp.csr_matrix((test_data, csr.indices, csr.indptr), shape=csr.shape)
    return train, test


def _lognorm_from_counts(sc, adata):
    """Log-normalize ``X`` from the raw counts, once. Sets ``adata.raw`` to the
    log-normalized values (the standard marker-test reference) and leaves the
    integer ``counts`` layer untouched. Idempotent: safe to call once up front."""
    adata.X = adata.layers["counts"].copy()
    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)
    adata.raw = adata
    return adata


def _leiden_at(sc, adata, resolution: float, seed: int):
    """Cluster at one resolution and return the labels, with no side effects on
    ``adata``. Rebuilds the HVG / scale / PCA / neighbors chain from the stable
    log-normalized ``X`` every call, so the anchor clustering and each sweep step
    are independent and reproducible (never re-normalizing already-scaled data)."""
    import anndata as ad

    work = ad.AnnData(X=adata.X.copy(), obs=adata.obs[[]].copy(), var=adata.var.copy())
    sc.pp.highly_variable_genes(work, n_top_genes=min(2000, work.n_vars), flavor="seurat")
    if "highly_variable" in work.var:
        work = work[:, work.var["highly_variable"]].copy()
    sc.pp.scale(work, max_value=10)
    sc.tl.pca(work, n_comps=min(50, work.n_vars - 1), svd_solver="arpack", random_state=seed)
    sc.pp.neighbors(work, n_neighbors=15, n_pcs=min(50, work.obsm["X_pca"].shape[1]), random_state=seed)
    try:
        sc.tl.leiden(work, resolution=resolution, key_added="leiden", flavor="igraph",
                     n_iterations=2, directed=False, random_state=seed)
    except TypeError:  # older scanpy without the igraph flavor
        sc.tl.leiden(work, resolution=resolution, key_added="leiden", random_state=seed)
    return work.obs["leiden"].astype(str).values


def _score_state(sc, adata, name: str, genes: list[str]) -> str:
    present = [g for g in genes if g in adata.var_names]
    col = f"_score_{name}"
    if present:
        sc.tl.score_genes(adata, present, score_name=col)
    else:
        import numpy as np
        adata.obs[col] = np.zeros(adata.n_obs, dtype=float)
    return col


def _marker_auc(score_vector, in_cluster_mask) -> float:
    """AUC of a per-cell marker score separating one cluster from the rest.
    0.5 is no separation."""
    from sklearn.metrics import roc_auc_score
    import numpy as np

    y = in_cluster_mask.astype(int)
    if y.sum() == 0 or y.sum() == y.size:
        return 0.5
    try:
        return float(roc_auc_score(y, np.asarray(score_vector)))
    except ValueError:
        return 0.5


def build_foil(args: argparse.Namespace) -> str:
    import anndata as ad
    import numpy as np
    import pandas as pd

    sc = _sc()
    rng = np.random.default_rng(args.seed)

    eprint(f"loading subset: {args.input}")
    adata = ad.read_h5ad(args.input)
    counts = _counts_layer(adata)
    adata.layers["counts"] = counts.copy()

    if "guide_id" not in adata.obs:
        raise SystemExit("subset is missing obs['guide_id']; re-run subset_marson.py.")

    # The naive binary grouping the scientist tests: IL2RA knockdown vs
    # non-targeting control. Derived from the guide identity.
    guide = adata.obs["guide_id"].astype(str)
    is_kd = guide.str.upper().str.contains(args.kd_target.upper())
    is_ctrl = adata.obs.get("is_control")
    if is_ctrl is None:
        is_ctrl = ~is_kd
    adata.obs["condition"] = np.where(is_kd, f"{args.kd_target}-KD", "non-targeting")
    # Focus the foil on the audited contrast; other perturbations stay in the
    # subset but are dropped from the analyzed object so the claim is legible.
    keep = is_kd.values | np.asarray(is_ctrl, dtype=bool)
    adata = adata[keep].copy()
    eprint(f"analyzed contrast: {int(is_kd.values[keep].sum())} KD vs "
           f"{int((~is_kd.values[keep]).sum())} non-targeting cells")

    # QC covariates and cell-cycle phase, computed if the subset lacks them.
    if "pct_mito" not in adata.obs or "n_genes" not in adata.obs:
        mt = adata.var_names.str.upper().str.startswith("MT-")
        adata.var["mt"] = mt.values
        sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], inplace=True, percent_top=None, layer="counts")
        adata.obs["n_genes"] = adata.obs.get("n_genes_by_counts", adata.obs.get("n_genes"))
        adata.obs["pct_mito"] = adata.obs.get("pct_counts_mt", adata.obs.get("pct_mito", 0.0))

    # INJECTED TECHNICAL CONFOUND (Pillar 4). The naive design captured the two
    # conditions on separate 10x lanes, so condition and lane are collinear. This
    # is the classic confound a careful design avoids; the foil introduces it on
    # purpose and labels it as injected in provenance.
    adata.obs["lane"] = np.where(adata.obs["condition"].values == f"{args.kd_target}-KD", "Lane-A", "Lane-B")

    # Standard cluster-then-annotate at an UNJUSTIFIED resolution. Log-normalize
    # once from counts, then cluster off that stable matrix.
    eprint(f"clustering at leiden resolution {args.resolution} (unjustified, the naive default)...")
    _lognorm_from_counts(sc, adata)
    adata.obs["leiden"] = _leiden_at(sc, adata, args.resolution, args.seed)

    if "phase" not in adata.obs:
        s = [g for g in S_GENES if g in adata.var_names]
        g2m = [g for g in G2M_GENES if g in adata.var_names]
        if s and g2m:
            sc.tl.score_genes_cell_cycle(adata, s_genes=s, g2m_genes=g2m)
        else:
            adata.obs["phase"] = "G1"
    adata.obs["phase"] = adata.obs["phase"].astype(str)

    # Annotate each leiden cluster with its top-scoring state signature.
    score_cols = {name: _score_state(sc, adata, name, genes) for name, genes in STATE_SIGNATURES.items()}
    per_cluster_state: dict[str, str] = {}
    for cl in adata.obs["leiden"].astype(str).unique():
        mask = (adata.obs["leiden"].astype(str) == cl).values
        means = {name: float(np.mean(adata.obs[col].values[mask])) for name, col in score_cols.items()}
        per_cluster_state[cl] = max(means, key=means.get)
    adata.obs["cell_state"] = adata.obs["leiden"].astype(str).map(per_cluster_state).astype(str)
    for col in score_cols.values():
        del adata.obs[col]

    # The naive DOUBLE-DIPPED DE: rank marker genes per cell state on the same
    # cells used to define the states. This is the fake-marker generator Pillar 2
    # catches; storing it is how the foil carries the scientist's claim.
    sc.tl.rank_genes_groups(adata, "cell_state", method="wilcoxon", use_raw=True)

    # SELECT THE GENUINELY SPURIOUS CLUSTERS. Never cry wolf: a cluster is only
    # eligible to be flagged if its markers collapse on an independent half of
    # the data (Pillar 2 logic) or if it exists only inside a narrow resolution
    # window (Pillar 3 logic). Both are verified here, not asserted.
    train_counts, test_counts = _poisson_thin(adata.layers["counts"], args.split, rng)
    train = ad.AnnData(X=train_counts.copy(), obs=adata.obs.copy(), var=adata.var.copy())
    test = ad.AnnData(X=test_counts.copy(), obs=adata.obs.copy(), var=adata.var.copy())
    sc.pp.normalize_total(train, target_sum=1e4); sc.pp.log1p(train)
    sc.pp.normalize_total(test, target_sum=1e4); sc.pp.log1p(test)

    heldout = {}
    for cl in adata.obs["leiden"].astype(str).unique():
        mask = (adata.obs["leiden"].astype(str) == cl).values
        state = per_cluster_state[cl]
        markers = [g for g in STATE_SIGNATURES[state] if g in adata.var_names]
        if not markers:
            continue
        disc = _marker_auc(np.asarray(train[:, markers].X.mean(axis=1)).ravel(), mask)
        hold = _marker_auc(np.asarray(test[:, markers].X.mean(axis=1)).ravel(), mask)
        # A marker "survives" if it still separates on the held-out half.
        survivors = 0
        for g in markers:
            if _marker_auc(np.asarray(test[:, [g]].X).ravel(), mask) >= args.survive_auc:
                survivors += 1
        heldout[cl] = {
            "state": state, "markers": markers, "n_markers": len(markers),
            "discovery_auc": round(disc, 3), "heldout_auc": round(hold, 3),
            "survivors": survivors, "collapse": round(disc - hold, 3),
        }

    # Pillar 2 flagged cluster: the largest discovery-to-heldout collapse whose
    # held-out AUC is at chance. If nothing collapses, flag nothing (clean).
    pillar2 = None
    ranked = sorted(heldout.items(), key=lambda kv: kv[1]["collapse"], reverse=True)
    for cl, m in ranked:
        if m["collapse"] >= args.min_collapse and m["heldout_auc"] <= args.chance_auc:
            pillar2 = {"cluster": cl, **m}
            break

    # Pillar 3 flagged cluster: a cluster present only inside a narrow resolution
    # window. Sweep neighboring resolutions and measure persistence via best
    # Jaccard overlap against clusters at each other resolution.
    persistence = _resolution_persistence(sc, adata, args, seed=args.seed)
    pillar3 = None
    fragile = sorted(persistence.items(), key=lambda kv: kv[1]["persistence"])
    for cl, m in fragile:
        if m["persistence"] <= args.max_persistence:
            pillar3 = {"cluster": cl, "state": per_cluster_state.get(cl, "unknown"), **m}
            break

    # Assemble the 9 resolved obs columns the foundation step expects. Extra
    # working columns are dropped so field resolution returns exactly the locked
    # nine.
    keep_cols = ["donor_id", "condition", "cell_barcode", "lane", "guide_id",
                 "n_genes", "pct_mito", "leiden", "phase"]
    for c in keep_cols:
        if c not in adata.obs:
            adata.obs[c] = "unknown"
    adata.obs["cell_barcode"] = adata.obs_names.astype(str)
    extra = [c for c in adata.obs.columns if c not in keep_cols + ["cell_state"]]
    adata.obs.drop(columns=extra, inplace=True, errors="ignore")

    adata.uns["redline_foil"] = {
        "kind": "naive_foil",
        "framing": ("Standard cluster-then-annotate-then-DE workflow built on the Marson data. "
                    "This is the analysis a less-experienced scientist would run. It is never the "
                    "authors' own analysis, which is rigorous and correct."),
        "focus_gene": args.focus_gene,
        "kd_target": args.kd_target,
        "unit": "donor_id",
        "grouping": "condition",
        "observation": "cell_barcode",
        "confound_var": "lane",
        "confound_note": "Injected: KD and non-targeting were placed on separate lanes, so condition and lane are collinear (Cramer's V near 1).",
        "resolution": float(args.resolution),
        "n_donors": int(adata.obs["donor_id"].nunique()),
        "claims": {
            "1": f"{args.kd_target} knockdown significantly upregulates {args.focus_gene} across CD4 T cells (p < 0.001).",
            "2": "An activated Treg-like state defined by 4 markers, enriched under knockdown.",
            "3": "A distinct knockdown-responsive T-cell state.",
            "4": "Differential expression between knockdown and non-targeting control.",
        },
        "pillar2_flagged": pillar2,
        "pillar3_flagged": pillar3,
        "heldout_by_cluster": heldout,
        "persistence_by_cluster": persistence,
        "cluster_states": per_cluster_state,
    }

    if pillar2 is None and pillar3 is None:
        eprint("WARNING: no cluster met the spurious threshold. The foil would report clean. "
               "Lower --resolution or adjust the subset before using this for the demo.")
    else:
        p2 = pillar2["state"] if pillar2 else "none"
        p3 = pillar3["state"] if pillar3 else "none"
        eprint(f"verified spurious clusters -> Pillar 2: {p2}, Pillar 3: {p3}")

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    adata.write_h5ad(args.output)
    eprint(f"wrote naive foil: {adata.n_obs} cells x {adata.n_vars} genes to {args.output}")
    return args.output


def _resolution_persistence(sc, adata, args, seed: int) -> dict:
    """Sweep resolutions and score each anchor-resolution cluster by how well it
    reappears at neighboring resolutions (best Jaccard overlap, averaged). A low
    score means the cluster exists only in a narrow window: a resolution
    artifact."""
    import numpy as np

    grid = np.round(np.arange(args.sweep_min, args.sweep_max + 1e-9, args.sweep_step), 3)
    labelings = {}
    for res in grid:
        labelings[float(res)] = _leiden_at(sc, adata, float(res), seed)

    anchor = float(args.resolution)
    if anchor not in labelings:
        # Nearest swept resolution to the anchor.
        anchor = min(labelings, key=lambda r: abs(r - anchor))
    anchor_labels = labelings[anchor]
    others = [r for r in labelings if r != anchor]

    out = {}
    for cl in np.unique(anchor_labels):
        cl_mask = anchor_labels == cl
        best_overlaps = []
        for r in others:
            other = labelings[r]
            best = 0.0
            for ol in np.unique(other):
                om = other == ol
                inter = np.logical_and(cl_mask, om).sum()
                union = np.logical_or(cl_mask, om).sum()
                if union:
                    best = max(best, inter / union)
            best_overlaps.append(best)
        out[str(cl)] = {
            "persistence": round(float(np.mean(best_overlaps)) if best_overlaps else 1.0, 3),
            "window": [float(min(labelings)), float(max(labelings))],
            "anchor_resolution": float(anchor),
        }
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="build_naive_foil",
        description="Construct the naive analysis Redline audits on the Marson data. Never the authors' analysis.",
    )
    p.add_argument("--input", default=DEFAULT_INPUT, help="input subset .h5ad (from subset_marson.py).")
    p.add_argument("--output", default=DEFAULT_OUTPUT, help="output foil .h5ad (gitignored cache).")
    p.add_argument("--resolution", type=float, default=1.0, help="unjustified leiden resolution the naive analysis uses.")
    p.add_argument("--focus-gene", dest="focus_gene", default=FOCUS_GENE, help="the gene the naive analysis calls significant.")
    p.add_argument("--kd-target", dest="kd_target", default=KD_TARGET, help="the CRISPRi knockdown target under audit.")
    p.add_argument("--split", type=float, default=0.5, help="count-split epsilon for the held-out marker test.")
    p.add_argument("--survive-auc", type=float, default=0.6, help="held-out AUC a single marker must clear to 'survive'.")
    p.add_argument("--min-collapse", type=float, default=0.2, help="min discovery-to-heldout AUC drop to call a cluster spurious.")
    p.add_argument("--chance-auc", type=float, default=0.65, help="held-out AUC at or below which markers are at chance.")
    p.add_argument("--max-persistence", type=float, default=0.4, help="max cross-resolution persistence to call a cluster an artifact.")
    p.add_argument("--sweep-min", type=float, default=0.4, help="resolution sweep lower bound (Pillar 3).")
    p.add_argument("--sweep-max", type=float, default=1.4, help="resolution sweep upper bound (Pillar 3).")
    p.add_argument("--sweep-step", type=float, default=0.2, help="resolution sweep step (Pillar 3).")
    p.add_argument("--seed", type=int, default=0, help="random seed.")
    args = p.parse_args(argv)

    try:
        out = build_foil(args)
    except SystemExit:
        raise
    except Exception as exc:
        eprint(f"build_naive_foil: {type(exc).__name__}: {exc}")
        return 1
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
