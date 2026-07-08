"""Generate a naive foil (or a clean variant) from any single-cell dataset.

The orchestrator ties the four stages together: read the dataset, describe it,
plan a believable claim, plant the flaw (or the honest cleanliness), write the
foil, and run the real engine to confirm the verdict. It returns a ``GroundTruth``
whose labels the harness and the oracle read.

    from redline.foilgen import generate_foil
    gt = generate_foil("cache/base/immune.h5ad", "cache/foils/immune.foil.h5ad")
    assert gt.verification["allMatch"]
"""

from __future__ import annotations

import os
from typing import Any, Optional, Union

from .descriptor import describe_dataset
from .groundtruth import GroundTruth, intended_verdicts, tracks
from .plant import plant_foil
from .planner import plan_foil


def _load(input_data: Union[str, Any]) -> tuple[Any, str]:
    """Return (adata, input_label). Accepts a path or an in-memory AnnData."""
    if isinstance(input_data, str):
        import anndata as ad

        return ad.read_h5ad(input_data), input_data
    return input_data, "<in-memory>"


def _scenario_id(adata: Any, input_label: str) -> str:
    base = getattr(adata, "uns", {}) or {}
    preset = base.get("redline_base", {}).get("preset") if isinstance(base.get("redline_base"), dict) else None
    if preset:
        return str(preset)
    stem = os.path.splitext(os.path.basename(input_label))[0]
    return stem or "dataset"


def generate_foil(
    input_data: Union[str, Any],
    out_h5ad: str,
    flaw: str = "all",
    clean: bool = False,
    seed: int = 0,
    backend: str = "auto",
    case_id: Optional[str] = None,
    scenario_id: Optional[str] = None,
    verify: bool = True,
) -> GroundTruth:
    """Build one foil and its ground-truth record. Writes the ``.h5ad`` to
    ``out_h5ad`` and, when ``verify`` is set, runs the engine to confirm."""
    adata, input_label = _load(input_data)
    scenario = scenario_id or _scenario_id(adata, input_label)
    descriptor = describe_dataset(adata)
    if not descriptor.has_counts:
        raise ValueError(
            "raw integer counts are required to build a foil (looked in layers['counts'], .raw, and X). "
            "Pillars 1 and 2 and the marker planting have no honest re-run without them."
        )
    plan = plan_foil(descriptor, flaw=flaw, clean=clean, seed=seed, backend=backend)
    foil, facts = plant_foil(adata, plan, seed=seed)

    os.makedirs(os.path.dirname(os.path.abspath(out_h5ad)), exist_ok=True)
    foil.write_h5ad(out_h5ad)

    source = {
        "input": input_label,
        "nCells": int(foil.n_obs),
        "nGenes": int(foil.n_vars),
        "obsColumns": [str(c) for c in foil.obs.columns],
    }
    cid = case_id or f"{scenario}_{'clean' if clean else flaw}"
    gt = GroundTruth(
        case_id=cid,
        scenario_id=scenario,
        plan=plan,
        source=source,
        facts=facts,
        intended=intended_verdicts(plan),
        track_list=tracks(plan),
        foil_path=out_h5ad,
    )
    if verify:
        from .verify import verify_foil

        gt.verification = verify_foil(out_h5ad, plan)
    return gt


def generate_batch(
    jobs: list[dict[str, Any]],
    out_dir: str,
    backend: str = "auto",
    verify: bool = True,
) -> list[GroundTruth]:
    """Generate many foils. Each job is a dict with at least ``input``; optional
    ``flaw``, ``clean``, ``seed``, ``case_id``, ``scenario_id``, ``out``. Returns
    the ground-truth records; write the manifest with ``groundtruth.write_manifest``.
    """
    results: list[GroundTruth] = []
    for i, job in enumerate(jobs):
        flaw = job.get("flaw", "all")
        clean = bool(job.get("clean", False))
        scenario = job.get("scenario_id")
        default_name = f"{scenario or 'foil'}_{'clean' if clean else flaw}_{i}.h5ad"
        out = job.get("out") or os.path.join(out_dir, default_name)
        gt = generate_foil(
            job["input"],
            out,
            flaw=flaw,
            clean=clean,
            seed=int(job.get("seed", 0)),
            backend=backend,
            case_id=job.get("case_id"),
            scenario_id=scenario,
            verify=verify,
        )
        results.append(gt)
    return results
