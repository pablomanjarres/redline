import type { CheckId, ScenarioId } from '@redline/contracts';
import type { TourAnchor } from './anchors';

/**
 * The shapes of the guided tour. A step is data, never a component: the tour is
 * one renderer driven by a list, so the copy can be reviewed and tested as prose
 * without touching the overlay.
 */

/** Where the coach mark sits relative to the spotlight. `auto` picks the side with room. */
export type TourPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right';

/**
 * How the reader leaves a step.
 * - `next`   the reader reads and presses Next.
 * - `click`  the reader operates the spotlighted control. The tour also listens
 *            for the real interaction and advances on it, so the reader is never
 *            told to click a thing and then ignored.
 */
export type TourAdvance = 'next' | 'click';

/** The DOM event that counts as "the reader operated this control". */
export type TourAdvanceEvent = 'click' | 'change';

/**
 * A side effect the tour runs when it enters a step, so a step is never dead.
 * A reader who deep-links to `/checks/3` with nothing run still sees a figure.
 * Every ensure is idempotent and calls the same session action the UI calls.
 */
export type TourEnsure =
  | { kind: 'loadScenario'; scenarioId: ScenarioId }
  | { kind: 'loadExample' }
  | { kind: 'resolveFields' }
  | { kind: 'confirmFields' }
  | { kind: 'confirmClaims' }
  | { kind: 'runCheck'; checkId: CheckId }
  | { kind: 'setCheck3Track'; track: string };

export interface TourStep {
  /** Stable id. Referenced by tests and by the progress rail. */
  id: string;
  /** Short chapter label above the headline. */
  chapter: string;
  /** `spine` plays in both modes. `detail` plays only when the reader drives. */
  depth: TourDepth;
  /** The pathname this step lives on. The tour navigates here when it enters the step. */
  route: string;
  /** The anchor to spotlight. `null` renders a centered card with no cutout. */
  target: TourAnchor | null;
  headline: string;
  /** What the control does and what to put there. Mechanical, second person. */
  what: string;
  /** Why it matters scientifically. Optional. */
  why?: string;
  /** The method paper the app itself cites for this finding. Optional. */
  cite?: string;
  advance: TourAdvance;
  /** Only meaningful when `advance` is `click`. Defaults to `click`. */
  advanceEvent?: TourAdvanceEvent;
  /** How long presenter mode rests on this step. */
  dwellMs: number;
  ensure?: TourEnsure;
  placement?: TourPlacement;
  /** Step 0 only: the welcome card's three doors. */
  primaryCta?: string;
  secondaryCta?: string;
  tertiaryCta?: string;
  /** Presenter mode sweeps the Check 3 scrub across the resolution range on this step. */
  sweepScrub?: boolean;
}

/**
 * How deep a step sits in the script.
 *
 * - `spine`  the narrative. What Redline catches, that it says clean when the
 *            analysis is clean, that it hands back a corrected pipeline, and
 *            that the same engine is an MCP server and a Claude Skill. Presenter
 *            mode plays these and only these, so a judge watching hands free
 *            gets the whole arc inside two minutes.
 * - `detail` mechanics a scientist wants when they are driving: the optional
 *            attach points, the routing chips, the reasoning console. Guided mode
 *            plays everything.
 *
 * Every step declares one. The alternative, a script that grows a step per
 * feature and slowly stops being two minutes long, is how this tour got to
 * twenty six steps across three parallel branches.
 */
export type TourDepth = 'spine' | 'detail';

/** Guided: the reader drives. Presenter: the tour drives itself, hands free. */
export type TourMode = 'guided' | 'presenter';

/**
 * The next index presenter mode should rest on, at or after `from`, skipping
 * `detail` steps. Returns `depths.length` when nothing at or after `from` is a
 * spine step, which the caller reads as "the run is over". Pure, so the presenter
 * skip is unit tested without a DOM.
 */
export function nextSpineIndex(depths: readonly TourDepth[], from: number): number {
  for (let i = Math.max(0, from); i < depths.length; i++) {
    if (depths[i] === 'spine') return i;
  }
  return depths.length;
}

/**
 * The spine index presenter should rest on when it lands on `from`, honoring the
 * direction it was travelling. Forward skips ahead to the next spine step; a Back
 * press skips backward to the previous one, so Back never bounces the reader onto
 * the step they just left. Returns `-1` when a backward
 * search runs off the front (the caller keeps the reader where they are). Pure.
 */
export function spineStepFor(
  depths: readonly TourDepth[],
  from: number,
  dir: 'forward' | 'back',
): number {
  if (depths[from] === 'spine') return from;
  if (dir === 'forward') {
    const i = nextSpineIndex(depths, from);
    return i < depths.length ? i : -1;
  }
  for (let i = from; i >= 0; i--) {
    if (depths[i] === 'spine') return i;
  }
  return -1;
}

export interface TourState {
  active: boolean;
  mode: TourMode;
  index: number;
  paused: boolean;
}

export type TourAction =
  | { type: 'start'; mode: TourMode; index?: number }
  | { type: 'stop' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; index: number }
  | { type: 'setMode'; mode: TourMode }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'togglePause' };

export const INITIAL_TOUR_STATE: TourState = {
  active: false,
  mode: 'guided',
  index: 0,
  paused: false,
};

/**
 * The state machine. Pure, so it is unit tested without a DOM. `stepCount` is
 * passed in rather than imported so the reducer never depends on the copy.
 */
export function tourReducer(state: TourState, action: TourAction, stepCount: number): TourState {
  const last = Math.max(0, stepCount - 1);
  const clamp = (i: number) => Math.min(last, Math.max(0, i));

  switch (action.type) {
    case 'start':
      return { active: true, mode: action.mode, index: clamp(action.index ?? 0), paused: false };
    case 'stop':
      return { ...INITIAL_TOUR_STATE, mode: state.mode };
    case 'next':
      // Advancing past the last step ends the tour. Reaching the end is a
      // completion, so it dismisses rather than sticking on the final card.
      if (state.index >= last) return { ...INITIAL_TOUR_STATE, mode: state.mode };
      return { ...state, index: state.index + 1, paused: false };
    case 'back':
      return { ...state, index: clamp(state.index - 1), paused: false };
    case 'goto':
      return { ...state, index: clamp(action.index), paused: false };
    case 'setMode':
      return { ...state, mode: action.mode, paused: false };
    case 'pause':
      return { ...state, paused: true };
    case 'resume':
      return { ...state, paused: false };
    case 'togglePause':
      return { ...state, paused: !state.paused };
    default:
      return state;
  }
}
