"""The corrected-code generator.

`render_corrected_code(check_id, params)` turns a check's resolved parameters into a
`CorrectedCode`: a runnable, self-contained Python script that reproduces Redline's honest
re-analysis. The executable skeleton is a hand-written template; only the params are
injected, with `repr()` so every value round-trips as a valid Python literal. The rendered
script is parsed with `ast.parse` before it can reach a user, so a broken template fails
loudly at render time instead of on the scientist's machine.
"""

from __future__ import annotations

import ast
from typing import Any

from ..contracts import CorrectedCode, Json
from .bundle import build_notebook, build_readme
from .stats import benjamini_hochberg
from .templates import SLOTS, TEMPLATES, assemble

#: The filename each check's script is emitted as.
FILENAMES: dict[int, str] = {
    1: "01_pseudoreplication.py",
    2: "02_double_dipping.py",
    3: "03_fragility.py",
    4: "04_confounding.py",
    5: "05_multiple_testing.py",
    6: "06_unmodeled_covariate.py",
    7: "07_resolution_choice.py",
    8: "08_test_assumptions.py",
}


def render_corrected_code(check_id: int, params: Json) -> CorrectedCode:
    """Render the runnable script for `check_id`, filled from `params`.

    Raises `ValueError` on an unknown check id or a template that does not parse, and
    `KeyError` when a required slot is missing from `params`. Extra keys in `params` are
    recorded but ignored by the template.
    """
    cid = int(check_id)
    if cid not in TEMPLATES:
        raise ValueError(f"unknown check id {check_id!r}; expected one of {sorted(TEMPLATES)}")

    required = SLOTS[cid]
    missing = [slot for slot in required if slot not in params]
    if missing:
        raise KeyError(
            f"check {cid} ({FILENAMES[cid]}) needs params {missing}; got keys {sorted(params)}"
        )

    injected: dict[str, str] = {key: repr(value) for key, value in params.items()}
    try:
        script = assemble(cid, injected)
    except KeyError as exc:  # a slot the template names but params did not supply
        raise KeyError(f"check {cid} template slot {exc} was not provided in params") from exc

    try:
        ast.parse(script)
    except SyntaxError as exc:
        raise ValueError(f"rendered check {cid} script does not parse: {exc}") from exc

    filename = FILENAMES[cid]
    h5ad = params.get("h5ad", "data.h5ad")
    return CorrectedCode(
        filename=filename,
        inline=script,
        entrypoint=f"python {filename} --h5ad {h5ad}",
        params={str(k): v for k, v in params.items()},
    )


def slug(check_id: int) -> str:
    """The filename stem for a check, e.g. `01_pseudoreplication`."""
    return FILENAMES[int(check_id)][:-3]


__all__ = [
    "FILENAMES",
    "benjamini_hochberg",
    "build_notebook",
    "build_readme",
    "render_corrected_code",
    "slug",
]
