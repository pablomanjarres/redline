'use client';

/**
 * The Redline session store. One client-side source of truth for the whole
 * audit: which scenario is loaded, the resolved fields, the knob config, and
 * the per-check results / reasoning / streaming state. Routing is URL-based
 * (Next App Router), so route is deliberately NOT part of this store.
 *
 * Persistence: `{ scenarioId, fields, fieldsConfirmed, cfg }` is mirrored to
 * localStorage['redline_state_v1'] and rehydrated on mount (SSR-guarded).
 *
 * Reasoning streams client-side: on a run we reveal one reasoning line every
 * ~165ms while the POST resolves, then reveal all. `prefers-reduced-motion`
 * collapses the stream to an immediate full reveal.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AuditReport,
  CheckConfigMap,
  CheckId,
  CheckResult,
  Claim,
  DatasetMeta,
  FieldRole,
  FieldSpec,
  ScenarioId,
} from '@redline/contracts';
import { DEFAULT_CONFIG, SCENARIOS, assembleReport, reasoningLines } from '@redline/engine';
import { postCheck, postFields } from '@/lib/api';

const IDS: CheckId[] = [1, 2, 3, 4];
const DEFAULT_SCENARIO: ScenarioId = 'marson';
const STORAGE_KEY = 'redline_state_v1';
const STREAM_INTERVAL_MS = 165;

// ── Public shape (consumed by every app surface) ─────────────────────────────
export interface SessionValue {
  scenarioId: ScenarioId;
  dataset: DatasetMeta;
  claims: Claim[];
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  cfg: CheckConfigMap;
  results: Record<CheckId, CheckResult | null>;
  running: Record<CheckId, boolean>;
  reasoning: Record<CheckId, string[]>;
  reveal: Record<CheckId, number>;
  // actions
  loadScenario(id: ScenarioId): void;
  resolveFields(): Promise<void>;
  setRole(fieldId: string, role: FieldRole): void;
  confirmFields(): Promise<void>;
  setCfg<Id extends CheckId>(id: Id, patch: Partial<CheckConfigMap[Id]>, opts?: { rerun?: boolean }): void;
  runCheck(id: CheckId): Promise<void>;
  runAll(): void;
  report: AuditReport;
}

// ── Internal state ───────────────────────────────────────────────────────────
interface CoreState {
  scenarioId: ScenarioId;
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  cfg: CheckConfigMap;
  results: Record<CheckId, CheckResult | null>;
  running: Record<CheckId, boolean>;
  reasoning: Record<CheckId, string[]>;
  reveal: Record<CheckId, number>;
}

interface PersistShape {
  scenarioId: ScenarioId;
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  cfg: CheckConfigMap;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const zeroResults = (): Record<CheckId, CheckResult | null> => ({ 1: null, 2: null, 3: null, 4: null });
const zeroRunning = (): Record<CheckId, boolean> => ({ 1: false, 2: false, 3: false, 4: false });
const zeroReasoning = (): Record<CheckId, string[]> => ({ 1: [], 2: [], 3: [], 4: [] });
const zeroReveal = (): Record<CheckId, number> => ({ 1: 0, 2: 0, 3: 0, 4: 0 });

function withId<T>(map: Record<CheckId, T>, id: CheckId, value: T): Record<CheckId, T> {
  return { ...map, [id]: value };
}

function cloneConfig(c: CheckConfigMap): CheckConfigMap {
  return typeof structuredClone === 'function'
    ? structuredClone(c)
    : (JSON.parse(JSON.stringify(c)) as CheckConfigMap);
}

/** Layer saved knobs over the engine defaults, so a new knob still gets a value. */
function mergeConfig(base: CheckConfigMap, saved?: Partial<CheckConfigMap> | null): CheckConfigMap {
  const out = cloneConfig(base);
  if (saved) {
    // Per-id merge. `id` is the CheckId union, so index the target through a
    // string-keyed view to avoid the union-of-configs intersection assignment.
    const target = out as Record<CheckId, Record<string, unknown>>;
    for (const id of IDS) {
      const patch = saved[id];
      if (patch) target[id] = { ...target[id], ...patch };
    }
  }
  return out;
}

function freshCore(scenarioId: ScenarioId): CoreState {
  return {
    scenarioId,
    fields: null,
    fieldsConfirmed: false,
    cfg: cloneConfig(DEFAULT_CONFIG),
    results: zeroResults(),
    running: zeroRunning(),
    reasoning: zeroReasoning(),
    reveal: zeroReveal(),
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function persist(s: CoreState): void {
  if (typeof window === 'undefined') return;
  try {
    const shape: PersistShape = {
      scenarioId: s.scenarioId,
      fields: s.fields,
      fieldsConfirmed: s.fieldsConfirmed,
      cfg: s.cfg,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    /* storage full / disabled — the app runs fine in-memory */
  }
}

/** Safety net if the engine's assembler is unavailable or throws on partial input. */
function localReport(dataset: DatasetMeta, results: CheckResult[]): AuditReport {
  const flagged = results.filter((r) => r.state === 'flagged').length;
  const clean = results.filter((r) => r.state === 'clean').length;
  const needInput = results.filter((r) => r.state === 'flag_only' || r.state === 'hard_stop').length;
  const verdict =
    results.length === 0
      ? 'No checks have been run yet.'
      : flagged > 0
        ? `${flagged} of ${results.length} checks flagged a problem to fix before publishing.`
        : 'No blocking problems found across the checks that ran.';
  return { dataset, results, flagged, clean, needInput, verdict };
}

// ── Context ──────────────────────────────────────────────────────────────────
const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<CoreState>(() => freshCore(DEFAULT_SCENARIO));

  // A ref mirror of the latest committed state, so async callbacks read fresh
  // config/fields without stale closures.
  const coreRef = useRef(core);
  coreRef.current = core;

  const timers = useRef<Record<CheckId, ReturnType<typeof setInterval> | null>>({
    1: null,
    2: null,
    3: null,
    4: null,
  });
  // Per-check run token: a superseded run's async resolution is ignored.
  const tokens = useRef<Record<CheckId, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  const mounted = useRef(true);

  const clearTimer = useCallback((id: CheckId) => {
    const t = timers.current[id];
    if (t) {
      clearInterval(t);
      timers.current[id] = null;
    }
  }, []);

  // Streaming run of one check: reveal reasoning lines on a timer while the
  // compute POST resolves. `stream: false` drives a quiet, full-reveal run.
  const runCheckInternal = useCallback(
    async (id: CheckId, opts: { stream: boolean }): Promise<void> => {
      const s = coreRef.current;
      const cfg = s.cfg[id];
      const fields = s.fields ?? [];
      const lines = reasoningLines(id, cfg);
      const stream = opts.stream && !prefersReducedMotion();
      const token = ++tokens.current[id];
      clearTimer(id);

      setCore((prev) => ({
        ...prev,
        running: withId(prev.running, id, true),
        reasoning: withId(prev.reasoning, id, lines),
        reveal: withId(prev.reveal, id, stream ? 0 : lines.length),
        results: withId(prev.results, id, null),
      }));

      if (stream && lines.length > 0) {
        let i = 0;
        timers.current[id] = setInterval(() => {
          i += 1;
          const next = Math.min(i, lines.length);
          setCore((prev) => ({ ...prev, reveal: withId(prev.reveal, id, next) }));
          if (i >= lines.length) clearTimer(id);
        }, STREAM_INTERVAL_MS);
      }

      try {
        const result = await postCheck({ scenarioId: s.scenarioId, checkId: id, config: cfg, fields });
        if (!mounted.current || token !== tokens.current[id]) return;
        clearTimer(id);
        setCore((prev) => ({
          ...prev,
          results: withId(prev.results, id, result),
          running: withId(prev.running, id, false),
          reveal: withId(prev.reveal, id, lines.length),
        }));
      } catch {
        if (!mounted.current || token !== tokens.current[id]) return;
        clearTimer(id);
        // Leave the result null (renders as "Not run") rather than a fake verdict.
        setCore((prev) => ({
          ...prev,
          running: withId(prev.running, id, false),
          reveal: withId(prev.reveal, id, lines.length),
        }));
      }
    },
    [clearTimer],
  );

  const runCheck = useCallback((id: CheckId) => runCheckInternal(id, { stream: true }), [runCheckInternal]);

  const runAll = useCallback(() => {
    for (const id of IDS) void runCheckInternal(id, { stream: true });
  }, [runCheckInternal]);

  // Quiet restore after a reload: repopulate a confirmed check's result and its
  // (static) reasoning without the running flash or the reveal animation.
  const restoreResult = useCallback(async (id: CheckId): Promise<void> => {
    const s = coreRef.current;
    const cfg = s.cfg[id];
    const lines = reasoningLines(id, cfg);
    const token = ++tokens.current[id];
    try {
      const result = await postCheck({ scenarioId: s.scenarioId, checkId: id, config: cfg, fields: s.fields ?? [] });
      if (!mounted.current || token !== tokens.current[id]) return;
      setCore((prev) => ({
        ...prev,
        results: withId(prev.results, id, result),
        reasoning: withId(prev.reasoning, id, lines),
        reveal: withId(prev.reveal, id, lines.length),
        running: withId(prev.running, id, false),
      }));
    } catch {
      /* leave not-run; the user can re-run from the workbench */
    }
  }, []);

  const loadScenario = useCallback(
    (id: ScenarioId) => {
      for (const k of IDS) {
        clearTimer(k);
        tokens.current[k] += 1;
      }
      const next = freshCore(id);
      coreRef.current = next;
      setCore(next);
      persist(next);
    },
    [clearTimer],
  );

  const resolveFields = useCallback(async () => {
    const s = coreRef.current;
    // Keep already-resolved fields (preserves the scientist's role edits).
    if (s.fields) return;
    const fields = await postFields({ scenarioId: s.scenarioId });
    const next: CoreState = { ...coreRef.current, fields };
    coreRef.current = next;
    setCore(next);
    persist(next);
  }, []);

  const setRole = useCallback((fieldId: string, role: FieldRole) => {
    const s = coreRef.current;
    if (!s.fields) return;
    const fields = s.fields.map((f) => (f.id === fieldId ? { ...f, role, edited: true } : f));
    const next: CoreState = { ...s, fields };
    coreRef.current = next;
    setCore(next);
    persist(next);
  }, []);

  const confirmFields = useCallback(async () => {
    const next: CoreState = { ...coreRef.current, fieldsConfirmed: true };
    coreRef.current = next;
    setCore(next);
    persist(next);
    runAll();
  }, [runAll]);

  const setCfg = useCallback(
    <Id extends CheckId>(id: Id, patch: Partial<CheckConfigMap[Id]>, opts?: { rerun?: boolean }): void => {
      const s = coreRef.current;
      const cfg = { ...s.cfg, [id]: { ...s.cfg[id], ...patch } } as CheckConfigMap;
      const next: CoreState = { ...s, cfg };
      coreRef.current = next;
      setCore(next);
      persist(next);
      // rerun === false is the live-scrub path: update the knob and re-render the
      // chart from it, but do not re-run the statistical test or stream.
      if (opts?.rerun === false) return;
      void runCheckInternal(id, { stream: true });
    },
    [runCheckInternal],
  );

  // Hydrate once from localStorage (never during render — keeps SSR + first
  // client render identical, avoiding a hydration mismatch).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let saved: Partial<PersistShape> | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) as Partial<PersistShape>;
    } catch {
      saved = null;
    }
    if (!saved) return;

    const scenarioId: ScenarioId =
      saved.scenarioId && SCENARIOS[saved.scenarioId] ? saved.scenarioId : DEFAULT_SCENARIO;
    const next: CoreState = {
      ...freshCore(scenarioId),
      fields: saved.fields ?? null,
      fieldsConfirmed: Boolean(saved.fieldsConfirmed),
      cfg: mergeConfig(DEFAULT_CONFIG, saved.cfg),
    };
    coreRef.current = next;
    setCore(next);

    if (next.fieldsConfirmed) {
      for (const id of IDS) void restoreResult(id);
    }
    // Intentionally run-once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      mounted.current = false;
      for (const k of IDS) {
        const t = timers.current[k];
        if (t) clearInterval(t);
      }
    },
    [],
  );

  const scenario = SCENARIOS[core.scenarioId];
  const dataset = scenario.dataset;
  const claims = scenario.claims;

  const report = useMemo<AuditReport>(() => {
    const done = IDS.map((id) => core.results[id]).filter((r): r is CheckResult => r != null);
    try {
      return assembleReport(dataset, done);
    } catch {
      return localReport(dataset, done);
    }
  }, [core.results, dataset]);

  const value: SessionValue = {
    scenarioId: core.scenarioId,
    dataset,
    claims,
    fields: core.fields,
    fieldsConfirmed: core.fieldsConfirmed,
    cfg: core.cfg,
    results: core.results,
    running: core.running,
    reasoning: core.reasoning,
    reveal: core.reveal,
    loadScenario,
    resolveFields,
    setRole,
    confirmFields,
    setCfg,
    runCheck,
    runAll,
    report,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within <SessionProvider>');
  return value;
}
