"""The single source of truth for every corrected statistic Redline reports.

Redline's integrity requirement (spec 4.3) is that three numbers agree: the value
the engine reports, the value the preview renders, and the value the downloadable
script prints. They used to be computed by two separate implementations, one in
the check module and one in the emitted template, so they drifted.

This module removes the second implementation. Each check has one kernel here, a
pure function that takes a loaded AnnData plus explicit parameters and returns a
plain dict. Both consumers use it:

- The check module calls the kernel and reports its return value. The chart it
  renders and the numbers it asserts come from that dict.
- The emitted script inlines this module's source text verbatim (via
  ``inspect.getsource``) and calls the same function with the same parameters.

The engine numbers, the preview, and the script then agree by construction,
because they are the same code running on the same data with the same seed.

Design rules this file keeps:

- It imports nothing from ``redline``. The source text is legal to paste into a
  standalone scientist script.
- Heavy imports (scanpy, decoupler, pydeseq2, statsmodels, sklearn) live inside
  the functions, each guarded, each with a deterministic fallback. Because both
  consumers run the same code, the fallback is identical on both sides.
- Every stochastic step takes an explicit seed.
- Every kernel returns JSON-serializable Python scalars (float, int, bool, None,
  str), so ``json.dumps`` succeeds in the emitted script. No numpy scalar leaks.
"""

from __future__ import annotations


# ── coercion so nothing numpy-typed reaches json.dumps ───────────────────────
def _num(x):
    """A p-value or measurement as a plain float, or None. Never rounded, so a
    value like 1e-74 survives the trip through JSON."""
    return None if x is None else float(x)


def _round(x, ndigits=4):
    """A fraction or score rounded to a readable width, or None."""
    return None if x is None else round(float(x), ndigits)


# ── data access ──────────────────────────────────────────────────────────────
def _load(path):
    """Read an .h5ad into an AnnData. The emitted script calls this first."""
    import anndata as ad

    return ad.read_h5ad(path)


def _dense(x):
    """A dense numpy array from a scipy sparse matrix or an array-like."""
    import numpy as np

    if x is None:
        return None
    if hasattr(x, "toarray"):
        return np.asarray(x.toarray())
    return np.asarray(x)


def _raw_counts(adata):
    """Return ``(count_matrix, var_names)`` as dense float counts.

    Prefers an explicit counts layer, then ``.raw`` when it holds integers, then
    ``.X``. The fixtures always carry a counts layer, so this returns the raw
    integer matrix the pseudobulk step needs.
    """
    import numpy as np

    names = [str(v) for v in getattr(adata, "var_names", [])]
    layers = getattr(adata, "layers", None)
    if layers is not None:
        for key in ("counts", "count", "raw_counts", "umi"):
            try:
                if key in layers:
                    return np.asarray(_dense(layers[key]), dtype=float), names
            except TypeError:
                continue
    raw = getattr(adata, "raw", None)
    if raw is not None and getattr(raw, "X", None) is not None:
        m = np.asarray(_dense(raw.X), dtype=float)
        finite = m[np.isfinite(m)]
        if finite.size and float(np.min(finite)) >= 0 and np.all(np.abs(finite - np.rint(finite)) < 1e-6):
            return m, [str(v) for v in getattr(raw, "var_names", names)]
    X = getattr(adata, "X", None)
    if X is not None:
        return np.asarray(_dense(X), dtype=float), names
    return np.zeros((int(getattr(adata, "n_obs", 1)), 1)), names


def _col(adata, name):
    """An obs column as a numpy array of strings, or None if it is absent."""
    import numpy as np

    if not name:
        return None
    obs = getattr(adata, "obs", None)
    if obs is None:
        return None
    try:
        if name not in obs.columns:
            return None
        return np.asarray([str(x) for x in obs[name].to_numpy()])
    except Exception:
        return None


def _subset(adata, mask):
    """A copied slice of the AnnData for the kept cells."""
    return adata[mask].copy()


# ── statistics primitives ────────────────────────────────────────────────────
def _welch(a, b):
    """Two-sided Welch t-test p-value. scipy when present, else a normal
    approximation on the Welch t statistic."""
    import numpy as np

    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if a.size < 2 or b.size < 2:
        return 1.0
    try:
        from scipy.stats import ttest_ind

        p = float(ttest_ind(a, b, equal_var=False).pvalue)
        return p if np.isfinite(p) else 1.0
    except Exception:
        import math

        se = math.sqrt(b.var(ddof=1) / b.size + a.var(ddof=1) / a.size)
        if se == 0:
            return 1.0
        t = (b.mean() - a.mean()) / se
        return math.erfc(abs(t) / math.sqrt(2))


def _bh(pvals, alpha, by=False):
    """Benjamini-Hochberg (or Benjamini-Yekutieli) FDR control.

    Returns ``(reject, qvalues)``. statsmodels when it imports, else the same
    step-up computation inline, so the emitted script controls the FDR even when
    statsmodels is not on the scientist's machine.
    """
    import numpy as np

    p = np.asarray(pvals, dtype=float)
    k = p.size
    if k == 0:
        return np.zeros(0, dtype=bool), np.zeros(0)
    name = "fdr_by" if by else "fdr_bh"
    try:
        from statsmodels.stats.multitest import multipletests

        reject, q, _, _ = multipletests(p, alpha=alpha, method=name)
        return np.asarray(reject), np.asarray(q)
    except Exception:
        c = float(np.sum(1.0 / np.arange(1, k + 1))) if by else 1.0
        order = np.argsort(p, kind="mergesort")
        ranked = p[order]
        q = ranked * k * c / np.arange(1, k + 1)
        q = np.minimum.accumulate(q[::-1])[::-1]
        q = np.clip(q, 0.0, 1.0)
        out = np.empty(k)
        out[order] = q
        return out <= alpha, out


def _cpm_log1p(x):
    """Library-size-normalized log1p expression (log1p of counts per million).

    Accepts a 1-D count vector or a cells-by-genes matrix. Each row is scaled by
    its own library size, so cells of different depth are comparable.
    """
    import numpy as np

    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        x = x.reshape(1, -1)
    lib = x.sum(axis=1, keepdims=True)
    with np.errstate(divide="ignore", invalid="ignore"):
        cpm = np.where(lib > 0, x / lib * 1e6, 0.0)
    return np.log1p(cpm)


def _cramers_v(tab):
    """Cramer's V association for a contingency table, in ``[0, 1]``."""
    import numpy as np

    tab = np.asarray(tab, dtype=float)
    n = tab.sum()
    if n == 0:
        return 0.0
    row = tab.sum(1, keepdims=True)
    col = tab.sum(0, keepdims=True)
    exp = row @ col / n
    with np.errstate(divide="ignore", invalid="ignore"):
        chi2 = np.nansum(np.where(exp > 0, (tab - exp) ** 2 / exp, 0.0))
    r, c = tab.shape
    kk = min(r, c)
    if kk < 2:
        return 0.0
    return float(np.sqrt(max(chi2, 0.0) / (n * (kk - 1))))


def _is_collinear(tab):
    """True when a contingency table is perfectly nested: every row, or every
    column, has at most one occupied cell. That is a design where the two
    variables are the same split and no model can separate them."""
    import numpy as np

    present = np.asarray(tab) > 0
    rows_one = all(int(r.sum()) <= 1 for r in present)
    cols_one = all(int(c.sum()) <= 1 for c in present.T)
    return bool(rows_one or cols_one)


def _icc(expr, unit_labels):
    """Intraclass correlation: between-unit variance over total variance. High
    values mean cells within a replicate are far from independent, which is the
    signal pseudoreplication rides on."""
    import numpy as np

    units = np.unique(unit_labels)
    if units.size < 2:
        return None
    means, within = [], []
    for u in units:
        vals = expr[unit_labels == u]
        if vals.size == 0:
            continue
        means.append(vals.mean())
        if vals.size > 1:
            within.append(vals.var(ddof=1))
    if len(means) < 2:
        return None
    between = float(np.var(means, ddof=1))
    inside = float(np.mean(within)) if within else 0.0
    total = between + inside
    return None if total <= 0 else between / total


def _auc(scores, labels):
    """Direction-agnostic ROC AUC (separation strength) of a marker score against
    a binary label. sklearn when present, else the rank-sum equivalent. Degenerate
    input returns 0.5 (chance)."""
    import numpy as np

    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels, dtype=int)
    if scores.size == 0 or np.unique(labels).size < 2:
        return 0.5
    try:
        from sklearn.metrics import roc_auc_score

        auc = float(roc_auc_score(labels, scores))
    except Exception:
        order = np.argsort(scores, kind="mergesort")
        ranks = np.empty_like(order, dtype=float)
        ranks[order] = np.arange(1, scores.size + 1)
        pos = labels == 1
        npos = int(pos.sum())
        nneg = int((~pos).sum())
        if npos == 0 or nneg == 0:
            return 0.5
        auc = (ranks[pos].sum() - npos * (npos + 1) / 2.0) / (npos * nneg)
    return float(max(auc, 1.0 - auc))


def _pick_gene(counts, names, m0, m1, given=None, log=True):
    """Resolve the audited gene. An explicit name wins; otherwise the gene the
    naive test would call most confidently (largest absolute Welch t between the
    two arms). ``log=False`` picks on raw counts, which is what check 8 reproduces."""
    import numpy as np

    if given is not None and str(given) in names:
        return str(given), names.index(str(given))
    base = np.log1p(np.clip(counts, 0, None)) if log else np.asarray(counts, dtype=float)
    a = base[m0]
    b = base[m1]
    if a.shape[0] < 2 or b.shape[0] < 2:
        idx = int(np.argmax(base.mean(0)))
        return names[idx], idx
    ma, mb = a.mean(0), b.mean(0)
    va = a.var(0, ddof=1) / max(a.shape[0], 1)
    vb = b.var(0, ddof=1) / max(b.shape[0], 1)
    se = np.sqrt(va + vb)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(se > 0, (mb - ma) / se, 0.0)
    idx = int(np.argmax(np.abs(np.nan_to_num(t))))
    return names[idx], idx


def _two_levels(vec):
    """The two most-populated levels of a label vector. Orientation does not
    change a two-sided p-value, so the busiest two levels are enough."""
    import numpy as np

    levels, counts = np.unique(vec, return_counts=True)
    order = np.argsort(-counts)
    top = [str(levels[i]) for i in order[:2]]
    if len(top) < 2:
        top = top + top
    return top[0], top[1]


# ── pseudobulk and the negative-binomial GLM ─────────────────────────────────
def _pseudobulk(adata, unit, group, extra):
    """Sum raw counts to one profile per (unit, group, extra...) sample.

    The sample key joins the replicate unit with the grouping and any extra
    factor, so a factor that varies within a unit (a technical variable the
    replicate straddles) is kept as its own axis instead of being averaged away. Works on decoupler
    2.x (``dc.pp.pseudobulk``) and 1.x (``dc.get_pseudobulk``). Returns
    ``(counts_df, meta)`` with one row per sample and the factor columns
    reconstructed from the sample key.
    """
    import anndata as ad
    import decoupler as dc
    import numpy as np
    import pandas as pd

    counts, names = _raw_counts(adata)
    obs = adata.obs
    cols = [unit, group] + list(extra)
    key = obs[cols[0]].astype(str)
    for c in cols[1:]:
        key = key.str.cat(obs[c].astype(str), sep="|")

    packed = ad.AnnData(X=np.asarray(np.rint(counts), dtype=float), obs=obs.copy())
    packed.var_names = names
    packed.obs["_rl_sample"] = key.values
    packed.layers["counts"] = np.asarray(np.rint(counts), dtype=float)

    if hasattr(dc, "pp") and hasattr(dc.pp, "pseudobulk"):
        pb = dc.pp.pseudobulk(packed, sample_col="_rl_sample", groups_col=None, layer="counts", mode="sum")
    else:
        pb = dc.get_pseudobulk(
            packed, sample_col="_rl_sample", groups_col=None, layer="counts", mode="sum", min_cells=1, min_counts=0
        )

    X = _dense(pb.X)
    counts_df = pd.DataFrame(
        np.rint(X).astype(int),
        index=[str(i) for i in pb.obs_names],
        columns=[str(v) for v in pb.var_names],
    )
    counts_df = counts_df.loc[:, counts_df.sum(0) > 0]

    meta = pd.DataFrame(index=counts_df.index)
    for pos, c in enumerate([group] + list(extra), start=1):
        meta[c] = [(str(s).split("|")[pos] if len(str(s).split("|")) > pos else "") for s in counts_df.index]
    return counts_df, meta


def _deseq_p(counts_df, meta, factors, group, ref, alt, gene):
    """One PyDESeq2 refit. Returns the p-value for ``gene`` under the group
    contrast, or None when the gene dropped out or the fit did not converge."""
    import numpy as np
    from pydeseq2.dds import DeseqDataSet
    from pydeseq2.ds import DeseqStats

    dds = DeseqDataSet(counts=counts_df, metadata=meta, design_factors=list(factors), quiet=True)
    dds.deseq2()
    st = DeseqStats(dds, contrast=[group, alt, ref], quiet=True)
    st.summary()
    res = st.results_df
    if gene in res.index:
        p = float(res.loc[gene, "pvalue"])
        return p if np.isfinite(p) else None
    return None


# ── per-unit linear model (the fallback when PyDESeq2 is absent) ──────────────
def _ols_coef_p(X, y, j):
    """Two-sided p-value for coefficient ``j`` of the least-squares fit ``y ~ X``."""
    import numpy as np

    n, k = X.shape
    dof = n - k
    if dof <= 0:
        return None
    try:
        XtX_inv = np.linalg.inv(X.T @ X)
    except np.linalg.LinAlgError:
        return None
    beta = XtX_inv @ (X.T @ y)
    resid = y - X @ beta
    sigma2 = float(resid @ resid) / dof
    var_j = sigma2 * float(XtX_inv[j, j])
    if var_j <= 0:
        return 1.0
    t = float(beta[j]) / (var_j ** 0.5)
    try:
        from scipy.stats import t as tdist

        return float(2.0 * tdist.sf(abs(t), dof))
    except Exception:
        from math import erfc, sqrt

        return float(erfc(abs(t) / sqrt(2.0)))


def _dummies(labels):
    """Drop-first one-hot encoding of a categorical vector."""
    import numpy as np

    levels = list(dict.fromkeys(str(v) for v in labels))
    if len(levels) < 2:
        return np.zeros((len(labels), 0))
    idx = {v: i for i, v in enumerate(levels)}
    oh = np.zeros((len(labels), len(levels)))
    for i, v in enumerate(labels):
        oh[i, idx[str(v)]] = 1.0
    return oh[:, 1:]


def _factor_collinear(meta, a, b):
    """True when two factor columns of a pseudobulk meta table are perfectly
    nested, so an adjusted fit would be rank deficient."""
    import pandas as pd

    tab = pd.crosstab(meta[a], meta[b]).to_numpy()
    return _is_collinear(tab)


def _unit_cpm_values(counts, units, groups, gi, ref, alt):
    """Per-unit log1p CPM of one gene, summed within each unit first. Returns the
    reference-arm values and the alternate-arm values, the two samples a
    replicate-level Welch test compares."""
    import numpy as np

    ref_vals, alt_vals = [], []
    for u in np.unique(units):
        sel = units == u
        summed = counts[sel].sum(0).astype(float)
        val = float(_cpm_log1p(summed)[0, gi])
        grp = groups[sel][0]
        if grp == ref:
            ref_vals.append(val)
        elif grp == alt:
            alt_vals.append(val)
    return np.asarray(ref_vals), np.asarray(alt_vals)


def _two_factor_unit_pvalues(sub, unit, interest, other, gene, ref, alt, allow_adjusted):
    """Naive and adjusted p-values for ``gene``, both at the replicate level.

    Naive fits ``~ interest``; adjusted fits ``~ interest + other``. Both run on
    the same pseudobulk samples, so this never compares a cell-level p to a
    unit-level p. PyDESeq2 first, else a per-unit linear model on log1p CPM.
    Returns ``(naive_p, adjusted_p_or_None, method_label)``.
    """
    try:
        counts_df, meta = _pseudobulk(sub, unit, interest, [other])
        naive = _deseq_p(counts_df, meta, [interest], interest, ref, alt, gene)
        if naive is not None:
            adjusted = None
            if allow_adjusted and other in meta.columns and meta[other].nunique() > 1 and not _factor_collinear(
                meta, interest, other
            ):
                adjusted = _deseq_p(counts_df, meta, [interest, other], interest, ref, alt, gene)
            return naive, adjusted, "pseudobulk sum + PyDESeq2"
    except Exception:
        pass
    return _ols_two_factor_unit(sub, unit, interest, other, gene, ref, alt, allow_adjusted)


def _ols_two_factor_unit(sub, unit, interest, other, gene, ref, alt, allow_adjusted):
    import numpy as np

    counts, names = _raw_counts(sub)
    gi = names.index(gene) if gene in names else 0
    u = _col(sub, unit)
    iv = _col(sub, interest)
    cv = _col(sub, other)
    keep = (iv == str(ref)) | (iv == str(alt))
    u, iv, cv = u[keep], iv[keep], cv[keep]
    M = _cpm_log1p(counts[keep])

    samples = {}
    for i in range(M.shape[0]):
        samples.setdefault((u[i], iv[i], cv[i]), []).append(i)
    rows, i_lab, c_lab = [], [], []
    for combo, ids in samples.items():
        rows.append(M[ids].mean(0))
        i_lab.append(combo[1])
        c_lab.append(combo[2])
    Y = np.vstack(rows) if rows else np.zeros((0, M.shape[1]))
    i_arr = np.asarray(i_lab)
    c_arr = np.asarray(c_lab)
    y = Y[:, gi]
    n = Y.shape[0]

    dummy = (i_arr == str(alt)).astype(float).reshape(-1, 1)
    Xn = np.hstack([np.ones((n, 1)), dummy])
    naive = _ols_coef_p(Xn, y, 1)
    adjusted = None
    if allow_adjusted:
        block = _dummies(c_arr)
        Xh = np.hstack([Xn, block])
        if n >= Xh.shape[1] + 1 and int(np.linalg.matrix_rank(Xh)) == Xh.shape[1]:
            adjusted = _ols_coef_p(Xh, y, 1)
    return naive, adjusted, "per-unit OLS on log1p CPM"


# ── clustering: embedding, sweep, and scoring ────────────────────────────────
def _pca(log, seed):
    """A deterministic PCA embedding of a log-expression matrix. sklearn with the
    full SVD solver, else a numpy SVD, both deterministic."""
    import numpy as np

    Xc = np.asarray(log, dtype=float)
    Xc = Xc - Xc.mean(0)
    try:
        from sklearn.decomposition import PCA

        n_comp = int(min(30, max(2, min(Xc.shape) - 1)))
        return PCA(n_components=n_comp, svd_solver="full", random_state=int(seed)).fit_transform(Xc)
    except Exception:
        n_comp = int(min(30, max(2, min(Xc.shape) - 1)))
        U, S, _ = np.linalg.svd(Xc, full_matrices=False)
        return U[:, :n_comp] * S[:n_comp]


def _lognorm(counts):
    """Library-size-normalized log expression: counts per 10k, then log1p.

    Each cell is divided by its own library size (its total counts), rescaled to
    a common depth of 10,000 counts, then log1p'd. This is the depth-normalized
    space a PCA embedding has to be built in. Clustering on raw ``log1p(counts)``
    instead lets sequencing depth drive the embedding: cells group by how deeply
    they were sequenced rather than by what they express, which makes a continuum
    read as a stable population and hides fragile clusters. The library size is
    floored at 1 so an all-zero cell maps to zero instead of dividing by zero.
    """
    import numpy as np

    C = np.asarray(counts, dtype=np.float64)
    lib = C.sum(axis=1, keepdims=True)
    return np.log1p(C / np.clip(lib, 1.0, None) * 1e4)


def _embed(adata, seed):
    """Depth-normalized PCA embedding, computed once and reused across the whole
    resolution sweep so every setting is clustered in the same space.

    It runs on ``_lognorm`` output. A raw ``log1p(counts)`` embedding is driven by
    sequencing depth, so a continuum looks like a stable population and fragile
    clusters go unseen. See ``_lognorm``.
    """
    counts, _ = _raw_counts(adata)
    return _pca(_lognorm(counts), seed)


def _reconcile_engine(engines: list) -> str:
    """One honest label for a sweep from the per-resolution engines ``_cluster``
    actually used. All resolutions normally run the same backend, but if leiden
    ran on some and fell back on others (an intermittent runtime failure), the
    sweep is no longer a pure Leiden result, so the fallback is reported. Reporting
    the truth is what lets a silent Leiden -> KMeans downgrade stay visible."""
    seen = list(dict.fromkeys(engines))
    if not seen:
        return ""
    if len(seen) == 1:
        return seen[0]
    fell_back = [e for e in seen if "Leiden" not in e]
    return fell_back[0] if fell_back else seen[0]


def _cluster(emb, res, seed):
    """Cluster an embedding at one resolution, for the resolution sweeps (checks
    3 and 7). Returns ``(labels, engine)`` where ``engine`` names the backend that
    ACTUALLY produced the labels: "Leiden (scanpy)" when the leiden call ran,
    "KMeans (fallback)" when it did not, or the binning fallback. The engine is
    tied to execution, not to importability, so a leiden call that raises at
    runtime (a stack present but incompatible) reports the KMeans it fell back to
    rather than the Leiden it did not run.

    scanpy Leiden at the resolution when a graph backend is installed, else
    deterministic KMeans, else a first-component binning so the code still runs.
    Every path is seeded.

    Leiden reads a resolution directly. When it is absent the KMeans and binning
    fallbacks still have to turn a resolution into a cluster count, so the sweep
    keeps moving from coarse to fine. They use a linear calibration of leiden's
    roughly linear resolution-to-cluster-count curve: about 3 clusters at the low
    end of the sweep, about 4 more for each added unit of resolution. The
    constants are a rough calibration to leiden on moderate single-cell data, and
    what the sweep needs from them is a monotone coarse-to-fine ordering, which
    they give. For a target cluster count instead of a resolution (check 2), use
    ``_cluster_to_k``.
    """
    import numpy as np

    emb = np.asarray(emb, dtype=float)
    n = emb.shape[0]
    # Resolution to cluster count for the non-leiden fallbacks (see the docstring).
    k = int(max(2, min(int(round(3 + float(res) * 4)), n - 1)))
    try:
        import igraph  # noqa: F401
        import leidenalg  # noqa: F401
        import anndata as ad
        import scanpy as sc

        a = ad.AnnData(X=emb.copy())
        sc.pp.neighbors(a, use_rep="X", n_neighbors=15, random_state=int(seed))
        sc.tl.leiden(
            a,
            resolution=float(res),
            random_state=int(seed),
            key_added="_rl",
            flavor="igraph",
            n_iterations=2,
            directed=False,
        )
        return a.obs["_rl"].astype(str).to_numpy(), "Leiden (scanpy)"
    except Exception:
        pass
    try:
        from sklearn.cluster import KMeans

        return KMeans(n_clusters=k, n_init=10, random_state=int(seed)).fit_predict(emb).astype(str), "KMeans (fallback)"
    except Exception:
        pc = emb[:, 0] if emb.ndim == 2 and emb.shape[1] else np.zeros(n)
        order = np.argsort(pc, kind="mergesort")
        lab = np.zeros(n, dtype=int)
        for b in range(k):
            lab[order[b * n // k : (b + 1) * n // k]] = b
        return lab.astype(str), "first-component bins (fallback)"


# Bounds for bisecting a leiden resolution to a target cluster count (check 2).
_K_MATCH_LO, _K_MATCH_HI, _K_MATCH_STEPS = 0.02, 2.0, 8
# When the grouping the claim names is absent, cluster the discovery half to this
# many groups, a generic default for a coarse cell-population map.
_CLAIM_K_FALLBACK = 8


def _cluster_to_k(emb, k, seed):
    """Cluster an embedding into ``k`` groups, where ``k`` is the granularity the
    claim implies (the number of levels in the grouping the scientist named).

    check 2 needs a fixed cluster count. Leiden takes a resolution, so this
    bisects the resolution until the leiden cluster count equals ``k`` (bounded
    iterations, seeded), and returns the closest count it reached when no
    resolution lands on ``k`` exactly. KMeans takes ``k`` directly, and the
    binning fallback splits into ``k`` bins. Every backend targets the same
    ``k``, so the verdict does not depend on which one is installed.

    A fixed resolution instead over-partitions the discovery half, and
    ``_best_cluster`` then locks onto a fragment of the named group. The claimed
    markers score near chance against that fragment, and a clean analysis gets
    flagged. Every path is seeded.
    """
    import numpy as np

    emb = np.asarray(emb, dtype=float)
    n = emb.shape[0]
    k = int(max(2, min(int(k), n - 1)))
    try:
        import igraph  # noqa: F401
        import leidenalg  # noqa: F401
        import anndata as ad
        import scanpy as sc

        a = ad.AnnData(X=emb.copy())
        sc.pp.neighbors(a, use_rep="X", n_neighbors=15, random_state=int(seed))

        def _leiden_res(res):
            sc.tl.leiden(
                a,
                resolution=float(res),
                random_state=int(seed),
                key_added="_rl",
                flavor="igraph",
                n_iterations=2,
                directed=False,
            )
            return a.obs["_rl"].astype(str).to_numpy()

        lo, hi = _K_MATCH_LO, _K_MATCH_HI
        best_lab, best_gap = None, None
        for _ in range(_K_MATCH_STEPS):
            mid = (lo + hi) / 2.0
            lab = _leiden_res(mid)
            got = int(np.unique(lab).size)
            gap = abs(got - k)
            if best_gap is None or gap < best_gap:
                best_lab, best_gap = lab, gap
            if got == k:
                return lab
            if got > k:
                hi = mid
            else:
                lo = mid
        if best_lab is not None:
            return best_lab
    except Exception:
        pass
    try:
        from sklearn.cluster import KMeans

        return KMeans(n_clusters=k, n_init=10, random_state=int(seed)).fit_predict(emb).astype(str)
    except Exception:
        pc = emb[:, 0] if emb.ndim == 2 and emb.shape[1] else np.zeros(n)
        order = np.argsort(pc, kind="mergesort")
        lab = np.zeros(n, dtype=int)
        for b in range(k):
            lab[order[b * n // k : (b + 1) * n // k]] = b
        return lab.astype(str)


def _silhouette(emb, labels, seed):
    """Silhouette score of a labelling, subsampled to 2000 cells with the seed
    when larger. None on a degenerate labelling (one cluster, or one per cell)."""
    import numpy as np

    labels = np.asarray(labels)
    k = int(np.unique(labels).size)
    n = int(labels.shape[0])
    if k < 2 or k >= n:
        return None
    try:
        from sklearn.metrics import silhouette_score

        emb = np.asarray(emb)
        if n > 2000:
            idx = np.random.default_rng(int(seed)).choice(n, 2000, replace=False)
            return float(silhouette_score(emb[idx], labels[idx]))
        return float(silhouette_score(emb, labels))
    except Exception:
        return None


def _pairwise_ari(labels):
    import numpy as np

    try:
        from sklearn.metrics import adjusted_rand_score

        return [float(adjusted_rand_score(labels[i], labels[i + 1])) for i in range(len(labels) - 1)]
    except Exception:
        return [float("nan")] * max(0, len(labels) - 1)


def _per_res_ari(pairs, n):
    import numpy as np

    vals = []
    for i in range(n):
        near = []
        if 0 <= i - 1 < len(pairs):
            near.append(pairs[i - 1])
        if i < len(pairs):
            near.append(pairs[i])
        near = [x for x in near if x is not None and np.isfinite(x)]
        vals.append(float(np.mean(near)) if near else None)
    return vals


def _scores(emb, labels, criterion, seed):
    """A quality score per resolution: silhouette on the embedding, or the mean
    adjacent-pair ARI stability around each setting."""
    if criterion == "silhouette":
        return [_silhouette(emb, l, seed) for l in labels]
    return _per_res_ari(_pairwise_ari(labels), len(labels))


def _grid(lo, hi, step):
    """The resolution grid, inclusive of the endpoint within floating tolerance."""
    lo, hi, step = float(lo), float(hi), float(step)
    if step <= 0:
        step = 0.2
    out, r = [], lo
    while r <= hi + 1e-9:
        out.append(round(r, 4))
        r += step
    return out or [lo]


def _present(label_vec, tracked):
    """Is the tracked group a discrete cluster at this setting? True when one
    cluster both holds most of the group (coverage) and is mostly the group
    (purity)."""
    import numpy as np

    total = float(tracked.sum())
    if total == 0:
        return False
    for lbl in np.unique(label_vec):
        c = label_vec == lbl
        inter = float(np.logical_and(c, tracked).sum())
        coverage = inter / total
        purity = inter / float(c.sum()) if c.sum() else 0.0
        if coverage >= 0.5 and purity >= 0.5:
            return True
    return False


def _find_track_col(adata, track):
    """The obs column whose levels include the tracked group name."""
    obs = getattr(adata, "obs", None)
    if obs is None or not track:
        return None
    for col in obs.columns:
        try:
            if str(track) in set(str(v) for v in obs[col].unique()):
                return str(col)
        except Exception:
            continue
    return None


def _best_cluster(labels, tracked):
    """The train-half cluster that best matches the claimed group (Jaccard), as a
    0/1 membership vector. Falls back to the largest cluster."""
    import numpy as np

    if tracked is None or float(tracked.sum()) == 0:
        vals, counts = np.unique(labels, return_counts=True)
        return (labels == vals[int(np.argmax(counts))]).astype(int)
    best, best_j = None, -1.0
    for lbl in np.unique(labels):
        c = labels == lbl
        inter = float(np.logical_and(c, tracked).sum())
        union = float(np.logical_or(c, tracked).sum())
        j = inter / union if union > 0 else 0.0
        if j > best_j:
            best, best_j = lbl, j
    return (labels == best).astype(int)


# ═════════════════════════════════════════════════════════════════════════════
# The eight kernels. Each return dict's keys are exactly the check's
# Evidence.numbers keys, so one dict feeds the chart, the preview, and the script.
# ═════════════════════════════════════════════════════════════════════════════


def check1_pseudoreplication(adata, unit, grouping, ref, alt, gene, covariates, alpha):
    """Pseudoreplication re-test.

    ``original`` is the naive cell-level Welch test on the audited gene. ``corrected``
    aggregates cells to one profile per replicate and re-tests with PyDESeq2 (a
    Welch t on the per-unit log1p CPM when the count-model stack is absent). The
    two-replicate-per-group hard stop belongs to the module, not here.
    """
    import numpy as np

    counts, names = _raw_counts(adata)
    groups = _col(adata, grouping)
    units = _col(adata, unit)
    keep = (groups == str(ref)) | (groups == str(alt))
    C = counts[keep]
    g = groups[keep]
    u = units[keep]
    m0 = g == str(ref)
    m1 = g == str(alt)

    gname, gi = _pick_gene(C, names, m0, m1, gene, log=True)
    expr = np.log1p(np.clip(C[:, gi].astype(float), 0, None))
    p_naive = _welch(expr[m0], expr[m1])

    n_cells = int(keep.sum())
    n_units = int(len({(uu, gg) for uu, gg in zip(u.tolist(), g.tolist())}))
    icc = _icc(expr, u)

    p_honest, method = None, ""
    covs = [str(c) for c in (covariates or [])]
    try:
        sub = _subset(adata, keep)
        counts_df, meta = _pseudobulk(sub, unit, grouping, covs)
        factors = [grouping] + [c for c in covs if c in meta.columns and meta[c].nunique() > 1]
        p_honest = _deseq_p(counts_df, meta, factors, grouping, str(ref), str(alt), gname)
        if p_honest is not None:
            method = "pseudobulk sum + PyDESeq2"
    except Exception:
        p_honest = None
    if p_honest is None:
        ref_vals, alt_vals = _unit_cpm_values(C, u, g, gi, str(ref), str(alt))
        p_honest = _welch(ref_vals, alt_vals)
        method = "pseudobulk sum + Welch on per-unit log1p CPM"

    return {
        "original": _num(p_naive),
        "corrected": _num(p_honest),
        "n_cells": n_cells,
        "n_units": n_units,
        "icc": _round(icc, 4),
        "method": method,
    }


def check2_double_dipping(adata, grouping, target_group, markers, split, seed):
    """Double-dipping held-out re-test.

    Poisson thinning splits the counts into two independent halves. The group is
    re-clustered on the discovery half, then the claimed markers are scored on the
    held-out half. ``original`` and ``corrected`` are the mean discovery and mean
    held-out AUC across markers, so they equal the groups chart's discAUC and
    holdAUC exactly.
    """
    import numpy as np

    counts, names = _raw_counts(adata)
    C = np.rint(np.clip(counts, 0, None)).astype(np.int64)
    gen = np.random.default_rng(int(seed))
    train = gen.binomial(C, float(split))
    test = C - train

    # Depth-normalize the discovery half on its own library sizes before PCA. The
    # thinned half carries about half the original depth, so a raw-count embedding
    # would cluster by depth instead of by expression. See _lognorm.
    emb = _pca(_lognorm(train.astype(float)), seed)
    # Cluster to the granularity the claim implies: k is the number of levels in
    # the grouping the scientist named, so _best_cluster matches the whole named
    # group instead of a fragment of it. A hardcoded resolution over-partitions
    # here and flags a clean analysis. See _cluster_to_k.
    grp = _col(adata, grouping)
    k = int(np.unique(grp).size) if grp is not None else _CLAIM_K_FALLBACK
    labels_train = _cluster_to_k(emb, k, seed)
    tracked = (grp == str(target_group)) if grp is not None else None
    y = _best_cluster(labels_train, tracked)

    log_tr = np.log1p(train.astype(float))
    log_te = np.log1p(test.astype(float))
    # No markers named: derive the group's own top markers by discovery AUC on the
    # discovery half, so the held-out re-test validates the genes that actually
    # define the cluster. Without this the loop scores nothing, hold_mean defaults
    # to 0.5, and a genuine cluster is flagged for lack of input rather than for
    # failing to replicate. Mirrors pillars/double_dipping's empty-marker path.
    marker_names = [str(x) for x in (markers or [])]
    if not marker_names:
        disc_all = np.array([_auc(log_tr[:, j], y) for j in range(log_tr.shape[1])])
        marker_names = [str(names[j]) for j in np.argsort(-disc_all)[:4]]
    report, discs, holds, surviving = {}, [], [], 0
    for m in marker_names:
        if m not in names:
            report[m] = {"disc": None, "hold": None, "survives": False}
            continue
        j = names.index(m)
        disc = _auc(log_tr[:, j], y)
        hold = _auc(log_te[:, j], y)
        surv = bool(np.isfinite(hold) and hold >= 0.60)
        surviving += int(surv)
        report[m] = {"disc": _round(disc, 4), "hold": _round(hold, 4), "survives": surv}
        discs.append(disc)
        holds.append(hold)

    disc_mean = float(np.mean(discs)) if discs else 0.5
    hold_mean = float(np.mean(holds)) if holds else 0.5
    return {
        "original": _round(disc_mean, 4),
        "corrected": _round(hold_mean, 4),
        "markers": report,
        "surviving": int(surviving),
    }


def check3_fragility(adata, track, track_column, min_res, max_res, step, seed):
    """Clustering-fragility re-test.

    Sweep the resolution and record, at each setting, whether the tracked group
    survives as a discrete cluster. The stability fraction is the share of
    settings where it does. This chart carries no supported window, so the honest
    corrected statistic is that fraction, and ``original`` and ``corrected`` are
    the same number.
    """
    import numpy as np

    resolutions = _grid(min_res, max_res, step)
    emb = _embed(adata, seed)
    pairs = [_cluster(emb, r, seed) for r in resolutions]
    labels = [lab for lab, _ in pairs]
    engine = _reconcile_engine([eng for _, eng in pairs])
    clusters = [int(np.unique(l).size) for l in labels]

    col = str(track_column) if track_column else _find_track_col(adata, track)
    tracked = None
    if col:
        c = _col(adata, col)
        if c is not None:
            tracked = c == str(track)

    steps, present_res = [], []
    for i, r in enumerate(resolutions):
        pres = _present(labels[i], tracked) if tracked is not None else False
        steps.append({"r": float(r), "present": bool(pres), "clusters": clusters[i]})
        if pres:
            present_res.append(float(r))

    stability = (len(present_res) / len(resolutions)) if resolutions else 0.0
    lo = min(present_res) if present_res else float(min_res)
    hi = max(present_res) if present_res else float(min_res)
    return {
        "original": _round(stability, 4),
        "corrected": _round(stability, 4),
        "present_lo": float(lo),
        "present_hi": float(hi),
        "steps": steps,
        "engine": engine,
    }


def check4_confounding(adata, interest, technical, gene, unit, alpha):
    """Confounding separability test.

    Cross-tabulate the effect of interest against the technical variable. When
    they are perfectly nested (Cramer's V at 1 or a rank-deficient design) the
    comparison cannot be rescued from this data: ``corrected`` is None,
    ``unsalvageable`` is True, and no adjusted number is invented. When separable,
    ``original`` is the replicate-level ``~ interest`` effect and ``corrected`` is
    the replicate-level ``~ interest + technical`` effect for the audited gene.
    """
    import pandas as pd

    inter = _col(adata, interest)
    tech = _col(adata, technical)
    ref, alt = _two_levels(inter)
    keep = (inter == ref) | (inter == alt)
    tab = pd.crosstab(pd.Series(inter[keep]), pd.Series(tech[keep])).to_numpy()
    v = _cramers_v(tab)
    collinear = _is_collinear(tab) or float(v) >= 0.995

    counts, names = _raw_counts(adata)
    C = counts[keep]
    g = inter[keep]
    m0 = g == ref
    m1 = g == alt
    gname, _ = _pick_gene(C, names, m0, m1, gene, log=True)

    sub = _subset(adata, keep)
    naive_p, adjusted_p, method = _two_factor_unit_pvalues(
        sub, unit, interest, technical, gname, ref, alt, allow_adjusted=not collinear
    )
    if collinear:
        adjusted_p = None
    return {
        "original": _num(naive_p),
        "corrected": _num(adjusted_p),
        "cramers_v": _round(v, 4),
        "unsalvageable": bool(collinear),
        "method": method,
    }


def check5_multiple_testing(adata, unit, grouping, ref, alt, alpha, method, tests):
    """Multiple-testing correction.

    Aggregate to the replicate level first (pseudobulk mean of log1p CPM) when a
    unit column is given, run a per-gene Welch across units, then Benjamini-Hochberg.
    ``original`` is the count of raw hits (p below alpha), ``corrected`` the count
    that survive FDR control (q below alpha). ``tests`` is recomputed from the genes
    actually tested, after dropping the all-zero genes.
    """
    import numpy as np

    counts, names = _raw_counts(adata)
    groups = _col(adata, grouping)
    keep = (groups == str(ref)) | (groups == str(alt))
    C = counts[keep]
    g = groups[keep]

    expressed = np.asarray(C.sum(0) > 0).ravel()
    idx = np.nonzero(expressed)[0]
    gene_names = [names[i] for i in idx]
    M = _cpm_log1p(C[:, idx])

    units = _col(adata, unit)
    if units is not None:
        u = units[keep]
        buckets = {}
        for i in range(M.shape[0]):
            buckets.setdefault(u[i], []).append(i)
        rows, labels = [], []
        for uu, ids in buckets.items():
            rows.append(M[ids].mean(0))
            labels.append(g[ids[0]])
        P = np.vstack(rows) if rows else np.zeros((0, M.shape[1]))
        labels = np.asarray(labels)
        A = P[labels == str(ref)]
        B = P[labels == str(alt)]
    else:
        A = M[g == str(ref)]
        B = M[g == str(alt)]

    pvals = np.array([_welch(A[:, j], B[:, j]) for j in range(M.shape[1])]) if M.shape[1] else np.zeros(0)
    finite = np.isfinite(pvals)
    pv = pvals[finite]
    kept_names = [gene_names[j] for j in range(len(gene_names)) if finite[j]]
    n_tests = int(pv.size)

    by = str(method).lower() in ("by", "fdr_by")
    _, q = _bh(pv, float(alpha), by)
    raw_hits = int(np.sum(pv < float(alpha)))
    adj_hits = int(np.sum(q < float(alpha)))

    order = list(np.argsort(pv)[:25])
    top = [
        {"gene": kept_names[k], "p": float(pv[k]), "q": float(q[k]), "survives": bool(q[k] < float(alpha))}
        for k in order
    ]
    return {
        "original": raw_hits,
        "corrected": adj_hits,
        "tests": n_tests,
        "alpha": float(alpha),
        "top": top,
    }


def check6_unmodeled_covariate(adata, interest, covariate, ref, alt, unit, gene, alpha):
    """Unmodeled-covariate re-test.

    Both fits run at the replicate level, so a cell-level naive is never compared
    to a unit-level adjusted. ``original`` is the ``~ interest`` effect and
    ``corrected`` the ``~ interest + covariate`` effect for the audited gene. When
    the covariate carries no separable information at the unit level the adjusted
    value equals the naive one.
    """
    import pandas as pd

    inter = _col(adata, interest)
    cov = _col(adata, covariate)
    keep = (inter == str(ref)) | (inter == str(alt))
    tab = pd.crosstab(pd.Series(inter[keep]), pd.Series(cov[keep])).to_numpy()
    v = _cramers_v(tab)

    counts, names = _raw_counts(adata)
    C = counts[keep]
    g = inter[keep]
    m0 = g == str(ref)
    m1 = g == str(alt)
    gname, _ = _pick_gene(C, names, m0, m1, gene, log=True)

    sub = _subset(adata, keep)
    naive_p, adjusted_p, method = _two_factor_unit_pvalues(
        sub, unit, interest, covariate, gname, str(ref), str(alt), allow_adjusted=True
    )
    if adjusted_p is None:
        adjusted_p = naive_p
    return {
        "original": _num(naive_p),
        "corrected": _num(adjusted_p),
        "cramersV": _round(v, 4),
        "method": method,
    }


def check7_resolution_choice(adata, min_res, max_res, step, criterion, chosen, seed):
    """Resolution-choice re-test.

    Sweep the resolution on one fixed embedding and seed, score each setting by
    the criterion (silhouette, else adjacent-pair ARI), and read off the supported
    window: the contiguous run of resolutions around the criterion peak whose score
    stays within 0.02 of the maximum. ``corrected`` is the coarsest supported
    resolution (supportedLo), which reports the fewest clusters the evidence
    allows. ``original`` is the resolution that was chosen.
    """
    import numpy as np

    resolutions = _grid(min_res, max_res, step)
    emb = _embed(adata, seed)
    # _cluster returns (labels, engine); this check reads the cluster counts only.
    labels = [lab for lab, _ in (_cluster(emb, r, seed) for r in resolutions)]
    clusters = [int(np.unique(l).size) for l in labels]
    crit = str(criterion).lower()
    if crit not in ("silhouette", "ari"):
        crit = "silhouette"
    scores = _scores(emb, labels, crit, seed)

    finite = [i for i, s in enumerate(scores) if s is not None and np.isfinite(s)]
    if finite:
        best = max(finite, key=lambda i: scores[i])
        thr = scores[best] - 0.02
        lo = hi = best
        while lo - 1 >= 0 and scores[lo - 1] is not None and np.isfinite(scores[lo - 1]) and scores[lo - 1] >= thr:
            lo -= 1
        while hi + 1 < len(scores) and scores[hi + 1] is not None and np.isfinite(scores[hi + 1]) and scores[hi + 1] >= thr:
            hi += 1
        s_lo, s_hi, best_res = resolutions[lo], resolutions[hi], resolutions[best]
    else:
        s_lo, s_hi, best_res = resolutions[0], resolutions[-1], float(chosen)

    steps = [
        {
            "r": float(resolutions[i]),
            "clusters": clusters[i],
            "score": (None if scores[i] is None or not np.isfinite(scores[i]) else round(float(scores[i]), 4)),
            "present": bool(s_lo <= resolutions[i] <= s_hi),
        }
        for i in range(len(resolutions))
    ]
    return {
        "original": float(chosen),
        "corrected": float(s_lo),
        "supportedLo": float(s_lo),
        "supportedHi": float(s_hi),
        "criterion": crit,
        "best": float(best_res),
        "steps": steps,
    }


def check8_test_assumptions(adata, grouping, ref, alt, unit, gene, claimed_test, alpha):
    """Test-assumption mismatch re-test.

    ``original`` reproduces the error being caught: the claimed test run as claimed,
    a Welch t-test on the raw per-cell counts of the audited gene. ``corrected``
    re-runs with a count-aware model, a negative-binomial GLM on pseudobulk via
    PyDESeq2 (a Welch on per-unit log1p CPM when that stack is absent).
    ``overdispersion`` is the mean variance-over-mean across the expressed genes,
    which is why a Gaussian test on raw counts misstates significance.
    """
    import numpy as np

    counts, names = _raw_counts(adata)
    groups = _col(adata, grouping)
    keep = (groups == str(ref)) | (groups == str(alt))
    C = counts[keep]
    g = groups[keep]
    m0 = g == str(ref)
    m1 = g == str(alt)

    gname, gi = _pick_gene(C, names, m0, m1, gene, log=False)
    raw_col = C[:, gi].astype(float)
    p_claimed = _welch(raw_col[m0], raw_col[m1])

    Cf = C.astype(float)
    mean = Cf.mean(0)
    var = Cf.var(0)
    ok = mean > 0
    overdisp = float(np.mean(var[ok] / mean[ok])) if np.any(ok) else 1.0

    p_nb, method = None, ""
    try:
        sub = _subset(adata, keep)
        counts_df, meta = _pseudobulk(sub, unit, grouping, [])
        p_nb = _deseq_p(counts_df, meta, [grouping], grouping, str(ref), str(alt), gname)
        if p_nb is not None:
            method = "pseudobulk sum + PyDESeq2 negative binomial"
    except Exception:
        p_nb = None
    if p_nb is None:
        units = _col(adata, unit)
        u = units[keep] if units is not None else np.array(["all"] * int(keep.sum()))
        ref_vals, alt_vals = _unit_cpm_values(C, u, g, gi, str(ref), str(alt))
        p_nb = _welch(ref_vals, alt_vals)
        method = "Welch on per-unit log1p CPM"

    return {
        "original": _num(p_claimed),
        "corrected": _num(p_nb),
        "overdispersion": _round(overdisp, 4),
        "method": method,
    }


__all__ = [
    "check1_pseudoreplication",
    "check2_double_dipping",
    "check3_fragility",
    "check4_confounding",
    "check5_multiple_testing",
    "check6_unmodeled_covariate",
    "check7_resolution_choice",
    "check8_test_assumptions",
]
