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
 * Persistence: a PersistShape (scenario, fields, claims, config, and the intake
 * text) is mirrored to localStorage['redline_state_v2'] and rehydrated on mount
 * (SSR-guarded). A stale v1 payload lives under a different key and is ignored,
 * never migrated, so a returning user never skips the claim station.
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
} from '@redline/contracts';
import {
  SCENARIOS,
  assembleReport,
  claimTextForCheck,
  curatedClaimsFor,
  defaultConfigFor,
  extractionLines as engineExtractionLines,
  mergeRoutedConfig,
  reasoningLines,
  routedChecksFrom,
} from '@redline/engine';
import { postCheck, postClaims, postFields, postInspect, postMapClaim } from '@/lib/api';

const IDS: CheckId[] = [1, 2, 3, 4];
const DEFAULT_SCENARIO: ScenarioId = 'marson';
const STORAGE_KEY = 'redline_state_v2';
const STREAM_INTERVAL_MS = 165;

type ClaimsSource = 'model' | 'curated';

// ── Public shape (consumed by every app surface) ─────────────────────────────
export interface SessionValue {
  scenarioId: ScenarioId;
  dataset: DatasetMeta;
  /** The legacy per-check scenario claims (CheckTile / CheckStage read these). */
  claims: Claim[];
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  // Claim slice (spec sections 4-7).
  inventory: DatasetInventory | null;
  /** The claims the extraction agent proposed, as ratified on Claim Review. */
  extractedClaims: ExtractedClaim[] | null;
  /** Whether the claim list is a live model reading or the curated built-in list. */
  claimsSource: ClaimsSource | null;
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
  cfg: CheckConfigMap;
  results: Record<CheckId, CheckResult | null>;
  running: Record<CheckId, boolean>;
  reasoning: Record<CheckId, string[]>;
  reveal: Record<CheckId, number>;
  /** The checks a confirmed, non-removed claim routes to. A check not in this
   * list must render an honest "no claim routes to this check" state, never a
   * verdict. */
  routedChecks: CheckId[];
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
  /** Confirm the claim list and run the routed checks in the workbench. */
  confirmClaims(): Promise<void>;
  setCfg<Id extends CheckId>(id: Id, patch: Partial<CheckConfigMap[Id]>, opts?: { rerun?: boolean }): void;
  runCheck(id: CheckId): Promise<void>;
  runAll(): void;
  /** The confirmed extracted claim routed to a check, else the legacy scenario
   * claim, else null. CheckTile / CheckStage prefer this over `claims`. */
  claimForCheck(id: CheckId): string | null;
  report: AuditReport;
}

// ── Internal state ───────────────────────────────────────────────────────────
interface CoreState {
  scenarioId: ScenarioId;
  fields: FieldSpec[] | null;
  fieldsConfirmed: boolean;
  inventory: DatasetInventory | null;
  extractedClaims: ExtractedClaim[] | null;
  claimsSource: ClaimsSource | null;
  claimsConfirmed: boolean;
  extracting: boolean;
  extractionLines: string[];
  extractionReveal: number;
  notebook: string;
  prose: string;
  addingClaim: boolean;
  addClaimError: string | null;
  cfg: CheckConfigMap;
  routedChecks: CheckId[];
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
  inventory: DatasetInventory | null;
  extractedClaims: ExtractedClaim[] | null;
  claimsConfirmed: boolean;
  claimsSource: ClaimsSource | null;
  notebook: string;
  prose: string;
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

// Claim -> check routing (routedChecksFrom, ownerClaimByCheck, mergeRoutedConfig,
// claimTextForCheck, and their helpers) now lives in @redline/engine's routing
// module: pure, React-free engine logic the acceptance harness can import and
// cover directly. This store imports it above rather than keeping a private copy.

function freshCore(scenarioId: ScenarioId): CoreState {
  return {
    scenarioId,
    fields: null,
    fieldsConfirmed: false,
    inventory: null,
    extractedClaims: null,
    claimsSource: null,
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
    routedChecks: [],
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

  const timers = useRef<Record<CheckId, ReturnType<typeof setInterval> | null>>({
    1: null,
    2: null,
    3: null,
    4: null,
  });
  // Per-check run token: a superseded run's async resolution is ignored.
  const tokens = useRef<Record<CheckId, number>>({ 1: 0, 2: 0, 3: 0, 4: 0 });
  // The extraction stream has its own timer + token, same discipline.
  const extractionTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const extractionToken = useRef(0);
  // Monotonic counter for stable, collision-free ids on manual claim entry.
  const addSeq = useRef(0);
  const mounted = useRef(true);

  const clearTimer = useCallback((id: CheckId) => {
    const t = timers.current[id];
    if (t) {
      clearInterval(t);
      timers.current[id] = null;
    }
  }, []);

  const clearExtractionTimer = useCallback(() => {
    if (extractionTimer.current) {
      clearInterval(extractionTimer.current);
      extractionTimer.current = null;
    }
  }, []);

  // Streaming run of one check: reveal reasoning lines on a timer while the
  // compute POST resolves. `stream: false` drives a quiet, full-reveal run. The
  // check config is read straight from state; the routed claim's params were
  // already baked into it by runAll (mergeRoutedConfig).
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

  // Run the workbench: only the checks a confirmed, non-removed claim routes to.
  // Each routed check's config is the claim route's params baked over the knobs;
  // a check no claim routes to is cleared to null so it renders "no claim routes
  // to this check", never a stale or fabricated verdict (spec sections 8, 9).
  const runAll = useCallback(() => {
    const s = coreRef.current;
    const routed = routedChecksFrom(s.extractedClaims);
    const routedSet = new Set(routed);
    const cfg = mergeRoutedConfig(s.cfg, s.extractedClaims);

    const results = { ...s.results };
    const running = { ...s.running };
    const reasoning = { ...s.reasoning };
    const reveal = { ...s.reveal };
    for (const id of IDS) {
      clearTimer(id);
      tokens.current[id] += 1; // invalidate any in-flight run for every check
      if (!routedSet.has(id)) {
        results[id] = null;
        running[id] = false;
        reasoning[id] = [];
        reveal[id] = 0;
      }
    }

    const next: CoreState = { ...s, cfg, routedChecks: routed, results, running, reasoning, reveal };
    coreRef.current = next;
    setCore(next);
    persist(next);

    for (const id of routed) void runCheckInternal(id, { stream: true });
  }, [clearTimer, runCheckInternal]);

  // Quiet restore after a reload: repopulate a routed check's result and its
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
      const { claims, source } = await postClaims({
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

  // Hydrate once from localStorage (never during render, which keeps SSR + first
  // client render identical, avoiding a hydration mismatch). The v2 key means a
  // stale v1 payload is simply never read (ignored, not migrated), so a returning
  // user never skips the claim station.
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

    const next: CoreState = {
      ...freshCore(scenarioId),
      fields: saved.fields ?? null,
      fieldsConfirmed: Boolean(saved.fieldsConfirmed),
      // The persisted cfg already carries the baked route params from the last
      // confirm plus any later scrubs, so restore trusts it and does NOT re-merge
      // route params (that would clobber a user's post-confirm knob scrub).
      cfg: mergeConfig(defaultConfigFor(scenarioId), saved.cfg),
      inventory,
      extractedClaims,
      claimsSource: saved.claimsSource ?? null,
      claimsConfirmed,
      notebook: saved.notebook ?? '',
      prose: saved.prose ?? '',
      routedChecks: claimsConfirmed ? routedChecksFrom(extractedClaims) : [],
    };
    coreRef.current = next;
    setCore(next);

    // Gate the result restore on claimsConfirmed (not fieldsConfirmed), and
    // restore only the routed checks.
    if (next.claimsConfirmed) {
      for (const id of next.routedChecks) void restoreResult(id);
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
      if (extractionTimer.current) clearInterval(extractionTimer.current);
    },
    [],
  );

  const scenario = SCENARIOS[core.scenarioId];
  const dataset = scenario.dataset;
  const legacyClaims = scenario.claims;

  const report = useMemo<AuditReport>(() => {
    const done = IDS.map((id) => core.results[id]).filter((r): r is CheckResult => r != null);
    try {
      return assembleReport(dataset, done);
    } catch {
      return localReport(dataset, done);
    }
  }, [core.results, dataset]);

  // Show the claim that owns the check's single run (the same one whose params
  // mergeRoutedConfig bakes into the config), so the named target and the audited
  // target are always the same claim. Fall back to the legacy scenario claim when
  // no confirmed claim routes to the check. Reads render-time state, so it stays
  // reactive. A thin wrapper over the engine's claimTextForCheck.
  const claimForCheck = (id: CheckId): string | null =>
    claimTextForCheck(
      core.extractedClaims,
      id,
      legacyClaims.find((c) => c.check === id)?.text ?? null,
    );

  const value: SessionValue = {
    scenarioId: core.scenarioId,
    dataset,
    claims: legacyClaims,
    fields: core.fields,
    fieldsConfirmed: core.fieldsConfirmed,
    inventory: core.inventory,
    extractedClaims: core.extractedClaims,
    claimsSource: core.claimsSource,
    claimsConfirmed: core.claimsConfirmed,
    extracting: core.extracting,
    extractionLines: core.extractionLines,
    extractionReveal: core.extractionReveal,
    notebook: core.notebook,
    prose: core.prose,
    addingClaim: core.addingClaim,
    addClaimError: core.addClaimError,
    cfg: core.cfg,
    results: core.results,
    running: core.running,
    reasoning: core.reasoning,
    reveal: core.reveal,
    routedChecks: core.routedChecks,
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
    setCfg,
    runCheck,
    runAll,
    claimForCheck,
    report,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within <SessionProvider>');
  return value;
}
