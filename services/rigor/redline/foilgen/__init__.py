"""Add-on 4: the naive-foil generator.

A build-time fixture factory. Given any single-cell ``.h5ad`` and its resolvable
field mapping, it manufactures a realistic naive analysis (the standard
cluster-then-annotate-then-DE workflow plus a plausible over-reach) whose planted
flaw is known by construction, then confirms with the real engine that Redline
catches it. It also builds genuinely clean variants for the never-cry-wolf case.

This is not a product feature. It exists to make test fixtures at volume, to feed
the prevalence study one naive analysis per public dataset, and to prove Redline
generalizes to data it has never seen. See ``docs/foil-generator.md``.

    from redline.foilgen import generate_foil
    gt = generate_foil("dataset.h5ad", "out.foil.h5ad")   # plants all four flaws
    gt = generate_foil("dataset.h5ad", "clean.h5ad", clean=True)  # Case C
"""

from __future__ import annotations

from .descriptor import DatasetDescriptor, describe_dataset
from .generate import generate_batch, generate_foil
from .groundtruth import GroundTruth, intended_verdicts, tracks, write_manifest
from .plant import plant_foil, state_layout
from .planner import FLAW_BY_PILLAR, PILLAR_BY_FLAW, FoilPlan, plan_foil
from .verify import verify_foil

__all__ = [
    "DatasetDescriptor",
    "describe_dataset",
    "FoilPlan",
    "plan_foil",
    "FLAW_BY_PILLAR",
    "PILLAR_BY_FLAW",
    "plant_foil",
    "state_layout",
    "GroundTruth",
    "intended_verdicts",
    "tracks",
    "write_manifest",
    "verify_foil",
    "generate_foil",
    "generate_batch",
]
