"""Check 1 - Pseudoreplication, on the CheckModule interface.

Differential expression computed at the single-cell level while the experiment
has a handful of true biological replicates inflates significance: tens of
thousands of correlated cells are counted as independent observations. The honest
re-analysis aggregates to one profile per replicate and re-tests.

This is the one check where Redline asserts the corrected result, because
pseudobulk aggregation is the accepted-correct method (Squair et al. 2021).

The split, made real:

- ``detect`` runs the cheap cell-level Welch test and the replicate-count gate.
  Fewer than two replicates in a group is a hard stop (no valid test exists).
  A cell-level test that is not even significant is a confident clean verdict, and
  it costs nothing to reach.
- ``prove`` runs the honest pseudobulk re-test (PyDESeq2 when raw counts and the
  heavy stack are present, else a Welch t on the per-replicate means) plus the
  intra-unit correlation, by composing ``pillars.pseudoreplication.run``. The
  expensive test runs here, once.

The module never edits the pillar; it reuses ``_welch``, ``_resolve_gene`` and
``run`` and computes the correction facts (numbers, params, corrected volcano,
feasibility) around the pillar's authoritative statistics.
"""

from __future__ import annotations

import math
from typing import Any, Optional

from ..contracts import (
    CLEAN,
    FIXABLE_NOW,
    FLAG_ONLY,
    FLAGGED,
    HARD_STOP,
    NEEDS_NEW_DATA,
    UNSALVAGEABLE,
    CorrectedCode,
    Knob,
    MethodRef,
    Recommendation,
    SignificanceLevel,
    UnitProfile,
    VolcanoPoint,
    fmt_p,
    log10p,
    significance_chart,
    stat,
    volcano_chart,
)
from ..correction import kernels
from ..pillars import cfg_get, obs_series, resolve_role_column, two_groups
from ..pillars import pseudoreplication as P
from .base import Candidate, CheckModule, Claim, Clean, Design, Evidence

_UNDERPOWERED_UNITS = 6  # below this many total replicates, the honest test is thin.

_CITATION = MethodRef(
    authors="Squair et al.",
    year=2021,
    venue="Nature Communications",
    note="Aggregate correlated cells to the independent unit (pseudobulk) before testing.",
    url="https://www.nature.com/articles/s41467-021-25960-2",
)


def _noun(col: Optional[str]) -> str:
    return P._noun(col) if col else "unit"


def _diagnose(adata: Any, design: Design) -> Optional[dict]:
    """The cheap diagnostic shared by detect (and reused as params by prove).

    Resolves the grouping and the true replicate unit, picks the audited gene,
    aggregates to per-replicate means, and runs the cell-level Welch test. No
    pseudobulk model runs here; that is the expensive step and it belongs to
    ``prove``. Returns ``None`` when the design is not resolvable.
    """
    alpha = float(cfg_get(design.config, "alpha", 0.05))
    group_col = cfg_get(design.config, "grouping", None) or resolve_role_column(design.fields, "grouping")
    config_unit = cfg_get(design.config, "unit", None)
    true_unit = resolve_role_column(design.fields, "unit") or config_unit

    groups = obs_series(adata, group_col)
    if groups is None:
        return None
    picked = two_groups(groups, design.config)
    if picked is None:
        return None
    ref, alt, ref_mask_all, alt_mask_all = picked

    # Which column does the honest test aggregate on? If the user pointed the unit
    # at a per-cell column, that IS the pseudoreplication; fall back to the true
    # biological unit and record the mismatch. Mirrors the pillar exactly.
    import numpy as np

    n_obs = int(getattr(adata, "n_obs", len(groups)))
    bad_unit = False
    unit_col = config_unit
    cu = obs_series(adata, config_unit)
    if cu is not None and np.unique(cu).size >= max(0.9 * n_obs, n_obs - 1):
        bad_unit = True
        unit_col = true_unit
    if obs_series(adata, unit_col) is None:
        unit_col = true_unit
    units = obs_series(adata, unit_col)
    if units is None:
        return None

    C, _ = _counts_or_x(adata)
    keep = ref_mask_all | alt_mask_all
    groups_k = np.asarray([str(x) for x in groups])[keep]
    units_k = np.asarray([str(x) for x in units])[keep]
    var_names = [str(v) for v in getattr(adata, "var_names", range(C.shape[1]))]
    C = C[keep]

    m0 = groups_k == ref
    m1 = groups_k == alt
    gene, gi = P._resolve_gene(design.config, C, var_names, m0, m1)
    has_counts = _has_counts(adata)
    col = np.clip(C[:, gi], 0, None)
    expr = np.log1p(col) if has_counts else np.asarray(C[:, gi], dtype=float)

    profiles: list[UnitProfile] = []
    ref_units: set[str] = set()
    alt_units: set[str] = set()
    for glabel, gmask, uset in ((ref, m0, ref_units), (alt, m1, alt_units)):
        u_here = units_k[gmask]
        e_here = expr[gmask]
        for u in np.unique(u_here):
            vals = e_here[u_here == u]
            if vals.size == 0:
                continue
            profiles.append(UnitProfile(id=str(u), group=glabel, n=int(vals.size), value=float(vals.mean())))
            uset.add(str(u))

    per_group = min(len(ref_units), len(alt_units))
    total_units = len(ref_units | alt_units)
    _, p_naive = P._welch(expr[m0], expr[m1])

    return {
        "alpha": alpha,
        "group_col": str(group_col),
        "unit_col": str(unit_col),
        "ref": ref,
        "alt": alt,
        "gene": gene,
        "bad_unit": bool(bad_unit),
        "per_group": int(per_group),
        "total_units": int(total_units),
        "n_cells": int(keep.sum()),
        "p_naive": float(p_naive),
        "profiles": profiles,
        "covariates": design.roles("covariate"),
    }


def _counts_or_x(adata: Any):
    from .. import gating

    C, _ = gating.counts_array(adata)
    if C is not None:
        return C, True
    import numpy as np

    X = getattr(adata, "X", None)
    dense = gating._to_dense(X) if X is not None else np.zeros((int(getattr(adata, "n_obs", 1)), 1))
    return dense, False


def _has_counts(adata: Any) -> bool:
    from .. import gating

    return gating.require_counts(adata).ok


class Pseudoreplication(CheckModule):
    id = 1
    name = "Pseudoreplication"
    one_line = "Non-independent data inflating a p-value"
    error_class = "unit_of_analysis"
    citation = _CITATION
    claim_kinds = ("de",)
    knobs = (
        Knob(key="unit", label="Replicate unit", kind="text"),
        Knob(key="grouping", label="Grouping variable", kind="text"),
        Knob(key="alpha", label="Significance threshold", kind="number", min=0.001, max=0.2, step=0.001),
    )

    def applies_to(self, claim: Claim, design: Design) -> bool:
        if claim.kind and claim.kind != "unknown" and claim.kind not in self.claim_kinds:
            return False
        grouping = design.grouping or cfg_get(design.config, "grouping", None)
        unit = design.unit or cfg_get(design.config, "unit", None)
        return bool(grouping) and bool(unit)

    def detect(self, claim: Claim, adata: Any, design: Design):
        d = _diagnose(adata, design)
        if d is None:
            return Candidate(
                state=FLAG_ONLY,
                headline="No grouping and replicate unit are resolved, so this check cannot run.",
                numbers={},
                stats=[stat("Status", "needs input")],
            )

        if d["per_group"] < 2:
            head = f"No valid test is possible: '{d['unit_col']}' gives {d['per_group']} replicate per group."
            return Candidate(
                state=HARD_STOP,
                headline=head,
                numbers=d,
                stats=[
                    stat("Independent units", str(d["total_units"]), bad=True),
                    stat("Per group", str(d["per_group"]), bad=True),
                    stat("Minimum needed", ">= 2 / group"),
                ],
            )

        naive = SignificanceLevel(n=d["n_cells"], p=d["p_naive"], sig=d["p_naive"] < d["alpha"])
        if not naive.sig:
            # A cell-level test that is not significant cannot be inflated by
            # pseudoreplication. Report clean, confidently, without the heavy re-run.
            mirror = SignificanceLevel(n=d["total_units"], p=d["p_naive"], sig=False)
            chart = significance_chart(naive, mirror, d["alpha"], d["profiles"], d["bad_unit"])
            return Clean(
                headline=f"No inflated significance: {d['gene']} is not significant at the cell level either.",
                stats=[
                    stat("Naive p", fmt_p(d["p_naive"]), good=True),
                    stat("True n", f"{d['total_units']} {_noun(d['unit_col'])}"),
                ],
                chart=chart,
            )

        head = f"{d['gene']} is significant across {d['n_cells']:,} cells; the replicate-level test still has to hold."
        return Candidate(
            state="flagged",
            headline=head,
            numbers=d,
            stats=[stat("Naive p", fmt_p(d["p_naive"]), bad=True), stat("Cells counted", f"{d['n_cells']:,}")],
        )

    def prove(self, candidate: Candidate, adata: Any, design: Design) -> Evidence:
        d = candidate.numbers or _diagnose(adata, design) or {}
        alpha = float(d.get("alpha", cfg_get(design.config, "alpha", 0.05)))
        gene = str(d.get("gene", "") or "")
        unit_col = d.get("unit_col")

        params = {
            "h5ad": _h5ad_hint(design),
            "unit": str(unit_col) if unit_col else "",
            "grouping": str(d.get("group_col", "")),
            "ref": str(d.get("ref", "")),
            "alt": str(d.get("alt", "")),
            "gene": gene,
            # The honest re-test is the Squair pseudobulk on the grouping alone. The
            # covariate role here is per-cell QC (n_genes, pct_mito), which is not a
            # replicate-level design factor, so no covariate enters the pseudobulk fit.
            "covariates": [],
            "alpha": alpha,
        }

        # Hard stop: n=1 per group, decided in detect. No valid test exists, so
        # nothing is proven and no corrected result is shown.
        if candidate.state == HARD_STOP or int(d.get("per_group", 0)) < 2:
            zero = SignificanceLevel(n=0, p=1.0, sig=False)
            chart = candidate.chart or significance_chart(zero, zero, alpha, d.get("profiles", []), False)
            return Evidence(
                state=HARD_STOP,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=chart,
                numbers={"original": d.get("p_naive"), "corrected": None, "unsalvageable": True},
                method=self.citation,
                feasibility=UNSALVAGEABLE,
                params=params,
                corrected_artifact=None,
                caveat="With one biological replicate per group, no differential-expression test is valid.",
            )

        # The design did not resolve far enough to re-test.
        if candidate.state == FLAG_ONLY or not d.get("group_col"):
            zero = SignificanceLevel(n=0, p=1.0, sig=False)
            return Evidence(
                state=FLAG_ONLY,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=candidate.chart or significance_chart(zero, zero, alpha, [], False),
                numbers={"original": d.get("p_naive"), "corrected": None},
                method=self.citation,
                feasibility=NEEDS_NEW_DATA,
                params=params,
                corrected_artifact=None,
                message="A grouping and a replicate unit are needed to re-test at the replicate level.",
            )

        # Pseudobulk aggregation needs raw integer counts. Without them the honest
        # re-test cannot run, and Redline says so rather than inventing a number.
        if not _has_counts(adata):
            zero = SignificanceLevel(n=0, p=1.0, sig=False)
            return Evidence(
                state=FLAG_ONLY,
                headline="Raw integer counts are required to run the pseudobulk re-test.",
                stats=[stat("Naive p", fmt_p(d.get("p_naive", 1.0)), bad=True), stat("Raw counts", "not found", bad=True)],
                chart=significance_chart(zero, zero, alpha, d.get("profiles", []), bool(d.get("bad_unit"))),
                numbers={"original": d.get("p_naive"), "corrected": None},
                method=self.citation,
                feasibility=NEEDS_NEW_DATA,
                params=params,
                corrected_artifact=None,
                caveat="Provide a 'counts' layer or .raw with integer counts, then re-run the replicate-level test.",
            )

        # The honest re-test comes from the shared kernel, so the number Redline
        # reports here is the same number the emitted script prints.
        nums = kernels.check1_pseudoreplication(
            adata,
            unit=str(unit_col) if unit_col else None,
            grouping=str(d.get("group_col")),
            ref=str(d.get("ref")),
            alt=str(d.get("alt")),
            gene=gene or None,
            covariates=[],
            alpha=alpha,
        )
        p_naive = nums["original"]
        p_honest = nums["corrected"]
        if p_honest is None:
            zero = SignificanceLevel(n=0, p=1.0, sig=False)
            return Evidence(
                state=FLAG_ONLY,
                headline=candidate.headline,
                stats=list(candidate.stats),
                chart=significance_chart(zero, zero, alpha, [], False),
                numbers=nums,
                method=self.citation,
                feasibility=NEEDS_NEW_DATA,
                params=params,
                corrected_artifact=None,
                caveat="Raw integer counts are required to run the pseudobulk re-test.",
            )

        naive = SignificanceLevel(n=int(nums["n_cells"]), p=float(p_naive), sig=float(p_naive) < alpha)
        honest = SignificanceLevel(n=int(nums["n_units"]), p=float(p_honest), sig=float(p_honest) < alpha)
        chart = significance_chart(naive, honest, alpha, d.get("profiles", []), bool(d.get("bad_unit")))
        volcano = _volcano_after(chart, gene or "the audited gene", alpha, float(p_honest), honest.sig)

        state = CLEAN if honest.sig else FLAGGED
        if honest.sig:
            head = f"'{gene}' survives the replicate-level re-test (p {fmt_p(p_honest)}); the effect holds after aggregation."
        else:
            head = (
                f"'{gene}' is significant across {int(nums['n_cells']):,} cells (p {fmt_p(p_naive)}) but not at the "
                f"replicate level (p {fmt_p(p_honest)}); the significance is inflated by pseudoreplication."
            )
        stats = [
            stat("Naive p", fmt_p(p_naive), bad=True),
            stat("Honest p", fmt_p(p_honest), good=(not honest.sig)),
            stat("True n", f"{int(nums['n_units'])} {_noun(unit_col)}"),
        ]
        return Evidence(
            state=state,
            headline=head,
            stats=stats,
            chart=chart,
            numbers=nums,
            method=self.citation,
            feasibility=FIXABLE_NOW,
            params=params,
            corrected_artifact=volcano,
            caveat=f"Honest re-test: {nums['method']}.",
        )

    def recommend(self, evidence: Evidence, design: Design) -> list[Recommendation]:
        p = evidence.params
        unit = p.get("unit") or "the replicate unit"
        gene = p.get("gene") or "the gene"
        n = evidence.numbers

        if evidence.state == HARD_STOP:
            return [
                Recommendation(
                    action=f"Assign a field that carries real replicate units, or collect more, before testing '{gene}'.",
                    rationale="With one biological replicate per group there is no independent unit to test, so any p-value is invalid.",
                    changes="A differential-expression test becomes possible only once each group has at least two replicates.",
                    feasibility=UNSALVAGEABLE,
                    citation=self.citation,
                )
            ]
        if evidence.state == FLAG_ONLY:
            return [
                Recommendation(
                    action="Provide raw integer counts (a 'counts' layer or .raw), then re-run the pseudobulk test.",
                    rationale="Pseudobulk aggregation needs raw counts; the object as given holds only normalized values.",
                    changes=f"The cell-level p on '{gene}' can then be re-checked at the replicate level.",
                    feasibility=NEEDS_NEW_DATA,
                    citation=self.citation,
                )
            ]

        orig = n.get("original")
        corr = n.get("corrected")
        total = _total_units(evidence)
        unit_word = _noun(unit) if unit != "the replicate unit" else "replicates"
        recs: list[Recommendation] = []
        if evidence.state == "flagged":
            recs.append(
                Recommendation(
                    action=f"Aggregate to one profile per '{unit}' and re-test '{gene}' with pseudobulk (PyDESeq2).",
                    rationale=f"The cell-level p ({fmt_p(orig)}) counts correlated cells as independent; the replicate-level p is {fmt_p(corr)}.",
                    changes=f"'{gene}' is no longer significant once cells are aggregated to their biological replicate.",
                    feasibility=FIXABLE_NOW,
                    citation=self.citation,
                )
            )
        else:  # clean: the effect survived aggregation.
            held = f"{total} {unit_word}" if total else "the replicates"
            recs.append(
                Recommendation(
                    action=f"Report the pseudobulk-level result for '{gene}'; it is the defensible one.",
                    rationale=f"The effect holds after aggregation to {held} (p {fmt_p(corr)}).",
                    changes="No change to the conclusion; the correct statistic replaces the inflated one.",
                    feasibility=FIXABLE_NOW,
                    citation=self.citation,
                )
            )


        if total and total < _UNDERPOWERED_UNITS:
            recs.append(
                Recommendation(
                    action="Add biological replicates before drawing a firm conclusion from this comparison.",
                    rationale=f"The honest test rests on {total} replicates, which is thin; the estimate is imprecise.",
                    changes="More replicates tighten the interval and let the replicate-level test detect a real effect.",
                    feasibility=NEEDS_NEW_DATA,
                    citation=self.citation,
                )
            )
        return recs

    def correct(self, evidence: Evidence, adata: Any, design: Design) -> CorrectedCode:
        from .m05_multiple_testing import render_or_fallback

        return render_or_fallback(self.id, evidence.params)


def _restat(cr: dict) -> list:
    """Rebuild StatReadout objects from the pillar's already-serialized stats."""
    from ..contracts import StatReadout

    out = []
    for s in cr.get("stats", []):
        out.append(StatReadout(label=s["label"], value=s["value"], bad=s.get("bad"), good=s.get("good")))
    return out


def _total_units(evidence: Evidence) -> int:
    for s in evidence.stats:
        label = getattr(s, "label", "")
        if label.lower().startswith("true n"):
            digits = "".join(ch for ch in str(getattr(s, "value", "")) if ch.isdigit())
            if digits:
                return int(digits)
    return 0


def _volcano_after(chart: dict, gene: str, alpha: float, p_honest: float, sig: bool) -> dict:
    """Build the corrected volcano from the pseudobulk result the pillar computed.

    One point, the claimed gene, at its honest fold change and honest p. This is
    the real output of the same computation the emitted script performs, whether
    that was PyDESeq2 or the Welch fallback on the per-replicate means.
    """
    units = chart.get("units", [])
    groups = list(dict.fromkeys(u.get("group") for u in units))
    log2fc = 0.0
    if len(groups) >= 2:
        a = [u["value"] for u in units if u.get("group") == groups[0]]
        b = [u["value"] for u in units if u.get("group") == groups[1]]
        if a and b:
            log2fc = (sum(b) / len(b) - sum(a) / len(a)) / math.log(2.0)
    point = VolcanoPoint(gene=gene, log2fc=log2fc, neg_log10_p=log10p(p_honest), sig=sig, claimed=True)
    return volcano_chart([point], alpha, fc_threshold=1.0, n_sig=(1 if sig else 0), label="pseudobulk DE (honest)")


def _h5ad_hint(design: Design) -> str:
    return str(cfg_get(design.config, "h5ad", None) or "data.h5ad")


MODULE: CheckModule = Pseudoreplication()

__all__ = ["MODULE", "Pseudoreplication"]
