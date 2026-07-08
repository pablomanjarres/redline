"""Acceptance tests for Add-on 4, the naive-foil generator.

The spec's acceptance criteria, one test each:

- Given a fresh dataset, the generator produces a foil whose planted flaw the
  engine catches (``test_planted_flaws_are_caught``), and whose ground truth the
  oracle and harness can read (``test_ground_truth_is_harness_shaped``).
- Given the same dataset, a clean variant passes every check
  (``test_clean_variant_is_green``).
- It generalizes to data it has never seen, including different column names
  (``test_generalizes_to_renamed_columns``).
- Ground-truth labels carry the flaw id, the claim, the flawed statistic, and the
  expected correction (``test_flaw_records_carry_labels``).

The engine-backed tests are marked ``slow`` (they run PyDESeq2 / Leiden). The rest
are fast and pin the planner, the ground-truth shape, and the voice rule.
"""

from __future__ import annotations

import os
import sys

import pytest

# Make ``redline`` and ``data`` importable when pytest's rootdir is services/rigor.
_RIGOR_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _RIGOR_ROOT not in sys.path:
    sys.path.insert(0, _RIGOR_ROOT)

anndata = pytest.importorskip("anndata")
np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")

from data.base_datasets import PRESETS, build_base  # noqa: E402
from redline.foilgen import (  # noqa: E402
    describe_dataset,
    generate_foil,
    intended_verdicts,
    plan_foil,
)
from redline.foilgen.planner import _parse_bedrock, plan_heuristic  # noqa: E402

# Descriptor fields the oracle (redline.oracle.descriptor) requires per case.
_ORACLE_REQUIRED = ("case_id", "foil", "unit", "grouping", "nuisance", "state_col", "focus_gene", "spurious")
_EM_DASH = "—"
_EN_DASH = "–"


def _base_path(tmp_path, preset: str) -> str:
    a = build_base(PRESETS[preset], seed=0)
    p = os.path.join(str(tmp_path), f"base_{preset}.h5ad")
    a.write_h5ad(p)
    return p


# ── Fast tests (no engine) ────────────────────────────────────────────────────
def test_descriptor_generalizes_across_presets():
    """Field resolution maps each preset's differently named columns."""
    expected = {
        "immune": ("donor_id", "condition", "lane"),
        "brain": ("subject", "treatment", "chip"),
        "tumor": ("patient", "arm", "batch"),
    }
    for preset, (unit, grouping, nuisance) in expected.items():
        d = describe_dataset(build_base(PRESETS[preset], seed=0))
        assert d.unit == unit
        assert d.grouping == grouping
        assert d.nuisance == nuisance
        assert d.has_counts
        assert d.naive_focus_gene in d.candidate_genes or d.naive_focus_gene is not None
        assert all(d.feasibility[f]["plantable"] for f in ("pseudoreplication", "double_dipping", "fragility", "confounding"))


def test_heuristic_planner_is_deterministic():
    d = describe_dataset(build_base(PRESETS["immune"], seed=0))
    a = plan_heuristic(d, "all", False, seed=3)
    b = plan_heuristic(d, "all", False, seed=3)
    assert a.to_json() == b.to_json()
    assert a.planned_by == "heuristic"
    assert a.focus_gene in d.candidate_genes or a.focus_gene == d.naive_focus_gene


def test_planner_auto_falls_back_without_bedrock(monkeypatch):
    monkeypatch.delenv("REDLINE_BEDROCK_MODEL_ID", raising=False)
    d = describe_dataset(build_base(PRESETS["immune"], seed=0))
    plan = plan_foil(d, flaw="all", clean=False, seed=0, backend="auto")
    assert plan.planned_by == "heuristic"


def test_bedrock_reply_parses():
    text = 'Here is the plan:\n{"focusGene": "FOXP3", "spuriousState": "Activated"}\nDone.'
    parsed = _parse_bedrock(text)
    assert parsed is not None
    assert parsed["focusGene"] == "FOXP3"
    assert _parse_bedrock("no json here") is None


def test_intended_verdicts_match_planted_flaws():
    d = describe_dataset(build_base(PRESETS["immune"], seed=0))
    v_all = intended_verdicts(plan_foil(d, flaw="all", backend="heuristic"))
    assert v_all["1"] == "flagged" and v_all["2"] == "flagged" and v_all["4"] == "flagged"
    assert "flagged" in v_all["3"].values() and "clean" in v_all["3"].values()

    v_clean = intended_verdicts(plan_foil(d, clean=True, backend="heuristic"))
    assert v_clean["1"] == "clean" and v_clean["2"] == "clean" and v_clean["4"] == "clean"
    assert set(v_clean["3"].values()) == {"clean"}

    v_conf = intended_verdicts(plan_foil(d, flaw="confounding", backend="heuristic"))
    assert v_conf["4"] == "flagged" and v_conf["1"] == "clean" and v_conf["2"] == "clean"


def test_generated_prose_has_no_em_dashes(tmp_path):
    gt = generate_foil(_base_path(tmp_path, "immune"), os.path.join(str(tmp_path), "f.h5ad"),
                       flaw="all", backend="heuristic", verify=False)
    prose_blobs = [gt.plan.framing, *gt.plan.claims.values()]
    for rec in gt.flaw_records():
        prose_blobs.append(rec["claim"])
        prose_blobs.append(str(rec.get("flawedStatistic", {}).get("computed_how", "")))
    for blob in prose_blobs:
        assert _EM_DASH not in blob, f"em dash in generated prose: {blob!r}"
        assert _EN_DASH not in blob, f"en dash in generated prose: {blob!r}"


def test_ground_truth_is_harness_shaped(tmp_path):
    """The manifest entry carries every field the oracle's Descriptor needs plus
    the intended verdicts and the planted-flaw records."""
    out = os.path.join(str(tmp_path), "immune.foil.h5ad")
    gt = generate_foil(_base_path(tmp_path, "immune"), out, flaw="all", backend="heuristic", verify=False)
    entry = gt.to_manifest_entry()
    for key in _ORACLE_REQUIRED:
        assert entry.get(key) is not None, f"missing oracle descriptor field: {key}"
    assert entry["foil"] == out
    assert entry["unit"] == "donor_id" and entry["grouping"] == "condition"
    assert entry["state_col"] and entry["focus_gene"]
    assert "intended_verdicts" in entry and set(entry["intended_verdicts"]) == {"1", "2", "3", "4"}
    assert entry["cleanVariant"] is False
    assert isinstance(entry["obs_columns"], list) and entry["state_col"] in entry["obs_columns"]


def test_flaw_records_carry_labels(tmp_path):
    out = os.path.join(str(tmp_path), "immune.foil.h5ad")
    gt = generate_foil(_base_path(tmp_path, "immune"), out, flaw="all", backend="heuristic", verify=False)
    records = gt.flaw_records()
    pillars = {r["pillar"] for r in records}
    assert pillars == {1, 2, 3, 4}
    for r in records:
        assert r["flaw"] in ("pseudoreplication", "double_dipping", "fragility", "confounding")
        assert r["claim"], "every planted flaw needs a plain-language claim"
        assert r["expectedVerdict"] == "flagged"
        assert r["flawedStatistic"], "every planted flaw needs its flawed statistic"
        assert r["citation"]
    p1 = next(r for r in records if r["pillar"] == 1)
    assert "p" in p1["flawedStatistic"] and "computed_how" in p1["flawedStatistic"]


def test_requires_raw_counts(tmp_path):
    """A dataset with only normalized values is refused with a clear message,
    rather than fabricating counts out of CPM."""
    n, g = 240, 60
    rng = np.random.default_rng(0)
    donors = np.repeat([f"D{i}" for i in range(6)], n // 6)
    cond = np.where(np.isin(donors, ["D0", "D2", "D4"]), "ctrl", "treated")
    counts = rng.poisson(2.0, size=(n, g)).astype(float)
    norm = np.log1p(counts / counts.sum(1, keepdims=True) * 1e4)  # CPM, no raw counts
    obs = pd.DataFrame({"donor": donors, "condition": cond, "bc": [f"c{i}" for i in range(n)]},
                       index=[f"c{i}" for i in range(n)])
    a = anndata.AnnData(X=norm.astype(np.float32), obs=obs)
    a.var_names = [f"g{i}" for i in range(g)]
    with pytest.raises(ValueError, match="raw integer counts"):
        generate_foil(a, os.path.join(str(tmp_path), "nc.h5ad"), flaw="all", backend="heuristic", verify=False)


def test_too_few_replicates_intends_hard_stop():
    """With one replicate per arm, pseudoreplication is infeasible and Pillar 1
    hard-stops, so the intended verdict is hard_stop, not clean."""
    n, g = 240, 60
    rng = np.random.default_rng(0)
    donors = np.repeat(["D0", "D1"], n // 2)
    cond = np.where(donors == "D0", "ctrl", "treated")
    counts = rng.poisson(2.0, size=(n, g))
    obs = pd.DataFrame({"donor": donors, "condition": cond, "bc": [f"c{i}" for i in range(n)]},
                       index=[f"c{i}" for i in range(n)])
    a = anndata.AnnData(X=counts.astype(np.float32), obs=obs)
    a.var_names = [f"g{i}" for i in range(g)]
    a.layers["counts"] = counts.astype(np.float32)
    d = describe_dataset(a)
    assert not d.feasibility["pseudoreplication"]["plantable"]
    plan = plan_foil(d, flaw="all", backend="heuristic")
    assert plan.min_units_per_group < 2
    assert 1 not in plan.planted_flaws
    assert intended_verdicts(plan)["1"] == "hard_stop"


# ── Slow tests (run the real engine) ──────────────────────────────────────────
@pytest.mark.slow
def test_planted_flaws_are_caught(tmp_path):
    out = os.path.join(str(tmp_path), "immune.foil.h5ad")
    gt = generate_foil(_base_path(tmp_path, "immune"), out, flaw="all", backend="heuristic", verify=True)
    v = gt.verification
    assert v["ran"] and v["allMatch"], f"engine did not catch the planted flaws: {v.get('mismatches')}"
    assert v["engine"]["1"] == "flagged"
    assert v["engine"]["2"] == "flagged"
    assert v["engine"]["4"] == "flagged"
    assert "flagged" in v["engine"]["3"].values()


@pytest.mark.slow
def test_clean_variant_is_green(tmp_path):
    out = os.path.join(str(tmp_path), "immune.clean.h5ad")
    gt = generate_foil(_base_path(tmp_path, "immune"), out, clean=True, backend="heuristic", verify=True)
    v = gt.verification
    assert v["ran"] and v["allMatch"], f"clean variant was not green: {v.get('mismatches')}"
    assert v["engine"]["1"] == "clean" and v["engine"]["2"] == "clean" and v["engine"]["4"] == "clean"
    assert set(v["engine"]["3"].values()) == {"clean"}


@pytest.mark.slow
def test_generalizes_to_renamed_columns(tmp_path):
    """The same generator, on a dataset with different column names, still plants a
    flaw the engine catches. This is the not-hardcoded-to-one-file proof."""
    out = os.path.join(str(tmp_path), "brain.foil.h5ad")
    gt = generate_foil(_base_path(tmp_path, "brain"), out, flaw="all", backend="heuristic", verify=True)
    assert gt.plan.unit == "subject" and gt.plan.grouping == "treatment"
    v = gt.verification
    assert v["allMatch"], f"engine did not catch the planted flaws on renamed columns: {v.get('mismatches')}"


@pytest.mark.slow
def test_single_flaw_targeting(tmp_path):
    """A targeted confounding foil flags only Pillar 4; the rest stay clean."""
    out = os.path.join(str(tmp_path), "immune.conf.h5ad")
    gt = generate_foil(_base_path(tmp_path, "immune"), out, flaw="confounding", backend="heuristic", verify=True)
    v = gt.verification
    assert v["allMatch"], f"targeted foil mismatched: {v.get('mismatches')}"
    assert v["engine"]["4"] == "flagged"
    assert v["engine"]["1"] == "clean" and v["engine"]["2"] == "clean"
