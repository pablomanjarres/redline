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
  redline_resolve_fields              obs columns -> FieldSpec[] JSON
  redline_check_pseudoreplication     check 1
  redline_check_double_dipping        check 2
  redline_check_fragility             check 3
  redline_check_confounding           check 4
  redline_check_multiple_testing      check 5
  redline_check_unmodeled_covariate   check 6
  redline_check_resolution_choice     check 7
  redline_check_test_assumptions      check 8
  redline_corrected_code              the runnable corrected script for a check
  redline_audit                       the whole registry-driven audit

Each check tool also accepts an optional ``fields`` argument (a confirmed
FieldSpec[]). When it is omitted the tool resolves fields from the file first,
so a caller can run a check with only a path and a config. Each check tool
returns the flat ``EngineResult``: the ``ComputeResult`` keys plus, when the
check produced them, ``correctedCode``, ``recommendations``, and ``preview``.
"""

from __future__ import annotations

from typing import Any

from redline.job_runner import compute_result, resolve_fields, run_audit, to_json

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

    @server.tool()
    def redline_check_multiple_testing(
        h5ad: str, config: dict[str, Any], fields: list[dict[str, Any]] | None = None
    ) -> str:
        """Check 5 (multiple testing): re-test the differential-expression claim
        across every gene and apply a real Benjamini-Hochberg (``config.method``:
        ``bh`` or ``by``) correction at ``config.alpha``, then report how many raw
        hits survive the adjusted threshold. Unlike Check 2 (a held-out evidence
        check), this is a certified FDR correction. Returns an EngineResult.
        """
        return _check_result(5, h5ad, config, fields)

    @server.tool()
    def redline_check_unmodeled_covariate(
        h5ad: str, config: dict[str, Any], fields: list[dict[str, Any]] | None = None
    ) -> str:
        """Check 6 (unmodeled covariate): refit the effect of interest
        (``config.interest``) with the batch variable (``config.covariate``) added
        to the model, when the two are separable, and report whether the claim
        survives once the known structure is modeled. Returns an EngineResult.
        """
        return _check_result(6, h5ad, config, fields)

    @server.tool()
    def redline_check_resolution_choice(
        h5ad: str, config: dict[str, Any], fields: list[dict[str, Any]] | None = None
    ) -> str:
        """Check 7 (resolution choice): sweep clustering resolution from
        ``config.min`` to ``config.max`` in ``config.step`` increments, score each
        by ``config.criterion`` (``silhouette`` or ``ari``), and report whether the
        chosen resolution (``config.chosen``) is the one the criterion supports.
        Returns an EngineResult.
        """
        return _check_result(7, h5ad, config, fields)

    @server.tool()
    def redline_check_test_assumptions(
        h5ad: str, config: dict[str, Any], fields: list[dict[str, Any]] | None = None
    ) -> str:
        """Check 8 (test assumptions): check whether the data meet the assumptions
        of the test the analysis used (``config.claimedTest``: ``ttest``,
        ``wilcoxon``, or ``unknown``) for the grouping in ``config.grouping``, and
        report the assumption-respecting result at ``config.alpha``. Returns an
        EngineResult.
        """
        return _check_result(8, h5ad, config, fields)

    @server.tool()
    def redline_corrected_code(
        h5ad: str,
        check_id: int,
        config: dict[str, Any],
        fields: list[dict[str, Any]] | None = None,
    ) -> str:
        """The runnable corrected script for one check: a ``CorrectedCode`` object
        (``filename``, ``inline``, ``entrypoint``, ``params``, ``language``) that
        reproduces the honest re-analysis. The script takes ``--h5ad PATH`` and, as
        its last line of stdout, prints ``REDLINE_RESULT`` with the check's
        numbers, so it is its own oracle. A clean verdict has nothing to correct
        and returns a short message instead.
        """
        result = compute_result(int(check_id), h5ad, config, fields)
        corrected = result.get("correctedCode")
        if corrected is None:
            return to_json(
                {"message": "This check produced no corrected code (a clean verdict has nothing to correct)."}
            )
        return to_json(corrected)

    @server.tool()
    def redline_audit(h5ad: str, analysis: dict[str, Any] | None = None) -> str:
        """Run the whole registry-driven audit: the foundation step, every check
        that applies to the analysis, and an assembled summary. ``analysis`` is an
        optional dict of hints (``gene``, ``markers``, ``target_group``, ``track``,
        or a per-check ``config`` map). Returns ``{fields, results, report}`` JSON;
        checks that do not apply are simply absent from ``results``.
        """
        return to_json(run_audit(h5ad, analysis))

    return server


def main() -> None:
    _build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
