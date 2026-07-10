"""Claim planning: decide a believable naive analysis for one dataset.

This is the step the spec means by "Claude drives the construction." Given the
descriptor, the planner picks the claim a less-experienced scientist would make:
which gene to headline, which cell state to invent, which arms to compare. It has
two backends behind one shape:

- ``bedrock``: Claude via AWS Bedrock reads the descriptor and proposes a claim
  grounded in the dataset's real genes and arms. Model id from
  ``REDLINE_BEDROCK_MODEL_ID``, region from ``AWS_REGION``. This is the same
  Bedrock-only rule the product follows.
- ``heuristic``: a deterministic planner that runs with no network and no model.
  It is the curated fallback, so the generator always produces a foil for anyone,
  and it is what the tests pin against.

Either way the output is a ``FoilPlan``. The plan never invents biology it cannot
ground: every gene it names exists in the dataset, and the flaw it plans is one
the descriptor marked feasible. The prose voice follows the repo rule: no em
dashes, direct and concrete.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Any, Optional

from .descriptor import DatasetDescriptor

# The four flaws, keyed by the pillar that catches each.
FLAW_BY_PILLAR = {
    1: "pseudoreplication",
    2: "double_dipping",
    3: "fragility",
    4: "confounding",
}
PILLAR_BY_FLAW = {v: k for k, v in FLAW_BY_PILLAR.items()}

# Believable, tissue-agnostic state names. A real scientist names a state after a
# program; these read as plausible across immune, brain, and tumor data.
_SPURIOUS_STATE_NAMES = ["Activated", "Reactive", "Transitional", "Intermediate", "Cycling", "Stressed"]
_STABLE_STATE_NAMES = ["Naive", "Resting", "Core", "Mature", "Quiescent", "Canonical"]


@dataclass
class FoilPlan:
    """The believable naive analysis to build on one dataset."""

    unit: Optional[str]
    grouping: Optional[str]
    nuisance: Optional[str]
    observation: Optional[str]
    state_col: str
    control_level: str
    treated_level: str
    focus_gene: str
    spurious_state: str
    spurious_markers: list[str]
    stable_state: str
    stable_markers: list[str]
    planted_flaws: list[int]  # pillar ids; empty means the clean variant
    clean: bool
    claims: dict[str, str]  # pillar id (as str) -> plain-language claim
    framing: str
    planned_by: str  # 'bedrock' | 'heuristic'
    # Fewest biological units in any arm. When this is below 2, no valid pillar-1
    # test exists, so the engine hard-stops rather than reporting clean, and the
    # intended verdict follows.
    min_units_per_group: int = 2

    def to_json(self) -> dict[str, Any]:
        return {
            "unit": self.unit,
            "grouping": self.grouping,
            "nuisance": self.nuisance,
            "observation": self.observation,
            "stateCol": self.state_col,
            "controlLevel": self.control_level,
            "treatedLevel": self.treated_level,
            "focusGene": self.focus_gene,
            "spuriousState": self.spurious_state,
            "spuriousMarkers": self.spurious_markers,
            "stableState": self.stable_state,
            "stableMarkers": self.stable_markers,
            "plantedFlaws": self.planted_flaws,
            "clean": self.clean,
            "claims": self.claims,
            "framing": self.framing,
            "plannedBy": self.planned_by,
            "minUnitsPerGroup": self.min_units_per_group,
        }


_FRAMING = (
    "Standard cluster-then-annotate-then-DE workflow built on this dataset. This is the analysis a "
    "less-experienced scientist would run. It is never a published expert analysis, and it never implies "
    "any real author erred. The rigor an expert applies is the standard Redline helps others reach."
)


def _strip_dashes(text: str) -> str:
    """Remove every dash the voice rule forbids from prose: em dash, en dash, and
    a spaced or bare double hyphen. Model-emitted claims run through this so they
    still pass the no-dash gate."""
    for spaced in (" — ", " – ", " -- "):
        text = text.replace(spaced, ", ")
    return text.replace("—", ", ").replace("–", ", ").replace("--", ", ")


def _clean_label(text: str) -> str:
    """A short cell-state label with any forbidden dash reduced to a hyphen."""
    return text.replace("—", "-").replace("–", "-").strip()[:40]


def _oriented_arms(descriptor: DatasetDescriptor) -> tuple[str, str]:
    """Control and treated arm labels, oriented with the engine's own helper so a
    control-looking level is the reference."""
    from ..pillars import two_groups

    levels = descriptor.grouping_levels
    if len(levels) < 2:
        # Degenerate: synthesize two labels so the plan stays well formed.
        only = levels[0] if levels else "control"
        return only, only
    picked = two_groups(sum(([lvl] * max(descriptor.grouping_counts.get(lvl, 1), 1) for lvl in levels), []))
    if picked is None:
        return levels[0], levels[1]
    ref, alt, _m0, _m1 = picked
    return str(ref), str(alt)


def _pick_markers(candidates: list[str], focus: str, n: int, offset: int) -> list[str]:
    pool = [g for g in candidates if g != focus]
    if not pool:
        return []
    out: list[str] = []
    i = offset
    while len(out) < n and len(out) < len(pool):
        out.append(pool[i % len(pool)])
        i += 1
    # De-duplicate while preserving order.
    seen: set[str] = set()
    uniq = [g for g in out if not (g in seen or seen.add(g))]
    return uniq


def _requested_pillars(flaw: str, descriptor: DatasetDescriptor) -> list[int]:
    """Resolve the requested flaw selection to the pillar ids that are feasible."""
    if flaw == "all":
        wanted = [1, 2, 3, 4]
    else:
        pid = PILLAR_BY_FLAW.get(flaw)
        if pid is None:
            raise ValueError(f"unknown flaw {flaw!r}; expected one of {sorted(PILLAR_BY_FLAW)} or 'all'")
        wanted = [pid]
    feasible = []
    for pid in wanted:
        name = FLAW_BY_PILLAR[pid]
        if descriptor.feasibility.get(name, {}).get("plantable"):
            feasible.append(pid)
    return feasible


def _claims(
    clean: bool,
    planted: list[int],
    treated: str,
    control: str,
    focus: str,
    spurious: str,
    stable: str,
    n_cells: int,
) -> dict[str, str]:
    """Plain-language claims. For a planted flaw the claim is the over-reach; for a
    clean pillar the claim is the defensible statement the clean variant supports."""
    claims: dict[str, str] = {}
    claims["1"] = (
        f"{treated} significantly changes {focus} expression relative to {control}, "
        f"significant at the single-cell level across {n_cells:,} cells."
        if (not clean and 1 in planted)
        else f"{focus} moves consistently with {treated} across biological replicates and survives pseudobulk."
    )
    claims["2"] = (
        f"A distinct {spurious} cell state, its marker genes read off the same cells that defined it."
        if (not clean and 2 in planted)
        else f"The {stable} state holds up: its markers still separate it on an independent split of the counts."
    )
    claims["3"] = (
        f"A discrete {spurious} population separates from the rest of the cells."
        if (not clean and 3 in planted)
        else f"The {stable} population is a discrete cluster across the clustering resolution sweep."
    )
    claims["4"] = (
        f"{treated} differs from {control}, tested across all cells."
        if (not clean and 4 in planted)
        else f"The {treated} versus {control} comparison is separable from the technical variable."
    )
    return claims


def plan_heuristic(descriptor: DatasetDescriptor, flaw: str, clean: bool, seed: int) -> FoilPlan:
    """Deterministic claim planner. No network, no model. The curated fallback."""
    control, treated = _oriented_arms(descriptor)
    focus = descriptor.naive_focus_gene or (descriptor.candidate_genes[0] if descriptor.candidate_genes else "GENE1")
    spurious_markers = _pick_markers(descriptor.candidate_genes, focus, n=4, offset=seed % 7)
    stable_markers = _pick_markers(descriptor.candidate_genes, focus, n=4, offset=(seed % 7) + 11)
    spurious_state = _SPURIOUS_STATE_NAMES[seed % len(_SPURIOUS_STATE_NAMES)]
    stable_state = _STABLE_STATE_NAMES[seed % len(_STABLE_STATE_NAMES)]
    planted = [] if clean else _requested_pillars(flaw, descriptor)
    claims = _claims(clean, planted, treated, control, focus, spurious_state, stable_state, descriptor.n_cells)
    return FoilPlan(
        unit=descriptor.unit,
        grouping=descriptor.grouping,
        # Fall back to the technical column name the planter creates when the
        # dataset has none, so the manifest never carries a null required field
        # (the oracle treats nuisance as required) and matches what is planted.
        nuisance=descriptor.nuisance or "batch",
        observation=descriptor.observation,
        state_col=descriptor.derived or "cell_state",
        control_level=control,
        treated_level=treated,
        focus_gene=focus,
        spurious_state=spurious_state,
        spurious_markers=spurious_markers,
        stable_state=stable_state,
        stable_markers=stable_markers,
        planted_flaws=planted,
        clean=clean,
        claims=claims,
        framing=_FRAMING,
        planned_by="heuristic",
        min_units_per_group=descriptor.min_units_compared,
    )


# ── Bedrock backend ───────────────────────────────────────────────────────────
_BEDROCK_SYSTEM = (
    "You design a NAIVE single-cell RNA-seq analysis for a rigor auditor's test set. Given a dataset "
    "descriptor, choose the claim a less-experienced scientist would plausibly make, so the auditor can "
    "later catch it. Ground every choice in the dataset: the focus gene and all markers MUST come from the "
    "provided candidateGenes. Invent believable, tissue-appropriate cell-state names. Never imply any real "
    "author erred. Do not use em dashes in any prose. Reply with a single JSON object and nothing else."
)


def _bedrock_prompt(descriptor: DatasetDescriptor, flaw: str, clean: bool) -> str:
    d = descriptor.to_json()
    compact = {
        "nCells": d["nCells"],
        "grouping": d["grouping"],
        "groupingLevels": d["groupingLevels"],
        "unit": d["unit"],
        "unitsPerGroup": d["unitsPerGroup"],
        "nuisance": d["nuisance"],
        "candidateGenes": d["candidateGenes"],
        "naiveFocusGene": d["naiveFocusGene"],
        "feasibleFlaws": [k for k, v in d["feasibility"].items() if v.get("plantable")],
    }
    intent = (
        "Design a genuinely CLEAN analysis (no flaw): a defensible claim that should pass every check."
        if clean
        else f"Plan flaw(s) to plant: {flaw}. Choose which listed feasibleFlaws to include."
    )
    schema = {
        "focusGene": "one gene from candidateGenes",
        "spuriousState": "believable cell-state name for the flagged state",
        "spuriousMarkers": "4 genes from candidateGenes that 'define' the spurious state",
        "stableState": "believable cell-state name for the genuine, stable state",
        "stableMarkers": "4 genes from candidateGenes for the stable state",
        "claims": {"1": "...", "2": "...", "3": "...", "4": "..."},
    }
    return (
        f"{intent}\n\nDATASET DESCRIPTOR:\n{json.dumps(compact, indent=2)}\n\n"
        f"Reply with JSON matching this shape (values are instructions):\n{json.dumps(schema, indent=2)}"
    )


def _invoke_bedrock(system: str, prompt: str) -> Optional[str]:
    """Call Claude on Bedrock. Returns the text reply, or None on any missing
    credential, missing dependency, or error (the caller then falls back)."""
    model_id = os.environ.get("REDLINE_BEDROCK_MODEL_ID")
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    if not model_id or not region:
        return None
    try:
        import boto3  # type: ignore
        from botocore.config import Config  # type: ignore

        # Bounded timeouts and a small retry cap so a Bedrock stall cannot hang a
        # build-time generation for minutes.
        client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(connect_timeout=5, read_timeout=60, retries={"max_attempts": 2}),
        )
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1200,
            "system": system,
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        }
        resp = client.invoke_model(modelId=model_id, body=json.dumps(body))
        payload = json.loads(resp["body"].read())
        parts = payload.get("content") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
        return text or None
    except Exception as exc:
        # Fail open to the heuristic, but say why so a misconfigured Bedrock is not
        # mistaken for an unconfigured one.
        print(f"foilgen: Bedrock planner unavailable, using the heuristic ({type(exc).__name__}: {exc})", file=sys.stderr)
        return None


def _parse_bedrock(text: str) -> Optional[dict]:
    """Pull the JSON object out of the model reply."""
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        return json.loads(text[start:end])
    except Exception:
        return None


def plan_bedrock(descriptor: DatasetDescriptor, flaw: str, clean: bool, seed: int) -> FoilPlan:
    """Bedrock-backed planner. Falls back to the heuristic on any failure, and
    repairs any field the model returned that is not grounded in the dataset."""
    base = plan_heuristic(descriptor, flaw, clean, seed)
    text = _invoke_bedrock(_BEDROCK_SYSTEM, _bedrock_prompt(descriptor, flaw, clean))
    if not text:
        return base
    parsed = _parse_bedrock(text)
    if not parsed:
        return base

    allowed = set(descriptor.candidate_genes)

    def _grounded_gene(value: Any, fallback: str) -> str:
        return str(value) if isinstance(value, str) and value in allowed else fallback

    def _grounded_markers(value: Any, fallback: list[str]) -> list[str]:
        if not isinstance(value, list):
            return fallback
        picks = [str(g) for g in value if isinstance(g, str) and g in allowed]
        return picks[:4] if len(picks) >= 2 else fallback

    focus = _grounded_gene(parsed.get("focusGene"), base.focus_gene)
    spurious_markers = _grounded_markers(parsed.get("spuriousMarkers"), base.spurious_markers)
    stable_markers = _grounded_markers(parsed.get("stableMarkers"), base.stable_markers)
    spurious_state = _clean_label(str(parsed.get("spuriousState") or base.spurious_state)) or base.spurious_state
    stable_state = _clean_label(str(parsed.get("stableState") or base.stable_state)) or base.stable_state
    claims = base.claims
    model_claims = parsed.get("claims")
    if isinstance(model_claims, dict):
        # Repair every forbidden dash the model may have slipped in; the voice rule
        # is non-negotiable and the no-dash test also gates en dashes.
        claims = {k: _strip_dashes(str(model_claims.get(k, base.claims.get(k, "")))) for k in ("1", "2", "3", "4")}

    return FoilPlan(
        unit=base.unit,
        grouping=base.grouping,
        nuisance=base.nuisance,
        observation=base.observation,
        state_col=base.state_col,
        control_level=base.control_level,
        treated_level=base.treated_level,
        focus_gene=focus,
        spurious_state=spurious_state,
        spurious_markers=spurious_markers,
        stable_state=stable_state,
        stable_markers=stable_markers,
        planted_flaws=base.planted_flaws,
        clean=base.clean,
        claims=claims,
        framing=_FRAMING,
        planned_by="bedrock",
        min_units_per_group=base.min_units_per_group,
    )


def plan_foil(
    descriptor: DatasetDescriptor, flaw: str = "all", clean: bool = False, seed: int = 0, backend: str = "auto"
) -> FoilPlan:
    """Plan a foil. ``backend`` is 'heuristic', 'bedrock', or 'auto' (try Bedrock,
    fall back to the heuristic when credentials are absent)."""
    if backend == "heuristic":
        return plan_heuristic(descriptor, flaw, clean, seed)
    if backend in ("bedrock", "auto"):
        return plan_bedrock(descriptor, flaw, clean, seed)
    raise ValueError(f"unknown planner backend {backend!r}")
