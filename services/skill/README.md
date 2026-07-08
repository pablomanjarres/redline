# Redline skill

The Redline rigor engine packaged as a Claude Skill. This is the procedural half
of Redline. The compute half is the `redline` MCP server in `services/rigor`.

The split is the canonical Anthropic pattern: the **MCP server provides the
tools** (it runs pseudobulk DE, count-split reclustering, the resolution sweep,
and the confounding check on real `.h5ad` data), and the **skill teaches Claude
how to use them well** (when each check applies, how to read each `ComputeResult`,
how to write the report, and the honesty rules). One artifact, every surface:
Claude Code, Claude Science, Claude Desktop, and the API.

## What is in this directory

| File | Purpose |
|---|---|
| `SKILL.md` | The skill. YAML front-matter (name, description) plus the procedure. |
| `scripts/redline_audit.py` | Thin CLI over `redline` for local code execution. Runs one check on an `.h5ad` and prints the `ComputeResult` JSON. |
| `README.md` | This file. |

## The tools the skill drives

The MCP server (`services/rigor`) exposes one tool per pillar plus the foundation
step. The skill references them by name:

| Step | MCP tool | Local-execution equivalent |
|---|---|---|
| Resolve obs roles | `redline_resolve_fields` | `redline_audit.py --check fields` |
| Pseudoreplication | `redline_check_pseudoreplication` | `redline_audit.py --check 1` |
| Double dipping | `redline_check_double_dipping` | `redline_audit.py --check 2` |
| Clustering fragility | `redline_check_clustering_fragility` | `redline_audit.py --check 3` |
| Confounding | `redline_check_confounding` | `redline_audit.py --check 4` |

Every tool and the CLI return the same contract shapes (a `ComputeResult` per
check, a `FieldSpec[]` for the foundation step), defined in
`packages/contracts` and `docs/build/INTERFACES.md`.

## Install the engine

The skill and the CLI need the `redline` package importable. From the repo root:

```bash
pip install -e "services/rigor[stats]"   # stats extra pulls scanpy, decoupler, pydeseq2
```

Add the `mcp` extra when you want to run the server: `pip install -e
"services/rigor[stats,mcp]"`.

## Run a single check locally (code execution)

On any surface with local code execution (Claude Science, Claude Code), run a
check straight against an `.h5ad`:

```bash
# Foundation: resolve the obs roles first, confirm them, then run checks.
python services/skill/scripts/redline_audit.py --h5ad analysis.h5ad --check fields

# Pillar 1, engine defaults.
python services/skill/scripts/redline_audit.py --h5ad analysis.h5ad --check 1

# Pillar 2 with explicit knobs; --config-json accepts inline JSON or a .json path.
python services/skill/scripts/redline_audit.py \
  --h5ad analysis.h5ad --check 2 --config-json '{"split":0.5,"grouping":"leiden"}'

# Feed confirmed roles back into a check so it audits the confirmed design.
python services/skill/scripts/redline_audit.py \
  --h5ad analysis.h5ad --check 4 --fields-json confirmed_fields.json
```

stdout is pure JSON, so pipe it (`... | jq .state`). Diagnostics go to stderr.
Exit codes: `0` success, `2` usage or engine-not-installed, `1` a failure inside
the engine.

## Claude Code

1. Install the engine (above).
2. Register the MCP server so Claude can call the pillar tools:

   ```bash
   claude mcp add redline -- redline-mcp
   ```

   or add it to `.mcp.json`:

   ```json
   { "mcpServers": { "redline": { "command": "redline-mcp" } } }
   ```

3. Make the skill discoverable by placing `SKILL.md` on the skills path (a
   `redline/` skill directory, this folder). Claude loads it when a task matches
   the description: a scientist auditing a single-cell analysis before publishing.

With both wired, Claude resolves the design, runs the four checks (via the MCP
tools or the local CLI), and writes the report following the skill's procedure.

## Claude Science

Claude Science extends through exactly two mechanisms, and Redline uses both:

- **MCP connector.** Add the `redline` MCP server as a connector. Every future
  session inherits the four pillar tools plus `redline_resolve_fields`.
- **Skill.** Add this skill. It gives the workbench the procedural knowledge its
  generalist reviewer does not have: the specific single-cell false-discovery
  modes and how to report them.

Heavy diagnostics run on the kernels Claude Science already supports (local, Slurm
over SSH, or Modal), so the pseudobulk re-analysis, the count-split reclustering,
and the resolution sweep execute where the data lives.

## A note on API limits

On the API, skills cannot make external network calls or install packages, and
custom skills do not auto-sync across surfaces. That limit is exactly why the
compute lives in the MCP server and the skill carries only procedural knowledge.
In Claude Science and Claude Code, local code execution is available, so the heavy
diagnostics run directly through `scripts/redline_audit.py` or the MCP tools.

## Honesty and configurability (carried from the engine)

- Auditor, not corrector. Only Pillar 1 asserts a corrected (pseudobulk) result.
- Never cry wolf. A passed check reports a confident clean verdict.
- Pillar 2 is evidence (markers surviving a held-out test), not a certified FDR
  correction. ClusterDE is named as the stronger method.
- The grouping variable is configurable (cell type, cell state, condition, or
  perturbation), never hardcoded.
- No hardcoded secrets or surface-specific paths, so the same core runs anywhere.
