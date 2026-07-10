"""Pillar tests on a tiny synthetic AnnData (donors x a grouping x cells).

Built with numpy only; the heavy stack (scanpy, decoupler, pydeseq2) is not
required because every pillar degrades to a numpy / scipy / scikit-learn path.
The load-bearing assertions: pseudobulk collapses an inflated p-value, the counts
gate flags missing raw counts, and each pillar returns a well-formed
ComputeResult in the right state.
"""

from __future__ import annotations

import numpy as np
import pytest

ad = pytest.importorskip("anndata")
pytest.importorskip("pandas")
pytest.importorskip("scipy")
pytest.importorskip("sklearn")

import pandas as pd  # noqa: E402

from redline import gating, resolve_fields, run_check  # noqa: E402
from redline.audit import audit  # noqa: E402  (`from redline import audit` binds the submodule, not the fn)
from redline.contracts import CHECK_STATES  # noqa: E402
from redline.pillars import confounding, double_dipping, fragility, pseudoreplication  # noqa: E402

N_PER = 300
DONORS = ["dA", "dB", "dC", "dD"]
COND = {"dA": "NT", "dB": "NT", "dC": "KD", "dD": "KD"}
FOXP3_LAMBDA = {"dA": 3.0, "dB": 7.0, "dC": 4.0, "dD": 8.0}  # KD arm shifted up
N_GENES = 30


def _gene_names() -> list[str]:
    return ["FOXP3"] + [f"g{i}" for i in range(1, N_GENES)]


def build_toy(seed: int = 0, with_counts: bool = True):
    """A 4-donor, 2-condition, 1,200-cell toy with a real cell-state split.

    FOXP3 carries a between-donor structure so its cell-level test is inflated but
    collapses at the donor level. A tight 'Naive' state (strong on g10..g14) and a
    diffuse 'Effector' state give a genuine clustering signal for pillars 2 and 3.
    """
    rng = np.random.default_rng(seed)
    donor_col, cond_col, state_col = [], [], []
    for d in DONORS:
        donor_col += [d] * N_PER
        cond_col += [COND[d]] * N_PER
        state_col += ["Naive"] * (N_PER // 2) + ["Effector"] * (N_PER - N_PER // 2)
    donor_col = np.array(donor_col)
    cond_col = np.array(cond_col)
    state_col = np.array(state_col)
    n = donor_col.size

    X = rng.poisson(1.0, size=(n, N_GENES)).astype(int)  # baseline noise
    # FOXP3: between-donor structure (balanced cell-state, so donor means differ by arm).
    lam = np.array([FOXP3_LAMBDA[d] for d in donor_col])
    X[:, 0] = rng.poisson(lam)

    naive = state_col == "Naive"
    eff = ~naive
    # Tight Naive markers (g10..g14): strong in Naive, near-zero elsewhere.
    X[naive, 10:15] = rng.poisson(15.0, size=(int(naive.sum()), 5))
    X[eff, 10:15] = rng.poisson(0.3, size=(int(eff.sum()), 5))
    # Effector markers (g15..g19) + diffuse spread (g20..g29): a looser state.
    X[eff, 15:20] = rng.poisson(6.0, size=(int(eff.sum()), 5))
    X[naive, 15:20] = rng.poisson(0.3, size=(int(naive.sum()), 5))
    X[eff, 20:30] = rng.poisson(2.0, size=(int(eff.sum()), 10))
    X[naive, 20:30] = rng.poisson(0.2, size=(int(naive.sum()), 10))

    barcodes = [f"cell_{i}" for i in range(n)]
    obs = pd.DataFrame(
        {
            "donor": donor_col,
            "condition": cond_col,
            "cell_barcode": barcodes,
            "lane": np.where(cond_col == "KD", "Lane-A", "Lane-B"),  # perfectly aligned with condition
            "guide_batch": np.where(cond_col == "KD", "gb1", "gb0"),  # 1 per group -> hard stop
            "leiden": np.where(naive, "0", "1"),
            "cell_state": state_col,
            "n_genes": (X > 0).sum(axis=1),
            "pct_mito": rng.uniform(0, 8, size=n),
            "phase": rng.choice(["G1", "S", "G2M"], size=n),
        },
        index=barcodes,
    )

    if with_counts:
        adata = ad.AnnData(X=X.astype(float), obs=obs)
        adata.var_names = _gene_names()
        adata.layers["counts"] = X.astype(float)
    else:
        # Library-size-normalized, log1p'd values: no integer counts anywhere.
        lib = X.sum(axis=1, keepdims=True)
        norm = np.log1p(X / np.clip(lib, 1, None) * 1e4)
        adata = ad.AnnData(X=norm.astype(float), obs=obs)
        adata.var_names = _gene_names()
    return adata


# ── Foundation ────────────────────────────────────────────────────────────────
def test_resolve_fields_roles():
    fields = {f.id: f for f in resolve_fields(build_toy())}
    assert fields["donor"].role == "unit"
    assert fields["condition"].role == "grouping"
    assert fields["cell_barcode"].role == "observation"
    assert fields["leiden"].role == "derived"
    assert fields["pct_mito"].role == "covariate"
    assert fields["n_genes"].role == "covariate"
    assert fields["lane"].role == "nuisance"
    assert fields["phase"].role == "nuisance"
    # lane lines up with condition, so the resolver should note the alignment.
    assert "line up" in fields["lane"].reason.lower() or "cramer" in fields["lane"].reason.lower()


# ── Pillar 1: pseudoreplication ───────────────────────────────────────────────
def test_pseudobulk_collapses_inflated_pvalue():
    adata = build_toy()
    cfg = {"unit": "donor", "grouping": "condition", "gene": "FOXP3", "alpha": 0.05}
    res = pseudoreplication.run(adata, cfg, resolve_fields(adata)).to_json()

    assert res["state"] == "flagged"
    assert res["chart"]["kind"] == "significance"
    naive, honest = res["chart"]["naive"], res["chart"]["honest"]
    assert naive["sig"] is True and honest["sig"] is False  # inflated -> collapses
    assert naive["log10p"] > honest["log10p"]
    assert res["chart"]["badUnit"] is False
    assert len(res["chart"]["units"]) == 4  # one profile per donor


def test_bad_unit_still_aggregates_to_the_real_replicate():
    adata = build_toy()
    cfg = {"unit": "cell_barcode", "grouping": "condition", "gene": "FOXP3", "alpha": 0.05}
    res = pseudoreplication.run(adata, cfg, resolve_fields(adata)).to_json()
    assert res["chart"]["badUnit"] is True  # user pointed the unit at a per-cell column
    assert res["state"] == "flagged"


def test_hard_stop_with_one_replicate_per_group():
    adata = build_toy()
    cfg = {"unit": "guide_batch", "grouping": "condition", "gene": "FOXP3", "alpha": 0.05}
    res = pseudoreplication.run(adata, cfg, resolve_fields(adata)).to_json()
    assert res["state"] == "hard_stop"
    assert res["chart"]["kind"] == "hardstop"
    assert res["chart"]["perGroup"] == 1


# ── Gating ────────────────────────────────────────────────────────────────────
def test_gating_flags_missing_counts_for_pillars_1_and_2():
    adata = build_toy(with_counts=False)
    assert gating.require_counts(adata).ok is False

    r1 = run_check(1, adata, {"unit": "donor", "grouping": "condition", "gene": "FOXP3"}, resolve_fields(adata))
    r2 = run_check(2, adata, {"split": 0.5, "grouping": "cell_state"}, resolve_fields(adata))
    assert r1["state"] == "flag_only" and "count" in r1["headline"].lower()
    assert r2["state"] == "flag_only" and "count" in r2["headline"].lower()


def test_counts_found_when_present():
    assert gating.require_counts(build_toy()).ok is True
    assert gating.has_raw_counts(build_toy()) is True


# ── Pillar 2: double dipping ──────────────────────────────────────────────────
def test_real_markers_survive_held_out_split():
    adata = build_toy()
    cfg = {
        "split": 0.5,
        "grouping": "cell_state",
        "target_group": "Naive",
        "markers": ["g10", "g11", "g12", "g13", "g14"],
        "seed": 0,
    }
    res = double_dipping.run(adata, cfg, resolve_fields(adata)).to_json()
    assert res["chart"]["kind"] == "groups"
    assert res["chart"]["verified"] is True
    assert 0.0 <= res["chart"]["holdAUC"] <= 1.0
    # These are genuine markers of a real, separable state, so they hold out of sample.
    assert res["chart"]["holdAUC"] >= 0.6
    assert res["state"] == "clean"


# ── Pillar 3: fragility ───────────────────────────────────────────────────────
def test_stable_group_is_reported_clean():
    adata = build_toy()
    # Sweep the range where the Naive state is a stable, discrete cluster under both
    # real Leiden and the KMeans fallback. (Real Leiden over-splits every population
    # at high resolution, so a genuinely stable group is one that holds across the
    # resolutions you would actually pick, not across an unbounded sweep.)
    cfg = {"min": 0.2, "max": 0.6, "step": 0.2, "track": "Naive", "seed": 0}
    res = fragility.run(adata, cfg, resolve_fields(adata)).to_json()
    assert res["chart"]["kind"] == "fragility"
    assert res["chart"]["stability"] >= 0.8
    assert res["state"] == "clean"  # never cry wolf on a stable population


def test_mechanical_mode_returns_a_valid_result():
    adata = build_toy()
    res = fragility.run(adata, {"min": 0.2, "max": 1.0, "step": 0.2, "track": ""}, resolve_fields(adata)).to_json()
    assert res["chart"]["kind"] == "fragility"
    assert res["state"] in CHECK_STATES


# ── Pillar 4: confounding ─────────────────────────────────────────────────────
def test_confounded_condition_and_lane_is_flagged():
    adata = build_toy()
    cfg = {"interest": "condition", "nuisance": ["lane"]}
    res = confounding.run(adata, cfg, resolve_fields(adata)).to_json()
    assert res["state"] == "flagged"
    assert res["chart"]["kind"] == "confound"
    assert res["chart"]["verified"] is True
    assert res["chart"]["cramersV"] is not None and res["chart"]["cramersV"] >= 0.99


def test_no_nuisance_selected_is_flag_only():
    adata = build_toy()
    res = confounding.run(adata, {"interest": "condition", "nuisance": []}, resolve_fields(adata)).to_json()
    assert res["state"] == "flag_only"
    assert res["chart"]["cramersV"] is None


# ── End to end ────────────────────────────────────────────────────────────────
def test_audit_end_to_end_shape():
    adata = build_toy()
    out = audit(adata)
    assert len(out["fields"]) == len(adata.obs.columns)
    # audit offers the claim to every registered check and runs the applicable
    # ones, so results is the registry's footprint, not a fixed four. Assert the
    # invariants that still carry weight: every result is a registered check, the
    # founding four are among them, and the ids are unique and ascending.
    from redline import modules

    registry_ids = set(modules.REGISTRY.keys())
    results = out["results"]
    ids = [res["checkId"] for res in results]
    assert ids, "audit ran no checks"
    assert set(ids) <= registry_ids
    assert {1, 2, 3, 4} <= set(ids)
    assert len(ids) == len(set(ids))
    assert ids == sorted(ids)
    for res in results:
        assert res["state"] in CHECK_STATES
        assert "kind" in res["chart"]
    report = out["report"]
    assert set(report.keys()) >= {"flagged", "clean", "needInput", "verdict"}
    assert report["flagged"] >= 1  # the FOXP3 pseudoreplication catch at minimum
    assert isinstance(report["verdict"], str) and "—" not in report["verdict"]
