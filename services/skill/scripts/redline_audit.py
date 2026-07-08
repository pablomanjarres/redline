#!/usr/bin/env python3
"""redline_audit.py — thin CLI over the `redline` rigor engine.

Runs one statistical check (or the design-resolution foundation step) on an
AnnData `.h5ad` file and prints the resulting ComputeResult as JSON on stdout.
Built for Claude Science / Claude Code local code execution: the heavy compute
lives in the `redline` package (installed from services/rigor); this script is
just an argv-to-JSON wrapper so an agent can run a check with one command.

    python redline_audit.py --h5ad analysis.h5ad --check 1
    python redline_audit.py --h5ad analysis.h5ad --check 2 \
        --config-json '{"split":0.5,"grouping":"leiden"}'
    python redline_audit.py --h5ad analysis.h5ad --check fields   # foundation step

Contract this script codes to (source of truth: docs/build/INTERFACES.md and the
Zod shapes in packages/contracts). The `redline` package is expected to expose:

    redline.audit(h5ad=<path>, check=<1|2|3|4>, config=<dict|None>,
                  fields=<list[dict]|None>) -> ComputeResult-shaped object
    redline.resolve_fields(h5ad=<path>) -> list of FieldSpec-shaped objects

Output shapes match the contracts exactly:
  * a check prints a ComputeResult: {checkId, state, headline, stats[], chart{}}
  * `--check fields` prints a FieldSpec[] (id, dtype, levels, missing, role,
    confidence, reason, ...).

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

CHECK_CHOICES = ["1", "2", "3", "4", "fields"]

# A per-check example config, surfaced in --help so a caller does not have to
# open the contracts to remember the knob names. These are illustrative values;
# omit --config-json entirely to let the engine apply its own defaults.
CONFIG_HINTS = {
    "1": '{"unit":"donor_id","grouping":"condition","alpha":0.05}',
    "2": '{"split":0.5,"grouping":"leiden"}',
    "3": '{"min":0.2,"max":2.0,"step":0.2,"track":"Effector"}',
    "4": '{"interest":"condition","nuisance":["lane"]}',
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


def import_redline() -> Any:
    """Import the `redline` package or exit 2 with an actionable message."""
    try:
        import redline  # type: ignore
    except ImportError as err:
        eprint(f"redline engine is not importable: {err}")
        eprint("install it from the repo root, for example:")
        eprint("  pip install -e services/rigor[stats]")
        raise SystemExit(2)
    return redline


def resolve_callable(redline: Any, names: list[str]) -> Any:
    """Return the first attribute in `names` that exists on the engine.

    The parallel build may land a slightly different name; failing loudly here
    with the list of attempted names beats an opaque AttributeError deeper in.
    """
    for name in names:
        fn = getattr(redline, name, None)
        if callable(fn):
            return fn
    eprint(f"redline exposes none of the expected callables: {names}")
    eprint("reconcile with services/rigor/redline (INTERFACES.md is the contract).")
    raise SystemExit(2)


def run_audit(redline: Any, h5ad: str, check: int, config: Any, fields: Any) -> Any:
    """Call redline.audit, tolerating `check` vs `check_id` keyword naming.

    Only forwards config/fields when the caller supplied them so the engine's own
    defaults and internal field resolution stay in charge otherwise.
    """
    audit = resolve_callable(redline, ["audit"])
    base: dict[str, Any] = {"h5ad": h5ad}
    if config is not None:
        base["config"] = config
    if fields is not None:
        base["fields"] = fields
    last_err: TypeError | None = None
    for key in ("check", "check_id"):
        try:
            return audit(**{**base, key: check})
        except TypeError as err:
            last_err = err
            continue
    raise SystemExit(f"redline.audit rejected both 'check' and 'check_id': {last_err}")


def run_fields(redline: Any, h5ad: str) -> Any:
    """Run the foundation step (design resolution) and return FieldSpec[]."""
    resolve = resolve_callable(redline, ["resolve_fields", "infer_fields"])
    return resolve(h5ad=h5ad)


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
        help="pillar to run: 1 pseudoreplication, 2 double dipping, "
        "3 clustering fragility, 4 confounding, or 'fields' for the "
        "design-resolution foundation step",
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

    redline = import_redline()

    try:
        if args.check == "fields":
            result = run_fields(redline, args.h5ad)
        else:
            result = run_audit(redline, args.h5ad, int(args.check), config, fields)
    except SystemExit:
        raise
    except Exception as err:  # noqa: BLE001 — surface any engine failure cleanly
        eprint(f"redline engine failed on check {args.check!r}: {err}")
        return 1

    indent = args.indent if args.indent and args.indent > 0 else None
    separators = (",", ":") if indent is None else None
    json.dump(to_jsonable(result), sys.stdout, indent=indent, separators=separators)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
