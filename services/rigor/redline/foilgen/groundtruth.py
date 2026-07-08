"""Ground truth: the machine-readable record the oracle and harness read.

Every generated foil carries a ground-truth record so its answer is known by
construction. The record is a strict superset of two existing shapes, so it drops
into the rest of the system without a translation layer:

- the oracle's ``Descriptor`` fields (``unit``, ``grouping``, ``nuisance``,
  ``state_col``, ``focus_gene``, ``spurious``, ``stable``, plus the foil path), so
  ``redline.oracle`` can score the running app against this case, and
- the foils manifest's ``intended_verdicts`` and per-case ``obs_columns``, so the
  four-check harness knows what each pillar should return.

On top of that it adds what Add-on 4 owns: the planted flaw ids, the plain-language
claim per flaw, the flawed statistic and how it was computed, and the expected
corrected result. That is what lets a scorer assert Redline caught the specific
flaw that was planted, and that a clean variant is genuinely clean.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Optional

from .planner import FLAW_BY_PILLAR, FoilPlan
from .plant import state_layout

# Citations per flaw, so a downstream report can name the fixing method. These
# match the method papers the product's reasoning layer cites.
_CITATION = {
    1: "Squair et al. 2021, Nature Communications (pseudobulk aggregation).",
    2: "Neufeld et al. count splitting; ClusterDE is the stronger FDR-controlling method.",
    3: "Cluster stability across the resolution sweep (adjusted Rand index).",
    4: "Design-matrix separability; a confounded effect is not identifiable.",
}


def tracks(plan: FoilPlan) -> list[tuple[str, str]]:
    """The cell states Pillar 3 should follow, each with its expected verdict.

    A noise state is flagged only when fragility is a planted flaw; the genuine
    stable state is always tracked as the clean reference.
    """
    layout = state_layout(plan)
    noise = next((name for name, _p, kind in layout if kind == "noise"), None)
    out: list[tuple[str, str]] = []
    if (not plan.clean) and (3 in set(plan.planted_flaws)) and noise:
        out.append((noise, "flagged"))
    out.append((plan.stable_state, "clean"))
    return out


def intended_verdicts(plan: FoilPlan) -> dict[str, Any]:
    """The verdict each pillar should return on this foil."""
    planted = set(plan.planted_flaws)

    def v(pid: int) -> str:
        return "flagged" if (not plan.clean and pid in planted) else "clean"

    # Pillar 1 hard-stops when a group has fewer than two biological replicates:
    # no valid test exists by any method, so the honest verdict is not "clean".
    p1 = "flagged" if (not plan.clean and 1 in planted) else ("hard_stop" if plan.min_units_per_group < 2 else "clean")
    return {"1": p1, "2": v(2), "3": {name: state for name, state in tracks(plan)}, "4": v(4)}


@dataclass
class GroundTruth:
    """The full, checkable record for one generated foil."""

    case_id: str
    scenario_id: str
    plan: FoilPlan
    source: dict[str, Any]
    facts: dict[str, Any]
    intended: dict[str, Any]
    track_list: list[tuple[str, str]]
    foil_path: Optional[str] = None
    verification: dict[str, Any] = field(default_factory=dict)

    def flaw_records(self) -> list[dict[str, Any]]:
        """One record per planted flaw: the claim, the flawed statistic and how it
        was computed, the expected verdict, and the expected corrected result."""
        out: list[dict[str, Any]] = []
        planted = self.plan.planted_flaws if not self.plan.clean else []
        corrected = (self.verification or {}).get("corrected", {})
        for pid in sorted(planted):
            rec: dict[str, Any] = {
                "pillar": pid,
                "flaw": FLAW_BY_PILLAR[pid],
                "claim": self.plan.claims.get(str(pid), ""),
                "expectedVerdict": "flagged",
                "citation": _CITATION[pid],
            }
            if pid == 1:
                rec["flawedStatistic"] = self.facts.get("naive_statistic", {})
                rec["expectedCorrected"] = corrected.get("1", {})
            elif pid == 2:
                rec["flawedStatistic"] = {
                    "method": "marker genes ranked on the same cells used to define the state (double dipping)",
                    "spuriousState": self.facts.get("states", {}).get("spurious_state"),
                    "namedMarkers": self.facts.get("states", {}).get("spurious_markers_named", []),
                    "computed_how": "the claimed markers are re-scored on an independent Poisson count split; they collapse.",
                }
                rec["expectedCorrected"] = corrected.get("2", {})
            elif pid == 3:
                rec["flawedStatistic"] = {
                    "method": "a cluster read off one clustering resolution and called a population",
                    "spuriousState": self.facts.get("states", {}).get("spurious_state"),
                    "computed_how": "the state is tracked across a resolution sweep; it is a discrete cluster only in a narrow window.",
                }
                rec["expectedCorrected"] = corrected.get("3", {})
            else:
                rec["flawedStatistic"] = {
                    "method": "differential expression across a grouping collinear with a technical variable",
                    "confound": self.facts.get("confounding", {}),
                    "computed_how": "Cramer's V between the grouping and the technical column is near 1, so the design is rank deficient.",
                }
                rec["expectedCorrected"] = corrected.get("4", {})
            out.append(rec)
        return out

    def to_manifest_entry(self) -> dict[str, Any]:
        """Harness- and oracle-compatible entry. Snake_case descriptor fields the
        oracle reads, plus the intended verdicts and the Add-on 4 extras."""
        p = self.plan
        entry: dict[str, Any] = {
            # Oracle Descriptor fields (snake_case, its accepted spelling).
            "case_id": self.case_id,
            "foil": self.foil_path,
            "scenario_id": self.scenario_id,
            "unit": p.unit,
            "grouping": p.grouping,
            "nuisance": p.nuisance,
            "state_col": p.state_col,
            "focus_gene": p.focus_gene,
            "spurious": self.facts.get("states", {}).get("spurious_state") or p.spurious_state,
            "stable": p.stable_state,
            # The scientist's claimed markers for the spurious state. The double-
            # dipping check audits exactly these; they do not survive a held-out
            # split. Present only when the double-dipping flaw is planted.
            "markers": (list(p.spurious_markers) if (not p.clean and 2 in set(p.planted_flaws)) else None),
            # Harness verdicts + tracks.
            "intended_verdicts": self.intended,
            "tracks": [[name, state] for name, state in self.track_list],
            "obs_columns": self.source.get("obsColumns", []),
            # Add-on 4 extras.
            "cleanVariant": p.clean,
            "plannedBy": p.planned_by,
            "controlLevel": p.control_level,
            "treatedLevel": p.treated_level,
            "source": self.source,
            "framing": p.framing,
            "plantedFlaws": self.flaw_records(),
            "verification": self.verification,
        }
        return entry

    def to_json(self) -> dict[str, Any]:
        return self.to_manifest_entry()


def write_manifest(entries: list[dict[str, Any]], out_path: str) -> str:
    """Write a foils manifest (the shape ``redline.oracle`` / the harness read)."""
    manifest = {
        "generatedBy": "redline.foilgen (Add-on 4 naive-foil generator)",
        "cases": entries,
    }
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    return out_path
