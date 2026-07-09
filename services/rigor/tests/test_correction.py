"""The correction acceptance harness (spec section 9).

Four acceptance criteria, in one place:

1. The code runs and reproduces. The emitted script is its own oracle: it prints
   ``REDLINE_RESULT {json}`` and that json must match the numbers Redline
   reported and previewed.
2. Case B parameterization. The same checks on a structurally different design
   emit that design's field names, carry its values in ``params``, and still run.
3. Three-way consistency. The reported numbers, the preview's ``after`` artifact,
   and the code's ``REDLINE_RESULT`` all agree. If the preview and the code
   disagree, one of them is faked, and ``assert_three_way`` catches it.
4. Honesty holds. On an unsalvageable design nothing corrected is shown anywhere,
   the code prints ``"corrected": null``, and the contract guards raise.

The subprocess tests are marked ``slow`` and skip when scanpy / pydeseq2 are
absent, so the fast contract suite still runs everywhere.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import tempfile

import pytest

pytest.importorskip("numpy")
pytest.importorskip("anndata")

from redline import run_check  # noqa: E402
from redline.contracts import (  # noqa: E402
    PreviewArtifact,
    Recommendation,
    volcano_chart,
)


def _has(mod: str) -> bool:
    return importlib.util.find_spec(mod) is not None


_STATS_OK = _has("scanpy") and _has("pydeseq2")
needs_stats = pytest.mark.skipif(not _STATS_OK, reason="heavy stats stack (scanpy / pydeseq2) not installed")

ALL_CHECKS = (1, 2, 3, 4, 5, 6, 7, 8)


# ── running a check and running its emitted code ─────────────────────────────
def _fire(case, cid: int) -> dict:
    """Run one check on a case and return the flat EngineResult JSON."""
    return run_check(cid, case.adata, case.config_for(cid), case.fields)


def _fired_checks(case) -> dict[int, dict]:
    """The checks that fired on this case, keyed by id. A fired check flagged a
    problem and produced corrected code. A clean or flag_only check carries none,
    and a hard_stop shows no corrected result, so both are excluded here (the
    hard_stop path is exercised directly in the honesty tests)."""
    out: dict[int, dict] = {}
    for cid in ALL_CHECKS:
        finding = _fire(case, cid)
        if finding.get("state") == "flagged" and finding.get("correctedCode"):
            out[cid] = finding
    return out


def _last_redline_line(stdout: str):
    for line in reversed(stdout.splitlines()):
        s = line.strip()
        if s.startswith("REDLINE_RESULT"):
            return s[len("REDLINE_RESULT"):].strip()
    return None


def _run_emitted(inline: str, h5ad: str) -> dict:
    """Execute an emitted script in a subprocess and parse its REDLINE_RESULT."""
    fd, script = tempfile.mkstemp(suffix=".py")
    os.close(fd)
    with open(script, "w") as f:
        f.write(inline)
    try:
        proc = subprocess.run(
            [sys.executable, script, "--h5ad", h5ad],
            capture_output=True,
            text=True,
            timeout=600,
        )
    finally:
        os.unlink(script)
    assert proc.returncode == 0, (
        f"emitted script exited {proc.returncode}\n--- STDERR ---\n{proc.stderr}\n--- STDOUT ---\n{proc.stdout}"
    )
    payload = _last_redline_line(proc.stdout)
    assert payload is not None, f"no REDLINE_RESULT line in emitted-script stdout:\n{proc.stdout}"
    return json.loads(payload)


# ── the three-way consistency helper ─────────────────────────────────────────
def _corrected_scalar(artifact: dict):
    """The single number that defines a corrected artifact, by chart kind."""
    if not artifact:
        return None
    k = artifact.get("kind")
    if k == "volcano":
        return artifact.get("nSig")
    if k == "fdr":
        return artifact.get("adjustedHits")
    if k == "fragility":
        # check 7 fills supported/chosen (the corrected resolution); check 3 does
        # not, and its corrected statistic is the stability fraction.
        if artifact.get("supported") is not None:
            return artifact["supported"][0]
        return artifact.get("stability")
    if k == "groups":
        return artifact.get("holdAUC")
    if k == "significance":
        return (artifact.get("honest") or {}).get("p")
    if k == "confound":
        return artifact.get("cramersV")
    if k == "hardstop":
        return artifact.get("perGroup")
    return None


def _reported_corrected(finding: dict):
    """The corrected statistic Redline reports, and its comparison category.

    This is the number the scientist sees as "the corrected result", the same
    number the emitted script must reproduce as ``REDLINE_RESULT.corrected``. It
    lives in the evidence chart for most checks. For the confounding check the
    chart is the diagnostic (Cramer's V), and the corrected effect is rendered
    in ``preview.after``, so that is where the corrected statistic is read.
    """
    chart = finding.get("chart") or {}
    k = chart.get("kind")
    if k == "significance":
        return "p", (chart.get("honest") or {}).get("p")
    if k == "fdr":
        return "count", chart.get("adjustedHits")
    if k == "fragility":
        if chart.get("supported") is not None:
            return "res", chart["supported"][0]
        return "frac", chart.get("stability")
    if k == "volcano":
        return "count", chart.get("nSig")
    if k == "groups":
        return "auc", chart.get("holdAUC")
    if k == "confound":
        after = (finding.get("preview") or {}).get("after") or {}
        if after.get("kind") == "significance":
            return "p", (after.get("honest") or {}).get("p")
        if after.get("kind") == "volcano":
            return "count", after.get("nSig")
        return "v", chart.get("cramersV")
    return "rel", None


def _reported_original(finding: dict):
    """The naive/original statistic, where the evidence chart carries it in the
    same units as the code's ``original`` key. None where it does not."""
    chart = finding.get("chart") or {}
    k = chart.get("kind")
    if k == "significance":
        return "p", (chart.get("naive") or {}).get("p")
    if k == "fdr":
        return "count", chart.get("rawHits")
    return None, None


# Per-category tolerance: (mode, size). "abs" for counts and fractions, "p" for
# p-values (order-of-magnitude aware), "rel" for exact recomputations.
_TOL = {
    "count": ("abs", 1.0),
    "res": ("abs", 1e-3),
    "frac": ("abs", 0.05),
    "auc": ("abs", 0.03),
    "p": ("p", 1e-3),
    "v": ("abs", 1e-3),
}


def _assert_close(a, b, category: str, tol: dict, label: str) -> None:
    if a is None or b is None:
        return
    a = float(a)
    b = float(b)
    mode, size = (tol or {}).get(category, _TOL.get(category, ("rel", 1e-6)))
    if mode == "abs":
        assert abs(a - b) <= size, f"{label}: {a} vs {b} differ by more than {size}"
    elif mode == "p":
        la = math.log10(max(a, 1e-300))
        lb = math.log10(max(b, 1e-300))
        assert abs(a - b) <= size or abs(la - lb) <= 0.5, f"{label}: p-values disagree, {a} vs {b}"
    else:
        assert abs(a - b) <= size * max(1.0, abs(a), abs(b)), f"{label}: {a} vs {b} exceed rel {size}"


def assert_three_way(finding: dict, code_output: dict, tol: dict | None = None) -> None:
    """Reported numbers, preview.after, and the code's REDLINE_RESULT agree.

    The teeth: the corrected statistic Redline reported (from the evidence chart,
    or preview.after for the confound check) must equal the code's ``corrected``
    value within tolerance, and the naive statistic must equal the code's
    ``original``. If they disagree, the downloadable code does not reproduce the
    finding, and one of them is faked. As a further guard, when preview.after
    shares the chart's representation, its corrected scalar must match the code
    too, which is what catches a doctored preview.
    """
    tol = tol or {}
    prev = finding.get("preview")
    assert prev is not None, "a fired, salvageable finding must carry a preview"

    if prev.get("unsalvageable"):
        assert prev.get("after") is None, "an unsalvageable preview must not carry an after artifact"
        assert code_output.get("corrected") is None, "unsalvageable code must print corrected: null"
        assert code_output.get("unsalvageable") is True, "unsalvageable code must print unsalvageable: true"
        return

    after = prev.get("after")
    assert after is not None, "a salvageable finding must carry the corrected after artifact"
    assert "corrected" in code_output and code_output["corrected"] is not None, (
        "the emitted code must report a corrected number"
    )

    # SOURCE 1 (Redline's reported corrected statistic) vs SOURCE 2 (code output).
    cat, reported = _reported_corrected(finding)
    assert reported is not None, "could not read Redline's reported corrected statistic from the finding"
    _assert_close(reported, code_output["corrected"], cat, tol, "corrected")

    # The naive/original leg, where the chart carries it in the code's units.
    ocat, oreported = _reported_original(finding)
    if oreported is not None and code_output.get("original") is not None:
        _assert_close(oreported, code_output["original"], ocat, tol, "original")

    # SOURCE 3 (preview.after) when it shares the chart's representation: catches
    # a preview doctored to a different corrected number than the code.
    chart = finding.get("chart") or {}
    if after.get("kind") == chart.get("kind"):
        _assert_close(_corrected_scalar(after), code_output["corrected"], cat, tol, "preview.after")


# ── design tokens a recommendation is allowed to name ────────────────────────
def _design_tokens(case) -> set[str]:
    toks = {case.unit, case.grouping, case.derived, case.gene, case.ref, case.alt, case.target_group, case.track}
    if case.technical:
        toks.add(case.technical)
    toks |= set(case.markers)
    return {str(t) for t in toks if t}


# ═══════════════════════════════════════════════════════════════════════════
# Criterion 1: the code runs and reproduces (the code is its own oracle).
# ═══════════════════════════════════════════════════════════════════════════
def test_at_least_pseudoreplication_fires_on_case_a(case_a):
    fired = _fired_checks(case_a)
    assert 1 in fired, "pseudoreplication (check 1) must fire on case A"
    assert fired, "no check fired on case A; the harness would be vacuous"


@needs_stats
@pytest.mark.slow
def test_emitted_code_runs_and_reproduces_on_case_a(case_a):
    fired = _fired_checks(case_a)
    assert fired, "no check fired on case A"
    for cid, finding in fired.items():
        code = finding["correctedCode"]
        out = _run_emitted(code["inline"], case_a.path)
        assert_three_way(finding, out)


@needs_stats
@pytest.mark.slow
def test_emitted_code_is_deterministic_under_a_fixed_seed(case_a):
    fired = _fired_checks(case_a)
    for cid, finding in fired.items():
        inline = finding["correctedCode"]["inline"]
        first = _run_emitted(inline, case_a.path)
        second = _run_emitted(inline, case_a.path)
        assert set(first.keys()) == set(second.keys()), f"check {cid} emits unstable keys"
        for key, a in first.items():
            b = second[key]
            if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                assert abs(float(a) - float(b)) <= 1e-9, f"check {cid} key {key} not deterministic: {a} vs {b}"
            else:
                assert a == b, f"check {cid} key {key} not deterministic: {a!r} vs {b!r}"


# ═══════════════════════════════════════════════════════════════════════════
# Criterion 2: Case B parameterization.
# ═══════════════════════════════════════════════════════════════════════════
def test_case_b_emits_its_own_field_names_not_case_a(case_b):
    fired = _fired_checks(case_b)
    assert 1 in fired, "pseudoreplication must fire on case B too"
    # any of case B's own field names (or its structured gene) proves the code
    # reads the resolved design; none of case A's distinctive names may appear.
    b_names = list(case_b.field_names) + [case_b.gene]
    # case A's distinctive column names. "leiden" is excluded: it is the name of
    # the clustering algorithm (sc.tl.leiden), so it appears in any sweep script
    # regardless of the dataset, and is not case A's obs column leaking through.
    a_names = ["donor", "condition", "lane", "FOXP3", "cell_state", "guide_batch"]
    for cid, finding in fired.items():
        inline = finding["correctedCode"]["inline"]
        assert any(n in inline for n in b_names), f"check {cid} emitted code names none of case B's fields"
        for a in a_names:
            assert a not in inline, f"check {cid} emitted code hardcodes case A's {a!r}"


def test_case_b_params_carry_bs_resolved_values(case_b):
    fired = _fired_checks(case_b)
    finding = fired.get(1)
    assert finding is not None
    params = finding["correctedCode"]["params"]
    # check 1 params: unit, grouping, ref, alt, gene, covariates, alpha.
    assert params.get("unit") == "mouse_id"
    assert params.get("grouping") == "treatment"
    assert params.get("ref") == "vehicle"
    assert params.get("alt") == "drug"
    assert params.get("gene") == "Il2ra"
    # none of case A's names leak into the injected values.
    flat = json.dumps(params)
    for a in ("donor", "condition", "FOXP3"):
        assert a not in flat, f"case B params leak case A's {a!r}"


@needs_stats
@pytest.mark.slow
def test_emitted_code_runs_and_reproduces_on_case_b(case_b):
    fired = _fired_checks(case_b)
    assert fired
    for cid, finding in fired.items():
        out = _run_emitted(finding["correctedCode"]["inline"], case_b.path)
        assert_three_way(finding, out)


# ═══════════════════════════════════════════════════════════════════════════
# Criterion 3: three-way consistency, in isolation.
# ═══════════════════════════════════════════════════════════════════════════
@needs_stats
@pytest.mark.slow
def test_three_way_consistency_holds_for_every_fired_check(case_a):
    fired = _fired_checks(case_a)
    assert fired
    for cid, finding in fired.items():
        out = _run_emitted(finding["correctedCode"]["inline"], case_a.path)
        # each source must expose the corrected statistic; assert_three_way fails
        # loudly if the preview and the code disagree.
        assert_three_way(finding, out)


def test_assert_three_way_catches_a_faked_preview(case_a):
    """A sanity check on the harness itself: if the preview is doctored to a
    different corrected number than the code, assert_three_way must fail."""
    finding = {
        "state": "flagged",
        "chart": {"kind": "fdr", "rawHits": 20, "adjustedHits": 8, "method": "bh", "tests": 100, "alpha": 0.05, "top": []},
        "preview": {
            "methodLabel": "Benjamini-Hochberg",
            "unsalvageable": False,
            "before": {"kind": "fdr", "rawHits": 20, "adjustedHits": 20, "method": "bh", "tests": 100, "alpha": 0.05, "top": []},
            "after": {"kind": "fdr", "rawHits": 20, "adjustedHits": 999, "method": "bh", "tests": 100, "alpha": 0.05, "top": []},
        },
    }
    with pytest.raises(AssertionError):
        assert_three_way(finding, {"original": 20, "corrected": 8})


# ═══════════════════════════════════════════════════════════════════════════
# Criterion 4: honesty holds.
# ═══════════════════════════════════════════════════════════════════════════
def test_preview_artifact_refuses_a_fix_on_an_unsalvageable_finding():
    good = volcano_chart([], alpha=0.05, fc_threshold=1.0, n_sig=0, label="x")
    with pytest.raises(ValueError):
        PreviewArtifact(method_label="x", unsalvageable=True, before=good, after=good)


def test_recommendation_rejects_an_invented_feasibility():
    with pytest.raises(ValueError):
        Recommendation(action="a", rationale="b", changes="c", feasibility="definitely_fixable")


def test_confounded_design_is_unsalvageable_and_shows_no_fix(case_confounded):
    finding = _fire(case_confounded, 4)
    assert finding["state"] in ("flag_only", "flagged")
    prev = finding.get("preview")
    assert prev is not None, "an unsalvageable finding still renders a preview, with after: null"
    assert prev.get("unsalvageable") is True
    assert prev.get("after") is None, "no corrected artifact may be shown on a full confound"

    recs = finding.get("recommendations") or []
    assert recs, "an unsalvageable finding still recommends what to do (collect new data, redesign)"
    assert any(r["feasibility"] == "unsalvageable" for r in recs), "no recommendation names it unsalvageable"
    assert not any(r["feasibility"] == "fixable_now" for r in recs), (
        "an unsalvageable design must not carry a fixable-now recommendation (an invented fix)"
    )


@needs_stats
@pytest.mark.slow
def test_confounded_emitted_code_prints_null_never_a_number(case_confounded):
    finding = _fire(case_confounded, 4)
    code = finding.get("correctedCode")
    assert code, "even an unsalvageable finding emits the diagnostic script"
    out = _run_emitted(code["inline"], case_confounded.path)
    assert out.get("corrected") is None, "the confounded script must print corrected: null"
    assert out.get("unsalvageable") is True, "the confounded script must print unsalvageable: true"


def test_underpowered_design_hard_stops_with_no_corrected_result(case_underpowered):
    finding = _fire(case_underpowered, 1)
    assert finding["state"] == "hard_stop", "n=1 per group must hard-stop"
    prev = finding.get("preview")
    # no corrected result anywhere: either no preview, or a preview with after: null.
    if prev is not None:
        assert prev.get("after") is None, "a hard stop must not show a corrected result"
    recs = finding.get("recommendations") or []
    assert not any(r["feasibility"] == "fixable_now" for r in recs), "a hard stop must not propose a statistical fix"


def test_recommendations_reference_the_datasets_actual_fields(case_a):
    fired = _fired_checks(case_a)
    assert fired
    tokens = _design_tokens(case_a)

    def _names_a_field(action: str) -> bool:
        return any(tok in action for tok in tokens)

    def _grounded(action: str) -> bool:
        # A recommendation is grounded when it references an actual data specific:
        # a resolved field name, or a number of this analysis (a resolution value,
        # a q-threshold, a test count). A resolution fix reads "set the resolution
        # to 0.20 instead of 1.00"; a multiple-testing fix reads "across all 30
        # gene tests". Both are grounded without naming an obs column.
        return _names_a_field(action) or bool(re.search(r"\d", action))

    # The differential-expression and confounding checks name the resolved field
    # they act on; the sweep and multiple-testing checks ground in a number.
    field_naming_checks = {1, 4, 6, 8}
    for cid, finding in fired.items():
        recs = finding.get("recommendations") or []
        assert recs, f"check {cid} fired without a recommendation"
        assert any(_grounded(str(r.get("action", ""))) for r in recs), (
            f"check {cid}: no recommendation references a data specific"
        )
        if cid in field_naming_checks:
            for r in recs:
                if r.get("feasibility") == "fixable_now":
                    action = str(r.get("action", ""))
                    assert _names_a_field(action), (
                        f"check {cid} fixable-now recommendation names no resolved field: {action!r}"
                    )


def test_a_clean_finding_carries_no_correction(case_a):
    """Never cry wolf: tracking a stable state returns clean, and a clean verdict
    carries no corrected code, no recommendations, and no preview."""
    finding = _fire(case_a, 3)  # fragility, tracking the stable Naive state
    assert finding["state"] == "clean", "a stable population must be reported clean, not flagged"
    assert not finding.get("correctedCode"), "a clean finding must not carry corrected code"
    assert not finding.get("recommendations"), "a clean finding must not carry recommendations"
    assert not finding.get("preview"), "a clean finding must not carry a preview"
