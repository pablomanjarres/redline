"""The confidence-interval layer, proven on a seeded reference foil.

These tests are the acceptance proof for the interval capability: a stochastic
check repeated over N seeds reports a distribution, the distribution is
reproducible (same seed => same interval), the interval is well formed, and its
width and level distinguish a robust real group from a weak one. They need the
heavy stats stack (anndata, scanpy, sklearn); where it is absent they skip, the
same way the pillars degrade.
"""

from __future__ import annotations

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("anndata")
pytest.importorskip("scanpy")
pytest.importorskip("sklearn")

from redline.oracle.reference import build_reference_foil, naive_marker_names
from redline.pillars import double_dipping, fragility

C2_REPS = 24
C3_REPS = 8


def _c2(target, markers=None, reps=C2_REPS, seed=0):
    cfg = {"split": 0.5, "grouping": "cell_state", "target_group": target, "repeats": reps, "seed": seed}
    if markers:
        cfg["markers"] = markers
    return double_dipping.run(build_reference_foil(), cfg)


def _c3(track, reps=C3_REPS, seed=0):
    cfg = {"min": 0.2, "max": 2.0, "step": 0.2, "track": track, "repeats": reps, "seed": seed}
    return fragility.run(build_reference_foil(), cfg)


def _stat(result, label):
    return next(s for s in result.stats if s.label == label)


# ── Check 2: the count-split held-out AUC interval ────────────────────────────


def test_c2_interval_is_reproducible():
    """Same seed, two independent runs, byte-identical interval. This is the core
    claim: the interval is not luck, it is a reproducible measurement."""
    a = _stat(_c2("Effector"), "Held-out AUC").interval
    b = _stat(_c2("Effector"), "Held-out AUC").interval
    assert a is not None and b is not None
    assert (a["median"], a["lo"], a["hi"], a["n"]) == (b["median"], b["lo"], b["hi"], b["n"])


def test_c2_interval_well_formed():
    iv = _stat(_c2("Effector"), "Held-out AUC").interval
    assert iv["lo"] <= iv["median"] <= iv["hi"]
    assert iv["hi"] > iv["lo"]  # a real sampling distribution, not one lucky point
    assert iv["n"] == C2_REPS
    assert 0 < len(iv["samples"]) <= 200


def test_c2_real_group_is_tighter_and_higher_than_weak():
    """The interval itself grades: a robust real group separates better out of
    sample AND with less uncertainty than a weak one. This is the Depth signal."""
    weak = _stat(_c2("Effector"), "Held-out AUC").interval
    real = _stat(_c2("Naive", naive_marker_names()), "Held-out AUC").interval
    assert real["median"] > weak["median"] + 0.04
    assert (real["hi"] - real["lo"]) < (weak["hi"] - weak["lo"])


def test_c2_reps_surface_in_prose_and_chart():
    r = _c2("Effector")
    assert "splits" in r.headline and str(C2_REPS) in r.headline
    assert r.chart["holdAUCDist"]["n"] == C2_REPS
    assert r.chart["discAUCDist"]["n"] == C2_REPS
    assert r.chart["markersHoldingDist"]["n"] == C2_REPS


# ── Check 3: the resolution-sweep stability interval ──────────────────────────


def test_c3_stability_interval_reproducible():
    a = _stat(_c3("Naive"), "Stability").interval
    b = _stat(_c3("Naive"), "Stability").interval
    assert a is not None and b is not None
    assert (a["median"], a["lo"], a["hi"], a["n"]) == (b["median"], b["lo"], b["hi"], b["n"])


def test_c3_flags_fragile_group_and_carries_presence():
    r = _c3("Effector")
    assert r.state == "flagged"  # a group that never forms a discrete cluster is fragile
    iv = _stat(r, "Stability").interval
    assert iv is not None and iv["lo"] <= iv["median"] <= iv["hi"] and iv["n"] == C3_REPS
    assert r.chart["stabilityDist"]["n"] == C3_REPS
    # per-setting presence probability rides on every step (0..1 across the reps)
    assert all("presence" in st for st in r.chart["steps"])
    assert all(0.0 <= st["presence"] <= 1.0 for st in r.chart["steps"])
