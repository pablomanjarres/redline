"""Check 5 - Multiple-testing / FDR handling.

Significance claimed on raw p-values across a test that examined many genes, with
no multiple-testing correction. Extremely common in genome-wide differential
expression. The honest re-analysis computes a p-value per gene (Welch on log1p
counts, aggregated to pseudobulk when a unit role exists), then controls the
false discovery rate with Benjamini-Hochberg and reports how many of the raw
"hits" survive.

This is a real FDR correction (Benjamini & Hochberg 1995), not the count-split
evidence of check 2. It controls the expected proportion of false discoveries,
not the family-wise error rate. The caveat carries that limit with the result.

This module also hosts the small differential-expression helpers that checks 6
and 8 reuse (expression extraction, pseudobulk means, a vectorized Welch and OLS,
the BH wrapper, and the volcano builder). Heavy statistics stay lazy.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from ..contracts import (
    CLEAN,
    FIXABLE_NOW,
    FLAG_ONLY,
    FLAGGED,
    NEEDS_NEW_DATA,
    CorrectedCode,
    FdrGene,
    Knob,
    MethodRef,
    Recommendation,
    VolcanoPoint,
    fdr_chart,
    fmt_p,
    log10p,
    stat,
    volcano_chart,
)
from ..correction import kernels
from ..pillars import obs_series, two_groups
from .base import Candidate, CheckModule, Claim, Clean, Design, DetectResult, Evidence

_LN2 = float(np.log(2.0))
_MIN_TESTS = 20  # below this, multiplicity is not a material risk


def _fdr_chart_from_kernel(nums: dict, method: str) -> dict:
    """The FDR chart, straight from the kernel dict, so the reported rawHits and
    adjustedHits are the same numbers the emitted script prints."""
    top = [
        FdrGene(gene=str(r["gene"]), p=float(r["p"]), q=float(r["q"]), survives=bool(r["survives"]))
        for r in nums.get("top", [])
    ]
    return fdr_chart(
        int(nums["tests"]),
        float(nums["alpha"]),
        int(nums["original"]),
        int(nums["corrected"]),
        method if method in ("bh", "by") else "bh",
        top,
    )


# ── Shared differential-expression helpers (reused by checks 6 and 8) ─────────


def h5ad_hint(design: Design) -> str:
    return str(design.knob("h5ad") or "data.h5ad")


def expr_log1p(adata: Any) -> tuple[np.ndarray, list[str], str]:
    """A dense ``log1p`` expression matrix (cells x genes) and its source.

    Prefers raw integer counts (``log1p`` of counts); falls back to whatever
    ``.X`` holds when no counts are present, so the check degrades rather than
    crashing. The source string names which was used, for the caveat.
    """
    from .. import gating

    counts, source = gating.counts_array(adata)
    if counts is not None:
        var_names = [str(v) for v in getattr(adata, "var_names", range(counts.shape[1]))]
        return np.log1p(np.clip(counts, 0, None)).astype(float), var_names, source or "counts"
    X = getattr(adata, "X", None)
    dense = gating._to_dense(X) if X is not None else np.zeros((int(getattr(adata, "n_obs", 1)), 1))
    var_names = [str(v) for v in getattr(adata, "var_names", range(dense.shape[1]))]
    return np.asarray(dense, dtype=float), var_names, "X"


def raw_counts(adata: Any) -> tuple[Optional[np.ndarray], list[str]]:
    from .. import gating

    counts, _ = gating.counts_array(adata)
    if counts is None:
        return None, []
    var_names = [str(v) for v in getattr(adata, "var_names", range(counts.shape[1]))]
    return np.asarray(counts, dtype=float), var_names


def unit_group_means(M: np.ndarray, unit_vec: np.ndarray, mask: np.ndarray) -> tuple[list[str], np.ndarray]:
    """Mean expression per biological unit within one group. One row per unit."""
    ids: list[str] = []
    rows: list[np.ndarray] = []
    sub_units = unit_vec[mask]
    sub_M = M[mask]
    for u in dict.fromkeys(str(x) for x in sub_units):
        sel = sub_units.astype(str) == u
        if not sel.any():
            continue
        ids.append(u)
        rows.append(sub_M[sel].mean(axis=0))
    if not rows:
        return [], np.zeros((0, M.shape[1]))
    return ids, np.vstack(rows)


def group_matrices(
    M: np.ndarray, unit_vec: Optional[np.ndarray], ref_mask: np.ndarray, alt_mask: np.ndarray
) -> tuple[np.ndarray, np.ndarray, bool, list[str], list[str]]:
    """Two observation matrices for the comparison.

    When a unit role resolves to two or more units per group, aggregate to
    per-unit pseudobulk means (the honest observation level). Otherwise fall back
    to cell-level rows and report that fallback to the caller (``pseudobulk`` is
    False), which the caveat then names.
    """
    if unit_vec is not None:
        ref_ids, A = unit_group_means(M, unit_vec, ref_mask)
        alt_ids, B = unit_group_means(M, unit_vec, alt_mask)
        if A.shape[0] >= 2 and B.shape[0] >= 2:
            return A, B, True, ref_ids, alt_ids
    A = M[ref_mask]
    B = M[alt_mask]
    ref_ids = [f"cell{i}" for i in range(A.shape[0])]
    alt_ids = [f"cell{i}" for i in range(B.shape[0])]
    return A, B, False, ref_ids, alt_ids


def _t_sf(x: np.ndarray, df: Any) -> np.ndarray:
    """One-sided upper-tail of the t distribution, scipy when present else normal."""
    try:
        from scipy.stats import t as _tdist

        return np.asarray(_tdist.sf(x, df), dtype=float)
    except Exception:
        from math import erfc, sqrt

        return 0.5 * np.asarray([erfc(float(z) / sqrt(2.0)) for z in np.ravel(x)], dtype=float).reshape(np.shape(x))


def welch_p(A: np.ndarray, B: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorized Welch t-test across genes. Returns ``(p, mean_ref, mean_alt)``."""
    A = np.asarray(A, dtype=float)
    B = np.asarray(B, dtype=float)
    na, nb = A.shape[0], B.shape[0]
    ma = A.mean(axis=0) if na else np.zeros(A.shape[1])
    mb = B.mean(axis=0) if nb else np.zeros(B.shape[1])
    if na < 2 or nb < 2:
        return np.ones(A.shape[1]), ma, mb
    va = A.var(axis=0, ddof=1)
    vb = B.var(axis=0, ddof=1)
    sea = va / na
    seb = vb / nb
    se = np.sqrt(sea + seb)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(se > 0, (mb - ma) / se, 0.0)
        denom = (sea**2) / (na - 1) + (seb**2) / (nb - 1)
        df = np.where(denom > 0, (sea + seb) ** 2 / denom, float(na + nb - 2))
    p = _t_sf(np.abs(t), df) * 2.0
    p = np.clip(np.nan_to_num(p, nan=1.0), 1e-300, 1.0)
    return p, ma, mb


def ols_p(X: np.ndarray, Y: np.ndarray, coef: int) -> np.ndarray:
    """Per-gene p-value for coefficient ``coef`` of a linear model ``Y ~ X``.

    Fully vectorized across the columns of ``Y`` (one gene per column), so a
    covariate-adjusted fit over the whole gene panel is a single least-squares
    solve. This is the per-unit two-way comparison the fallback path uses.
    """
    X = np.asarray(X, dtype=float)
    Y = np.asarray(Y, dtype=float)
    n, k = X.shape
    XtX_inv = np.linalg.pinv(X.T @ X)
    beta = XtX_inv @ (X.T @ Y)  # (k, g)
    resid = Y - X @ beta
    dof = max(n - k, 1)
    sigma2 = np.sum(resid**2, axis=0) / dof
    se = np.sqrt(np.clip(sigma2 * float(XtX_inv[coef, coef]), 0.0, None))
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(se > 0, beta[coef] / se, 0.0)
    p = _t_sf(np.abs(t), dof) * 2.0
    return np.clip(np.nan_to_num(p, nan=1.0), 1e-300, 1.0)


def bh(pvals: np.ndarray, alpha: float, method: str) -> tuple[np.ndarray, np.ndarray]:
    """FDR-adjusted q-values. statsmodels first, then the house BH, then inline.

    Matches the scipy-then-manual pattern used across the pillars: prefer the
    library, fall back to Redline's own audited Benjamini-Hochberg, and keep a
    final inline path so the surface never crashes on a missing dependency.
    """
    pvals = np.asarray(pvals, dtype=float)
    try:
        from statsmodels.stats.multitest import multipletests

        _, q, _, _ = multipletests(pvals, alpha=alpha, method=("fdr_bh" if method == "bh" else "fdr_by"))
        q = np.asarray(q, dtype=float)
        return q < alpha, q
    except Exception:
        pass
    try:
        from ..correction.stats import benjamini_hochberg

        _, q = benjamini_hochberg(pvals, alpha, method)
        q = np.asarray(q, dtype=float)
        return q < alpha, q
    except Exception:
        pass
    return _bh_inline(pvals, alpha, method)


def _bh_inline(pvals: np.ndarray, alpha: float, method: str) -> tuple[np.ndarray, np.ndarray]:
    p = np.asarray(pvals, dtype=float)
    n = p.size
    q_out = np.full(n, np.nan)
    finite = np.isfinite(p)
    idx = np.nonzero(finite)[0]
    if idx.size == 0:
        return np.zeros(n, dtype=bool), q_out
    sub = p[idx]
    k = sub.size
    c = float(np.sum(1.0 / np.arange(1, k + 1))) if method == "by" else 1.0
    order = np.argsort(sub, kind="mergesort")
    ranked = sub[order]
    q_sorted = np.clip(np.minimum.accumulate((ranked * k * c / np.arange(1, k + 1))[::-1])[::-1], 0.0, 1.0)
    q_sub = np.empty(k)
    q_sub[order] = q_sorted
    q_out[idx] = q_sub
    return q_out < alpha, q_out


def pick_target(p: np.ndarray) -> int:
    """Index of the most naively significant gene (the one to trace on a chart)."""
    p = np.asarray(p, dtype=float)
    if p.size == 0:
        return 0
    return int(np.argmin(np.nan_to_num(p, nan=1.0)))


def build_volcano(
    var_names: list[str],
    log2fc: np.ndarray,
    p_for_axis: np.ndarray,
    sig_all: np.ndarray,
    claimed: set[str],
    label: str,
    alpha: float,
    fc_threshold: float,
    limit: int = 200,
) -> dict:
    """A volcano from the honest model. ``p_for_axis`` is the value drawn on the
    y axis (a q-value for check 5, a model p for checks 6 and 8). ``sig_all``
    decides colour, and ``nSig`` counts every significant gene, not only the
    shown ones. Claimed genes are always included and marked."""
    neg = np.asarray([log10p(float(v)) for v in p_for_axis], dtype=float)
    n_sig = int(np.sum(sig_all))
    order = np.argsort(-neg)
    shown = list(order[: max(0, int(limit))])
    claimed_idx = [i for i, g in enumerate(var_names) if str(g) in claimed]
    for i in claimed_idx:
        if i not in shown:
            shown.append(i)
    points = [
        VolcanoPoint(
            gene=str(var_names[i]),
            log2fc=float(log2fc[i]),
            neg_log10_p=float(neg[i]),
            sig=bool(sig_all[i]),
            claimed=(str(var_names[i]) in claimed) or None,
        )
        for i in shown
    ]
    return volcano_chart(points, alpha, fc_threshold, n_sig, label)


def fallback_code(check_id: int, params: dict) -> CorrectedCode:
    """A safety net for correct() when the correction templates are not yet
    wired. The integrator's correction layer replaces this with the real,
    runnable, parameterized script. It is never the shipped path."""
    return CorrectedCode(
        filename=f"check_{int(check_id):02d}.py",
        inline=(
            "# The runnable correction template for this check is provided by the\n"
            "# correction layer. This placeholder only records the injected params.\n"
            f"PARAMS = {dict(params)!r}\n"
        ),
        entrypoint=f"python check_{int(check_id):02d}.py --h5ad {params.get('h5ad', 'data.h5ad')}",
        params=dict(params),
    )


def render_or_fallback(check_id: int, params: dict) -> CorrectedCode:
    try:
        from ..correction import render_corrected_code

        return render_corrected_code(check_id, params)
    except Exception:
        return fallback_code(check_id, params)


# ── Check 5 module ────────────────────────────────────────────────────────────

_CITATION = MethodRef(
    authors="Benjamini & Hochberg",
    year=1995,
    venue="J. R. Stat. Soc. B",
    note="Control the expected proportion of false discoveries among rejected hypotheses.",
    url="https://doi.org/10.1111/j.2517-6161.1995.tb02031.x",
)


def _already_adjusted(design: Design) -> Optional[str]:
    """The stored analysis says it adjusted for multiplicity. Returns the method
    name it used, or None when the significance rode on raw p-values."""
    if design.knob("adjusted") in (True, "true", "yes"):
        return str(design.knob("correction") or "an FDR method")
    corr = design.knob("correction") or design.knob("pAdjust") or design.knob("significanceBasis")
    if corr and str(corr).lower() not in ("raw", "none", "unadjusted", "false"):
        return str(corr)
    return None


class _Analysis:
    """The per-gene FDR analysis, computed once and shared by detect and prove."""

    def __init__(self, adata: Any, design: Design, claim: Claim) -> None:
        self.ok = False
        self.reason = ""
        self.alpha = float(design.knob("alpha", 0.05) or 0.05)
        self.method = str(design.knob("method", "bh") or "bh").lower()
        if self.method not in ("bh", "by"):
            self.method = "bh"
        self.grouping = design.grouping or design.knob("grouping")
        self.unit = design.unit

        groups = obs_series(adata, self.grouping) if self.grouping else None
        if groups is None:
            self.reason = "No grouping column is resolved, so a per-gene test cannot be built."
            return
        picked = two_groups(groups, design.config)
        if picked is None:
            self.reason = f"'{self.grouping}' has fewer than two levels to compare."
            return
        self.ref, self.alt, ref_mask, alt_mask = picked

        M, var_names, self.source = expr_log1p(adata)
        keep = ref_mask | alt_mask
        # Genes with any signal in the compared cells; the tested set.
        expressed = np.asarray(M[keep].sum(axis=0) > 0).ravel()
        if not expressed.any():
            self.reason = "No expressed genes in the compared groups to test."
            return
        gene_idx = np.nonzero(expressed)[0]
        self.var_names = [str(var_names[i]) for i in gene_idx]

        unit_vec = obs_series(adata, self.unit) if self.unit else None
        A, B, self.pseudobulk, _, _ = group_matrices(
            M[:, gene_idx], np.asarray([str(x) for x in unit_vec]) if unit_vec is not None else None, ref_mask, alt_mask
        )
        self.p, ma, mb = welch_p(A, B)
        self.log2fc = (mb - ma) / _LN2
        _, self.q = bh(self.p, self.alpha, self.method)
        self.raw_hits = int(np.sum(self.p < self.alpha))
        self.adjusted_hits = int(np.sum(self.q < self.alpha))
        self.tests = int(self.p.size)
        self.claimed = {str(g) for g in getattr(claim, "genes", ())}
        self.ok = True

    def fdr_chart_json(self) -> dict:
        order = np.argsort(self.p)[:25]
        top = [
            FdrGene(
                gene=self.var_names[i],
                p=float(self.p[i]),
                q=float(self.q[i]),
                survives=bool(self.q[i] < self.alpha),
            )
            for i in order
        ]
        return fdr_chart(self.tests, self.alpha, self.raw_hits, self.adjusted_hits, self.method, top)

    def volcano_json(self) -> dict:
        return build_volcano(
            self.var_names,
            self.log2fc,
            self.q,
            self.q < self.alpha,
            self.claimed,
            f"Benjamini-Hochberg q-values ({self.method.upper()}), sig at q<{self.alpha}",
            self.alpha,
            fc_threshold=1.0,
        )


class Check5MultipleTesting(CheckModule):
    id = 5
    name = "Multiple testing"
    one_line = "Significance claimed on raw p-values across many genes, with no FDR control."
    error_class = "Uncorrected multiple testing"
    citation = _CITATION
    claim_kinds = ("de",)
    knobs = (
        Knob(key="alpha", label="FDR threshold q", kind="number", min=0.0, max=0.25, step=0.005),
        Knob(key="method", label="Adjustment", kind="select", options=["bh", "by"]),
    )

    def applies_to(self, claim: Claim, design: Design) -> bool:
        if claim.kind not in self.claim_kinds:
            return False
        return bool(design.grouping or design.knob("grouping"))

    def detect(self, claim: Claim, adata: Any, design: Design) -> DetectResult:
        a = _Analysis(adata, design, claim)
        if not a.ok:
            return Candidate(
                state=FLAG_ONLY,
                headline="A per-gene result is not recoverable, so multiplicity cannot be checked.",
                numbers={"tests": 0},
                stats=[stat("Status", "needs input")],
                message=a.reason,
            )
        adjusted_with = _already_adjusted(design)
        if adjusted_with is not None:
            head = f"The analysis already applied {adjusted_with}; multiplicity is controlled."
            return Clean(
                headline=head,
                stats=[
                    stat("Tests", str(a.tests)),
                    stat("Correction", adjusted_with, good=True),
                    stat("Survive q<%.2g" % a.alpha, str(a.adjusted_hits), good=True),
                ],
                chart=a.fdr_chart_json(),
            )
        if a.tests < _MIN_TESTS:
            head = f"Only {a.tests} genes were tested; multiplicity is not a material risk here."
            return Clean(
                headline=head,
                stats=[stat("Tests", str(a.tests), good=True), stat("Raw hits", str(a.raw_hits))],
                chart=a.fdr_chart_json(),
            )
        head = (
            f"{a.raw_hits} genes clear raw p<{a.alpha}, but only {a.adjusted_hits} survive "
            f"{a.method.upper()} FDR control across {a.tests} tests."
        )
        return Candidate(
            state=FLAGGED,
            headline=head,
            numbers={"original": a.raw_hits, "corrected": a.adjusted_hits, "tests": a.tests, "alpha": a.alpha},
            chart=a.fdr_chart_json(),
            stats=[
                stat("Raw hits", str(a.raw_hits), bad=True),
                stat("Survive FDR", str(a.adjusted_hits), good=(a.adjusted_hits > 0), bad=(a.adjusted_hits == 0)),
                stat("Tests", str(a.tests)),
                stat("Method", a.method.upper()),
            ],
        )

    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        a = _Analysis(adata, design, Claim(genes=tuple()))
        if not a.ok:
            return Evidence(
                state=FLAG_ONLY,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=candidate.chart or a.fdr_chart_json(),
                numbers={"tests": 0},
                method=self.citation,
                feasibility=NEEDS_NEW_DATA,
                params=self._params(a, design),
                message=candidate.message,
            )

        # The reported hit counts, the FDR chart, and the emitted script all read
        # from one kernel: aggregate to the unit, per-gene Welch, then BH.
        nums = kernels.check5_multiple_testing(
            adata,
            unit=a.unit,
            grouping=a.grouping,
            ref=str(a.ref),
            alt=str(a.alt),
            alpha=a.alpha,
            method=a.method,
            tests=0,
        )
        chart = _fdr_chart_from_kernel(nums, a.method)
        caveat = (
            "Benjamini-Hochberg controls the false discovery rate, the expected share of false "
            "positives among the genes called significant. It does not control the family-wise "
            "error rate. "
        )
        if not a.pseudobulk:
            caveat += "No biological-unit role resolved, so per-gene tests are at the cell level; check 1 covers that separately."
        elif a.source == "X":
            caveat += "Raw counts were not found, so the tests ran on the stored .X values."
        head = (
            f"{nums['original']} genes clear raw p<{a.alpha}, but only {nums['corrected']} survive "
            f"{a.method.upper()} FDR control across {nums['tests']} tests."
        )
        return Evidence(
            state=FLAGGED,
            headline=head,
            stats=[
                stat("Raw hits", str(nums["original"]), bad=True),
                stat("Survive FDR", str(nums["corrected"]), good=(nums["corrected"] > 0), bad=(nums["corrected"] == 0)),
                stat("Tests", str(nums["tests"])),
                stat("Method", a.method.upper()),
            ],
            chart=chart,
            numbers=nums,
            method=self.citation,
            feasibility=FIXABLE_NOW,
            params=self._params(a, design, tests=nums["tests"]),
            corrected_artifact=chart,
            caveat=caveat.strip(),
        )

    def _params(self, a: "_Analysis", design: Design, tests: Optional[int] = None) -> dict:
        return {
            "h5ad": h5ad_hint(design),
            "unit": a.unit if a.ok else design.unit,
            "grouping": a.grouping if a.ok else (design.grouping or design.knob("grouping")),
            "ref": getattr(a, "ref", None),
            "alt": getattr(a, "alt", None),
            "alpha": float(getattr(a, "alpha", design.knob("alpha", 0.05) or 0.05)),
            "method": getattr(a, "method", "bh"),
            "tests": int(tests if tests is not None else getattr(a, "tests", 0)),
        }

    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        return render_or_fallback(self.id, evidence.params)

    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        n = evidence.numbers
        raw = n.get("original", 0)
        adj = n.get("corrected", 0)
        tests = n.get("tests", 0)
        alpha = n.get("alpha", 0.05)
        method = str(evidence.params.get("method", "bh")).upper()
        recs = [
            Recommendation(
                action=f"apply {method} FDR control at q<{alpha} across all {tests} gene tests",
                rationale=(
                    f"{raw} genes clear raw p<{alpha}, but raw p-values ignore that {tests} genes were "
                    f"tested; after {method} adjustment {adj} survive."
                ),
                changes=f"the significant set drops from {raw} genes to {adj}.",
                feasibility=FIXABLE_NOW,
                citation=self.citation,
            )
        ]
        if int(adj) == 0:
            recs.append(
                Recommendation(
                    action="collect more replicates before claiming any of these genes",
                    rationale=f"no gene survives FDR control at q<{alpha}; the raw hits do not clear the noise floor.",
                    changes="with more power, true effects would separate from the false ones the raw list holds.",
                    feasibility=NEEDS_NEW_DATA,
                    citation=self.citation,
                )
            )
        return recs


MODULE: CheckModule = Check5MultipleTesting()
