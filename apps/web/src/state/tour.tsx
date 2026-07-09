'use client';

/**
 * The guided tour store.
 *
 * The tour is a list of steps (`@/lib/tour/steps`) plus a pure reducer
 * (`@/lib/tour/types`). This provider is the impure half: it syncs the step to
 * the route, runs each step's `ensure` so a step is never dead, listens for the
 * reader operating the spotlighted control, drives presenter mode, and restores
 * any knob the tour moved when it ends.
 *
 * It sits inside <SessionProvider> in the root layout, so it survives every
 * route change and can call the same session actions the UI calls. It never
 * writes a result and never fabricates a number: an `ensure` runs the real check
 * through the real compute target.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { ScenarioId } from '@redline/contracts';
import { useSession, type SessionValue } from '@/state/session';
import { TOUR_STEPS } from '@/lib/tour/steps';
import { anchorSelector } from '@/lib/tour/anchors';
import {
  INITIAL_TOUR_STATE,
  tourReducer,
  type TourEnsure,
  type TourMode,
  type TourState,
  type TourStep,
} from '@/lib/tour/types';

const SEEN_KEY = 'redline_tour_v1';
/** Presenter mode redraws the progress rule at this cadence. */
const TICK_MS = 90;
/** How long a reader's own interaction is allowed to land before the tour moves on. */
const ADVANCE_DELAY_MS = 900;
/** Presenter mode sweeps the Check 3 resolution scrub at this cadence. */
const SWEEP_MS = 80;

export interface TourValue extends TourState {
  steps: TourStep[];
  step: TourStep;
  total: number;
  progress: number;
  start(mode: TourMode): void;
  stop(): void;
  next(): void;
  back(): void;
  goTo(index: number): void;
  setMode(mode: TourMode): void;
  togglePause(): void;
}

const TourContext = createContext<TourValue | null>(null);

function readSeen(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(SEEN_KEY) === 'seen';
  } catch {
    return false;
  }
}

function markSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SEEN_KEY, 'seen');
  } catch {
    /* storage disabled; the tour simply offers itself again next visit */
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Arrow keys belong to a focused slider or select, never to the tour. */
function inFormControl(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const reducer = useCallback(
    (s: TourState, a: Parameters<typeof tourReducer>[1]) => tourReducer(s, a, TOUR_STEPS.length),
    [],
  );
  const [state, dispatch] = useReducer(reducer, INITIAL_TOUR_STATE);
  const [progress, setProgress] = useState(0);

  // Fresh session in async callbacks without stale closures.
  const sessionRef = useRef<SessionValue>(session);
  sessionRef.current = session;

  const step = TOUR_STEPS[state.index] ?? TOUR_STEPS[0]!;
  const stepRef = useRef(step);
  stepRef.current = step;

  // What the tour moved, so it can put it back.
  const restore = useRef<{ scenarioId: ScenarioId; track?: string; scrub?: number } | null>(null);
  // Where focus was before the tour took it, so Escape returns the reader there.
  const focusReturn = useRef<HTMLElement | null>(null);

  const next = useCallback(() => dispatch({ type: 'next' }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const goTo = useCallback((index: number) => dispatch({ type: 'goto', index }), []);
  const setMode = useCallback((mode: TourMode) => dispatch({ type: 'setMode', mode }), []);
  const togglePause = useCallback(() => dispatch({ type: 'togglePause' }), []);

  const start = useCallback((mode: TourMode) => {
    const s = sessionRef.current;
    restore.current = { scenarioId: s.scenarioId, track: s.cfg[3].track, scrub: s.cfg[3].scrub };
    const active = document.activeElement;
    focusReturn.current = active instanceof HTMLElement ? active : null;
    dispatch({ type: 'start', mode, index: 0 });
  }, []);

  const stop = useCallback(() => {
    markSeen();
    const r = restore.current;
    const s = sessionRef.current;
    if (r) {
      if (r.scenarioId !== s.scenarioId) {
        // The tour switched scenarios to narrate Marson. Switching back resets
        // the session wholesale, so there is nothing further to put right.
        s.loadScenario(r.scenarioId);
      } else if (r.track !== s.cfg[3].track || r.scrub !== s.cfg[3].scrub) {
        // Put back only what actually moved, and re-run the check that owns it.
        s.setCfg(3, { track: r.track, scrub: r.scrub });
      }
    }
    restore.current = null;
    dispatch({ type: 'stop' });
    // Hand focus back where the reader left it, so Escape is not a dead end.
    focusReturn.current?.focus({ preventScroll: true });
    focusReturn.current = null;
  }, []);

  // Reaching the end of the list ends the tour through the reducer, so treat
  // any transition out of `active` as a completion and remember it.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !state.active) markSeen();
    wasActive.current = state.active;
  }, [state.active]);

  // ── ensure: make the step's surface real before the reader looks at it ─────
  const runEnsure = useCallback(async (e: TourEnsure | undefined): Promise<void> => {
    if (!e) return;
    const s = sessionRef.current;
    switch (e.kind) {
      case 'loadScenario':
        // The script quotes the Marson fixture's numbers, so it narrates that
        // scenario. `stop()` puts the reader's own scenario back.
        if (s.scenarioId !== e.scenarioId) s.loadScenario(e.scenarioId);
        return;
      case 'resolveFields':
        if (!s.fields) await s.resolveFields();
        return;
      case 'confirmFields':
        if (!sessionRef.current.fields) await sessionRef.current.resolveFields();
        if (!sessionRef.current.fieldsConfirmed) await sessionRef.current.confirmFields();
        return;
      case 'runCheck': {
        const id = e.checkId;
        if (!s.fieldsConfirmed) {
          if (!s.fields) await s.resolveFields();
          await sessionRef.current.confirmFields();
          return; // confirmFields runs all four
        }
        if (s.results[id] == null && !s.running[id]) await s.runCheck(id);
        return;
      }
      case 'setCheck3Track':
        if (s.cfg[3].track !== e.track) s.setCfg(3, { track: e.track });
        return;
    }
  }, []);

  // ── route sync + ensure, keyed on the STEP, never on the pathname ─────────
  // Keying on the pathname would fight the app: a reader who clicks the real
  // "Begin audit" navigates to /fields while the tour is still on the intake
  // step, and a pathname-keyed effect would push them straight back.
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!state.active) {
      syncedFor.current = null;
      return;
    }
    if (syncedFor.current === step.id) return;
    syncedFor.current = step.id;

    if (step.route && pathname !== step.route) router.push(step.route);
    void runEnsure(step.ensure);
    // `pathname` is read, not depended on, for the reason above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active, step.id, router, runEnsure]);

  // ── the reader operates the spotlighted control ───────────────────────────
  useEffect(() => {
    if (!state.active || step.advance !== 'click' || !step.target) return;
    const el = document.querySelector(anchorSelector(step.target));
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const evt = step.advanceEvent ?? 'click';
    const onInteract = () => {
      if (timer) return; // first qualifying interaction wins
      timer = setTimeout(() => dispatch({ type: 'next' }), ADVANCE_DELAY_MS);
    };
    el.addEventListener(evt, onInteract);
    return () => {
      el.removeEventListener(evt, onInteract);
      if (timer) clearTimeout(timer);
    };
  }, [state.active, state.index, step.advance, step.advanceEvent, step.target]);

  // ── presenter mode: the tour drives itself ───────────────────────────────
  useEffect(() => {
    if (!state.active || state.mode !== 'presenter' || state.paused) {
      setProgress(0);
      return;
    }
    const dwell = Math.max(1200, step.dwellMs);
    const startedAt = performance.now();
    const id = setInterval(() => {
      const elapsed = performance.now() - startedAt;
      setProgress(Math.min(1, elapsed / dwell));
      if (elapsed >= dwell) dispatch({ type: 'next' });
    }, TICK_MS);
    return () => {
      clearInterval(id);
      setProgress(0);
    };
  }, [state.active, state.mode, state.paused, state.index, step.dwellMs]);

  // ── presenter mode sweeps the resolution scrub, so the state appears and vanishes ─
  useEffect(() => {
    if (!state.active || state.mode !== 'presenter' || state.paused || !step.sweepScrub) return;
    if (prefersReducedMotion()) return;

    const s = sessionRef.current;
    const lo = s.cfg[3].min;
    const hi = s.cfg[3].max;
    if (!(hi > lo)) return;

    const dwell = Math.max(1200, step.dwellMs);
    const startedAt = performance.now();
    const id = setInterval(() => {
      const t = Math.min(1, (performance.now() - startedAt) / dwell);
      // out and back, so the group appears and then vanishes again
      const phase = t < 0.5 ? t * 2 : (1 - t) * 2;
      const value = Number((lo + (hi - lo) * phase).toFixed(2));
      sessionRef.current.setCfg(3, { scrub: value }, { rerun: false });
    }, SWEEP_MS);
    return () => clearInterval(id);
  }, [state.active, state.mode, state.paused, state.index, step.sweepScrub, step.dwellMs]);

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop();
        return;
      }
      if (inFormControl(document.activeElement)) return; // the slider owns its arrows
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        dispatch({ type: 'next' });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        dispatch({ type: 'back' });
      } else if (e.key === ' ' && state.mode === 'presenter') {
        e.preventDefault();
        dispatch({ type: 'togglePause' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.active, state.mode, stop]);

  // ── first visit: offer the tour rather than making the reader hunt for it ─
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('tour');
    if (flag === '0') {
      markSeen();
      return;
    }
    if (flag !== '1' && readSeen()) return;
    if (window.location.pathname !== '/') return;
    const t = setTimeout(() => start('guided'), 550);
    return () => clearTimeout(t);
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<TourValue>(
    () => ({
      ...state,
      steps: TOUR_STEPS,
      step,
      total: TOUR_STEPS.length,
      progress,
      start,
      stop,
      next,
      back,
      goTo,
      setMode,
      togglePause,
    }),
    [state, step, progress, start, stop, next, back, goTo, setMode, togglePause],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourValue {
  const value = useContext(TourContext);
  if (!value) throw new Error('useTour must be used within <TourProvider>');
  return value;
}
