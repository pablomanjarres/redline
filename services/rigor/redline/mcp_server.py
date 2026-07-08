"""Redline MCP server (stdio).

Exposes the foundation field resolver plus one tool per rigor pillar over the
``redline`` Python engine. Each check tool takes an ``.h5ad`` path and a per-check
config object, loads the AnnData, runs the engine, and returns the
``ComputeResult`` as camelCase JSON matching the ``@redline/contracts`` Zod
shapes (``checkId``, ``state``, ``headline``, ``stats``, ``chart``).

Wired as the ``redline-mcp`` entry point (see ``pyproject.toml``). The compute
bridge (load AnnData, resolve engine functions, JSON-normalize, keep stdout
clean for the stdio protocol) lives in ``redline.job_runner`` so there is one
source of truth and the Cloud Run image never needs the MCP SDK.

Tools:
  redline_resolve_fields          obs columns -> FieldSpec[] JSON
  redline_check_pseudoreplication pillar 1
  redline_check_double_dipping    pillar 2
  redline_check_fragility         pillar 3
  redline_check_confounding       pillar 4

Each check tool also accepts an optional ``fields`` argument (a confirmed
FieldSpec[]). When it is omitted the tool resolves fields from the file first,
so a caller can run a check with only a path and a config.
"""

from __future__ import annotations

from typing import Any

from redline.job_runner import compute_result, resolve_fields, to_json

_INSTRUCTIONS = (
    "Redline is a statistical-rigor auditor for single-cell RNA-seq. Point each "
    "check tool at an .h5ad file and a per-check config; it returns a ComputeResult "
    "(checkId, state, headline, stats, chart) as camelCase JSON. Start with "
    "redline_resolve_fields to see the obs columns and their proposed roles, then "
    "confirm the roles before running a check: a wrong role makes every downstream "
    "flag wrong."
)


def _check_result(check_id: int, h5ad: str, config: Any, fields: Any) -> str:
    return to_json(compute_result(check_id, h5ad, config, fields))


def _build_server():
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as exc:
        raise SystemExit(
            "The MCP SDK is not installed. Install the server extra with "
            "`pip install 'redline-rigor[mcp]'`."
        ) from exc

    server = FastMCP("redline", instructions=_INSTRUCTIONS)

    @server.tool()
    def redline_resolve_fields(h5ad: str) -> str:
        """Resolve an .h5ad's obs columns into FieldSpec[] JSON.

        Returns one entry per column with its proposed role (unit, grouping,
        observation, nuisance, covariate, derived, ignore), dtype, cardinality,
        missing count, and confidence. Confirm these before running a check.
        """
        return to_json(resolve_fields(h5ad))

    @server.tool()
    def redline_check_pseudoreplication(
        h5ad: str, config: dict[str, Any], fields: list[dict[str, Any]] | None = None
    ) -> str:
        """Pillar 1 (pseudoreplication): test whether a cell-level significance
        claim survives aggregation to the independent unit named in ``config.unit``
        (donor, mouse, patient). Returns a ComputeResult. The pseudobulk retest is
        the one place Redline asserts a corrected result; too few units per group
        returns a hard stop instead.
        """
        return _check_result(1, h5ad, config, fields)

    @server.tool()
    def redline_check_double_dipping(
        h5ad: str, config: dict[str, Any], fields: list[dict[str, Any]] | None = None
    ) -> str:
        """Pillar 2 (double dipping): hold out ``config.split`` of the cells,
        re-test the cluster markers on the held-out half, and report how many
        separate on data that was not used to define them. This is evidence of
        survival, a held-out check, not a certified FDR correction; ClusterDE is
        the stronger method. Returns a ComputeResult.
        """
        return _check_result(2, h5ad, config, fields)

    @server.tool()
    def redline_check_fragility(
        h5ad: str, config: dict[str, Any], fields: list[dict[str, Any]] | None = None
    ) -> str:
        """Pillar 3 (clustering fragility): sweep clustering resolution from
        ``config.min`` to ``config.max`` in ``config.step`` increments and report
        whether ``config.track`` stays a discrete cluster or appears only in a
        narrow band of settings. A group that is stable across the sweep returns a
        clean verdict. Returns a ComputeResult.
        """
        return _check_result(3, h5ad, config, fields)

    @server.tool()
    def redline_check_confounding(
        h5ad: str, config: dict[str, Any], fields: list[dict[str, Any]] | None = None
    ) -> str:
        """Pillar 4 (confounding): cross-tabulate the grouping of interest
        (``config.interest``) against each technical variable in
        ``config.nuisance`` and report Cramer's V. A grouping that moves one-to-one
        with a technical variable is not separable from it. Returns a ComputeResult.
        """
        return _check_result(4, h5ad, config, fields)

    return server


def main() -> None:
    _build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
