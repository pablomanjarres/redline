/**
 * The tour anchor registry. Every element the guided tour can spotlight carries
 * `data-tour="<id>"`, and every id it may carry lives here.
 *
 * This module is the single seam between the tour script and the app's markup.
 * A step may only target an id in this list, and `steps.test.ts` greps the source
 * tree to prove every id here is actually attached to a rendered element. A typo
 * fails the test suite instead of showing an empty spotlight on stage.
 */

export const TOUR_ANCHORS = [
  // intake (/)
  'intake.hero',
  'intake.scenario',
  'intake.dataset',
  'intake.upload',
  'intake.analysis',
  'intake.begin',

  // the audit shell (every route below intake)
  'shell.pipeline',
  'shell.tally',
  'shell.report',

  // foundation (/fields)
  'fields.matrix',
  'fields.unit-row',
  'fields.unit-role',
  'fields.tally',
  'fields.confirm',

  // claim review (/claims)
  'claims.tally',
  'claims.confirm',
  'claims.list',
  'claims.card.1',
  'claims.routing.1',
  'claims.out-of-scope',
  'claims.add',

  // the board (/workbench)
  'workbench.board',
  'workbench.tile.1',
  'workbench.rerun',

  // a check stage (/checks/[id])
  'check.badge',
  'check.rerun',
  'check.figure',
  'check.stats',
  'check.verdict',
  'check.instruments',
  'check.reasoning',
  'check1.unit',
  'check2.split',
  'check3.track',
  'check3.scrub',
  'check4.nuisance',

  // the report (/report)
  'report.band',
  'report.row.1',
  'report.export',

  // the engine (/environment)
  'env.terminal',
  'env.surfaces',
] as const;

export type TourAnchor = (typeof TOUR_ANCHORS)[number];

/** The attribute selector for an anchor. One place, so the tour and the tests agree. */
export function anchorSelector(id: TourAnchor): string {
  return `[data-tour="${id}"]`;
}

/** Anchors that only exist once a check has produced a result. A step on one of
 *  these must carry an `ensure` that runs the check, or it will wait on nothing. */
export const ANCHORS_REQUIRING_RESULT: readonly TourAnchor[] = [
  'check.stats',
  'check.verdict',
  'check.badge',
  'report.row.1',
];

/** Anchors that only exist once the scientist has confirmed the design. */
export const ANCHORS_REQUIRING_CONFIRMED_FIELDS: readonly TourAnchor[] = ['shell.tally'];

/**
 * Anchors whose element is rendered inside a `.map()`, so the id reaches the DOM
 * through a prop or a template literal rather than as a literal attribute. The
 * static test in `steps.test.ts` knows to look for them differently. The runtime
 * driver checks all of them the same way, against the real DOM.
 */
export const THREADED_ANCHORS: readonly TourAnchor[] = [
  'fields.unit-row', // passed to <FieldMatrixRow tourId=...> for the row whose role is `unit`
  'fields.unit-role', // passed to <FieldMatrixRow tourRoleId=...>
  'claims.card.1', // passed to <ClaimCard tourCardId=...> for the first in-scope claim
  'claims.routing.1', // passed to <ClaimCard tourRoutingId=...> for that claim's routing chips
  'workbench.tile.1', // emitted as data-tour={`workbench.tile.${checkId}`}
  'report.row.1', // emitted as data-tour={`report.row.${checkId}`}
];
