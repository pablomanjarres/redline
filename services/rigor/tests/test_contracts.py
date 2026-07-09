"""Contract shape tests: the Python engine must emit the EXACT camelCase keys the
TypeScript side (``@redline/contracts``) parses. These run with no scientific
stack installed (contracts is stdlib-only)."""

from __future__ import annotations

import math

import pytest

from redline.contracts import (
    ComputeResult,
    ConfoundGrid,
    Correction,
    CorrectedCode,
    FdrGene,
    FieldSpec,
    FragilityStep,
    Knob,
    Marker,
    MethodRef,
    PreviewArtifact,
    Recommendation,
    SignificanceLevel,
    UnitProfile,
    VolcanoPoint,
    compute_result,
    confound_chart,
    fdr_chart,
    field_spec,
    fmt_p,
    fragility_chart,
    groups_chart,
    hardstop_chart,
    jsonify,
    log10p,
    significance_chart,
    stat,
    volcano_chart,
)


def test_stat_omits_bad_good_when_unset():
    assert stat("True n", "6 donors").to_json() == {"label": "True n", "value": "6 donors"}
    assert stat("Naive p", "6.2e-11", bad=True).to_json() == {
        "label": "Naive p",
        "value": "6.2e-11",
        "bad": True,
    }
    assert stat("Honest p", "0.21", good=True).to_json()["good"] is True
    # value is always coerced to a string (StatReadout.value is z.string()).
    assert stat("Cells", 51842).to_json()["value"] == "51842"


def test_log10p_matches_reference():
    # -log10(3.1e-9) ~ 8.5, -log10(0.34) ~ 0.47 (the locked ketamine numbers).
    assert math.isclose(log10p(3.1e-9), 8.5, abs_tol=0.05)
    assert math.isclose(log10p(0.34), 0.47, abs_tol=0.05)
    # floored so p == 0 stays finite rather than raising.
    assert math.isfinite(log10p(0.0))


def test_significance_chart_keys():
    naive = SignificanceLevel(n=51842, p=6.2e-11, sig=True)
    honest = SignificanceLevel(n=4, p=0.21, sig=False)
    units = [UnitProfile(id="donor_1", group="NT", n=13000, value=1.02)]
    chart = significance_chart(naive, honest, alpha=0.05, units=units, bad_unit=True)

    assert chart["kind"] == "significance"
    assert chart["badUnit"] is True  # camelCase, not bad_unit
    assert "bad_unit" not in chart
    assert set(chart["naive"].keys()) == {"n", "p", "log10p", "sig"}
    assert chart["naive"]["sig"] is True
    assert math.isclose(chart["naive"]["log10p"], log10p(6.2e-11))
    assert set(chart["units"][0].keys()) == {"id", "group", "n", "value"}


def test_hardstop_chart_keys():
    chart = hardstop_chart(units=2, per_group=1, profiles=[UnitProfile("g", "KD", 5, 0.3)])
    assert chart["kind"] == "hardstop"
    assert chart["perGroup"] == 1  # camelCase, not per_group
    assert "per_group" not in chart
    assert chart["units"] == 2


def test_groups_chart_optional_aucs():
    markers = [Marker(gene="TNFRSF9", disc=0.90, hold=0.57)]
    bare = groups_chart(markers, split=0.5, verified=False)
    assert bare["kind"] == "groups"
    assert "discAUC" not in bare and "holdAUC" not in bare
    assert set(bare["markers"][0].keys()) == {"gene", "disc", "hold"}

    full = groups_chart(markers, split=0.5, verified=True, disc_auc=0.90, hold_auc=0.57)
    assert full["discAUC"] == 0.90  # camelCase keys the TS side reads
    assert full["holdAUC"] == 0.57


def test_fragility_chart_keys():
    steps = [FragilityStep(r=0.2, present=False, clusters=4), FragilityStep(r=1.0, present=True, clusters=8)]
    chart = fragility_chart(steps, present=(0.8, 1.2), track="Effector", stability=0.33)
    assert chart["kind"] == "fragility"
    assert chart["present"] == [0.8, 1.2]  # a 2-tuple serialized as a list
    assert chart["track"] == "Effector"
    assert set(chart["steps"][0].keys()) == {"r", "present", "clusters"}


def test_confound_chart_cramersv_nullable_but_present():
    grid = ConfoundGrid(rows=["KD", "NT"], cols=["Lane-A", "Lane-B"], cells=[[24106, 0], [0, 24107]])
    unverified = confound_chart(grid, cramers_v=None, verified=False)
    assert unverified["kind"] == "confound"
    assert "cramersV" in unverified and unverified["cramersV"] is None  # nullable, still emitted
    assert set(unverified["grid"].keys()) == {"rows", "cols", "cells"}

    verified = confound_chart(grid, cramers_v=1.0, verified=True)
    assert verified["cramersV"] == 1.0
    assert "cramers_v" not in verified


def test_compute_result_shape_and_validation():
    chart = confound_chart(ConfoundGrid([], [], []), None, False)
    res = compute_result(4, "flag_only", "No technical variable selected.", [stat("Assessed", "no")], chart)
    j = res.to_json()
    assert set(j.keys()) == {"checkId", "state", "headline", "stats", "chart"}
    assert j["checkId"] == 4  # camelCase, not check_id
    assert "check_id" not in j
    assert j["stats"][0] == {"label": "Assessed", "value": "no"}

    with pytest.raises(ValueError):
        ComputeResult(check_id=9, state="flagged", headline="", stats=[], chart=chart)
    with pytest.raises(ValueError):
        ComputeResult(check_id=1, state="explosion", headline="", stats=[], chart=chart)


def test_field_spec_keys_and_omission():
    f = field_spec(
        id="donor_id",
        dtype="categorical",
        levels=4,
        missing=0,
        role="unit",
        confidence="high",
        reason="Treatment is assigned at this level.",
    )
    j = f.to_json()
    assert set(j.keys()) == {"id", "dtype", "levels", "missing", "role", "confidence", "reason"}
    assert j["levels"] == 4

    numeric = field_spec("pct_mito", "numeric", None, 0, "covariate", "high", "Per-cell covariate.")
    assert numeric.to_json()["levels"] is None  # numeric columns carry null levels

    edited = field_spec(
        "lane", "categorical", 2, 0, "nuisance", "medium", "Technical.", sample="Lane-A · Lane-B", edited=True
    )
    ej = edited.to_json()
    assert ej["sample"] == "Lane-A · Lane-B"
    assert ej["edited"] is True

    with pytest.raises(ValueError):
        field_spec("x", "categorical", 1, 0, "not-a-role", "high", "bad role")


def test_field_spec_validates_enums():
    with pytest.raises(ValueError):
        field_spec("x", "float64", None, 0, "covariate", "high", "bad dtype")
    with pytest.raises(ValueError):
        field_spec("x", "numeric", None, 0, "covariate", "very-high", "bad confidence")


def test_jsonify_recurses():
    marker = Marker("TIGIT", 0.9, 0.55)
    assert jsonify([marker])[0] == {"gene": "TIGIT", "disc": 0.9, "hold": 0.55}
    assert jsonify({"a": marker})["a"]["gene"] == "TIGIT"
    assert jsonify(7) == 7


def test_fmt_p_no_em_dashes():
    for p in (6.2e-11, 0.21, 0.0, 1.0, 3.1e-9):
        s = fmt_p(p)
        assert "—" not in s  # never an em dash in user-facing prose
        assert isinstance(s, str)


# ── the correction-layer shapes (camelCase keys the TS side parses) ──────────
def test_volcano_chart_keys():
    pts = [
        VolcanoPoint(gene="FOXP3", log2fc=1.9, neg_log10_p=8.2, sig=True, claimed=True),
        VolcanoPoint(gene="g5", log2fc=0.1, neg_log10_p=0.3, sig=False),
    ]
    chart = volcano_chart(pts, alpha=0.05, fc_threshold=1.0, n_sig=1, label="pseudobulk + PyDESeq2, ~ condition")
    assert chart["kind"] == "volcano"
    assert chart["fcThreshold"] == 1.0  # camelCase, not fc_threshold
    assert chart["nSig"] == 1 and "n_sig" not in chart
    assert set(chart["points"][0].keys()) == {"gene", "log2fc", "negLog10P", "sig", "claimed"}
    assert chart["points"][0]["negLog10P"] == 8.2  # camelCase, not neg_log10_p
    # claimed is omitted when unset.
    assert "claimed" not in chart["points"][1]


def test_fdr_chart_keys_and_method_guard():
    top = [FdrGene(gene="TNFRSF9", p=0.0004, q=0.01, survives=True)]
    chart = fdr_chart(tests=200, alpha=0.05, raw_hits=18, adjusted_hits=7, method="bh", top=top)
    assert chart["kind"] == "fdr"
    assert chart["rawHits"] == 18 and chart["adjustedHits"] == 7  # camelCase
    assert "raw_hits" not in chart and "adjusted_hits" not in chart
    assert chart["method"] == "bh"
    assert set(chart["top"][0].keys()) == {"gene", "p", "q", "survives"}
    with pytest.raises(ValueError):
        fdr_chart(tests=1, alpha=0.05, raw_hits=0, adjusted_hits=0, method="holm", top=[])


def test_fragility_step_silhouette_omitted_when_none():
    bare = FragilityStep(r=0.4, present=True, clusters=6).to_json()
    assert "silhouette" not in bare  # check 3 omits it
    scored = FragilityStep(r=0.4, present=True, clusters=6, silhouette=0.31).to_json()
    assert scored["silhouette"] == 0.31  # check 7 fills it


def test_fragility_chart_chosen_and_supported_optional():
    steps = [FragilityStep(r=0.2, present=False, clusters=4), FragilityStep(r=1.0, present=True, clusters=8)]
    bare = fragility_chart(steps, present=(0.8, 1.0), track="Effector", stability=0.5)
    assert "chosen" not in bare and "supported" not in bare
    full = fragility_chart(
        steps, present=(0.8, 1.0), track="silhouette", stability=0.5, chosen=1.0, supported=(0.6, 1.2)
    )
    assert full["chosen"] == 1.0
    assert full["supported"] == [0.6, 1.2]  # a 2-tuple serialized as a list


def test_method_ref_url_omitted_when_absent():
    m = MethodRef(authors="Squair et al.", year=2021, venue="Nature Communications", note="Pseudobulk aggregation.")
    j = m.to_json()
    assert set(j.keys()) == {"authors", "year", "venue", "note"}
    assert j["year"] == 2021 and isinstance(j["year"], int)
    with_url = MethodRef(
        authors="Gao, Bien & Witten", year=2022, venue="JASA", note="Count splitting.", url="https://example.org"
    ).to_json()
    assert with_url["url"] == "https://example.org"


def test_recommendation_to_json_and_feasibility_guard():
    m = MethodRef(authors="Squair et al.", year=2021, venue="Nature Communications", note="Pseudobulk.")
    r = Recommendation(
        action="Aggregate donor into pseudobulk and re-test condition.",
        rationale="The cell-level p is inflated by 51,842 correlated cells.",
        changes="The p rises above alpha.",
        feasibility="fixable_now",
        citation=m,
    )
    j = r.to_json()
    assert set(j.keys()) == {"action", "rationale", "changes", "feasibility", "citation"}
    assert j["feasibility"] == "fixable_now"
    assert j["citation"]["year"] == 2021
    # citation omitted when absent.
    bare = Recommendation(action="a", rationale="b", changes="c", feasibility="needs_new_data").to_json()
    assert "citation" not in bare
    with pytest.raises(ValueError):
        Recommendation(action="a", rationale="b", changes="c", feasibility="definitely_fixable")


def test_corrected_code_to_json():
    code = CorrectedCode(
        filename="pseudoreplication.py",
        inline="import anndata\n",
        entrypoint="main",
        params={"unit": "donor", "grouping": "condition", "alpha": 0.05},
    )
    j = code.to_json()
    assert set(j.keys()) == {"language", "filename", "inline", "entrypoint", "params"}
    assert j["language"] == "python"
    assert j["params"]["unit"] == "donor"


def test_preview_artifact_after_always_emitted_and_guards_raise():
    before = confound_chart(ConfoundGrid(["KD", "NT"], ["A", "B"], [[10, 0], [0, 10]]), cramers_v=1.0, verified=True)
    # unsalvageable: after is null, but the key is still emitted.
    unsalv = PreviewArtifact(method_label="collinearity", unsalvageable=True, before=before, after=None)
    j = unsalv.to_json()
    assert "after" in j and j["after"] is None
    assert j["methodLabel"] == "collinearity" and j["unsalvageable"] is True

    # salvageable: after carries the corrected artifact, caveat rides along.
    after = volcano_chart([], alpha=0.05, fc_threshold=1.0, n_sig=3, label="~ condition + lane")
    salv = PreviewArtifact(
        method_label="covariate refit", unsalvageable=False, before=before, after=after, caveat="Batch modelled."
    )
    sj = salv.to_json()
    assert sj["after"]["kind"] == "volcano"
    assert sj["caveat"] == "Batch modelled."

    # the two structural guards: a fix on an unsalvageable finding, and a missing
    # fix on a salvageable one, both raise.
    with pytest.raises(ValueError):
        PreviewArtifact(method_label="x", unsalvageable=True, before=before, after=after)
    with pytest.raises(ValueError):
        PreviewArtifact(method_label="x", unsalvageable=False, before=before, after=None)


def test_correction_to_json_omits_absent_keys():
    assert Correction().to_json() == {}
    code = CorrectedCode(filename="c.py", inline="x", entrypoint="main", params={})
    rec = Recommendation(action="a", rationale="b", changes="c", feasibility="fixable_now")
    only_code = Correction(corrected_code=code).to_json()
    assert set(only_code.keys()) == {"correctedCode"}
    full = Correction(corrected_code=code, recommendations=[rec]).to_json()
    assert set(full.keys()) == {"correctedCode", "recommendations"}
    assert full["recommendations"][0]["feasibility"] == "fixable_now"


def test_knob_to_json_omits_unset_bounds():
    select = Knob(key="method", label="FDR method", kind="select", options=["bh", "by"]).to_json()
    assert set(select.keys()) == {"key", "label", "kind", "options"}
    assert select["options"] == ["bh", "by"]
    ranged = Knob(key="alpha", label="Alpha", kind="range", min=0.0, max=0.2, step=0.01).to_json()
    assert ranged["min"] == 0.0 and ranged["max"] == 0.2 and ranged["step"] == 0.01
