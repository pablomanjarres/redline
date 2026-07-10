'use client';

/**
 * The Redline session store. One client-side source of truth for the whole
 * audit: which scenario is loaded, the resolved fields, the extracted claims,
 * the knob config, and the per-check results / reasoning / streaming state.
 * Routing is URL-based (Next App Router), so route is deliberately NOT part of
 * this store.
 *
 * The flow (spec section 1) is:
 *   intake -> field resolution -> claim extraction -> workbench -> report
 * Confirming fields no longer runs the checks. It kicks the inspection and the
 * claim extraction. Confirming the claims is what runs the workbench, and it
 * runs only the checks a confirmed, non-removed claim routes to.
 *
 * Persistence: a PersistShape (scenario, fields, claims, the per-check knob base,
 * and the intake text) is mirrored to localStorage['redline_state_v3'] and
 * rehydrated on mount (SSR-guarded). The runs and their per-run configs are NOT
 * persisted; they are rebuilt from the persisted claims + config via prepareRuns
 * on restore. A stale v1/v2 payload lives under a different key and is ignored,
 * never migrated, so a returning user never skips the claim station and an old
 * per-check baked config never mis-restores.
 *
 * The unit of work is one (claim, check) RUN, not one check. When two claims
 * route to the same check, each is its own run with its own baked config, keyed
 * by RunKey (`${claimId}::${checkId}`), and nothing is silently dropped. The
 * results / running / reasoning / reveal maps and the timers/tokens are all
 * RunKey-keyed. `prepareRuns` (from @redline/engine) is the source of truth for
 * which runs exist.
 *
 * Streaming: both the check reasoning and the claim-extraction copy reveal one
 * line every ~165ms while the POST resolves, then reveal all. `prefers-reduced-
 * motion` collapses each stream to an immediate full reveal.
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
import {
  DatasetInventory,
  ExtractedClaim,
} from '@redline/contracts';
import type {
  AuditReport,
  CheckConfigMap,
  CheckId,
  CheckResult,
  CheckRoute,
  Claim,
  ClaimStatus,
  DatasetMeta,
  FieldRole,
  FieldSpec,
  ScenarioId,
  ExtractionAssessment,
} from '@redline/contracts';
import {
  SCENARIOS,
  assembleReport,
  curatedClaimsFor,
  defaultConfigFor,
  extractionLines as engineExtractionLines,
  prepareRuns,
  reasoningLines,
} from '@redline/engine';
import type { PreparedRun, RunKey } from '@redline/engine';
import { postCheck, postClaims, postFields, postInspect, postMapClaim } from '@/lib/api';

const IDS: CheckId[] = [1, 2, 3, 4];
const DEFAULT_SCENARIO: ScenarioId = 'marson';
const STORAGE_KEY = 'redline_state_v3';
const STREAM_INTERVAL_MS = 165;

type ClaimsSource = 'model' | 'curated';

/**
 * A knob patch for one run. A union of per-check partials rather than
 * `Partial<CheckConfigMap[CheckId]>` (which collapses to `{}` because the four
 * configs share no common key), so a caller's `{ track }` or `{ nuisance }` keeps
 * its per-check shape and a typo'd knob is still rejected.
 */
export type RunCfgPatch =
  | Partial<CheckConfigMap[1]>
  | Partial<CheckConfigMap[2]>
  | Partial<CheckConfigMap[3]>
  | Partial<CheckConfigMap[4]>;

/**
 * One finding on the report sheet: a run (its key, check, and the claim whose
 * params drove it) paired with its computed result. Carrying `claimText` here is
 * what lets the report title two findings on the same check apart ("Fragility:
 * {claim}"). The claim shown and the claim audited are the same descriptor, so
 * they can never disagree (honesty rule 2).
 */
export interface ReportFinding {
  key: RunKey;
  checkId: CheckId;
  claimText: string;
  result: CheckResult;
}

// ── Public shape (consumed by every app surface) ─────────────────────────────
export interface SessionValue {
  scenarioId: ScenarioId;
  dataset: DatasetMeta;
  /** The legacy per-check scenario claims. No surface reads these since the run
   * model landed (the board and stage read run.claimText); kept on the shape for
   * back-compat. */
  claims: Claim[];
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  // Claim slice (spec sections 4-7).
  inventory: DatasetInventory | null;
  /** The claims the extraction agent proposed, as ratified on Claim Review. */
  extractedClaims: ExtractedClaim[] | null;
  /** Whether the claim list is a live model reading or the curated built-in list. */
  claimsSource: ClaimsSource | null;
  /** The extraction assessment: set when a live model reading looks suppressed. */
  extractionAssessment: ExtractionAssessment | null;
  claimsConfirmed: boolean;
  extracting: boolean;
  extractionLines: string[];
  extractionReveal: number;
  /** Optional intake text: the scientist's notebook / script and pasted prose. */
  notebook: string;
  prose: string;
  /** In-flight / error state for manual claim entry (spec section 7). */
  addingClaim: boolean;
  addClaimError: string | null;
  /** The per-check knob base (the scenario defaults). Each run bakes its claim's
   * route params over this into its own `runCfg` entry; the base itself is not
   * edited by the instrument rail. */
  cfg: CheckConfigMap;
  /** Each run's effective config (base ⊕ the run's route params), keyed by RunKey.
   * The InstrumentRail edits THIS per run, so two runs on one check keep separate
   * knobs. */
  runCfg: Record<RunKey, CheckConfigMap[CheckId]>;
  results: Record<RunKey, CheckResult | null>;
  running: Record<RunKey, boolean>;
  reasoning: Record<RunKey, string[]>;
  reveal: Record<RunKey, number>;
  /** Every (active claim, valid route) as a run ready to execute, in prepareRuns'
   * deterministic order. This is the source of truth for what the workbench shows:
   * when it is empty, no claim routes to any check and there are simply no tiles. */
  runs: PreparedRun[];
  // actions
  loadScenario(id: ScenarioId): void;
  resolveFields(): Promise<void>;
  setRole(fieldId: string, role: FieldRole): void;
  /** Confirm the fields. Does NOT run the checks; kicks inspect + extractClaims. */
  confirmFields(): Promise<void>;
  inspect(): Promise<void>;
  extractClaims(): Promise<void>;
  setClaimStatus(id: string, status: ClaimStatus): void;
  setClaimText(id: string, text: string): void;
  setClaimRouting(id: string, checks: CheckRoute[]): void;
  addClaim(text: string): Promise<void>;
  setNotebook(text: string): void;
  setProse(text: string): void;
  /** Confirm the claim list and run every (claim, check) run in the workbench. */
  confirmClaims(): Promise<void>;
  /** Edit one run's effective config (runCfg[runKey]) and, unless rerun is false,
   * re-run just that run. Replaces the old per-check setCfg. */
  setRunCfg(runKey: RunKey, patch: RunCfgPatch, opts?: { rerun?: boolean }): void;
  /** Run one (claim, check) run by its RunKey. Replaces the old runCheck(id). */
  runOne(runKey: RunKey): Promise<void>;
  runAll(): void;
  /** The claim text a run audits, read straight off the run descriptor so the
   * shown claim and the audited claim can never disagree. Empty when the key
   * matches no current run. */
  claimForRun(runKey: RunKey): string;
  report: AuditReport;
  /** One finding per run that produced a result, in run order, each carrying the
   * claim it audited so the report can title findings that share a check apart. */
  reportFindings: ReportFinding[];
}

// ── Internal state ───────────────────────────────────────────────────────────
interface CoreState {
  scenarioId: ScenarioId;
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  inventory: DatasetInventory | null;
  extractedClaims: ExtractedClaim[] | null;
  claimsSource: ClaimsSource | null;
  /** The extraction assessment: set when a live model reading looks suppressed. */
  extractionAssessment: ExtractionAssessment | null;
  claimsConfirmed: boolean;
  extracting: boolean;
  extractionLines: string[];
  extractionReveal: number;
  notebook: string;
  prose: string;
  addingClaim: boolean;
  addClaimError: string | null;
  cfg: CheckConfigMap;
  runCfg: Record<RunKey, CheckConfigMap[CheckId]>;
  runs: PreparedRun[];
  results: Record<RunKey, CheckResult | null>;
  running: Record<RunKey, boolean>;
  reasoning: Record<RunKey, string[]>;
  reveal: Record<RunKey, number>;
}

interface PersistShape {
  scenarioId: ScenarioId;
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  cfg: CheckConfigMap;
  inventory: DatasetInventory | null;
  extractedClaims: ExtractedClaim[] | null;
  claimsConfirmed: boolean;
  claimsSource: ClaimsSource | null;
  // extractionAssessment is deliberately NOT persisted: it is a live signal about
  // one extraction run, recomputed on re-extract, not restored.
  notebook: string;
  prose: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
// Runs are dynamic, so the per-run maps start empty and fill as runs are prepared.
const zeroResults = (): Record<RunKey, CheckResult | null> => ({});
const zeroRunning = (): Record<RunKey, boolean> => ({});
const zeroReasoning = (): Record<RunKey, string[]> => ({});
const zeroReveal = (): Record<RunKey, number> => ({});

function withId<T>(map: Record<string, T>, key: string, value: T): Record<string, T> {
  return { ...map, [key]: value };
}

function cloneConfig(c: CheckConfigMap): CheckConfigMap {
  return typeof structuredClone === 'function'
    ? structuredClone(c)
    : (JSON.parse(JSON.stringify(c)) as CheckConfigMap);
}

/** Layer saved knobs over the scenario defaults, so a new knob still gets a value. */
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

// Claim -> check routing (the (claim, check) run model: prepareRuns / runsFrom /
// configForRun) now lives in @redline/engine's routing module: pure, React-free
// engine logic the acceptance harness can import and cover directly. This store
// imports prepareRuns above rather than keeping a private copy.

function freshCore(scenarioId: ScenarioId): CoreState {
  return {
    scenarioId,
    fields: null,
    fieldsConfirmed: false,
    inventory: null,
    extractedClaims: null,
    claimsSource: null,
    extractionAssessment: null,
    claimsConfirmed: false,
    extracting: false,
    extractionLines: [],
    extractionReveal: 0,
    notebook: '',
    prose: '',
    addingClaim: false,
    addClaimError: null,
    // Each scenario loads with its own knob defaults (the tracked group, the unit,
    // the nuisance column differ per dataset). defaultConfigFor reads
    // SCENARIO_DEFAULTS, which is total over every ScenarioId.
    cfg: cloneConfig(defaultConfigFor(scenarioId)),
    runCfg: {},
    runs: [],
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
      inventory: s.inventory,
      extractedClaims: s.extractedClaims,
      claimsConfirmed: s.claimsConfirmed,
      claimsSource: s.claimsSource,
      notebook: s.notebook,
      prose: s.prose,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    /* storage full or disabled; the app runs fine in-memory */
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
  // config/fields/claims without stale closures.
  const coreRef = useRef(core);
  coreRef.current = core;

  // Per-run stream timers, keyed by RunKey (dynamic, so it starts empty).
  const timers = useRef<Record<RunKey, ReturnType<typeof setInterval> | null>>({});
  // Per-run run token: a superseded run's async resolution is ignored.
  const tokens = useRef<Record<RunKey, number>>({});
  // The extraction stream has its own timer + token, same discipline.
  const extractionTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const extractionToken = useRef(0);
  // Monotonic counter for stable, collision-free ids on manual claim entry.
  const addSeq = useRef(0);
  const mounted = useRef(true);

  const clearTimer = useCallback((key: RunKey) => {
    const t = timers.current[key];
    if (t) {
      clearInterval(t);
      timers.current[key] = null;
    }
  }, []);

  const clearExtractionTimer = useCallback(() => {
    if (extractionTimer.current) {
      clearInterval(extractionTimer.current);
      extractionTimer.current = null;
    }
  }, []);

  // Streaming run of one (claim, check) run: reveal reasoning lines on a timer
  // while the compute POST resolves. `stream: false` drives a quiet, full-reveal
  // run. The config is the run's own effective config (runCfg[key], which is the
  // claim route's params already baked over the base by prepareRuns), so the
  // audit uses the exact params the claim on the card names.
  const runCheckInternal = useCallback(
    async (key: RunKey, opts: { stream: boolean }): Promise<void> => {
      const s = coreRef.current;
      const run = s.runs.find((r) => r.key === key);
      if (!run) return; // no such run; nothing to audit
      const checkId = run.checkId;
      const cfg = s.runCfg[key] ?? run.config;
      const fields = s.fields ?? [];
      const lines = reasoningLines(checkId, cfg);
      const stream = opts.stream && !prefersReducedMotion();
      const token = (tokens.current[key] ?? 0) + 1;
      tokens.current[key] = token;
      clearTimer(key);

      setCore((prev) => ({
        ...prev,
        running: withId(prev.running, key, true),
        reasoning: withId(prev.reasoning, key, lines),
        reveal: withId(prev.reveal, key, stream ? 0 : lines.length),
        results: withId(prev.results, key, null),
      }));

      if (stream && lines.length > 0) {
        let i = 0;
        timers.current[key] = setInterval(() => {
          i += 1;
          const next = Math.min(i, lines.length);
          setCore((prev) => ({ ...prev, reveal: withId(prev.reveal, key, next) }));
          if (i >= lines.length) clearTimer(key);
        }, STREAM_INTERVAL_MS);
      }

      try {
        const result = await postCheck({ scenarioId: s.scenarioId, checkId, config: cfg, fields });
        if (!mounted.current || token !== tokens.current[key]) return;
        clearTimer(key);
        setCore((prev) => ({
          ...prev,
          results: withId(prev.results, key, result),
          running: withId(prev.running, key, false),
          reveal: withId(prev.reveal, key, lines.length),
        }));
      } catch {
        if (!mounted.current || token !== tokens.current[key]) return;
        clearTimer(key);
        // Leave the result null (renders as "Not run") rather than a fake verdict.
        setCore((prev) => ({
          ...prev,
          running: withId(prev.running, key, false),
          reveal: withId(prev.reveal, key, lines.length),
        }));
      }
    },
    [clearTimer],
  );

  const runOne = useCallback((key: RunKey) => runCheckInternal(key, { stream: true }), [runCheckInternal]);

  // Run the workbench: one run per (confirmed, non-removed claim; valid route).
  // prepareRuns is the source of truth for which runs exist, and each run carries
  // its own baked config, so two claims on one check produce two runs with their
  // own params and neither is silently dropped (the F2 fix). The per-run maps are
  // rebuilt fresh for exactly this run set, so a run whose claim was removed leaves
  // no stale verdict behind (honesty rules 1, 13).
  const runAll = useCallback(() => {
    const s = coreRef.current;
    const runs = prepareRuns(s.cfg, s.extractedClaims);

    // Tear down every currently-tracked timer and invalidate every in-flight run,
    // including keys that no longer correspond to a run (a removed claim).
    for (const key of Object.keys(timers.current)) clearTimer(key);
    for (const key of Object.keys(tokens.current)) tokens.current[key] = (tokens.current[key] ?? 0) + 1;

    const runCfg: Record<RunKey, CheckConfigMap[CheckId]> = {};
    for (const r of runs) runCfg[r.key] = r.config;

    // Fresh per-run maps for exactly this run set. runCheckInternal fills them.
    const next: CoreState = {
      ...s,
      runs,
      runCfg,
      results: {},
      running: {},
      reasoning: {},
      reveal: {},
    };
    coreRef.current = next;
    setCore(next);
    persist(next);

    for (const r of runs) void runCheckInternal(r.key, { stream: true });
  }, [clearTimer, runCheckInternal]);

  // Quiet restore after a reload: repopulate a run's result and its (static)
  // reasoning without the running flash or the reveal animation.
  const restoreResult = useCallback(async (key: RunKey): Promise<void> => {
    const s = coreRef.current;
    const run = s.runs.find((r) => r.key === key);
    if (!run) return;
    const cfg = s.runCfg[key] ?? run.config;
    const lines = reasoningLines(run.checkId, cfg);
    const token = (tokens.current[key] ?? 0) + 1;
    tokens.current[key] = token;
    try {
      const result = await postCheck({ scenarioId: s.scenarioId, checkId: run.checkId, config: cfg, fields: s.fields ?? [] });
      if (!mounted.current || token !== tokens.current[key]) return;
      setCore((prev) => ({
        ...prev,
        results: withId(prev.results, key, result),
        reasoning: withId(prev.reasoning, key, lines),
        reveal: withId(prev.reveal, key, lines.length),
        running: withId(prev.running, key, false),
      }));
    } catch {
      /* leave not-run; the user can re-run from the workbench */
    }
  }, []);

  const loadScenario = useCallback(
    (id: ScenarioId) => {
      for (const key of Object.keys(timers.current)) {
        clearTimer(key);
        tokens.current[key] = (tokens.current[key] ?? 0) + 1;
      }
      clearExtractionTimer();
      extractionToken.current += 1;
      const next = freshCore(id);
      coreRef.current = next;
      setCore(next);
      persist(next);
    },
    [clearTimer, clearExtractionTimer],
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

  // ── Inspection + extraction (spec sections 3-6) ──────────────────────────
  const inspect = useCallback(async () => {
    const s = coreRef.current;
    if (s.inventory) return; // already inspected
    let inventory: DatasetInventory | null = null;
    try {
      inventory = await postInspect({ scenarioId: s.scenarioId });
    } catch {
      // Fall back to the scenario's built-in inventory so extraction can still
      // run offline. The app must always render.
      inventory = SCENARIOS[s.scenarioId].inventory ?? null;
    }
    if (!inventory) return;
    const next: CoreState = { ...coreRef.current, inventory };
    coreRef.current = next;
    setCore(next);
    persist(next);
  }, []);

  const extractClaims = useCallback(async () => {
    const s = coreRef.current;
    const inventory = s.inventory;
    if (!inventory) {
      // inspect() could not produce an inventory (no built-in to fall back on).
      // Leave the extracting state cleanly rather than stall on "Reading".
      setCore((prev) => ({ ...prev, extracting: false }));
      return;
    }
    const lines = engineExtractionLines(s.scenarioId);
    const stream = !prefersReducedMotion();
    const token = ++extractionToken.current;
    clearExtractionTimer();

    setCore((prev) => ({
      ...prev,
      extracting: true,
      extractionLines: lines,
      extractionReveal: stream ? 0 : lines.length,
      extractedClaims: null,
      claimsSource: null,
      claimsConfirmed: false,
      addClaimError: null,
    }));

    if (stream && lines.length > 0) {
      let i = 0;
      extractionTimer.current = setInterval(() => {
        i += 1;
        const next = Math.min(i, lines.length);
        setCore((prev) => ({ ...prev, extractionReveal: next }));
        if (i >= lines.length) clearExtractionTimer();
      }, STREAM_INTERVAL_MS);
    }

    try {
      const { claims, source, assessment } = await postClaims({
        scenarioId: s.scenarioId,
        inventory,
        fields: s.fields ?? [],
        notebook: s.notebook || undefined,
        prose: s.prose || undefined,
      });
      if (!mounted.current || token !== extractionToken.current) return;
      clearExtractionTimer();
      setCore((prev) => ({
        ...prev,
        extractedClaims: claims,
        claimsSource: source,
        extractionAssessment: assessment ?? null,
        extracting: false,
        extractionReveal: lines.length,
      }));
    } catch {
      if (!mounted.current || token !== extractionToken.current) return;
      clearExtractionTimer();
      // The POST itself failed (transport). Fall back to the same curated list
      // the route serves, so the review screen always has real content and the
      // two fallback paths never diverge. Mark it curated.
      const fallback = curatedClaimsFor(s.scenarioId, inventory);
      setCore((prev) => ({
        ...prev,
        extractedClaims: fallback,
        claimsSource: 'curated',
        extractionAssessment: null,
        extracting: false,
        extractionReveal: lines.length,
      }));
    }
  }, [clearExtractionTimer]);

  // Confirming fields no longer runs the checks (spec section 1): it kicks the
  // inspection, then the claim extraction. The workbench waits for confirmClaims.
  // The extracting flag is set synchronously here so a navigation to /claims
  // right after this call lands on the streaming console (spec section 6) instead
  // of flashing the cold "no claims yet" state during the inspect round-trip;
  // extractClaims takes over the stream once inspection resolves.
  const confirmFields = useCallback(async () => {
    const s = coreRef.current;
    const next: CoreState = {
      ...s,
      fieldsConfirmed: true,
      extracting: true,
      extractionLines: engineExtractionLines(s.scenarioId),
      extractionReveal: 0,
      extractedClaims: null,
      claimsSource: null,
      claimsConfirmed: false,
    };
    coreRef.current = next;
    setCore(next);
    persist(next);
    await inspect();
    await extractClaims();
  }, [inspect, extractClaims]);

  // ── Claim Review edits (spec section 6) ──────────────────────────────────
  const patchClaim = useCallback((id: string, fn: (c: ExtractedClaim) => ExtractedClaim) => {
    const s = coreRef.current;
    if (!s.extractedClaims) return;
    const extractedClaims = s.extractedClaims.map((c) => (c.id === id ? fn(c) : c));
    const next: CoreState = { ...s, extractedClaims };
    coreRef.current = next;
    setCore(next);
    persist(next);
  }, []);

  const setClaimStatus = useCallback(
    (id: string, status: ClaimStatus) => patchClaim(id, (c) => ({ ...c, status })),
    [patchClaim],
  );
  const setClaimText = useCallback(
    (id: string, text: string) => patchClaim(id, (c) => ({ ...c, text, status: 'edited' })),
    [patchClaim],
  );
  const setClaimRouting = useCallback(
    (id: string, checks: CheckRoute[]) => patchClaim(id, (c) => ({ ...c, checks, status: 'edited' })),
    [patchClaim],
  );

  // Manual claim entry (spec section 7). On a 503 the mapping failed; we surface
  // the error and add nothing rather than fabricate a routing.
  const addClaim = useCallback(async (text: string) => {
    const s = coreRef.current;
    const inventory = s.inventory;
    const trimmed = text.trim();
    if (trimmed === '') return;
    if (!inventory) {
      setCore((prev) => ({ ...prev, addClaimError: 'Inspect the dataset before adding a claim.' }));
      return;
    }
    setCore((prev) => ({ ...prev, addingClaim: true, addClaimError: null }));
    try {
      const mapped = await postMapClaim({
        scenarioId: s.scenarioId,
        inventory,
        fields: s.fields ?? [],
        text: trimmed,
      });
      if (!mounted.current) return;
      const id = `user-${Date.now()}-${addSeq.current++}`;
      const claim: ExtractedClaim = { ...mapped, id, source: 'user_added', status: 'user_added' };
      const cur = coreRef.current;
      const extractedClaims = [...(cur.extractedClaims ?? []), claim];
      const next: CoreState = { ...cur, extractedClaims, addingClaim: false, addClaimError: null };
      coreRef.current = next;
      setCore(next);
      persist(next);
    } catch {
      if (!mounted.current) return;
      setCore((prev) => ({
        ...prev,
        addingClaim: false,
        addClaimError:
          'Redline could not map that claim to a check right now, so nothing was added. Try again, or configure a Claude backend.',
      }));
    }
  }, []);

  const setNotebook = useCallback((text: string) => {
    const next: CoreState = { ...coreRef.current, notebook: text };
    coreRef.current = next;
    setCore(next);
    persist(next);
  }, []);
  const setProse = useCallback((text: string) => {
    const next: CoreState = { ...coreRef.current, prose: text };
    coreRef.current = next;
    setCore(next);
    persist(next);
  }, []);

  // Confirming the claim list is what runs the workbench (spec sections 1, 9).
  const confirmClaims = useCallback(async () => {
    const next: CoreState = { ...coreRef.current, claimsConfirmed: true };
    coreRef.current = next;
    setCore(next);
    persist(next);
    runAll();
  }, [runAll]);

  const setRunCfg = useCallback(
    (key: RunKey, patch: RunCfgPatch, opts?: { rerun?: boolean }): void => {
      const s = coreRef.current;
      const cur = s.runCfg[key];
      if (!cur) return; // no such run
      // Index through a string-keyed view so the union-of-configs patch merges
      // without the intersection-assignment error.
      const merged = { ...(cur as Record<string, unknown>), ...patch };
      const runCfg = { ...s.runCfg, [key]: merged } as Record<RunKey, CheckConfigMap[CheckId]>;
      const next: CoreState = { ...s, runCfg };
      coreRef.current = next;
      setCore(next);
      persist(next);
      // rerun === false is the live-scrub path: update the knob and re-render the
      // chart from it, but do not re-run the statistical test or stream.
      if (opts?.rerun === false) return;
      void runCheckInternal(key, { stream: true });
    },
    [runCheckInternal],
  );

  // Hydrate once from localStorage (never during render, which keeps SSR + first
  // client render identical, avoiding a hydration mismatch). The v3 key means a
  // stale v1/v2 payload is simply never read (ignored, not migrated), so a
  // returning user never skips the claim station and an old baked-per-check config
  // never mis-restores. The runs and their per-run configs are rebuilt here from
  // the persisted claims + base config via prepareRuns.
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

    // Validate the persisted claim/inventory shapes; drop them on a mismatch
    // rather than crash on a corrupt or older payload.
    const claimsParse = saved.extractedClaims ? ExtractedClaim.array().safeParse(saved.extractedClaims) : undefined;
    const extractedClaims = claimsParse?.success ? claimsParse.data : null;
    const invParse = saved.inventory ? DatasetInventory.safeParse(saved.inventory) : undefined;
    const inventory = invParse?.success ? invParse.data : null;
    const claimsConfirmed = Boolean(saved.claimsConfirmed) && extractedClaims != null;

    // The persisted cfg is the per-check knob base (the per-run scrubs live in the
    // non-persisted runCfg). prepareRuns re-bakes each claim's route params over
    // this base, so the rebuilt runs match what the last confirm produced.
    const restoredCfg = mergeConfig(defaultConfigFor(scenarioId), saved.cfg);
    const runs = claimsConfirmed ? prepareRuns(restoredCfg, extractedClaims) : [];
    const runCfg: Record<RunKey, CheckConfigMap[CheckId]> = {};
    for (const r of runs) runCfg[r.key] = r.config;

    const next: CoreState = {
      ...freshCore(scenarioId),
      fields: saved.fields ?? null,
      fieldsConfirmed: Boolean(saved.fieldsConfirmed),
      cfg: restoredCfg,
      inventory,
      extractedClaims,
      claimsSource: saved.claimsSource ?? null,
      claimsConfirmed,
      notebook: saved.notebook ?? '',
      prose: saved.prose ?? '',
      runs,
      runCfg,
    };
    coreRef.current = next;
    setCore(next);

    // Gate the result restore on claimsConfirmed (not fieldsConfirmed), and
    // restore each rebuilt run.
    if (next.claimsConfirmed) {
      for (const r of next.runs) void restoreResult(r.key);
    }
    // Intentionally run-once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      mounted.current = false;
      for (const t of Object.values(timers.current)) {
        if (t) clearInterval(t);
      }
      if (extractionTimer.current) clearInterval(extractionTimer.current);
    },
    [],
  );

  const scenario = SCENARIOS[core.scenarioId];
  const dataset = scenario.dataset;
  const legacyClaims = scenario.claims;

  // One finding per run that has produced a result, in run order. Each finding
  // carries the claim it audited, so the report can title two findings that share
  // a check apart ("Fragility: {claim}"). The verdict math (assembleReport) still
  // takes CheckResult[]; the per-finding claim is a UI concern the report surfaces.
  const { report, reportFindings } = useMemo<{ report: AuditReport; reportFindings: ReportFinding[] }>(() => {
    const findings: ReportFinding[] = [];
    for (const r of core.runs) {
      const result = core.results[r.key];
      if (result != null) findings.push({ key: r.key, checkId: r.checkId, claimText: r.claimText, result });
    }
    const done = findings.map((f) => f.result);
    let assembled: AuditReport;
    try {
      assembled = assembleReport(dataset, done);
    } catch {
      assembled = localReport(dataset, done);
    }
    return { report: assembled, reportFindings: findings };
  }, [core.runs, core.results, dataset]);

  // The claim a run audits, read straight off the run descriptor (never a separate
  // lookup), so the claim shown on a card and the claim whose params drove the
  // audit are the same descriptor and can never disagree (honesty rule 2).
  const claimForRun = (runKey: RunKey): string =>
    core.runs.find((r) => r.key === runKey)?.claimText ?? '';

  const value: SessionValue = {
    scenarioId: core.scenarioId,
    dataset,
    claims: legacyClaims,
    fields: core.fields,
    fieldsConfirmed: core.fieldsConfirmed,
    inventory: core.inventory,
    extractedClaims: core.extractedClaims,
    claimsSource: core.claimsSource,
    extractionAssessment: core.extractionAssessment,
    claimsConfirmed: core.claimsConfirmed,
    extracting: core.extracting,
    extractionLines: core.extractionLines,
    extractionReveal: core.extractionReveal,
    notebook: core.notebook,
    prose: core.prose,
    addingClaim: core.addingClaim,
    addClaimError: core.addClaimError,
    cfg: core.cfg,
    runCfg: core.runCfg,
    results: core.results,
    running: core.running,
    reasoning: core.reasoning,
    reveal: core.reveal,
    runs: core.runs,
    loadScenario,
    resolveFields,
    setRole,
    confirmFields,
    inspect,
    extractClaims,
    setClaimStatus,
    setClaimText,
    setClaimRouting,
    addClaim,
    setNotebook,
    setProse,
    confirmClaims,
    setRunCfg,
    runOne,
    runAll,
    claimForRun,
    report,
    reportFindings,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within <SessionProvider>');
  return value;
}
