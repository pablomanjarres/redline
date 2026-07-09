# Redline: Claude Code project guide

**Read `docs/` first.** Start with `docs/architecture.md`, then the doc that matches your
task. The seam contract between build agents is `docs/build/INTERFACES.md` and it is
authoritative. The Zod types in `packages/contracts/src/*` are the source of truth for
every shape; import them from `@redline/contracts`, never redefine them.

## What Redline is

A statistical-rigor auditor for single-cell RNA-seq. A scientist hands it their data (an
AnnData `.h5ad`) and the analysis they ran. Redline re-runs the load-bearing statistics
itself and marks the false discoveries on the scientist's own figures, before the
analysis becomes a paper. Every finding names the failure mode, cites the method paper
that fixes it, and rewrites the conclusion in defensible language.

It is not QC (solved and commoditized) and not a generic manuscript reviewer (reads
finished papers). It is the specialized layer that catches the statistical reasoning
errors nothing else does: pseudoreplication, double dipping, clustering fragility, and
technical-biological confounding. Positioning line: break your own analysis before
Reviewer 2 does.

One engine, every surface. The same core runs as a plots-first web workbench
(`apps/web`), an MCP server (`services/rigor`), and a Claude Skill (`services/skill`) that
drops into Claude Science.

## Layout

```
apps/web            Next.js 16 App Router (React 19). The demo workbench. Deploys to Vercel.
packages/contracts  @redline/contracts: the Zod shapes every surface speaks. Built. Import, don't edit.
packages/ui         @redline/ui: tokens (C, FONT, stateColor, stateLabel) + primitives. Built. Import, don't edit.
packages/engine     @redline/engine: the ComputeTarget seam, fixtures, DEFAULT_CONFIG, SCENARIOS.
packages/reasoning  @redline/reasoning: Claude via AWS Bedrock + curated fallback.
services/rigor      Python engine (scanpy / decoupler / PyDESeq2 / numpy): MCP server + GCP Cloud Run job.
services/skill      The same engine packaged as a Claude Skill.
docs/               Architecture, honesty rules, dataset, storyboard, deploy. Read first.
```

The `docs/` index:

| Want to | Read |
|---|---|
| Understand the system | `docs/architecture.md` |
| Not break an honesty invariant | `docs/honesty-rules.md` |
| Know the hero dataset and its framing rule | `docs/dataset.md` |
| Read a repeat interval on a stochastic check | `docs/confidence-intervals.md` |
| Run the three-minute demo | `docs/demo-storyboard.md` |
| Add a step to the guided tour, or run it hands-free | `docs/guided-tour.md` |
| Deploy the app or point at the real engine | `docs/deploy.md` |
| Integrate with the other build agents | `docs/build/INTERFACES.md` |

## The finding shape (internalize this)

Every finding is numbers plus prose that meet in the contract:

- `ComputeResult` = `{ checkId, state, headline, stats, chart }`. The statistics, from a
  `ComputeTarget` (the locked fixture or the real Python engine). Deterministic.
- `Narrative` = `{ error, citation, original, corrected, missing? }`. The prose, from the
  reasoning layer (Claude via Bedrock) or its curated fallback.
- `CheckResult = ComputeResult.merge(Narrative)` is what the UI renders per pillar.
- `state` is `flagged | clean | flag_only | hard_stop`. `ready` and `running` are UI-only
  and are not part of the engine's return contract.

The `ComputeTarget` seam decides where the statistics run (`fixture` default, then
`local`, `cloudrun`, `endpoint`) behind one return shape. The UI never changes when the
target changes. A target that is not wired reports `available: false` and its control
renders disabled and labeled.

## Honesty invariants (enforce in code and copy)

These are the product. Full detail in `docs/honesty-rules.md`.

1. **Auditor, not corrector.** Only Pillar 1 (pseudoreplication) asserts a corrected
   result. The rest report evidence and sensitivity.
2. **Never cry wolf.** A passed check reports clean, confidently, in green. Never
   manufacture a flag.
3. **Pillar 2 is evidence,** not a certified FDR correction. Name ClusterDE as the
   stronger method.
4. **The grouping variable is configurable,** never hardcoded to "cell type." Pillars
   operate on resolved `FieldRole`s.
5. **The Marson scenario audits a naive foil,** never the authors' rigorous analysis.
   Copy must never imply the authors erred.
6. **Never present a dead compute control as live.** Configurable is honest; a dead
   button labeled live is not.

## Prose voice rules (any user-facing English)

This includes report copy, reasoning lines, headlines, captions, and these docs.

- **No em dashes.** Use commas, periods, parentheses, or "and."
- **No "not X, but Y" reframes.**
- **No AI-tell vocabulary.** Direct and concrete. Say the thing.
- Accessibility is part of the voice: real semantic elements, `aria-label` on icon
  buttons, focus-visible rings, keyboard-operable controls, `prefers-reduced-motion`
  respected for the `rl-*` animations.

## Build rules

- **Bedrock only for Claude calls.** Via `@aws-sdk/client-bedrock-runtime`, model id from
  `REDLINE_BEDROCK_MODEL_ID`, region from `AWS_REGION`. Never the direct Anthropic API. On
  any missing credential or error, fall back to curated copy so the app always renders.
- **Import conventions.** `@redline/contracts` for shapes, `@redline/ui` for tokens and
  primitives, `@/…` inside `apps/web`. ESM everywhere. In `packages/*` use explicit `.js`
  extensions on relative imports and `import type` for type-only imports
  (`verbatimModuleSyntax` is on). `apps/web` relaxes both.
- **Pixel-faithful design.** Match the design source: same spacing, radii, fonts (IBM
  Plex Sans and Mono, Source Serif 4), colors (cream desk, one editorial red at
  `#CE2A1E`, quiet green and amber for clean and needs-input), and copy.
- **Open source, no hidden paths.** No hardcoded credentials, no environment-specific
  secrets, no surface-specific paths. Everything configurable through env vars.
- **Portable as a Skill** from day one.

## Build order

1. Design resolution (the foundation; everything depends on it).
2. Pillar 1 (the keystone; the one that can assert; validate against the pseudobulk
   oracle in `docs/dataset.md`).
3. Pillar 2 (highest-impact catch; most implementation risk in the re-test).
4. Pillar 4 (cheap once the design is resolved; legible).
5. Pillar 3 (cheapest; best interactive surface).
6. The reasoning layer and report assembly, including the clean-verdict path.

The UI is built last, but every pillar exposes its knobs so the UI can surface and tune
each one.

## Git

- No `Co-Authored-By` lines on commits. None.
- Do not commit unless asked. The main session integrates and commits; parallel build
  agents write only the files they own and leave verification and commits to the
  integrator.
