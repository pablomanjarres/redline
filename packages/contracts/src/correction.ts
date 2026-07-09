import { z } from 'zod';
import { Chart } from './charts.js';
import { CheckId, MethodRef } from './primitives.js';

/**
 * The correction and rigor layer. Redline does not stop at naming the error: it
 * hands back the corrected analysis as runnable code, says what to do next, and
 * renders the result the scientist should have had.
 *
 * One guardrail governs all three, and it is the reason this is defensible:
 * everything Redline asserts, recommends, or corrects is shown, reproducible,
 * and cited. The code is downloadable and runs. The preview is the output of
 * that code. The recommendation names the method and its limits.
 *
 * Where there is no valid fix (a full confound, n=1, an unsalvageable design)
 * Redline says so plainly and shows no corrected result anywhere. That rule is
 * enforced here, in the contract, by `PreviewArtifact` below.
 */

// ── Recommended next actions (Capability 2) ──────────────────────────────────

/**
 * Can the scientist fix this at their desk, do they need to go back to the
 * bench, or is the claim unrescuable from this data? This field is decided by
 * the deterministic engine, never by the model, so an honest "unsalvageable"
 * can never be talked up into a fix that does not exist.
 */
export const Feasibility = z.enum(['fixable_now', 'needs_new_data', 'unsalvageable']);
export type Feasibility = z.infer<typeof Feasibility>;

export const Recommendation = z.object({
  /** The concrete step, imperative, naming the resolved fields of this dataset. */
  action: z.string(),
  /** Why, tied to this finding's numbers. */
  rationale: z.string(),
  /** What it would change if done. */
  changes: z.string(),
  feasibility: Feasibility,
  citation: MethodRef.optional(),
});
export type Recommendation = z.infer<typeof Recommendation>;

// ── Corrected analysis as runnable code (Capability 1) ───────────────────────

/**
 * A runnable script that reproduces Redline's honest re-analysis. The
 * executable skeleton comes from a hand-written, per-check template; only the
 * comments and the explanation are model-written. `params` records exactly what
 * was injected into the template, which is what makes the Case B generality
 * test checkable: the same check on a different dataset must inject that
 * dataset's field names, not the canonical case's.
 */
export const CorrectedCode = z.object({
  language: z.literal('python'),
  filename: z.string(),
  /** The full script, shown inline and downloadable. */
  inline: z.string(),
  /** How to run it, e.g. "python 01_pseudoreplication.py --h5ad data.h5ad". */
  entrypoint: z.string(),
  /** The values injected into the template slots. */
  params: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  ),
});
export type CorrectedCode = z.infer<typeof CorrectedCode>;

// ── Fix and preview (Capability 3) ───────────────────────────────────────────

/**
 * The corrected downstream result, rendered. `before` is what the scientist
 * claimed; `after` is the analysis they should have had, and it is the output
 * of the very code in `CorrectedCode`.
 *
 * The honesty invariant is enforced structurally: an `unsalvageable` finding
 * carries `after: null` and nothing else is representable. A fabricated clean
 * result on a dead-end design is a parse error, not a review comment.
 */
export const PreviewArtifact = z
  .object({
    /** Names the method that produced `after`, e.g. "pseudobulk + PyDESeq2". */
    methodLabel: z.string(),
    /** The method's known limits, carried with the result and never dropped. */
    caveat: z.string().optional(),
    /** True when no valid fix exists for this finding on this data. */
    unsalvageable: z.boolean(),
    before: Chart,
    after: Chart.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.unsalvageable && v.after !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['after'],
        message:
          'An unsalvageable finding must not carry a corrected artifact. Set after to null and say so plainly.',
      });
    }
    if (!v.unsalvageable && v.after === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['after'],
        message:
          'A salvageable finding must carry the corrected artifact. Set unsalvageable when there is no valid fix.',
      });
    }
  });
export type PreviewArtifact = z.infer<typeof PreviewArtifact>;

// ── The corrected-analysis bundle (the artifact that outlasts the week) ──────

export const CorrectedScript = z.object({
  checkId: CheckId,
  title: z.string(),
  filename: z.string(),
  code: z.string(),
});
export type CorrectedScript = z.infer<typeof CorrectedScript>;

export const CorrectedBundle = z.object({
  /** What was wrong, what each script fixes, how to run them. */
  readme: z.string(),
  /** A consolidated notebook, serialized .ipynb JSON. */
  notebook: z.string(),
  scripts: z.array(CorrectedScript),
});
export type CorrectedBundle = z.infer<typeof CorrectedBundle>;

// ── Knobs (the parameters a check exposes to the UI panel) ───────────────────

export const Knob = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['number', 'select', 'multiselect', 'text']),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(),
});
export type Knob = z.infer<typeof Knob>;
