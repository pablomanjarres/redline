# The naive-foil generator (Add-on 4)

Read `architecture.md` first, then `dataset.md` and `honesty-rules.md`. This doc
describes a build-time tool, not a product surface. It lives in
`services/rigor/redline/foilgen/` and is driven from
`services/rigor/data/generate_foil.py`.

## What it is

A fixture factory. Given any single-cell `.h5ad` and its resolvable field mapping,
it manufactures a realistic naive analysis artifact: the standard
cluster-then-annotate-then-DE workflow plus a plausible over-reach (a cell-level
DE claim, an over-clustered state with hand-picked markers, a boundary-resolution
"population", a comparison that happens to be confounded). Claude drives the
construction: it reads the dataset, decides a believable claim a real scientist
might make, and the tool emits the flawed analysis with its stated result. This is
the thing Redline then audits.

It also builds a genuinely clean variant on request, so the same dataset can serve
the never-cry-wolf case (Case C).

## Why it exists (three uses)

1. **Test fixtures at volume.** The four-check harness needs Case A, Case B, and
   more. This generates them, each with a planted flaw whose expected verdict is
   known by construction, so the oracle's answer is not hand-written per dataset.
2. **The prevalence study.** It produces one naive analysis per public dataset
   without writing each by hand, so the study can measure how often the standard
   workflow trips a real rigor error.
3. **The generality proof.** If the generator makes a valid foil on a dataset it
   has never seen and Redline then catches it, that is end-to-end evidence the
   whole system is not hardcoded to one file. The bundled presets deliberately use
   different column names (`donor_id`/`condition`/`lane` vs
   `subject`/`treatment`/`chip` vs `patient`/`arm`/`batch`) so the generator has to
   resolve structure blind every time.

## The contract

**Input.** A dataset (a path to an `.h5ad`, or an in-memory AnnData) plus its
resolvable field mapping. The mapping is resolved by the engine's own
`foundation.resolve_fields`, the same resolver the product uses, so a dataset with
arbitrary column names is handled without configuration.

**Output.** A naive analysis artifact:

- the flawed foil as an `.h5ad` (reshaped counts, a `cell_state` column, and the
  role-bearing obs columns), and
- a machine-readable ground-truth record (`GroundTruth.to_manifest_entry()`)
  carrying the flawed claim in plain language, the flawed statistic and how it was
  computed, which flaw was planted, and the expected corrected result.

The record is a strict superset of two shapes already in the repo, so it drops in
without translation: the oracle's `Descriptor` fields (`unit`, `grouping`,
`nuisance`, `state_col`, `focus_gene`, `spurious`, `stable`, plus the foil path)
and the foils manifest's `intended_verdicts` and per-case `obs_columns`.

## The four stages

```
describe_dataset(adata)  ->  DatasetDescriptor   (roles, units per arm, candidate genes, feasibility)
plan_foil(descriptor)    ->  FoilPlan            (Claude or heuristic picks the believable claim)
plant_foil(adata, plan)  ->  foil .h5ad + facts  (deterministic flaw induction on a copy)
verify_foil(foil, plan)  ->  verification        (the real engine confirms the intended verdicts)
```

1. **Describe.** Resolve the roles, count the biological units nested in each arm
   (so a pseudobulk contrast is only planned where it is possible), rank the
   high-variance genes, and pick the gene the naive cell-level test would flag
   hardest. This is the evidence the planner reads.
2. **Plan.** Choose the claim. Two backends behind one shape: Claude via AWS
   Bedrock reads the descriptor and proposes a claim grounded in the dataset's
   real genes and arms, or a deterministic heuristic runs with no network. The
   heuristic is the curated fallback and the reproducible default, so the tool
   runs for anyone. Every gene the plan names exists in the dataset.
3. **Plant.** Reshape a copy of the counts and obs so the real engine returns the
   intended verdict. Each mechanism is the textbook error, induced strongly enough
   that the verdict holds under either clustering backend (scanpy Leiden or the
   numpy KMeans fallback).
4. **Verify.** Run the four pillars with the engine's own default config and
   confirm each state matches the intended one. A foil is only blessed when its
   planted flaw is genuinely caught, and a clean variant only when it is genuinely
   green. This is the never-cry-wolf guard at the fixture level.

## The planted flaws

Every flaw operates on the resolved grouping variable, never a hardcoded "cell
type". A default foil plants all four; single-flaw and clean modes are also
available.

| Pillar | Flaw | How it is planted | How it is caught |
|---|---|---|---|
| 1 | pseudoreplication | the focus gene gets a wide, deterministic between-unit baseline plus a small consistent arm offset | cell-level significance is real, pseudobulk over a few replicates collapses it |
| 2 | double dipping | a spurious cell state is a plurality of cells with no coherent program | its markers separate at discovery and collapse on a held-out count split |
| 3 | fragility | that spurious state has no real structure | it is a discrete cluster only inside a narrow resolution window |
| 4 | confounding | the technical column is made collinear with the grouping | Cramer's V is near 1 and the design is rank deficient |

The clean variant induces the honest version of each: a donor-consistent effect
that survives pseudobulk, cell states with reproducible markers, a stable cluster,
and a technical column drawn independently of the grouping.

## Ground-truth record

`to_manifest_entry()` returns, per foil:

- the oracle `Descriptor` fields and the foil path,
- `intended_verdicts` per pillar (Pillar 3 per tracked state) and the `tracks`,
- `plantedFlaws`: one record per flaw with the plain-language `claim`, the
  `flawedStatistic` (method, value, and `computed_how`), the `expectedVerdict`,
  the `expectedCorrected` result the engine reported, and the fixing `citation`,
- `cleanVariant`, `plannedBy` (`bedrock` or `heuristic`), the `source`, and the
  honesty `framing`.

`write_manifest` collects many entries into a foils manifest the harness and the
oracle read.

## Guardrails

- The planted flaw is a real error a scientist would plausibly make, not a
  strawman. The claim reads like a real over-reach and names the dataset's real
  genes and arms.
- The record carries ground truth (which flaw, expected corrected result) so every
  generated case is checkable by the oracle.
- Clean variants are genuinely clean: they pass the checks, or Case C is invalid.
  The verify step proves it before the foil is blessed.
- No dataset name or gene is hardcoded downstream of the descriptor. The tool runs
  on data it has never seen.
- The prose voice follows the repo rule: no em dashes, direct and concrete. The
  copy never implies any real author erred.

## Usage

```
# one dataset, plant all four flaws, verify with the engine
python -m data.generate_foil --input path/to/dataset.h5ad --out cache/foils/foil.h5ad

# a genuinely clean variant (Case C)
python -m data.generate_foil --input path/to/dataset.h5ad --out cache/foils/clean.h5ad --clean

# one targeted flaw
python -m data.generate_foil --input path/to/dataset.h5ad --out foil.h5ad --flaw confounding

# build the bundled demonstration set (three presets x {foil, clean}) plus a manifest
python -m data.generate_foil --demo --out cache/foils/
```

The bundled base datasets (`data/base_datasets.py`) stand in for public datasets a
scientist would download. They are neutral (raw counts, a unit nested in a two-arm
grouping, a technical column independent of the grouping, no planted flaw); the
generator induces every flaw itself on a copy.

## Planner backends

- `auto` (default): Claude via Bedrock when `REDLINE_BEDROCK_MODEL_ID` and
  `AWS_REGION` are set, otherwise the heuristic. Bedrock is the same rule the
  product follows; on any missing credential or error the planner falls back to the
  heuristic, so the tool always produces a foil.
- `heuristic`: deterministic, no network. The reproducible default the tests pin
  against.

The Bedrock planner is repaired against the dataset before use: every gene it
names must exist in the descriptor's candidate list, and any em dash it slips into
the prose is rewritten. The claim is grounded either way.

## Compute

Cheap relative to the batch pipelines, but it runs the real engine once per foil
to verify. The bundled foils are small (a few hundred cells, tens of genes) so a
foil plus its four-check verification runs in seconds; a clean variant is slower
because Pillar 4's separable branch fits a multi-factor model. Budget-appropriate
for generating many fixtures.
