import { CriticJudgment, FieldProposalResponse, Narrative } from '@redline/contracts';
import type {
  ClaimExtractionRequest,
  ClaimMappingRequest,
  ExtractedClaim,
  CriticRequest,
  FieldProposalRequest,
  FieldSpec,
  NarrativeRequest,
} from '@redline/contracts';
import * as anthropic from './anthropic.js';
import * as bedrock from './bedrock.js';
import {
  buildClaimExtractionPrompt,
  buildClaimMappingPrompt,
  buildFieldProposalPrompt,
  buildNarrativePrompt,
} from './prompts.js';
import { parseClaimReply, parseClaimsReply } from './claims.js';
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
const FIELDS_MAX_TOKENS = 4096;
// Claim lists are longer than a single narrative, so they get more headroom.
const CLAIMS_MAX_TOKENS = 8192;
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
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < REASON_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < REASON_RETRIES - 1) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Build a reasoner backed by Claude — the first-party Claude API or AWS Bedrock,
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
          const text = await withTimeout(send(system, user, CLAIMS_MAX_TOKENS), REASON_TIMEOUT_MS, 'extractClaims');
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
          const text = await withTimeout(send(system, user, CLAIMS_MAX_TOKENS), REASON_TIMEOUT_MS, 'mapClaim');
          return parseClaimReply(text, req.inventory);
        });
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
 * seam even if a model slips.
 */
function enforceHonesty(req: NarrativeRequest, narrative: Narrative): Narrative {
  if (req.state === 'clean') {
    return { ...narrative, error: null, original: null };
  }
  return narrative;
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
