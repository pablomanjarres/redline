"""The four rigor pillars, plus the small helpers they share.

Only base-install dependencies (numpy, scipy, scikit-learn) are imported here.
The heavy statistical stack (scanpy, decoupler, pydeseq2) is imported lazily
inside the pillar functions that need it, so the contract tests and the base
package import without it.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

import numpy as np

# Level names that read as a control / reference arm. Used only to orient a
# two-group comparison (which arm is the baseline), never to hardcode biology.
CONTROL_HINTS = (
    "nt",
    "non-targeting",
    "nontargeting",
    "non_targeting",
    "control",
    "ctrl",
    "ctl",
    "vehicle",
    "veh",
    "saline",
    "dmso",
    "unstim",
    "unstimulated",
    "untreated",
    "wt",
    "wildtype",
    "wild-type",
    "mock",
    "scramble",
    "scrambled",
    "baseline",
    "ref",
    "reference",
)


def cfg_get(config: Any, key: str, default: Any = None) -> Any:
    """Read a knob from a dict, a dataclass, or any attribute-bearing object."""
    if config is None:
        return default
    if isinstance(config, dict):
        return config.get(key, default)
    return getattr(config, key, default)


def obs_series(adata: Any, name: Optional[str]) -> Optional[np.ndarray]:
    """Return an ``obs`` column as a numpy array, or ``None`` if it is absent."""
    if not name:
        return None
    obs = getattr(adata, "obs", None)
    if obs is None:
        return None
    try:
        if name not in obs.columns:
            return None
        return np.asarray(obs[name].to_numpy())
    except Exception:
        return None


def resolve_role_column(fields: Any, role: str) -> Optional[str]:
    """First field id carrying ``role`` in a list of FieldSpec dicts/objects."""
    for f in fields or []:
        f_role = f.get("role") if isinstance(f, dict) else getattr(f, "role", None)
        f_id = f.get("id") if isinstance(f, dict) else getattr(f, "id", None)
        if f_role == role and f_id:
            return str(f_id)
    return None


def _is_control(level: str) -> bool:
    low = str(level).strip().lower()
    return any(h == low or low.startswith(h) or h in low.split("_") for h in CONTROL_HINTS)


def two_groups(
    values: Sequence[Any], config: Any = None
) -> Optional[tuple[str, str, np.ndarray, np.ndarray]]:
    """Pick two comparison levels from a label vector.

    Honors ``config['groups'] = [ref, alt]`` or ``config['reference']`` when
    given, otherwise takes the two most-populated levels and orients a
    control-looking level as the reference. Returns
    ``(ref_label, alt_label, ref_mask, alt_mask)`` or ``None`` when fewer than
    two levels are present.
    """
    arr = np.asarray([str(v) for v in values])
    levels, counts = np.unique(arr, return_counts=True)
    if levels.size < 2:
        return None

    explicit = cfg_get(config, "groups", None)
    reference = cfg_get(config, "reference", None)
    if explicit and len(explicit) >= 2:
        ref, alt = str(explicit[0]), str(explicit[1])
    else:
        order = np.argsort(-counts)
        top = [str(levels[i]) for i in order[:2]]
        if reference and str(reference) in set(levels.tolist()):
            ref = str(reference)
            alt = next((l for l in top if l != ref), top[0] if top[0] != ref else top[1])
        else:
            # Orient a control-looking level as the reference for legibility.
            if _is_control(top[1]) and not _is_control(top[0]):
                ref, alt = top[1], top[0]
            else:
                ref, alt = top[0], top[1]

    ref_mask = arr == ref
    alt_mask = arr == alt
    if ref_mask.sum() == 0 or alt_mask.sum() == 0:
        return None
    return ref, alt, ref_mask, alt_mask


def rng(seed: Any = 0) -> "np.random.Generator":
    """Deterministic numpy Generator (checks that use randomness stay reproducible)."""
    try:
        return np.random.default_rng(int(seed))
    except Exception:
        return np.random.default_rng(0)


def safe_auc(scores: Sequence[float], labels: Sequence[int]) -> float:
    """ROC AUC of ``scores`` separating a binary ``labels`` vector.

    Oriented so a value above 0.5 means the marker is higher in the positive
    class. Degenerate inputs (one class only) return 0.5 (chance).
    """
    scores = np.asarray(scores, dtype=float)
    labels = np.asarray(labels, dtype=int)
    if scores.size == 0 or len(np.unique(labels)) < 2:
        return 0.5
    try:
        from sklearn.metrics import roc_auc_score

        auc = float(roc_auc_score(labels, scores))
    except Exception:
        # Mann-Whitney U / rank equivalence, no sklearn required.
        order = np.argsort(scores, kind="mergesort")
        ranks = np.empty_like(order, dtype=float)
        ranks[order] = np.arange(1, scores.size + 1)
        pos = labels == 1
        n_pos = int(pos.sum())
        n_neg = int((~pos).sum())
        if n_pos == 0 or n_neg == 0:
            return 0.5
        auc = (ranks[pos].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
    return max(auc, 1.0 - auc)  # separation strength, direction-agnostic
