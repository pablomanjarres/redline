import { z } from 'zod';
import { CheckId } from './primitives.js';

/**
 * `core` are the four founding pillars. `rigor` are the checks added on top of
 * the same module interface. The split exists so the UI can group them and the
 * report can say which surface fired, and for no other reason: both groups
 * implement exactly the same interface and inherit corrected code, recommended
 * actions, and fix-and-preview automatically.
 */
export const CheckGroup = z.enum(['core', 'rigor']);
export type CheckGroup = z.infer<typeof CheckGroup>;

export const CheckMeta = z.object({
  id: CheckId,
  /** Station label on the pipeline rail and title on the finding card. */
  name: z.string(),
  /** The one-line description of what this check catches. */
  sub: z.string(),
  /** Taxonomy tag, shared across checks that catch the same class of error. */
  errorClass: z.string(),
  group: CheckGroup,
});
export type CheckMeta = z.infer<typeof CheckMeta>;

/**
 * The check registry. This is the single source of truth for which checks
 * exist and what they are called. Every surface derives from it: the pipeline
 * rail, the workbench board, the session state maps, the report, the PDF, and
 * the reasoning layer's per-check guidance.
 *
 * Adding a rigor check is adding a row here, a literal to `CheckId`, and a
 * module in the Python engine. Nothing else in the app enumerates checks.
 */
export const CHECK_REGISTRY: Record<CheckId, CheckMeta> = {
  1: {
    id: 1,
    name: 'Pseudoreplication',
    sub: 'Non-independent data inflating a p-value',
    errorClass: 'unit_of_analysis',
    group: 'core',
  },
  2: {
    id: 2,
    name: 'Double dipping',
    sub: "Clusters that don't replicate out of sample",
    errorClass: 'selective_inference',
    group: 'core',
  },
  3: {
    id: 3,
    name: 'Fragility',
    sub: 'A result that hinges on an arbitrary parameter',
    errorClass: 'clustering_artifact',
    group: 'core',
  },
  4: {
    id: 4,
    name: 'Confounding',
    sub: "Two variables that can't be separated",
    errorClass: 'confounding',
    group: 'core',
  },
  5: {
    id: 5,
    name: 'Multiple testing',
    sub: 'Significance claimed on raw p-values across many tests',
    errorClass: 'multiple_testing',
    group: 'rigor',
  },
  6: {
    id: 6,
    name: 'Unmodeled covariate',
    sub: 'Known batch structure left out of a separable model',
    errorClass: 'model_misspecification',
    group: 'rigor',
  },
  7: {
    id: 7,
    name: 'Resolution choice',
    sub: 'A cluster count chosen without a stability criterion',
    errorClass: 'clustering_artifact',
    group: 'rigor',
  },
  8: {
    id: 8,
    name: 'Test assumptions',
    sub: 'A test whose assumptions the data violate',
    errorClass: 'test_misspecification',
    group: 'rigor',
  },
};

/** Every check id, in display order. Derive loops from this, never a literal. */
export const CHECK_IDS: readonly CheckId[] = [1, 2, 3, 4, 5, 6, 7, 8];

export const CORE_CHECK_IDS: readonly CheckId[] = CHECK_IDS.filter(
  (id) => CHECK_REGISTRY[id].group === 'core',
);

export const RIGOR_CHECK_IDS: readonly CheckId[] = CHECK_IDS.filter(
  (id) => CHECK_REGISTRY[id].group === 'rigor',
);

/** Total number of registered checks. Report copy reads this, never "4". */
export const CHECK_COUNT = CHECK_IDS.length;

export function checkMeta(id: CheckId): CheckMeta {
  return CHECK_REGISTRY[id];
}

/** Narrow an arbitrary number to a registered check id. */
export function isCheckId(n: unknown): n is CheckId {
  return typeof n === 'number' && (CHECK_IDS as readonly number[]).includes(n);
}

/** Build a record keyed by every check id. Replaces `{1:…,2:…,3:…,4:…}` literals. */
export function checkRecord<T>(init: (id: CheckId) => T): Record<CheckId, T> {
  const out = {} as Record<CheckId, T>;
  for (const id of CHECK_IDS) out[id] = init(id);
  return out;
}
