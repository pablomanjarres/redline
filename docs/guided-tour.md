# The guided tour

A first-time reader opens Redline and sees a dataset, four claims, and a button. They do
not know what any of it means. The guided tour fixes that: it darkens the screen except
the one control they should touch next, and puts a card beside it saying what that control
does, what to put there, and why the check behind it matters.

It has two readers at once, and it has to serve both:

- **A scientist** who has never used the app. The `what` line is for them. It is mechanical
  and second person, and where a control takes input it says what to put in.
- **A judge** clicking through with nobody presenting. The `why` line is for them. By the
  last step they should know what Redline catches, that it says clean when the analysis is
  clean, and that the same engine is an MCP server and a Claude Skill.

Nineteen steps, about two minutes on the presenter track.

## The two tracks

The welcome card offers three doors.

| Door | Mode | What happens |
|---|---|---|
| Walk me through it | `guided` | The reader drives. Steps that spotlight a control wait for the reader to operate it, and a Next button is always there so nobody gets stuck. |
| Play it for me | `presenter` | The tour drives itself on a per-step dwell, sweeps the Check 3 resolution scrub so the state appears and vanishes, and offers Pause. Space toggles it. |
| Skip | none | Dismissed, remembered in `localStorage`. The masthead keeps a Guided tour button. |

## Where the pieces live

```
apps/web/src/lib/tour/
  anchors.ts          The id registry. Every element the tour can spotlight.
  types.ts            TourStep, TourEnsure, and the pure reducer.
  steps.ts            The script. All the prose.
  use-target-rect.ts  Tracks the target's viewport rectangle.
  steps.test.ts       The voice, honesty, and structure gate.
apps/web/src/state/tour.tsx          The impure half: routing, ensures, presenter, keyboard.
apps/web/src/components/tour/
  Spotlight.tsx       Four scrim rectangles around a real hole.
  CoachMark.tsx       The card, and the placement math.
  TourOverlay.tsx     The portal, the error boundary, the live region.
  TourLauncher.tsx    The way back in.
```

## The spotlight is four rectangles, not a hole

The scrim is drawn as four fixed panels (above, below, left of, right of the target). The
hole is a genuine gap in the document with nothing over it, so the spotlighted control
keeps its own hit testing, hover, and keyboard focus at no cost. A `clip-path` cutout or a
`box-shadow: 0 0 0 9999px` scrim would paint the same picture and leave click-through to a
CSS feature whose behavior varies. On a stage, that is not a trade worth making.

Consequences worth knowing:

- The overlay root is `pointer-events: none`. The scrim panels and the coach mark opt back
  in. Without this the root would cover the hole and swallow the click the step asks for.
- The scrim swallows every click that lands on it, so a reader cannot wander off mid-step.
- Straight panels leave the square corners of a rounded control undimmed. Padding stays
  tight (8px) and the radiused ring paints last, over the corners.

The target rectangle is tracked by a single `requestAnimationFrame` loop reading one
`getBoundingClientRect`. The app scrolls inside a clipped `<main class="rl-scroll">` rather
than the window, charts mount after a check resolves, and the pipeline rail scrolls
sideways on narrow screens. A scroll listener plus a `ResizeObserver` plus a
`MutationObserver` would cover those three and still miss a CSS transition. The frame loop
covers all of them, and only re-renders when the rectangle moves.

## A step is never dead

Each step may carry an `ensure`, a side effect the tour runs on entering it. A reader who
deep-links to `/checks/3` with nothing run still sees a figure, because the step calls the
same session action the UI would have called. Ensures are idempotent, and they run the real
check through the real compute target. The tour never writes a result and never fabricates
a number.

`ensure` kinds: `loadScenario`, `resolveFields`, `confirmFields`, `runCheck`,
`setCheck3Track`.

The script quotes the Marson fixture, so its first step switches to that scenario if the
reader was on another one. Ending the tour puts their scenario, and any knob the tour
moved, back.

## It cannot take the demo down

- The overlay is wrapped in an error boundary that renders nothing on failure.
- A target that never appears within three seconds floats the card in the middle rather
  than blocking the app.
- `?tour=0` suppresses it, `?tour=1` forces it, and a dismissal is remembered.
- It renders nothing during SSR and nothing on paper.

For a clean demo run with no tour, open the app with `?tour=0` once.

## Accessibility

- The card is `role="dialog"` with `aria-modal="false"`, deliberately. The reader is meant
  to reach past the card and operate the spotlighted control, so the rest of the page has
  to stay in the accessibility tree.
- Focus moves to the card on every step, and returns where it came from when the tour ends.
- Escape ends the tour. Left and Right move between steps, and both stand down when focus
  is inside a slider or a select, because those controls own their arrow keys.
- `prefers-reduced-motion` drops the ring halo, the card rise, and the presenter scrub
  sweep.
- The step is announced in an `aria-live="polite"` region.

## The copy is tested, not reviewed

Tour prose ships in the product, so `steps.test.ts` holds it to the same rules as report
copy (see `honesty-rules.md` and the voice rules in `CLAUDE.md`). It fails the build on:

- an em dash anywhere, or an en dash outside a numeric range
- a `not X, but Y` reframe, or AI-tell vocabulary
- any sentence attaching an error to the dataset's authors
- calling Check 2 an FDR correction, or omitting ClusterDE from the double-dipping step
- presenting the disabled upload control as live
- a clean beat wired to the spurious group rather than the stable one
- a step targeting an anchor that no element actually carries

That last one is the useful one. Every `data-tour` id a step names is grepped out of the
source tree, so a typo fails the suite instead of showing an empty spotlight on stage.

## Adding a step

1. Add the `data-tour="..."` attribute to the element.
2. Add its id to `TOUR_ANCHORS` in `anchors.ts`. If the element renders inside a `.map()`,
   add the id to `THREADED_ANCHORS` too.
3. Add the step to `TOUR_STEPS`. Give it an `ensure` if its target only exists after a
   check has run.
4. Run `pnpm --filter @redline/web test`. The gate above will tell you what you broke.
