# Close the improving loop

Spec: `docs/superpowers/specs/2026-07-10-improving-loop-design.md`

## Plan

- [x] 1. `lib/correction-terminal.ts` + test: pure `correctionTerminal(result)` derivation
- [x] 2. `lib/notebook.ts` + test: `parseNotebook(json)` + `renderMarkdownLite`
- [x] 3. `lib/api.ts`: `postCheck` forwards optional `noReason`
- [x] 4. `BeforeAfter.tsx`: controlled `flipToAfter?: boolean`
- [x] 5. `CorrectedCodeBlock.tsx`: Run button + terminal reveal (uses 1 + 3)
- [x] 6. `CheckStage.tsx`: wire run inputs, `correctionRan`, flip Before/After
- [x] 7. `NotebookPreview.tsx` + `corrected/page.tsx`: inline notebook preview (uses 2)
- [x] 8. Verify: typecheck, vitest, build, drive the page in a browser
- [ ] 9. Commit, push, draft PR

## Review

Closed the loop the corrected code used to dead-end on (Copy/Download only).

**What changed.** Each check page gains a **Run** action on the corrected-code
block: a genuine numbers-only recompute through the same ComputeTarget the audit
used (`postCheck({ noReason: true })`), into local state so the figure/stats stay
mounted. It reveals a terminal readout (command, computed stats colored by the
same bad/good flags, verdict), labeled with the honest compute seam
(`provenance.target`, e.g. "recomputed on the locked fixture"). Running flips
Before/After to the honest analysis. The CORRECTED page now renders the
consolidated `.ipynb` inline as notebook cells above the download buttons.

**Honesty held.** Unsalvageable findings (confounding) show the evidence but no
fabricated corrected number and route to the dead end, in the reveal and in the
inline notebook (no code cell). Clean findings have no corrected code, so no Run
button. No em dashes / AI-tell copy; aria-labels + reduced-motion respected.

**Verification.** typecheck clean; vitest 77/77 (18 new across the two pure
helpers); `next build` clean. Drove the real app end to end: Run reveal on
double-dipping, unsalvageable path on confounding, inline notebook on /corrected.
Screenshots captured. Only console error is a pre-existing favicon 404.

**Scope.** No cloud/sandbox execution, no new API route, no contract/engine/Python
change. All eight edits live in `apps/web`.
