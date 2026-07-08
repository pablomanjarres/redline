"""Case descriptors and the foils manifest reader.

A ``Descriptor`` is the small map from a case to the obs columns and cell-state
groups the oracle needs. Every column name is a field, so a case whose foil uses
renamed columns (``patient`` / ``treatment`` / ``batch`` instead of
``donor_id`` / ``condition`` / ``lane``) is handled by naming those columns in
its descriptor. No column name is hardcoded in the check logic.

The manifest is JSON. It accepts three shapes:

- ``{"cases": [ {..}, {..} ]}``
- a bare list ``[ {..}, {..} ]``
- a dict keyed by case id ``{"A": {..}, "B": {..}}``

Each case entry carries the descriptor fields below plus a ``foil`` path.
Relative ``foil`` paths resolve against the manifest file's directory. A case may
also override any tuning knob (``split``, ``alpha``, ``resMin`` / ``resMax`` /
``resStep``, ``markers``, ``markersK``, ``seed``, ``clusterMethod``,
``minCoverage`` / ``minPurity`` / ``stableFraction``); anything omitted falls
back to the run-wide default.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class Descriptor:
    """The obs-column map and cell-state groups for one case."""

    case_id: str
    foil: str
    unit: str
    grouping: str
    nuisance: str
    state_col: str
    focus_gene: str
    spurious: str
    stable: Optional[str] = None
    # Optional per-case overrides. ``None`` means "use the run default".
    markers: Optional[list[str]] = None
    markers_k: Optional[int] = None
    split: Optional[float] = None
    alpha: Optional[float] = None
    res_min: Optional[float] = None
    res_max: Optional[float] = None
    res_step: Optional[float] = None
    seed: Optional[int] = None
    cluster_method: Optional[str] = None
    min_coverage: Optional[float] = None
    min_purity: Optional[float] = None
    stable_fraction: Optional[float] = None
    extra: dict[str, Any] = field(default_factory=dict)


# Accepted spellings for each descriptor field, so a manifest can use snake_case
# or camelCase or a couple of natural synonyms.
_ALIASES: dict[str, tuple[str, ...]] = {
    "case_id": ("case_id", "caseId", "case", "id"),
    "foil": ("foil", "h5ad", "path", "file", "filename"),
    "unit": ("unit", "unit_col", "unitCol"),
    "grouping": ("grouping", "group", "grouping_col", "groupingCol"),
    "nuisance": ("nuisance", "nuisance_col", "nuisanceCol", "technical"),
    "state_col": ("state_col", "stateCol", "cell_state_col", "cellStateCol"),
    "focus_gene": ("focus_gene", "focusGene", "gene"),
    "spurious": ("spurious", "spurious_group", "spuriousGroup", "tracked"),
    "stable": ("stable", "stable_group", "stableGroup"),
    "markers": ("markers", "marker_genes", "markerGenes"),
    "markers_k": ("markers_k", "markersK", "n_markers", "nMarkers"),
    "split": ("split", "eps"),
    "alpha": ("alpha",),
    "res_min": ("res_min", "resMin", "min"),
    "res_max": ("res_max", "resMax", "max"),
    "res_step": ("res_step", "resStep", "step"),
    "seed": ("seed",),
    "cluster_method": ("cluster_method", "clusterMethod", "method"),
    "min_coverage": ("min_coverage", "minCoverage", "coverage"),
    "min_purity": ("min_purity", "minPurity", "purity"),
    "stable_fraction": ("stable_fraction", "stableFraction"),
}

_KNOWN_KEYS = {alias for aliases in _ALIASES.values() for alias in aliases}


def _pick(entry: dict[str, Any], canonical: str, default: Any = None) -> Any:
    for alias in _ALIASES[canonical]:
        if alias in entry and entry[alias] is not None:
            return entry[alias]
    return default


def _as_markers(value: Any) -> Optional[list[str]]:
    if value is None:
        return None
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(",")]
        return [p for p in parts if p]
    return [str(v) for v in value]


def descriptor_from_dict(entry: dict[str, Any], base_dir: str = "") -> Descriptor:
    """Build a ``Descriptor`` from one manifest entry.

    ``base_dir`` is prepended to a relative ``foil`` path so paths in a manifest
    are read relative to the manifest, which is what an operator expects.
    """
    case_id = _pick(entry, "case_id")
    if case_id is None:
        raise ValueError(f"case entry is missing a case id: {entry!r}")
    foil = _pick(entry, "foil")
    if foil is None:
        raise ValueError(f"case {case_id!r} is missing a foil path")
    foil = os.path.expanduser(str(foil))
    if base_dir and not os.path.isabs(foil):
        foil = os.path.normpath(os.path.join(base_dir, foil))

    required = {name: _pick(entry, name) for name in ("unit", "grouping", "nuisance", "state_col", "focus_gene", "spurious")}
    missing = [name for name, val in required.items() if val is None]
    if missing:
        raise ValueError(f"case {case_id!r} is missing descriptor fields: {missing}")

    extra = {k: v for k, v in entry.items() if k not in _KNOWN_KEYS}

    return Descriptor(
        case_id=str(case_id),
        foil=foil,
        unit=str(required["unit"]),
        grouping=str(required["grouping"]),
        nuisance=str(required["nuisance"]),
        state_col=str(required["state_col"]),
        focus_gene=str(required["focus_gene"]),
        spurious=str(required["spurious"]),
        stable=(None if _pick(entry, "stable") is None else str(_pick(entry, "stable"))),
        markers=_as_markers(_pick(entry, "markers")),
        markers_k=(None if _pick(entry, "markers_k") is None else int(_pick(entry, "markers_k"))),
        split=(None if _pick(entry, "split") is None else float(_pick(entry, "split"))),
        alpha=(None if _pick(entry, "alpha") is None else float(_pick(entry, "alpha"))),
        res_min=(None if _pick(entry, "res_min") is None else float(_pick(entry, "res_min"))),
        res_max=(None if _pick(entry, "res_max") is None else float(_pick(entry, "res_max"))),
        res_step=(None if _pick(entry, "res_step") is None else float(_pick(entry, "res_step"))),
        seed=(None if _pick(entry, "seed") is None else int(_pick(entry, "seed"))),
        cluster_method=(None if _pick(entry, "cluster_method") is None else str(_pick(entry, "cluster_method"))),
        min_coverage=(None if _pick(entry, "min_coverage") is None else float(_pick(entry, "min_coverage"))),
        min_purity=(None if _pick(entry, "min_purity") is None else float(_pick(entry, "min_purity"))),
        stable_fraction=(None if _pick(entry, "stable_fraction") is None else float(_pick(entry, "stable_fraction"))),
        extra=extra,
    )


def load_manifest(path: str) -> list[Descriptor]:
    """Read a foils manifest and return one ``Descriptor`` per case."""
    path = os.path.expanduser(path)
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    base_dir = os.path.dirname(os.path.abspath(path))

    entries: list[dict[str, Any]]
    if isinstance(raw, dict) and "cases" in raw:
        entries = list(raw["cases"])
    elif isinstance(raw, list):
        entries = list(raw)
    elif isinstance(raw, dict):
        # dict keyed by case id
        entries = []
        for key, val in raw.items():
            if not isinstance(val, dict):
                continue
            item = dict(val)
            item.setdefault("caseId", key)
            entries.append(item)
    else:
        raise ValueError("manifest must be an object with 'cases', a list, or a dict keyed by case id")

    return [descriptor_from_dict(entry, base_dir) for entry in entries]
