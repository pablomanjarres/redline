"""Assemble the downloadable correction bundle: a README and a consolidated notebook.

Given one row per finding, `build_readme` writes what was wrong, what each script fixes,
and how to run them, and `build_notebook` writes a single .ipynb (nbformat 4) with a
header cell plus one markdown and one code cell per finding.

The honesty rule holds here too. An unsalvageable finding gets its markdown cell saying
the design cannot be rescued from this data and what would be needed instead, and it
carries no code cell claiming a fix. There is no path that renders a corrected result for
a finding with none.

stdlib only: this module builds JSON with the standard library so it imports without the
heavy stack.
"""

from __future__ import annotations

import json
from typing import Any, Sequence

Finding = dict[str, Any]


def _title(row: Finding) -> str:
    cid = row.get("checkId", "?")
    name = str(row.get("name", "finding"))
    return f"Check {cid}: {name}"


def _fix_line(row: Finding) -> str:
    """One sentence on what this script does, honest about the unsalvageable case."""
    if row.get("unsalvageable"):
        return (
            "This design cannot be rescued from this data, so there is no corrected "
            "result. The script prints the verdict and what new data would be needed."
        )
    corrected = row.get("corrected")
    if corrected is None:
        return "This script re-runs the analysis the honest way and prints the result."
    return (
        "This script re-runs the analysis the honest way. The corrected result is "
        f"{corrected}, printed as the last line so you can check it against the report."
    )


def build_readme(findings: Sequence[Finding]) -> str:
    """A short README: what was wrong, what each script fixes, how to run them."""
    lines: list[str] = []
    lines.append("# Redline corrected analysis")
    lines.append("")
    lines.append(
        "Redline re-ran the load-bearing statistics in your analysis. Each script below "
        "reproduces one honest re-analysis. Every script is self-contained and takes the "
        "path to your data:"
    )
    lines.append("")
    lines.append("```")
    lines.append("python <script>.py --h5ad your_data.h5ad")
    lines.append("```")
    lines.append("")
    lines.append(
        "Each script prints a human-readable report and, as its last line, a "
        "`REDLINE_RESULT` JSON object. That line is the machine-readable result, and it "
        "matches the numbers in the Redline report by construction."
    )
    lines.append("")
    if not findings:
        lines.append("No findings were flagged. Every check reported clean.")
        return "\n".join(lines) + "\n"

    lines.append("## Findings")
    lines.append("")
    for row in findings:
        lines.append(f"### {_title(row)}")
        lines.append("")
        filename = str(row.get("filename", ""))
        if row.get("error"):
            lines.append(f"Could not complete: {row['error']}")
            lines.append("")
            continue
        lines.append(_fix_line(row))
        lines.append("")
        if filename and not row.get("unsalvageable"):
            lines.append("```")
            lines.append(f"python {filename} --h5ad your_data.h5ad")
            lines.append("```")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _md_cell(source: str) -> dict[str, Any]:
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(keepends=True)}


def _code_cell(source: str) -> dict[str, Any]:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": source.splitlines(keepends=True),
    }


def build_notebook(findings: Sequence[Finding]) -> str:
    """A consolidated notebook (serialized .ipynb JSON, nbformat 4).

    One header cell, then per finding a markdown cell and, when a fix exists, a code cell.
    An unsalvageable finding gets its markdown cell and no code cell.
    """
    cells: list[dict[str, Any]] = []
    header = [
        "# Redline corrected analysis\n",
        "\n",
        "This notebook collects the honest re-analyses for every flagged finding. ",
        "Each code cell is a self-contained script. Point it at your data by setting ",
        "the `--h5ad` path, or run it from a shell.\n",
        "\n",
        "The last printed line of each script is a `REDLINE_RESULT` JSON object, the ",
        "machine-readable result that matches the Redline report.\n",
    ]
    cells.append({"cell_type": "markdown", "metadata": {}, "source": header})

    for row in findings:
        title = _title(row)
        filename = str(row.get("filename", ""))
        if row.get("error"):
            cells.append(_md_cell(f"## {title}\n\nCould not complete: {row['error']}\n"))
            continue
        if row.get("unsalvageable"):
            md = (
                f"## {title}\n\n"
                "This design cannot be rescued from this data. There is no corrected "
                "result to show. To answer the question, the experiment needs a design "
                "that separates the effect of interest from the confound, which means new "
                "data, not a re-analysis of this data.\n"
            )
            cells.append(_md_cell(md))
            continue
        md = f"## {title}\n\n{_fix_line(row)}\n\nFile: `{filename}`\n"
        cells.append(_md_cell(md))
        code = str(row.get("code", ""))
        if code:
            cells.append(_code_cell(code))

    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return json.dumps(notebook, indent=1)


__all__ = ["build_notebook", "build_readme"]
