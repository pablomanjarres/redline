"""Render a case as the analysis write-up the baseline arm audits.

This is the fairness crux. The write-up is what a scientist would put in a
methods + results section: the claim, the naive test they ran (a cell-level
Wilcoxon, which is scanpy's default and the reason pseudoreplication is
widespread), the marker list, the clustering resolution, and the batch design.
It is neutral and STRUCTURALLY PARALLEL across error and clean cases, so nothing
in the phrasing tips the answer. A diligent reviewer has here exactly what they
would have for a real manuscript, and no more: distinguishing a real effect from
a pseudoreplication artifact, or real markers from double-dipped ones, requires
re-running the statistics, which is what the Redline arm does and this arm cannot.
"""

from __future__ import annotations

from typing import Any


def _fmt_p(p: float) -> str:
    if p is None:
        return "n/a"
    if p < 1e-3:
        return f"{p:.1e}"
    return f"{p:.3f}"


def render_evidence(per_pillar: dict) -> str:
    """Render the engine's RE-RUN diagnostic numbers for the evidence-baseline
    arm: the same model as the write-up baseline, but handed the statistics that
    only re-running the analysis produces. The engine's own verdict, headline,
    and state are deliberately stripped so the model judges from the numbers, not
    from Redline's answer. The gap between this arm and the write-up baseline is
    the value of re-running, isolated from reasoning quality."""
    e1 = per_pillar["pseudoreplication"]["evidence"]
    e2 = per_pillar["double_dipping"]["evidence"]
    e3 = per_pillar["fragility"]["evidence"]
    e4 = per_pillar["confounding"]["evidence"]

    def g(d, k):
        return d.get(k, "n/a")

    return f"""\
Re-run diagnostic statistics for a single-cell analysis (for rigor review).
These are the results of re-running the load-bearing tests on the data.

PSEUDOREPLICATION diagnostic
  cell-level differential-expression p-value: {_fmt_p(g(e1, 'naive_p') if e1.get('naive_p') is not None else None)}
  p-value after aggregating to the {g(e1, 'n_units')} biological replicates (pseudobulk): {_fmt_p(g(e1, 'honest_p') if e1.get('honest_p') is not None else None)}
  cells: {g(e1, 'n_cells')}, replicate units: {g(e1, 'n_units')}

DOUBLE-DIPPING diagnostic (count-split held-out marker test)
  discovery-split AUC of the claimed markers: {g(e2, 'discovery_auc')}
  held-out-split AUC of the same markers: {g(e2, 'heldout_auc')}
  claimed markers: {', '.join(g(e2, 'markers')) if isinstance(e2.get('markers'), list) else g(e2, 'markers')}

CLUSTERING-FRAGILITY diagnostic (resolution sweep)
  fraction of resolution settings where the state persists (stability): {g(e3, 'stability')}
  resolution range where present: {g(e3, 'present_range')} of {g(e3, 'n_settings')} settings

CONFOUNDING diagnostic
  Cramer's V between the comparison and the technical variable: {g(e4, 'cramers_v')}

From these diagnostics, judge which of the four error classes is present.
"""


def render(case: dict, stats: dict) -> str:
    """``case`` is a manifest entry; ``stats`` is that case's labeler stats."""
    claim = case["claim"]
    design = case["design"]
    n_cells = design["n_cells"]
    n_donors = len(design["donors"])
    per_group = design["per_group_donors"]
    n_batches = len(design["nuisance_levels"])
    resolution = claim["resolution"]
    focus = claim["focus_gene"]
    state = claim["target_state"]

    p1 = stats["pseudoreplication"]
    p2 = stats["double_dipping"]
    p4 = stats["confounding"]
    cell_p = p1.get("cell_p")
    markers = p2.get("markers", []) or []
    disc_auc = p2.get("disc_auc")
    direction = "higher" if cell_p is not None else "changed"

    # batch design: stated plainly for both the confounded and the balanced case
    if p4.get("cramers_v", 0) >= 0.99:
        batch_sentence = ("All treated samples were processed on sequencing batch "
                          "chip-A and all control samples on batch chip-B.")
    else:
        batch_sentence = ("Treated and control samples were distributed across both "
                          "sequencing batches.")

    marker_str = ", ".join(markers) if markers else "a set of top differential genes"
    sep_clause = f" (these genes separate the state with AUC {disc_auc:.2f})" if disc_auc else ""

    return f"""\
Single-cell RNA-seq analysis summary (for rigor review)

DESIGN
{n_cells} CD4+ T cells were profiled from {n_donors} donors, {per_group} per
condition, under two conditions (control and treated). {batch_sentence}

CLUSTERING
Cells were clustered with the Leiden algorithm at resolution {resolution:.1f}. A
"{state}" cell state was identified among the resulting clusters.

CLAIM 1 (differential expression of a marker gene)
Differential expression of {focus} between treated and control was assessed
across all {n_cells} cells with a Wilcoxon rank-sum test; p = {_fmt_p(cell_p)}.
We conclude that {focus} is significantly {direction} in the treated condition.

CLAIM 2 (state marker genes)
The "{state}" state was characterized by marker genes found by differential
expression between "{state}" cells and all other cells: {marker_str}{sep_clause}.
We report these as the defining markers of the "{state}" state.

CLAIM 3 (a distinct cell state)
We report "{state}" as a distinct, condition-associated cell state identified in
this dataset at the clustering resolution above.

CLAIM 4 (condition comparison)
Differential expression between treated and control was computed across the
dataset to characterize the transcriptional response to treatment.

Please review this analysis for statistical rigor.
"""
