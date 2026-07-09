"""Pure-stdlib / numpy statistics used by the correction layer.

The one export that matters is ``benjamini_hochberg``: a correct Benjamini-Hochberg
(and Benjamini-Yekutieli) false-discovery-rate control. Check 5 uses it directly when
statsmodels is not importable, so it has to match statsmodels exactly, including on the
awkward inputs (empty, NaNs, ties, p-values already at 1.0).

This is a real FDR correction, not the count-split evidence of check 2. Do not conflate
the two.
"""

from __future__ import annotations

import math
from typing import Sequence


def benjamini_hochberg(
    pvals: Sequence[float], alpha: float = 0.05, method: str = "bh"
) -> tuple[list[bool], list[float]]:
    """Benjamini-Hochberg (``method='bh'``) or Benjamini-Yekutieli (``method='by'``).

    Returns ``(reject, qvals)`` aligned to the input order.

    BH controls the FDR under independence or positive dependence. BY divides the
    threshold by the harmonic number ``sum(1/i for i in 1..m)``, which controls the FDR
    under arbitrary dependence at the cost of power.

    NaN p-values are carried through: they never reject and their q-value is NaN. They do
    not count toward ``m`` (matching how statsmodels handles a filtered gene set, where
    NaNs are dropped before correction). Ties are handled by the standard step-up
    cumulative-minimum, so equal p-values get equal q-values.
    """
    import numpy as np

    m = str(method).lower()
    if m in ("by", "fdr_by"):
        by = True
    elif m in ("bh", "fdr_bh"):
        by = False
    else:
        raise ValueError("method must be 'bh' or 'by', got " + repr(method))

    p = np.asarray(list(pvals), dtype=float)
    n = p.size
    reject = [False] * n
    qvals = [float("nan")] * n
    if n == 0:
        return reject, qvals

    finite = np.isfinite(p)
    idx = np.nonzero(finite)[0]
    if idx.size == 0:
        return reject, qvals

    sub = p[idx]
    k = sub.size
    c = 1.0
    if by:
        c = float(np.sum(1.0 / np.arange(1, k + 1)))

    order = np.argsort(sub, kind="mergesort")  # stable, so ties keep input order
    ranked = sub[order]
    # step-up q-values: q_i = p_(i) * m * c / i, then enforce monotonicity from the top.
    q_sorted = ranked * k * c / np.arange(1, k + 1)
    q_sorted = np.minimum.accumulate(q_sorted[::-1])[::-1]
    q_sorted = np.clip(q_sorted, 0.0, 1.0)

    q_sub = np.empty(k, dtype=float)
    q_sub[order] = q_sorted
    rej_sub = q_sub <= alpha

    for local, global_i in enumerate(idx):
        qvals[int(global_i)] = float(q_sub[local])
        reject[int(global_i)] = bool(rej_sub[local])
    return reject, qvals


if __name__ == "__main__":
    # Self-check against statsmodels on a spread of cases, if it is importable.
    import numpy as np

    rng = np.random.default_rng(0)
    cases = [
        np.array([0.001, 0.008, 0.02, 0.04, 0.9, 0.7, 0.5, 0.3]),
        np.array([0.04, 0.04, 0.04, 0.04, 0.04]),  # ties
        rng.uniform(0, 1, size=200),
        np.concatenate([rng.uniform(0, 0.001, 10), rng.uniform(0, 1, 90)]),
    ]
    try:
        from statsmodels.stats.multitest import multipletests

        ok = True
        for method, sm_method in (("bh", "fdr_bh"), ("by", "fdr_by")):
            for pv in cases:
                rej, q = benjamini_hochberg(pv, alpha=0.05, method=method)
                sm_rej, sm_q, _, _ = multipletests(pv, alpha=0.05, method=sm_method)
                if not np.allclose(q, sm_q, atol=1e-9):
                    ok = False
                    print("q mismatch", method, np.max(np.abs(np.array(q) - sm_q)))
                if list(rej) != list(sm_rej):
                    ok = False
                    print("reject mismatch", method)
        # NaN handling (statsmodels cannot take NaNs directly, so check by hand).
        pv = np.array([0.001, float("nan"), 0.9, 0.02])
        rej, q = benjamini_hochberg(pv, alpha=0.05, method="bh")
        assert math.isnan(q[1]) and rej[1] is False
        print("stats self-check:", "PASS" if ok else "FAIL")
    except ImportError:
        print("statsmodels not importable; skipped the cross-check.")
