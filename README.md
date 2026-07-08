# Redline

**Break your own analysis before Reviewer 2 does.**

Redline is a statistical-rigor auditor for single-cell RNA-seq analysis. A scientist
gives Redline their data (`.h5ad`) and the analysis they ran; Redline re-runs the
load-bearing statistical steps itself and surfaces where the results are statistically
invalid or fragile — **before publication**. Every finding is rendered on the
scientist's own figures, names the error, cites the method that fixes it, and rewrites
the conclusion in language that survives peer review.

It is **not** QC (a solved, commoditized layer) and **not** a generic reviewer. It is
the specialized statistical-rigor layer that catches the reasoning errors nothing else
does:

1. **Fake significance from non-independent data** (pseudoreplication)
2. **Fake groups** (double dipping — clusters tested for markers on the data that defined them)
3. **Fragile conclusions** (results that hinge on an arbitrary clustering resolution)
4. **Confounded comparisons** (a biological effect inseparable from a technical variable)

Two governing principles: **auditor, not corrector** (surface and quantify fragility;
assert a correction only where the field agrees on one — pseudoreplication), and
**never cry wolf** (a passed check reports clean, confidently).

## Architecture

One engine, every surface. Built as a TypeScript + Python monorepo (pnpm + turbo).

| Path | What it is |
|---|---|
| `apps/web` | The plots-first workbench (Next.js, → Vercel). Findings marked on the figures. |
| `packages/contracts` | Zod shapes every surface exchanges and renders. |
| `packages/ui` | Design system — tokens, palette, primitives. |
| `packages/engine` | Orchestration + the `ComputeTarget` seam + locked demo fixtures. |
| `packages/reasoning` | Claude via **AWS Bedrock** — names the failure mode, cites the fix, rewrites the conclusion. |
| `services/rigor` | The real rigor engine (Python / scanpy / PyDESeq2) — foundation + four pillars, as an **MCP server** + a **GCP Cloud Run job**. |
| `services/skill` | The same engine packaged as a **Claude Skill**, so it drops into Claude Science. |

The `ComputeTarget` interface has three implementations — a locked deterministic
fixture (the demo), the real Python engine (local or GCP Cloud Run), and a
user-provided endpoint (run the heavy jobs on infrastructure you control). The UI never
changes; only the target changes.

## Status

Hackathon v1 — **Built with Claude: Life Sciences** (Anthropic × Gladstone Institutes).
See `docs/` for the architecture, the demo storyboard, and the honesty rules.

## License

MIT — see [LICENSE](./LICENSE).
