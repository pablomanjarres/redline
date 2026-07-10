import { CriticJudgment, FieldProposalResponse, Narrative, RecommendationResponse } from '@redline/contracts';
import type {
  ClaimExtractionRequest,
  ClaimMappingRequest,
  ExtractedClaim,
  CriticRequest,
  FieldProposalRequest,
  FieldSpec,
  NarrativeRequest,
  Recommendation,
  RecommendationRequest,
} from '@redline/contracts';
import * as anthropic from './anthropic.js';
import * as bedrock from './bedrock.js';
import {
  buildClaimExtractionPrompt,
  buildClaimMappingPrompt,
  buildFieldProposalPrompt,
  buildNarrativePrompt,
  buildRecommendationPrompt,
} from './prompts.js';
import { ClaimRejected, parseClaimReply, parseClaimsReply } from './claims.js';
import { buildCriticPrompt } from './critic-prompts.js';

/**
 * Thrown whenever the reasoner cannot produce a validated result: no backend
 * configured, no credentials, a network failure, or an unparseable reply. The
 * API route catches this and falls back to the engine's curated narrative, so
 * the app always renders.
 */
export class ReasonerUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReasonerUnavailable';
  }
}

export interface Reasoner {
  /** True when a reasoning backend is configured. Read lazily; no network. */
  readonly available: boolean;
  /** The active backend, or undefined when none is wired. Lets a caller stamp the
   *  source of a produced narrative, field proposal, or critic ruling. An injected
   *  Messages seam presents as `bedrock`. */
  readonly backend: 'anthropic' | 'bedrock' | undefined;
  narrate(req: NarrativeRequest): Promise<Narrative>;
  recommend(req: RecommendationRequest): Promise<Recommendation[]>;
  proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]>;
  /** Extract the auditable claims from the inspected analysis (spec section 4). */
  extractClaims(req: ClaimExtractionRequest): Promise<ExtractedClaim[]>;
  /** Map one user-typed claim to its checks and params (spec section 7). */
  mapClaim(req: ClaimMappingRequest): Promise<ExtractedClaim>;
  /**
   * The critic: an independent, adversarial second pass over one candidate
   * finding. Returns the validated ruling, or throws `ReasonerUnavailable` when
   * no backend is wired or the reply does not parse, so the caller can fail safe
   * toward showing the finding (marked critic-unverified) rather than hiding it.
   */
  critique(req: CriticRequest): Promise<CriticJudgment>;
}

const NARRATE_MAX_TOKENS = 2048;
const RECOMMEND_MAX_TOKENS = 2048;
const FIELDS_MAX_TOKENS = 4096;
// Claim lists are longer than a single narrative, so they get more headroom.
const CLAIMS_MAX_TOKENS = 8192;
/** Routing a claim to a check is a decision, not prose. Same run, same routing. */
const CLAIMS_TEMPERATURE = 0;
const CRITIQUE_MAX_TOKENS = 1024;
/** The critic decides whether a flag reaches the scientist. Sampled at the model
 *  default it is a coin flip on the borderline cases, so the same real catch can
 *  be vetoed on one run and confirmed on the next. A gate has to be reproducible. */
const CRITIQUE_TEMPERATURE = 0;

type Backend = 'anthropic' | 'bedrock';

/**
 * A raw Messages seam: system + user in, model text out. Injecting one bypasses
 * the env-selected backend, so tests and the critic self-honesty harness can
 * drive the parse and gate logic (including a forced rubber-stamp reply) without
 * the network. The same code path hits real Bedrock in production.
 */
export type InvokeFn = (args: {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}) => Promise<string>;

/**
 * Pick the reasoning backend from the environment. The **public path** is the
 * first-party Claude API (`ANTHROPIC_API_KEY`) so anyone can run Redline against
 * their own Claude key. The **internal demo** on Vercel pins **Bedrock** (Pablo's
 * AWS creds). `REDLINE_REASONING_BACKEND` forces one explicitly; otherwise the
 * Claude API wins when its key is present, else Bedrock, else nothing (curated).
 */
function selectBackend(): Backend | undefined {
  const forced = process.env.REDLINE_REASONING_BACKEND?.trim().toLowerCase();
  if (forced === 'anthropic') return anthropic.isConfigured() ? 'anthropic' : undefined;
  if (forced === 'bedrock') return bedrock.isConfigured() ? 'bedrock' : undefined;
  if (anthropic.isConfigured()) return 'anthropic';
  if (bedrock.isConfigured()) return 'bedrock';
  return undefined;
}

/** Route one Messages request to the selected backend. */
async function invoke(
  backend: Backend,
  system: string,
  user: string,
  maxTokens: number,
  temperature?: number,
): Promise<string> {
  if (backend === 'anthropic') {
    return anthropic.invokeMessages({ system, user, maxTokens, temperature });
  }
  const modelId = bedrock.getModelId();
  if (!modelId) {
    throw new ReasonerUnavailable('REDLINE_BEDROCK_MODEL_ID is not set');
  }
  return bedrock.invokeMessages({ modelId, system, user, maxTokens, temperature });
}

const REASON_RETRIES = 3;
/** A model call that hangs must not block the request forever. The SDKs do not
 *  bound this themselves, and a hung Bedrock invoke stalled a whole audit. */
const REASON_TIMEOUT_MS = Number(process.env.REDLINE_REASONING_TIMEOUT_MS ?? 25000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Retry a reasoning call with a short exponential backoff. The verification
 * harness fires many model calls in quick succession, and Bedrock throttles
 * transiently (a 429 or a one-off unparseable reply). Retrying keeps the real
 * model on the primary path instead of silently dropping to the curated
 * fallback, which matters because the fallback is a different, static source.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (err: unknown) => boolean = () => true,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < REASON_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // A deterministic verdict about the reply (the honesty backstop rejected it)
      // must not be retried. Re-rolling until the check passes is sampling until
      // the honesty check is satisfied, which defeats the check.
      if (!shouldRetry(err)) break;
      if (attempt < REASON_RETRIES - 1) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Transport and malformed replies are transient. A rejected claim is not. */
const retryUnlessRejected = (err: unknown): boolean => !(err instanceof ClaimRejected);

/**
 * Build a reasoner backed by Claude, the first-party Claude API or AWS Bedrock,
 * whichever the environment configures (see `selectBackend`). Construction is
 * free and never hits the network; `available` reflects the env at access time.
 * Both backends speak the same Anthropic Messages shape, so the prompts and the
 * JSON contract are identical across them.
 *
 * Pass `{ invoke }` to inject a Messages seam that replaces the env-selected
 * backend. This is how the deterministic tests and the critic self-honesty
 * harness exercise the parse and gate logic without the network. When injected,
 * the reasoner reports `available` and a `bedrock` source, and every call routes
 * through the injected function.
 */
export function createReasoner(opts?: { invoke?: InvokeFn }): Reasoner {
  const injected = opts?.invoke;

  // The active backend: the injected seam presents as bedrock (a real Messages
  // shape); otherwise the env selection decides.
  const activeBackend = (): Backend | undefined =>
    injected ? 'bedrock' : selectBackend();

  // Route one Messages request through the injected seam or the real backend.
  const send = async (
    system: string,
    user: string,
    maxTokens: number,
    temperature?: number,
  ): Promise<string> => {
    if (injected) return injected({ system, user, maxTokens, temperature });
    const backend = selectBackend();
    if (!backend) throw new ReasonerUnavailable('No reasoning backend configured');
    return invoke(backend, system, user, maxTokens, temperature);
  };

  return {
    get available(): boolean {
      return activeBackend() !== undefined;
    },

    // The injected seam presents as bedrock; otherwise the env selection decides.
    get backend(): Backend | undefined {
      return activeBackend();
    },

    async narrate(req: NarrativeRequest): Promise<Narrative> {
      if (activeBackend() === undefined) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use the curated narrative',
        );
      }
      try {
        // The injected Messages seam still gets the retry and the deadline: a
        // hung call must not stall an audit, whichever backend answers it.
        return await withRetry(async () => {
          const { system, user } = buildNarrativePrompt(req);
          const text = await withTimeout(send(system, user, NARRATE_MAX_TOKENS), REASON_TIMEOUT_MS, 'narrate');
          return enforceHonesty(req, Narrative.parse(extractJson(text)));
        });
      } catch (err) {
        throw asUnavailable('narrate', err);
      }
    },

    async recommend(req: RecommendationRequest): Promise<Recommendation[]> {
      const backend = selectBackend();
      if (!backend) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use the curated recommendations',
        );
      }
      try {
        const { system, user } = buildRecommendationPrompt(req);
        const text = await invoke(backend, system, user, RECOMMEND_MAX_TOKENS);
        const { recommendations } = RecommendationResponse.parse(extractJson(text));
        return enforceRecommendationHonesty(req, recommendations);
      } catch (err) {
        throw asUnavailable('recommend', err);
      }
    },

    async proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]> {
      if (activeBackend() === undefined) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use the fixture fields',
        );
      }
      try {
        return await withRetry(async () => {
          const { system, user } = buildFieldProposalPrompt(req);
          const text = await withTimeout(send(system, user, FIELDS_MAX_TOKENS), REASON_TIMEOUT_MS, 'proposeFields');
          return FieldProposalResponse.parse(extractJson(text)).fields;
        });
      } catch (err) {
        throw asUnavailable('proposeFields', err);
      }
    },

    async extractClaims(req: ClaimExtractionRequest): Promise<ExtractedClaim[]> {
      if (activeBackend() === undefined) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use the curated claims',
        );
      }
      try {
        // Through `send`, not `invoke`: the injected Messages seam, the retry, and
        // the deadline apply here too. A hung extraction stalls the whole intake.
        return await withRetry(async () => {
          const { system, user } = buildClaimExtractionPrompt(req);
          const text = await withTimeout(send(system, user, CLAIMS_MAX_TOKENS, CLAIMS_TEMPERATURE), REASON_TIMEOUT_MS, 'extractClaims');
          // The backstop runs immediately after Zod validation, inside parseClaimsReply.
          return parseClaimsReply(text, req.inventory);
        });
      } catch (err) {
        throw asUnavailable('extractClaims', err);
      }
    },

    async mapClaim(req: ClaimMappingRequest): Promise<ExtractedClaim> {
      if (activeBackend() === undefined) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use manual claim entry',
        );
      }
      try {
        return await withRetry(async () => {
          const { system, user } = buildClaimMappingPrompt(req);
          const text = await withTimeout(send(system, user, CLAIMS_MAX_TOKENS, CLAIMS_TEMPERATURE), REASON_TIMEOUT_MS, 'mapClaim');
          return parseClaimReply(text, req.inventory);
        }, retryUnlessRejected);
      } catch (err) {
        throw asUnavailable('mapClaim', err);
      }
    },

    async critique(req: CriticRequest): Promise<CriticJudgment> {
      if (activeBackend() === undefined) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; skip the critic',
        );
      }
      try {
        // The critic gates the finding path, so a hung call would stall the
        // whole audit. On exhaustion this throws and the gate fails safe toward
        // showing the finding, marked critic-unverified.
        return await withRetry(async () => {
          const { system, user } = buildCriticPrompt(req);
          const text = await withTimeout(send(system, user, CRITIQUE_MAX_TOKENS, CRITIQUE_TEMPERATURE), REASON_TIMEOUT_MS, 'critique');
          return CriticJudgment.parse(extractJson(text));
        });
      } catch (err) {
        throw asUnavailable('critique', err);
      }
    },
  };
}

function asUnavailable(op: string, err: unknown): ReasonerUnavailable {
  if (err instanceof ReasonerUnavailable) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ReasonerUnavailable(`${op} failed: ${message}`, { cause: err });
}

/**
 * Honesty backstop. A clean verdict must name no error and strike nothing
 * through, whatever the model returned. This guarantees never-cry-wolf at the
 * seam even if a model slips. On a clean state we also drop any `missing`: a
 * check that passed is not missing anything.
 */
function enforceHonesty(req: NarrativeRequest, narrative: Narrative): Narrative {
  if (req.state === 'clean') {
    const { missing: _missing, ...rest } = narrative;
    return { ...rest, error: null, original: null };
  }
  return narrative;
}

/**
 * Soft openers a model hides an imperative behind, so the deny-list below still
 * sees the real verb underneath: "You could aggregate...", "Consider adding...",
 * "We recommend refitting...", "To fix this, add...". Stripped before the leading
 * verb is tested.
 */
const SOFT_OPENER =
  /^(?:you\s+(?:could|can|might|may|should|would|'?d)|consider|i\s?(?:'d|\s+would)?\s+(?:suggest|recommend)|we\s+(?:could|can|should|suggest|recommend)|try(?:\s+to)?|simply|just|please|to\s+fix\s+(?:this|it),?|the\s+fix\s+is\s+to|one\s+option\s+is\s+to)\s+/i;

/**
 * The imperative verbs a within-data statistical fix opens with, with the
 * inflections a model actually emits ("adding", "aggregating", "refitting").
 * Tested only against an `action`, and only after any soft opener is stripped,
 * so it stays high-precision: an honest unsalvageable action opens with
 * "collect", "state", "do not report", or "redesign", none of which are here.
 */
const FIX_VERB =
  /^(?:add(?:s|ed|ing)?|includ(?:e|es|ed|ing)|aggregat(?:e|es|ed|ing)|adjust(?:s|ed|ing)?|re-?run(?:s|ning)?|refit(?:s|ted|ting)?|regress(?:es|ed|ing)?|pool(?:s|ed|ing)?|collaps(?:e|es|ed|ing)|model(?:s|ed|ing|led|ling)?|fit(?:s|ted|ting)?|control\s+for|correct\s+for|condition(?:s|ed|ing)?\s+on)\b/i;

/**
 * The method a fix names. In an unsalvageable slot every one of these is a
 * fabricated fix, wherever in the sentence it sits, so it is scanned across the
 * action and the `changes` field (the "what it would change" a scientist reads
 * as authoritative). Kept off the `rationale`, which honestly explains WHY no
 * fix works and may name the very method it is ruling out.
 */
const FIX_METHOD =
  /\bas\s+a\s+(?:random\s+|fixed\s+)?(?:covariate|effect)\b|\bmixed[-\s](?:effects?\s+)?model\b|\brandom\s+effects?\b|\bregress(?:ing|es|ed)?\s+out\b|\bbatch[-\s]correct|\bpseudobulk/i;

/**
 * A claimed corrected OUTCOME: a rescued p/q value, or a "becomes significant /
 * valid" verdict. In an unsalvageable slot this is the fabrication that matters
 * most, so it is scanned across all three prose fields (action, changes,
 * rationale). An honest refusal never asserts a corrected number.
 */
const FIX_OUTCOME =
  /\bbecomes?\s+(?:significant|valid|non-?significant|insignificant)\b|\b(?:recovers?|restores?)\s+significance\b|\bp[-\s]?values?\s+(?:rises?|falls?|drops?|becomes?|is\s+now|of\s+0?\.\d)|\b[pq]\s*[=<>]\s*0?\.\d/i;

/**
 * Does one recommendation read like a proposed statistical fix that would be
 * dishonest in an unsalvageable slot? The `action` is imperative, so it is held
 * to the leading-verb rule (after a soft opener is stripped) plus the method and
 * outcome markers. `changes` carries method + outcome markers; `rationale`
 * carries only the outcome marker, so it can still explain why the design is a
 * dead end without being flagged.
 */
function looksLikeProposedFix(r: Recommendation): boolean {
  const action = r.action.trim().replace(SOFT_OPENER, '');
  if (FIX_VERB.test(action) || FIX_METHOD.test(action) || FIX_OUTCOME.test(action)) {
    return true;
  }
  if (FIX_METHOD.test(r.changes) || FIX_OUTCOME.test(r.changes)) return true;
  return FIX_OUTCOME.test(r.rationale);
}

/**
 * Honesty backstop for recommendations. The engine, never the model, owns the
 * feasibility of each slot, so this forces the returned list back onto the
 * deterministic truth:
 *
 * - the number of recommendations is forced to the number of feasibility slots
 *   (a model that returns too many is truncated; too few, including zero, is
 *   treated as a failure so the curated fallback wins over a short list);
 * - each recommendation's feasibility is overwritten with the engine's verdict,
 *   so a model that talks an unsalvageable finding up to fixable_now cannot;
 * - if any unsalvageable slot reads like a proposed fix, in its action, its
 *   changes, or its rationale, the whole call is treated as unavailable so the
 *   curated fallback renders rather than a fabricated fix reaching a scientist.
 *   The check scans every prose field because a fabricated "the p-value rises to
 *   0.21" reads just as authoritatively in `changes` as in `action`.
 */
function enforceRecommendationHonesty(
  req: RecommendationRequest,
  recs: Recommendation[],
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const [i, feasibility] of req.feasibilities.entries()) {
    const base = recs[i];
    if (!base) {
      throw new ReasonerUnavailable(
        'recommend returned fewer recommendations than feasibility slots',
      );
    }
    if (feasibility === 'unsalvageable' && looksLikeProposedFix(base)) {
      throw new ReasonerUnavailable(
        'recommend proposed a statistical fix in an unsalvageable slot',
      );
    }
    out.push({ ...base, feasibility });
  }
  return out;
}

/** Recover a JSON object from a model reply, tolerating fences and stray prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && typeof fenced[1] === 'string') {
    candidates.push(fenced[1].trim());
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error('model response did not contain parseable JSON');
}
