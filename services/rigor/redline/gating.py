"""Data-completeness gating.

Pseudobulk (Pillar 1) and count splitting (Pillar 2) both need raw integer
counts. This module locates them (``layers['counts']`` or ``.raw`` first, then a
count-shaped ``.X``) and, when they are absent, reports a clean ``flag_only``
degradation instead of fabricating a re-run the data cannot support.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import numpy as np

COUNTS_REQUIRED_MESSAGE = (
    "Raw integer counts are required to re-run this check and were not found. "
    "Provide them in a 'counts' layer or in .raw, then re-run."
)


@dataclass
class GateResult:
    """Outcome of the counts gate for pillars 1 and 2."""

    ok: bool
    source: Optional[str]  # 'layers[counts]' | 'raw' | 'X' | None
    message: str


def _to_dense(matrix: Any) -> np.ndarray:
    """Densify a scipy sparse matrix or return a numpy view, without importing scipy."""
    if matrix is None:
        return None  # type: ignore[return-value]
    if hasattr(matrix, "toarray"):  # scipy.sparse
        return np.asarray(matrix.toarray())
    return np.asarray(matrix)


def _sample_block(matrix: Any, max_cells: int = 400) -> np.ndarray:
    """A small dense block used to sniff whether values are integer counts."""
    n = matrix.shape[0]
    if n <= max_cells:
        block = matrix
    else:
        idx = np.linspace(0, n - 1, max_cells).astype(int)
        block = matrix[idx]
    return _to_dense(block)


def looks_like_counts(matrix: Any) -> bool:
    """True when a matrix is non-negative and (near) integer valued."""
    if matrix is None or getattr(matrix, "shape", (0, 0))[0] == 0:
        return False
    block = _sample_block(matrix)
    if block.size == 0:
        return False
    finite = block[np.isfinite(block)]
    if finite.size == 0:
        return False
    if float(np.min(finite)) < 0:
        return False
    # Integer-valued to within floating error (raw counts, possibly stored as float).
    return bool(np.all(np.abs(finite - np.round(finite)) < 1e-6))


def find_counts(adata: Any) -> tuple[Optional[Any], Optional[str]]:
    """Locate a raw-count matrix. Returns ``(matrix, source)`` or ``(None, None)``.

    Preference order: an explicit ``counts`` layer, then ``.raw.X`` if it is
    count-shaped, then ``.X`` itself when it already holds integer counts.
    """
    layers = getattr(adata, "layers", None)
    if layers is not None:
        for key in ("counts", "count", "raw_counts", "umi"):
            try:
                if key in layers:
                    mat = layers[key]
                    if looks_like_counts(mat):
                        return mat, "layers[counts]"
            except TypeError:
                continue

    raw = getattr(adata, "raw", None)
    if raw is not None and getattr(raw, "X", None) is not None:
        if looks_like_counts(raw.X):
            return raw.X, "raw"

    X = getattr(adata, "X", None)
    if X is not None and looks_like_counts(X):
        return X, "X"

    return None, None


def has_raw_counts(adata: Any) -> bool:
    matrix, _ = find_counts(adata)
    return matrix is not None


def counts_array(adata: Any) -> tuple[Optional[np.ndarray], Optional[str]]:
    """Dense count matrix (cells x genes) plus its source, or ``(None, None)``."""
    matrix, source = find_counts(adata)
    if matrix is None:
        return None, None
    return _to_dense(matrix), source


def require_counts(adata: Any) -> GateResult:
    """Gate for pillars 1 and 2. ``ok=False`` degrades the pillar to flag_only."""
    matrix, source = find_counts(adata)
    if matrix is None:
        return GateResult(ok=False, source=None, message=COUNTS_REQUIRED_MESSAGE)
    return GateResult(ok=True, source=source, message=f"Raw counts found in {source}.")
