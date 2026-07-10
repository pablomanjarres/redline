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
import type { Check3Config, ScenarioId } from '@redline/contracts';
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

/**
 * The first Check-3 run and its live config, or null before the workbench has any
 * runs. The tour's fragility beat (track + scrub) drives this one run; with the
 * (claim, check) run model there is no single per-check cfg[3] any more, so the
 * tour targets the first run of Check 3 and no-ops gracefully when there is none.
 */
function firstCheck3Run(s: SessionValue): { key: string; cfg: Check3Config } | null {
  const run = s.runs.find((r) => r.checkId === 3);
  if (!run) return null;
  const cfg = s.runCfg[run.key];
  if (!cfg) return null;
  return { key: run.key, cfg: cfg as Check3Config };
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

  // What the tour moved, so it can put it back. `check3` is the first Check-3
  // run's key plus its pre-tour track/scrub, captured the first time the tour
  // moves it (the run only exists after the workbench has run).
  const restore = useRef<{
    scenarioId: ScenarioId;
    check3?: { key: string; track: string; scrub: number };
  } | null>(null);
  // Where focus was before the tour took it, so Escape returns the reader there.
  const focusReturn = useRef<HTMLElement | null>(null);

  const next = useCallback(() => dispatch({ type: 'next' }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const goTo = useCallback((index: number) => dispatch({ type: 'goto', index }), []);
  const setMode = useCallback((mode: TourMode) => dispatch({ type: 'setMode', mode }), []);
  const togglePause = useCallback(() => dispatch({ type: 'togglePause' }), []);

  const start = useCallback((mode: TourMode) => {
    const s = sessionRef.current;
    // Capture the scenario now; the Check-3 run only exists once the workbench has
    // run, so its pre-tour state is captured lazily when the tour first moves it
    // (see the setCheck3Track ensure). If a run already exists, capture it here.
    const c3 = firstCheck3Run(s);
    restore.current = {
      scenarioId: s.scenarioId,
      ...(c3 ? { check3: { key: c3.key, track: c3.cfg.track, scrub: c3.cfg.scrub } } : {}),
    };
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
      } else if (r.check3) {
        // Put back only what actually moved, on the same run, and re-run it.
        const curCfg = s.runCfg[r.check3.key] as Check3Config | undefined;
        if (curCfg && (curCfg.track !== r.check3.track || curCfg.scrub !== r.check3.scrub)) {
          s.setRunCfg(r.check3.key, { track: r.check3.track, scrub: r.check3.scrub });
        }
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
        // Confirming the design no longer runs the checks. It inspects the file
        // and extracts the claims, so this leaves the Claim Review screen with a
        // real, unconfirmed list for the reader to look at.
        if (!sessionRef.current.fields) await sessionRef.current.resolveFields();
        if (!sessionRef.current.fieldsConfirmed) await sessionRef.current.confirmFields();
        return;
      case 'confirmClaims':
        // The workbench runs only after the claim list is confirmed. Walk the
        // whole front door, each hop idempotent, so a reader who deep-links to a
        // check or the report still lands on real, routed results.
        if (!sessionRef.current.fields) await sessionRef.current.resolveFields();
        if (!sessionRef.current.fieldsConfirmed) await sessionRef.current.confirmFields();
        if (!sessionRef.current.claimsConfirmed) await sessionRef.current.confirmClaims();
        return;
      case 'runCheck': {
        const id = e.checkId;
        // Results come from confirming the claim list, which runs every (claim,
        // check) run. Make sure the whole chain ran, then fill the FIRST run of
        // this check directly if it has not produced a result yet. runOne is a
        // real session action, so the step is never dead.
        if (!sessionRef.current.fields) await sessionRef.current.resolveFields();
        if (!sessionRef.current.fieldsConfirmed) await sessionRef.current.confirmFields();
        if (!sessionRef.current.claimsConfirmed) await sessionRef.current.confirmClaims();
        const cur = sessionRef.current;
        const run = cur.runs.find((r) => r.checkId === id);
        if (run && cur.results[run.key] == null && !cur.running[run.key]) await cur.runOne(run.key);
        return;
      }
      case 'setCheck3Track': {
        const c3 = firstCheck3Run(s);
        if (!c3) return; // no Check-3 run yet; the beat no-ops rather than crash
        // Lazily remember the pre-tour state the first time the tour moves it, so
        // stop() can restore this exact run.
        if (restore.current && !restore.current.check3) {
          restore.current = {
            ...restore.current,
            check3: { key: c3.key, track: c3.cfg.track, scrub: c3.cfg.scrub },
          };
        }
        if (c3.cfg.track !== e.track) s.setRunCfg(c3.key, { track: e.track });
        return;
      }
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

    const c3 = firstCheck3Run(sessionRef.current);
    if (!c3) return; // no Check-3 run to sweep; skip rather than crash
    const runKey = c3.key;
    const lo = c3.cfg.min;
    const hi = c3.cfg.max;
    if (!(hi > lo)) return;

    const dwell = Math.max(1200, step.dwellMs);
    const startedAt = performance.now();
    const id = setInterval(() => {
      const t = Math.min(1, (performance.now() - startedAt) / dwell);
      // out and back, so the group appears and then vanishes again
      const phase = t < 0.5 ? t * 2 : (1 - t) * 2;
      const value = Number((lo + (hi - lo) * phase).toFixed(2));
      sessionRef.current.setRunCfg(runKey, { scrub: value }, { rerun: false });
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
