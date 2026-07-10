"""Reading a foil ``.h5ad`` for the oracle.

Independent of the app engine's ``redline.gating``: this locates raw integer
counts, densifies them, and exposes obs columns and the focus-gene column with
its own small helpers. Preference for counts mirrors the standard convention
(a ``counts`` layer first, then ``.raw``, then a count-shaped ``.X``) but the
logic here is written from scratch.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

_COUNT_LAYER_KEYS = ("counts", "count", "raw_counts", "umi")


def load_adata(path: str):
    """Read an ``.h5ad`` into an AnnData. Heavy import kept local."""
    import anndata as ad

    return ad.read_h5ad(path)


def _densify(matrix) -> Optional[np.ndarray]:
    """Turn a scipy sparse matrix or array-like into a dense float array."""
    if matrix is None:
        return None
    if hasattr(matrix, "toarray"):
        return np.asarray(matrix.toarray(), dtype=float)
    return np.asarray(matrix, dtype=float)


def _is_integer_counts(matrix) -> bool:
    """True when a matrix is non-negative and integer valued to within float error.

    Sniffs a bounded sample so a large matrix does not force a full densify.
    """
    if matrix is None or getattr(matrix, "shape", (0,))[0] == 0:
        return False
    n = matrix.shape[0]
    if n > 400:
        idx = np.linspace(0, n - 1, 400).astype(int)
        block = matrix[idx]
    else:
        block = matrix
    dense = _densify(block)
    if dense is None or dense.size == 0:
        return False
    finite = dense[np.isfinite(dense)]
    if finite.size == 0:
        return False
    if float(np.min(finite)) < 0:
        return False
    return bool(np.all(np.abs(finite - np.round(finite)) < 1e-6))


def get_counts(adata) -> tuple[Optional[np.ndarray], list[str]]:
    """Locate raw integer counts and return ``(cells_by_genes, var_names)``.

    Returns ``(None, var_names)`` when no count-shaped matrix is present.
    """
    var_names = [str(v) for v in getattr(adata, "var_names", [])]

    layers = getattr(adata, "layers", None)
    if layers is not None:
        for key in _COUNT_LAYER_KEYS:
            try:
                present = key in layers
            except TypeError:
                present = False
            if present and _is_integer_counts(layers[key]):
                return _densify(layers[key]), var_names

    raw = getattr(adata, "raw", None)
    if raw is not None and getattr(raw, "X", None) is not None and _is_integer_counts(raw.X):
        dense = _densify(raw.X)
        raw_vars = [str(v) for v in getattr(raw, "var_names", var_names)]
        return dense, raw_vars

    X = getattr(adata, "X", None)
    if X is not None and _is_integer_counts(X):
        return _densify(X), var_names

    return None, var_names


def densify(matrix) -> Optional[np.ndarray]:
    """Public densifier: scipy sparse or array-like to a dense float array."""
    return _densify(matrix)


def get_X(adata) -> tuple[Optional[np.ndarray], list[str]]:
    """Return ``(dense_X, var_names)`` for the primary matrix.

    Used only as a fallback for the focus gene and the embedding when no
    count-shaped matrix is present. ``.X`` may already be normalized; callers
    that need raw counts must use :func:`get_counts` instead.
    """
    var_names = [str(v) for v in getattr(adata, "var_names", [])]
    X = getattr(adata, "X", None)
    return _densify(X), var_names


def obs_column(adata, name: Optional[str]) -> Optional[np.ndarray]:
    """Return an obs column as a numpy array of strings, or ``None`` if absent."""
    if not name:
        return None
    obs = getattr(adata, "obs", None)
    if obs is None:
        return None
    try:
        if name not in obs.columns:
            return None
        return np.asarray([str(v) for v in obs[name].to_numpy()])
    except Exception:
        return None


def gene_index(var_names: list[str], gene: str) -> Optional[int]:
    """Column index of ``gene`` in ``var_names``, case-insensitive fallback."""
    if gene in var_names:
        return var_names.index(gene)
    lower = {v.lower(): i for i, v in enumerate(var_names)}
    return lower.get(str(gene).lower())
