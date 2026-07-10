# Redline: close the improving loop

Date: 2026-07-10
Branch: `feat/improving-loop`

## Problem

On a check page the corrected code sits in a block whose only actions are Copy
and Download. The `$ python ...` run line is decorative, the Before/After toggle
"does not re-run anything" (its own comment), and the only surface that executes
anything is `/verifications`, an internal QA harness for the builders, not a loop
the scientist drives. From the user's seat: catch the error, read the fix,
copy/download, dead end. There is no in-app way to run the fix, see the corrected
result, watch how it helps, or see the corrected notebook.

## Key fact that makes this cheap

The honest corrected result is *already computed* on every check. `result.stats`
(e.g. discovery AUC 0.90 vs held-out 0.57), `result.preview.after` (the corrected
figure), and the chart are all real ComputeTarget output. The corrected notebook
(`buildBundle` -> `redline_corrected.ipynb`) is already built, but it is a blind
download. So this is a wiring and presentation gap, not a missing-compute gap.

## Scope (approved)

Wire the reveal that already exists. No cloud/Fargate execution, no streaming
stdout, no new API route, no contract/engine/Python change.

## Design

Three pieces, all in `apps/web`.

### 1. "Run correction" reveal on the check page

`CorrectedCodeBlock` gains a `Run` button beside Copy/Download and, below the
code, a terminal-style reveal.

- On click it does a genuine numbers-only recompute through the ComputeTarget the
  app already uses: `postCheck({ ..., noReason: true })` into local component
  state (not the global `results` map, so the figure/stats/code stay mounted). On
  the fixture target this reproduces the same numbers, which is the point ("run it
  again, it holds"); on a real target it truly executes.
- The terminal renders from the fresh result: the `$ entrypoint` command, one
  line per computed stat aligned with dotted leaders and colored by its existing
  `bad`/`good` flag, then `headline` as the closing verdict.
- Honesty: labeled as the corrected method's output, never "a shell just ran."
  An `unsalvageable` finding (`preview.after === null`) shows no fabricated
  corrected number; it states no valid corrected result exists and flips to the
  dead end. A `clean` finding has no `correctedCode`, so no button appears.
- Reduced motion respected (no artificial delay); the button has an `aria-label`;
  keyboard operable. On fetch failure it says so plainly and shows nothing faked.

The derivation of terminal lines from a `CheckResult` is a pure function in
`lib/correction-terminal.ts`, unit tested.

### 2. Auto-flip Before/After to "after"

Running the correction flips `BeforeAfter` from "What you claimed" to "The honest
analysis" via a new controlled `flipToAfter?: boolean` prop (a `useEffect` sets
the tab to `after` when it turns true; the tabs stay interactive after). For an
unsalvageable finding this lands on the existing `DeadEnd`, never a fake figure.

`CheckStage` holds a `correctionRan` flag (reset when `runKey` changes), passes
the run inputs + an `onRan` callback to `CorrectedCodeBlock`, and `flipToAfter` to
`BeforeAfter`.

### 3. Inline notebook preview on the CORRECTED page

`corrected/page.tsx` renders the consolidated `redline_corrected.ipynb` inline as
notebook cells (markdown "what was wrong" cells + corrected-code cells with
`In [ ]:` chrome and `highlightPython`), above the existing download buttons and
per-script blocks. Parsing the notebook JSON and a small markdown-lite renderer
live in `lib/notebook.ts`, unit tested.

## Files

- `lib/api.ts` — `postCheck` forwards optional `noReason`.
- `lib/correction-terminal.ts` (new) + `.test.ts` — pure terminal-line derivation.
- `lib/notebook.ts` (new) + `.test.ts` — notebook parse + markdown-lite.
- `components/check/CorrectedCodeBlock.tsx` — Run button + terminal reveal.
- `components/check/CheckStage.tsx` — wire run inputs, `correctionRan`, flip.
- `components/check/BeforeAfter.tsx` — controlled `flipToAfter`.
- `components/check/NotebookPreview.tsx` (new) — cell rendering (used by corrected page).
- `app/(app)/corrected/page.tsx` — inline notebook preview.

## Honesty invariants touched

1 (correct and show your work), 2 (never cry wolf: clean = no button), 6 (never
present a dead compute control as live: the button does real compute and is
labeled honestly). Voice rules: no em dashes, no "not X but Y", no AI-tell
vocabulary, aria-labels, focus-visible, reduced-motion.

## Out of scope

Real sandbox execution, streaming stdout, new API routes, contract/engine/Python
changes, new guided-tour steps (avoid spending the tour's spine budget).
