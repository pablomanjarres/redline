"""Registry integrity and the fire-on-the-right-case tests.

These import the module registry, so they need the eight modules to exist. Until
the module files land they error at collection, which is expected: the contract
is fixed, the implementations are in flight.
"""

from __future__ import annotations

import pytest

pytest.importorskip("numpy")
pytest.importorskip("anndata")

# Import the functions from the submodule directly: ``from redline import audit``
# binds the ``redline.audit`` module, not the ``audit`` function inside it.
from redline.audit import audit, run_check  # noqa: E402
from redline.contracts import CHECK_IDS as CONTRACT_CHECK_IDS  # noqa: E402
from redline.contracts import MethodRef  # noqa: E402
from redline.modules import REGISTRY, Claim, Design  # noqa: E402

_INTERFACE = ("applies_to", "detect", "prove", "correct", "preview", "recommend")

# Checks whose applicability is gated on a resolved grouping (or unit) role. The
# clustering checks (3, 7) run mechanically on a de-novo clustering and are not
# gated on a role, so they are excluded from the unresolved-roles assertion.
_ROLE_GATED = (1, 2, 4, 5, 6, 8)


# ── registry parity ──────────────────────────────────────────────────────────
def test_registry_matches_contract_ids():
    assert set(REGISTRY.keys()) == set(CONTRACT_CHECK_IDS)
    # keyed by the module's own id, in the 1..8 range.
    for cid, mod in REGISTRY.items():
        assert int(mod.id) == int(cid)
        assert cid in CONTRACT_CHECK_IDS


def test_every_module_has_identity_and_a_real_citation():
    for cid, mod in REGISTRY.items():
        assert isinstance(mod.name, str) and mod.name.strip(), f"check {cid} name empty"
        assert isinstance(mod.one_line, str) and mod.one_line.strip(), f"check {cid} one_line empty"
        assert isinstance(mod.error_class, str) and mod.error_class.strip(), f"check {cid} error_class empty"
        cit = mod.citation
        assert isinstance(cit, MethodRef), f"check {cid} citation is not a MethodRef"
        assert isinstance(cit.year, int) and cit.year > 1900, f"check {cid} citation lacks a real year"
        assert isinstance(cit.venue, str) and cit.venue.strip(), f"check {cid} citation lacks a venue"
        assert isinstance(cit.authors, str) and cit.authors.strip(), f"check {cid} citation lacks authors"


def test_every_module_implements_the_interface():
    for cid, mod in REGISTRY.items():
        for method in _INTERFACE:
            assert callable(getattr(mod, method, None)), f"check {cid} missing {method}"


def test_no_user_facing_prose_carries_an_em_dash():
    for cid, mod in REGISTRY.items():
        for text in (mod.name, mod.one_line, mod.citation.venue, mod.citation.note):
            assert "—" not in str(text), f"check {cid} prose has an em dash"


# ── applies_to gates on resolved roles ───────────────────────────────────────
def test_applies_to_is_false_when_roles_are_unresolved():
    empty = Design(fields=(), config={})
    claim = Claim(kind="unknown")
    for cid in _ROLE_GATED:
        assert REGISTRY[cid].applies_to(claim, empty) is False, (
            f"check {cid} claims to apply to an empty design with no resolved roles"
        )


# ── the added checks fire on the cases that exercise them ────────────────────
def _finding(case, cid: int) -> dict:
    return run_check(cid, case.adata, case.config_for(cid), case.fields)


def _assert_fires_with_full_correction(finding: dict, cid: int) -> None:
    assert finding["checkId"] == cid
    assert finding["state"] in ("flagged", "hard_stop"), f"check {cid} did not fire: {finding['state']}"
    assert finding.get("correctedCode"), f"check {cid} fired without corrected code"
    recs = finding.get("recommendations")
    assert recs and len(recs) >= 1, f"check {cid} fired without a recommendation"
    assert finding.get("preview") is not None, f"check {cid} fired without a preview"


def test_check5_fires_on_uncorrected_multiple_testing(case_a):
    _assert_fires_with_full_correction(_finding(case_a, 5), 5)


def test_check6_fires_on_a_separable_unmodeled_batch(case_b):
    # seq_batch is separable from treatment (Cramer's V ~ 0.6, not collinear) and
    # perturbs b5..b9, so modelling it changes the effect: a real correction.
    _assert_fires_with_full_correction(_finding(case_b, 6), 6)


def test_check7_fires_on_an_unjustified_resolution(case_a):
    _assert_fires_with_full_correction(_finding(case_a, 7), 7)


def test_check8_fires_on_a_ttest_claimed_on_raw_counts(case_a):
    _assert_fires_with_full_correction(_finding(case_a, 8), 8)


# ── audit only reports the checks that applied, and never says "of 4" ─────────
def test_audit_reports_only_applicable_checks_and_no_of_4(case_a):
    out = audit(case_a.adata)
    results = out["results"]
    assert 1 <= len(results) <= len(REGISTRY)
    seen = [r["checkId"] for r in results]
    assert len(seen) == len(set(seen)), "a check ran twice"
    for r in results:
        assert r["checkId"] in REGISTRY
        assert r["state"] in ("flagged", "clean", "flag_only", "hard_stop")
    verdict = out["report"]["verdict"]
    assert "of 4" not in verdict, f"verdict hardcodes a count of 4: {verdict!r}"
    assert "—" not in verdict
