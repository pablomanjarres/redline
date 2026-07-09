import { FieldProposalResponse, Narrative } from '@redline/contracts';
import type {
  ClaimExtractionRequest,
  ClaimMappingRequest,
  ExtractedClaim,
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
  narrate(req: NarrativeRequest): Promise<Narrative>;
  proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]>;
  /** Extract the auditable claims from the inspected analysis (spec section 4). */
  extractClaims(req: ClaimExtractionRequest): Promise<ExtractedClaim[]>;
  /** Map one user-typed claim to its checks and params (spec section 7). */
  mapClaim(req: ClaimMappingRequest): Promise<ExtractedClaim>;
}

const NARRATE_MAX_TOKENS = 2048;
const FIELDS_MAX_TOKENS = 4096;
// Claim lists are longer than a single narrative, so they get more headroom.
const CLAIMS_MAX_TOKENS = 8192;

type Backend = 'anthropic' | 'bedrock';

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
): Promise<string> {
  if (backend === 'anthropic') {
    return anthropic.invokeMessages({ system, user, maxTokens });
  }
  const modelId = bedrock.getModelId();
  if (!modelId) {
    throw new ReasonerUnavailable('REDLINE_BEDROCK_MODEL_ID is not set');
  }
  return bedrock.invokeMessages({ modelId, system, user, maxTokens });
}

/**
 * Build a reasoner backed by Claude — the first-party Claude API or AWS Bedrock,
 * whichever the environment configures (see `selectBackend`). Construction is
 * free and never hits the network; `available` reflects the env at access time.
 * Both backends speak the same Anthropic Messages shape, so the prompts and the
 * JSON contract are identical across them.
 */
export function createReasoner(): Reasoner {
  return {
    get available(): boolean {
      return selectBackend() !== undefined;
    },

    async narrate(req: NarrativeRequest): Promise<Narrative> {
      const backend = selectBackend();
      if (!backend) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use the curated narrative',
        );
      }
      try {
        const { system, user } = buildNarrativePrompt(req);
        const text = await invoke(backend, system, user, NARRATE_MAX_TOKENS);
        const narrative = Narrative.parse(extractJson(text));
        return enforceHonesty(req, narrative);
      } catch (err) {
        throw asUnavailable('narrate', err);
      }
    },

    async proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]> {
      const backend = selectBackend();
      if (!backend) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use the fixture fields',
        );
      }
      try {
        const { system, user } = buildFieldProposalPrompt(req);
        const text = await invoke(backend, system, user, FIELDS_MAX_TOKENS);
        const { fields } = FieldProposalResponse.parse(extractJson(text));
        return fields;
      } catch (err) {
        throw asUnavailable('proposeFields', err);
      }
    },

    async extractClaims(req: ClaimExtractionRequest): Promise<ExtractedClaim[]> {
      const backend = selectBackend();
      if (!backend) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use the curated claims',
        );
      }
      try {
        const { system, user } = buildClaimExtractionPrompt(req);
        const text = await invoke(backend, system, user, CLAIMS_MAX_TOKENS);
        // The backstop runs immediately after Zod validation, inside parseClaimsReply.
        return parseClaimsReply(text, req.inventory);
      } catch (err) {
        throw asUnavailable('extractClaims', err);
      }
    },

    async mapClaim(req: ClaimMappingRequest): Promise<ExtractedClaim> {
      const backend = selectBackend();
      if (!backend) {
        throw new ReasonerUnavailable(
          'No reasoning backend configured; use manual claim entry',
        );
      }
      try {
        const { system, user } = buildClaimMappingPrompt(req);
        const text = await invoke(backend, system, user, CLAIMS_MAX_TOKENS);
        return parseClaimReply(text, req.inventory);
      } catch (err) {
        throw asUnavailable('mapClaim', err);
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
