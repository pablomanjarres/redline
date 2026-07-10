#!/usr/bin/env python3
"""redline_audit.py — thin CLI over the `redline` rigor engine.

Runs one statistical check (or the design-resolution foundation step) on an
AnnData `.h5ad` file and prints the resulting ComputeResult as JSON on stdout.
Built for Claude Science / Claude Code local code execution: the heavy compute
lives in the `redline` package (installed from services/rigor); this script is
just an argv-to-JSON wrapper so an agent can run a check with one command.

    python redline_audit.py --h5ad analysis.h5ad --check 1
    python redline_audit.py --h5ad analysis.h5ad --check 5 \
        --config-json '{"method":"bh","alpha":0.05}'
    python redline_audit.py --h5ad analysis.h5ad --check fields    # foundation step
    python redline_audit.py --h5ad analysis.h5ad --check inspect   # dataset inventory
    python redline_audit.py --h5ad analysis.h5ad --check audit     # foundation + all checks

Contract this script codes to (source of truth: docs/build/INTERFACES.md and the
Zod shapes in packages/contracts). It drives `redline.job_runner`, the same
path-based engine bridge the MCP server and the RemoteTarget use:

    job_runner.compute_result(check_id=<1..8>, h5ad=<path>, config=<dict>,
                              fields=<list[dict]|None>) -> EngineResult dict
    job_runner.resolve_fields(h5ad=<path>) -> list of FieldSpec dicts
    job_runner.inspect_dataset(h5ad=<path>) -> DatasetInventory dict
    job_runner.run_audit(h5ad=<path>, analysis=<dict|None>) -> {fields, results, report}

They load the .h5ad, run the foundation step when fields are not supplied, and
return JSON-safe dicts, so this stays a thin argv-to-JSON shim over the engine.

Output shapes match the contracts exactly:
  * a check prints an EngineResult: {checkId, state, headline, stats[], chart{}}
    plus correctedCode/recommendations/preview when the check produced them.
  * `--check fields` prints a FieldSpec[] (id, dtype, levels, missing, role,
    confidence, reason, ...).
  * `--check inspect` prints a DatasetInventory (obs, uns, hasRawCounts, ...).
  * `--check audit` prints {fields, results, report}.

stdout carries ONLY the JSON so it is safe to pipe or parse. All human-readable
diagnostics go to stderr. Exit codes: 0 success, 2 usage / engine-not-installed,
1 runtime failure inside the engine.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
from typing import Any

CHECK_CHOICES = ["1", "2", "3", "4", "5", "6", "7", "8", "fields", "inspect", "audit"]

# A per-check example config, surfaced in --help so a caller does not have to
# open the contracts to remember the knob names. These are illustrative values;
# omit --config-json entirely to let the engine apply its own defaults.
CONFIG_HINTS = {
    "1": '{"unit":"donor_id","grouping":"condition","alpha":0.05}',
    "2": '{"split":0.5,"grouping":"leiden"}',
    "3": '{"min":0.2,"max":2.0,"step":0.2,"track":"Effector"}',
    "4": '{"interest":"condition","nuisance":["lane"]}',
    "5": '{"method":"bh","alpha":0.05,"grouping":"condition"}',
    "6": '{"interest":"condition","covariate":"batch","alpha":0.05}',
    "7": '{"min":0.2,"max":2.0,"step":0.2,"criterion":"silhouette","chosen":1.0}',
    "8": '{"grouping":"condition","claimedTest":"ttest","alpha":0.05}',
    "audit": '{"gene":"IL2RA","track":"Effector"}',
}


def eprint(*args: Any) -> None:
    """Write a diagnostic line to stderr (keeps stdout pure JSON)."""
    print(*args, file=sys.stderr)


def load_json_arg(raw: str | None, label: str) -> Any:
    """Parse a JSON argument that may be an inline literal or a path to a file.

    Returns None when `raw` is None. Accepts either a JSON string on the command
    line or the path of a readable `.json` file, whichever is given.
    """
    if raw is None:
        return None
    if os.path.isfile(raw):
        try:
            with open(raw, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, json.JSONDecodeError) as err:
            raise SystemExit(f"could not read {label} from file {raw!r}: {err}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        raise SystemExit(f"{label} is not valid JSON: {err}")


def import_engine() -> Any:
    """Import the `redline.job_runner` bridge or exit 2 with an actionable
    message. This is the same path-based entry point the MCP server and the
    RemoteTarget call, so the CLI, the connector, and the web app share one
    load-AnnData / resolve-fields / run-check / JSON-normalize path.
    """
    try:
        from redline import job_runner  # type: ignore
    except ImportError as err:
        eprint(f"redline engine is not importable: {err}")
        eprint("install it from the repo root, for example:")
        eprint("  pip install -e services/rigor[stats]")
        raise SystemExit(2)
    return job_runner


def run_check(engine: Any, h5ad: str, check: int, config: Any, fields: Any) -> Any:
    """Run one pillar on the .h5ad and return its ComputeResult as a JSON dict.

    `job_runner.compute_result` loads the AnnData, resolves the design itself when
    `fields` is None, runs the check, and returns a JSON-safe dict. The engine
    applies its own per-check defaults, so an empty config is fine.
    """
    return engine.compute_result(int(check), h5ad, config or {}, fields)


def run_fields(engine: Any, h5ad: str) -> Any:
    """Run the foundation step (design resolution) and return FieldSpec[]."""
    return engine.resolve_fields(h5ad)


def run_inspect(engine: Any, h5ad: str) -> Any:
    """Run the intake step: inventory obs, uns, counts, layers, and gene ids
    without loading the expression matrix. Returns a DatasetInventory dict."""
    return engine.inspect_dataset(h5ad)


def run_audit(engine: Any, h5ad: str, analysis: Any) -> Any:
    """Run the one-call audit: the foundation step, every applicable check, and
    the assembled summary. `analysis` is an optional hints dict (gene, markers,
    target_group, track, or a per-check config map). Returns {fields, results,
    report}."""
    return engine.run_audit(h5ad, analysis)


def to_jsonable(value: Any) -> Any:
    """Coerce whatever the engine returns into JSON-serializable data.

    Handles plain data, pydantic models (.model_dump), dataclasses, objects with
    .to_dict, and finally __dict__, so this script does not couple to how the
    engine chooses to represent a ComputeResult.
    """
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    for attr in ("model_dump", "dict", "to_dict"):
        method = getattr(value, attr, None)
        if callable(method):
            try:
                return to_jsonable(method())
            except TypeError:
                pass
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return to_jsonable(dataclasses.asdict(value))
    if hasattr(value, "__dict__"):
        return to_jsonable(vars(value))
    return str(value)


def build_parser() -> argparse.ArgumentParser:
    hints = "\n".join(f"  check {k}: {v}" for k, v in CONFIG_HINTS.items())
    parser = argparse.ArgumentParser(
        prog="redline_audit.py",
        description="Run one Redline rigor check on an .h5ad and print the "
        "ComputeResult JSON. Thin wrapper over the `redline` engine.",
        epilog="example --config-json values (omit to use engine defaults):\n"
        + hints,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--h5ad",
        required=True,
        metavar="PATH",
        help="path to the AnnData .h5ad file under audit",
    )
    parser.add_argument(
        "--check",
        required=True,
        choices=CHECK_CHOICES,
        help="what to run: 1 pseudoreplication, 2 double dipping, 3 clustering "
        "fragility, 4 confounding, 5 multiple testing, 6 unmodeled covariate, "
        "7 resolution choice, 8 test assumptions; 'fields' for the "
        "design-resolution foundation step, 'inspect' for the dataset inventory, "
        "or 'audit' for the one-call audit (foundation + every applicable check)",
    )
    parser.add_argument(
        "--config-json",
        default=None,
        metavar="JSON|PATH",
        help="per-check config knobs, as a JSON object or a path to a .json "
        "file. Merged over the engine defaults.",
    )
    parser.add_argument(
        "--fields-json",
        default=None,
        metavar="JSON|PATH",
        help="pre-resolved FieldSpec[] (confirmed obs roles) as JSON or a path. "
        "When omitted the engine resolves the design itself.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        metavar="N",
        help="JSON indent; use 0 for a single compact line (default 2)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if not os.path.isfile(args.h5ad):
        eprint(f"no such .h5ad file: {args.h5ad}")
        return 2

    config = load_json_arg(args.config_json, "--config-json")
    fields = load_json_arg(args.fields_json, "--fields-json")

    engine = import_engine()

    try:
        if args.check == "fields":
            result = run_fields(engine, args.h5ad)
        elif args.check == "inspect":
            result = run_inspect(engine, args.h5ad)
        elif args.check == "audit":
            result = run_audit(engine, args.h5ad, config)
        else:
            result = run_check(engine, args.h5ad, int(args.check), config, fields)
    except SystemExit:
        raise
    except Exception as err:  # noqa: BLE001 — surface any engine failure cleanly
        eprint(f"redline engine failed on check {args.check!r}: {err}")
        return 1

    indent = args.indent if args.indent and args.indent > 0 else None
    separators = (",", ":") if indent is None else None
    # allow_nan=False keeps the output valid JSON: the engine sanitizes non-finite
    # floats to null, and this asserts none slipped through (JS JSON.parse rejects
    # NaN/Infinity, and the Zod contracts make such values nullable).
    json.dump(
        to_jsonable(result),
        sys.stdout,
        indent=indent,
        separators=separators,
        allow_nan=False,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
