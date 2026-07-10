"""Bridge the web app's RemoteTarget protocol to the rigor engine.

The TS `RemoteTarget` (`packages/engine/src/targets/remote.ts`) speaks a small
envelope keyed by `op` + `scenarioId` and expects exactly one JSON value on
stdout:

    {"op": "resolve_fields", "scenarioId": "marson"}
    {"op": "check", "scenarioId": "marson", "checkId": 1, "config": {...}, "fields": [...]}
    {"op": "preview", "scenarioId": "marson", "checkId": 1, "config": {...}, "fields": [...]}

``check`` returns the flat ``EngineResult`` (the ``ComputeResult`` keys plus the
additive ``correctedCode`` / ``recommendations`` / ``preview`` when present).
``preview`` returns just that one check's ``preview`` object, so the TS side can
dispatch a heavier preview as its own job without recomputing the whole check
(it is ``null`` for a check that proved nothing, e.g. ``flag_only``).

The engine's `job_runner`, on the other hand, is keyed by a concrete `.h5ad`
path. This adapter is the missing glue: it reads the RemoteTarget envelope on
stdin, maps `scenarioId` -> a local `.h5ad` path (from an env var), dispatches to
`job_runner.resolve_fields()` / `compute_result()`, and prints one JSON line.

Wire it as the local compute target:

    export REDLINE_COMPUTE_TARGET=local
    export REDLINE_ENGINE_CMD="python -m redline.remote_adapter"
    export REDLINE_MARSON_H5AD=/abs/path/cache/cd4_tcell_perturbseq_subset.foil.h5ad
    export REDLINE_KETAMINE_H5AD=/abs/path/pfc_ketamine_scRNAseq.h5ad

The `.h5ad` is built by the data scripts in `services/rigor/data/` on a machine
with Python >=3.11 and the `[stats]` extra (scanpy / decoupler / PyDESeq2). Until
those env vars point at a real file, `getComputeTarget()` in the app keeps
falling back to the deterministic fixture, so nothing is ever presented as live
that is not.
"""

from __future__ import annotations

import json
import os
import sys

from redline.contracts import CHECK_IDS
from redline.job_runner import compute_result, resolve_fields, to_json

# scenarioId -> the env var that holds that scenario's built .h5ad path.
SCENARIO_H5AD_ENV = {
    "marson": "REDLINE_MARSON_H5AD",
    "ketamine": "REDLINE_KETAMINE_H5AD",
    "pfc": "REDLINE_PFC_H5AD",
    "clean": "REDLINE_CLEAN_H5AD",
    "nocounts": "REDLINE_NOCOUNTS_H5AD",
}


def _h5ad_for(scenario_id: str) -> str:
    env = SCENARIO_H5AD_ENV.get(scenario_id)
    path = os.environ.get(env) if env else None
    if not path:
        hint = env or f"REDLINE_{str(scenario_id).upper()}_H5AD"
        raise ValueError(f"no .h5ad configured for scenario '{scenario_id}' (set {hint})")
    return path


def handle(req: dict) -> object:
    op = req.get("op")
    scenario_id = req.get("scenarioId")
    if not scenario_id:
        raise ValueError("request is missing 'scenarioId'")
    h5ad = _h5ad_for(scenario_id)

    if op == "resolve_fields":
        return {"fields": resolve_fields(h5ad)}
    if op in ("check", "preview"):
        check_id = req.get("checkId")
        if check_id not in CHECK_IDS:
            allowed = ", ".join(str(i) for i in CHECK_IDS)
            raise ValueError(f"'checkId' must be one of {allowed}")
        result = compute_result(int(check_id), h5ad, req.get("config") or {}, req.get("fields"))
        if op == "preview":
            return result.get("preview")
        return result
    raise ValueError(f"unknown op '{op}' (expected 'resolve_fields', 'check', or 'preview')")


def main(argv: list[str] | None = None) -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print("redline-remote-adapter: empty request on stdin", file=sys.stderr)
        return 2
    try:
        req = json.loads(raw)
        if not isinstance(req, dict):
            raise ValueError("request must be a JSON object")
        result = handle(req)
    except ValueError as exc:
        print(f"redline-remote-adapter: bad request: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # surface a clean failure; never emit partial JSON
        print(f"redline-remote-adapter: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    sys.stdout.write(to_json(result) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
