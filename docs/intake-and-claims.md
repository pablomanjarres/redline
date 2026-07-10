# Intake and claim extraction (the front door)

Read `architecture.md` first, then this. The built engine (`redline_v1-build-spec.md`)
defined the four checks, field resolution, and the report, and it quietly assumed the
thing being audited (a claim) already existed. It never said how a claim gets into the
system. This is that front door.

The design decision is locked: the user does not hand-write claims and Redline does not
write parsers. An agent reads whatever the user provides and proposes the auditable
claims itself. The user drops their analysis in, and Redline tells them which claims it
found them making and how it will test each one. The shapes are Zod-typed in
`packages/contracts/src/inventory.ts` and `packages/contracts/src/claims.ts`; import
them from `@redline/contracts` and never redefine them.

## Where it sits in the flow

```
Intake  ->  Field Resolution  ->  Claim Extraction  ->  Workbench (the 4 checks)  ->  Report
 (new)         (built)               (new)                 (built)                    (built)
```

Intake is the upload screen. Field Resolution (already built) establishes what each
column means. Claim Extraction (new) reads the analysis with the resolved fields as
context and produces the list of claims the checks will audit. The Workbench then runs
each check against its routed claims. Without this step the checks have nothing to point
at, which was the gap.

Two things moved when this landed:

- `confirmFields()` no longer runs the four checks. It confirms the design, then runs
  inspection and extraction, and the flow lands on the Claim Review screen.
- The Workbench runs only the checks a confirmed claim routes to. A check with no routed
  claim renders no verdict (see honesty rule 13 in `honesty-rules.md`).

## The input contract

The rule that makes this useful: **a bare `.h5ad` alone must work.**

- **Required:** the dataset as an `.h5ad`. It already carries the raw counts, the cell
  metadata (`obs`), the clustering labels, and any stored results (`uns`, for example
  stored marker genes per cluster and stored differential-expression results). If the
  object contains stored results, the agent extracts claims from those results with no
  notebook and no prose required. One file in, an audit out.
- **Optional, accepted if given:** the analysis code or notebook (as text), and free-text
  claims (an abstract, figure captions, or a plain description of what was found). Extra
  inputs make extraction richer and match the user's own wording. They are never
  mandatory. On the Intake screen these are the two optional attach points, written into
  the session as `notebook` and `prose` and passed straight through to extraction.

## The inspection step (thin, not a parser)

A thin inspection step surfaces the raw material and hands it to the agent as context.
The agent does all the interpretation, so there is no format-specific parsing logic to
maintain. `services/rigor/redline/inspect.py` produces the inventory, and the shape it
returns is `DatasetInventory` in `packages/contracts/src/inventory.ts`.

What inspection reads from the `.h5ad`:

- **`obs` columns and their types.** Each column becomes an `ObsColumn` with its dtype
  (categorical, numeric, or identifier), its cardinality (`levels`, null for numeric),
  its missing count, and a few example values.
- **`uns` contents.** Each stored result becomes an `UnsEntry`, classified as a
  `de_result` (a stored differential-expression table), a `marker_table` (a scanpy
  `rank_genes_groups`), or `unknown` (kept with a text preview). Each entry carries its
  shape, its column names, the group labels it is keyed on, and the union of gene
  identifiers it references (capped). That gene union is what lets the honesty backstop
  reject a claim about a gene the data never mentions.
- **Cluster label fields** (`clusterFields`, for example `leiden`): the categorical `obs`
  columns that hold community labels.
- **Whether raw counts are present** (`hasRawCounts` and `countsSource`), reusing the
  same counts detection the pseudoreplication and double-dipping checks rely on.
- **`layers`, `obsm`, and a sample of `var_names`** (`varNamesSample`), for gene-existence
  checks.

What inspection **never** reads: **the expression matrix `X`.** Inspection is metadata
and stored results only. It never loads the counts matrix into memory, so it stays cheap
even on a multi-gigabyte object. The heavy statistics load `X`; the front door does not.

## The claim object

Each extracted claim is one auditable statement, routed to the checks that can test it.
The type is `ExtractedClaim` in `packages/contracts/src/claims.ts`, quoted here verbatim:

```ts
export const ClaimSource = z.enum(['stored_result', 'notebook', 'prose', 'user_added']);

export const ClaimStatus = z.enum([
  'proposed',
  'confirmed',
  'edited',
  'removed',
  'user_added',
  'out_of_scope',
]);

/** One routing of a claim to a check, with the specifics that check needs. */
export const CheckRoute = z.object({
  check: CheckId,
  params: z.record(z.string(), z.unknown()),
});

/** The machine-checkable evidence a claim rests on. */
export const EvidenceRefs = z.object({
  obsColumns: z.array(z.string()),
  unsKeys: z.array(z.string()),
  genes: z.array(z.string()),
});

export const ExtractedClaim = z.object({
  id: z.string(),
  /** The claim in plain language, as a scientist would state it. */
  text: z.string(),
  source: ClaimSource,
  /** The evidence in words: which stored result / grouping / genes / cluster. */
  restsOn: z.string(),
  /** The same evidence, machine-checkable. */
  evidenceRefs: EvidenceRefs,
  checks: z.array(CheckRoute),
  confidence: Confidence,
  status: ClaimStatus,
  /** Why a claim is outside scope (present when status is `out_of_scope`). */
  outOfScopeReason: z.string().optional(),
  /** Surfaced when routing is uncertain; never resolved silently. */
  ambiguousRouting: z.string().optional(),
});
```

Two fields carry the honesty weight. `evidenceRefs` is the machine-checkable version of
`restsOn`: the exact `obs` columns, `uns` keys, and genes the claim rests on, so the
backstop can verify each one against the inventory. `CheckRoute.params` is a freeform bag
by design, but by convention the column-naming keys (`grouping`, `unit`, `nuisance`,
`interest`) hold exact `obs` column names and the gene-naming keys (`gene`, `markers`)
hold gene symbols, so those two too can be verified. Populate `evidenceRefs` faithfully;
it is the strong, always-checked fabrication guard.

The worked example (the canonical Marson demo) shows the fan-out: one analysis yields a
handful of claims that spread across all four checks. The significance claim on FOXP3
routes to Check 01 and Check 04; the activated-state claim routes to Check 02 and Check
03; the effector-state claim routes to Check 03; and a pseudotime claim Redline cannot
audit comes back `out_of_scope` with an empty `checks` array. The full set lives in
`packages/engine/src/fixtures/marson.ts` as `MARSON_CLAIMS`.

## The routing table

Classification and routing are many-to-many. One claim can trigger several checks. The
extraction agent applies this table (spec section 4); the honesty backstop then drops any
route that cannot exist for the actual data.

| Claim kind | Routes to | Why |
|---|---|---|
| A significance claim about a difference between groups | **Check 01** (pseudoreplication), and **Check 04** (confounding) if it is a between-condition comparison | A tiny p-value is the pseudoreplication target; a between-condition effect can be confounded with a technical axis. |
| A cluster or state defined by markers | **Check 02** (double dipping) and **Check 03** (clustering fragility) | Markers tested on the cells that defined the state are double-dipped; a marker-defined state may be a resolution artifact. |
| A distinct population exists | **Check 03** (clustering fragility), and **Check 02** if markers are claimed for it | Existence rides on the clustering resolution; if markers are claimed, they are double-dipping candidates too. |
| A between-condition comparison | **Check 04** (confounding), and **Check 01** if a significance is asserted | The comparison can be inseparable from a technical variable; an asserted significance is a pseudoreplication target. |

For each routed check the agent extracts the specifics that check needs (which stored
result, which grouping, which genes or markers, which cluster label, the reported
statistic) into `CheckRoute.params`. Those become the check's parameters when the
Workbench runs it.

## enforceClaimHonesty: the load-bearing backstop

Extraction is a model call (`packages/reasoning`), so its output can drift, hallucinate a
column, or route to a check that cannot exist for this data. `enforceClaimHonesty(inv,
claims)` in `packages/contracts/src/claims.ts` is the pure, deterministic gate every
extractor and mapper output passes through before it reaches the user or the Workbench.
It runs the same way every time. It only ever drops or edits a claim; it never adds one.
Call it on every model output (the parse layer in `packages/reasoning/src/claims.ts`
already does).

Its seven rules, each with the spec line it enforces:

1. **Zero in, zero out.** It maps over the input in order and only ever drops or edits a
   claim. It never adds, pads, reorders, or fills the list. Enforces spec section 8 ("No
   auditable claims found. Say so plainly. Do not invent claims") and section 11
   invariant a ("Never fabricate a claim to fill the list").

2. **Pure fabrication is dropped.** A claim whose `evidenceRefs` cite an `obs` column or
   a `uns` key the inventory does not contain is removed outright. Genes are handled
   separately (rule 5). Enforces spec section 8 ("Claim rests on data not present") and
   section 11 invariant e (a claim referencing data absent from the inventory is
   rejected, never audited as if real).

3. **Out-of-scope claims carry no checks.** Any claim with status `out_of_scope` has its
   `checks` forced to `[]`. It is listed and labeled, never silently audited. Enforces
   spec section 5 (the `out_of_scope` status), section 8, and section 11 invariant b.

4. **Impossible routes are dropped, then de-duplicated.** A `CheckRoute` is removed when
   its check id is not 1, 2, 3, or 4, or when a column-naming param (`grouping`, `unit`,
   `nuisance`, `interest`) points at an `obs` column absent from the inventory. Surviving
   routes are de-duplicated by check id, first occurrence winning. Enforces spec sections
   4 and 5 (route only to checks that can test the claim, with real parameters).

5. **An unknown gene demotes, it does not delete.** A claim that references a gene the
   inventory does not know is kept, its confidence dropped to `low`, and `ambiguousRouting`
   set with a note naming the gene. The uncertainty goes to the user rather than being
   resolved silently. Enforces spec section 8 ("Low-confidence claim, surfaced with its
   low confidence marked" and "Ambiguous routing, present the options") and section 11
   invariant d ("Surface uncertainty rather than resolving it silently").

6. **A claim that loses every route is surfaced, not silently emptied.** An active claim
   (its status is neither `out_of_scope` nor `removed`) that arrived with routes but lost
   all of them to rule 4 is kept, its confidence dropped to `low`, and `ambiguousRouting`
   set with a plain note naming the `obs` columns whose absence dropped the routes. It is
   not deleted and it is not relabeled `out_of_scope`, because the scientist may still be
   making the claim, so the uncertainty goes to them instead of being resolved silently. A
   claim that legitimately arrived with an empty `checks` array (it was never routed
   anywhere) is left untouched; only a claim that had routes and lost them all is surfaced.
   Enforces spec section 8 ("Ambiguous routing, present the options") and section 11
   invariant d ("Surface uncertainty rather than resolving it silently").

7. **Output ids are unique and non-empty.** The Claim Review screen patches, removes, and
   React-keys a claim by its `id`, so two claims sharing an id would edit or remove both at
   once and collide keys. The gate keeps the first claim's id and gives any later collision
   a deterministic suffixed id (`${id}-2`, `${id}-3`, and so on). A claim that arrives with
   an empty or whitespace-only id is backfilled from its input position (`claim-<index>`)
   and then de-collided the same way. There is no randomness and no clock, so the
   assignment is stable across runs and idempotent: a second pass leaves an already-unique,
   non-empty id as it is. Enforces spec section 5 (each claim carries a stable id).

The gene predicate is case-insensitive (`inventoryKnowsGene`), because gene symbols vary
in case across tools. The column predicate is case-sensitive (`inventoryHasField`),
because column names are identifiers.

## The two screens

### Intake (`apps/web/src/app/page.tsx`)

One job: get the analysis in. The required `.h5ad`, two optional attach points
(a notebook or script, and pasted claims or prose), and one primary action to proceed.
Nothing else.

On the default `fixture` compute target the dataset is already loaded, so there is no
upload control; a note says so and points to the scenario picker in the top strip, the
way in for the demo. When a real compute target is wired, an upload appears as a live,
keyboard-operable file picker (honesty rule 6: a control only renders live once its
target is connected). The two attach points work in every mode, since they are plain
text. **Begin** confirms the fields, then inspection and extraction run.

### Claim Review (`apps/web/src/app/(app)/claims/page.tsx`)

The extracted claims, presented for confirmation, in the same confirm-or-correct pattern
as Field Resolution. This is the second interactive surface, and like the first it is a
real AI proposal the user ratifies. Per claim it shows the text, what it rests on, which
checks will test it, and the confidence (a light: green high, amber medium, red low,
matching `FieldMatrixRow`). The user can:

- **Confirm** a claim as-is.
- **Edit** the wording or the routing (change which checks apply, or the parameters).
- **Remove** a claim the agent surfaced that the user is not actually making.
- **Add** a claim manually. The user types one sentence and the agent maps it: it
  classifies the claim, routes it to the applicable checks, and extracts the parameters
  from the data, exactly as it does for extracted claims. The user never has to know the
  four error types (spec section 7).

Out-of-scope claims are shown in their own clearly-labeled group, so the user sees what
Redline is not testing and why. Low-confidence and ambiguous-routing claims carry a
visible amber note, so the user's attention goes to the uncertain ones. Nothing runs in
the Workbench until the claim list is confirmed.

While extraction runs, the screen shows the agent working rather than a blank spinner,
streaming lines from `extractionLines(scenarioId)` on the same timer the check reasoning
uses ("reading your analysis", "found 3 claims"). When there is nothing routable, the
screen says so plainly and offers manual entry. It never fabricates a claim to fill the
list.

## The fallback story (no model backend)

Extraction is a Claude call through `packages/reasoning` (first-party Claude API via
`ANTHROPIC_API_KEY`, or AWS Bedrock via `REDLINE_BEDROCK_MODEL_ID` and AWS credentials;
`REDLINE_REASONING_BACKEND` forces one). When no backend is configured, `createReasoner()`
reports `available: false` and the extract call throws `ReasonerUnavailable`, exactly like
the narrative path.

On that path the app falls back to `curatedClaimsFor(scenarioId, inventory)` from
`@redline/engine` (`packages/engine/src/scenarios.ts`), the single home both fallback paths
share: it reads each scenario's own `extractedClaims` and passes the whole set through
`enforceClaimHonesty`, so a curated claim can never cite `uns` keys, columns, or genes the
inventory does not carry. The UI shows `CURATED_CLAIMS_NOTICE` alongside it:

> No model backend is configured, so Redline is showing curated reference claims for this
> built-in scenario. Configure a Claude backend to extract claims from your own upload.

The curated list is always labeled as such and is never passed off as a live reading
(honesty rule 14). A model call that succeeds and returns zero claims stays a model
result with an empty list; it is never padded with curated claims to look fuller. Manual
entry maps through the model too, so with no backend the map call returns a plain 503 and
the screen surfaces the failure rather than fabricating a routing.

## The acceptance harness

The acceptance criteria are spec section 10. `pnpm verify:intake` is the single command
that runs them; it needs the Node graph built and the Python venv active. What it proves:

- **Bare-file works.** Given only the canonical `.h5ad` with stored results, extraction
  produces the expected claims routed to the correct checks (the worked example in spec
  section 5). Proven by the engine fixtures (`MARSON_CLAIMS` survive
  `enforceClaimHonesty` against `MARSON_INVENTORY` unchanged) in
  `packages/engine/src/inventory.test.ts`.
- **Generality (not hardcoded).** On a different dataset with different columns and
  stored results, extraction adapts. Identical claims across two datasets would mean the
  extractor is faked. Proven deterministically by `services/rigor/tests/test_inspect.py`
  (case A, case B, and the bare case C produce different inventories with disjoint genes)
  and by the cross-dataset guard in `inventory.test.ts` (one scenario's claims fed through
  the other's inventory do not survive unchanged).
- **Real AI.** A real Claude call fires for extraction and the proposed claims reference
  the actual data. This is the one criterion that needs a live backend: set a Claude
  backend (`ANTHROPIC_API_KEY`, or Bedrock) and point the compute target at the Python
  engine (`REDLINE_COMPUTE_TARGET=local`) so a real `.h5ad` is inspected. The
  deterministic criteria above need no model.
- **Out-of-scope honesty.** A claim Redline cannot audit is labeled with an empty `checks`
  array, never fabricated-audited. Proven by the backstop tests in
  `packages/contracts/src/contracts.test.ts` and `packages/reasoning/src/claims.test.ts`.
- **User control flows through.** Edits, removals, and manual additions on the Claim
  Review screen change what the Workbench runs (the session store writes `routedChecks`
  and the baked config from the confirmed claims).

The env: the deterministic checks need only `pnpm build` and the Python venv (`python
3.12`, `anndata`). The real-AI check additionally needs a Claude backend and
`REDLINE_COMPUTE_TARGET=local`.

## The fixture `.h5ad` files

There is no real `.h5ad` committed anywhere (datasets are gitignored and the Marson
subset is multi-gigabyte), so the intake, inspection, and extraction paths need something
to run against. `services/rigor/data/build_case_fixtures.py` synthesizes three small,
seeded, clearly-labeled test fixtures. They are synthetic: nothing in them is real
biology, the gene names are chosen only so the inventory and the routing are legible, and
each object carries `uns['redline_fixture']` with a plain-language note saying so.

- **`case_a.h5ad`** (Marson-shaped foil, about 600 cells, 4 donors). Carries both a
  scanpy `rank_genes_groups` marker table (with TNFRSF9, ICOS, TIGIT, CTLA4 among the
  cluster markers) and a stored `de_results` DE table (FOXP3 at a tiny p-value). The full
  worked example.
- **`case_b.h5ad`** (ketamine-shaped, deliberately different, about 500 cells). Different
  `obs` columns entirely (`mouse_id`, `treatment`, `batch`, `cell_type`), different genes
  (BDNF, HOMER1, ARC, NPAS4), a DE result with different column names (`pvalue`,
  `log2FoldChange`), and no marker table. Identical claims across case A and case B would
  prove the extractor is faked; the different shapes force it to adapt.
- **`case_c_bare.h5ad`** (counts and `obs`, nothing in `uns`). The honest "no auditable
  claims" state: the harness asserts Redline says so plainly instead of inventing claims.

Rebuild them (deterministic and idempotent, so a rebuild produces the same bytes):

```bash
cd services/rigor && source .venv/bin/activate
python -m data.build_case_fixtures                 # writes to data/fixtures/
python services/rigor/data/build_case_fixtures.py --out /tmp/fixtures   # elsewhere
```

All three are under 1 MB. The root `.gitignore` has a global `*.h5ad` rule, so committing
them needs a negation for `services/rigor/data/fixtures/`; the builder regenerates them
either way, so committing is optional.

## Handoff to the Workbench

The confirmed claim list drives the built checks. For each confirmed claim, each routed
check receives its parameters (baked from `CheckRoute.params` over the check config) and
runs. Checks with no routed claim are cleared and render no verdict. The Workbench's
per-check panels already render the result; this front door is what guarantees they now
receive real, user-ratified targets instead of assuming them.
