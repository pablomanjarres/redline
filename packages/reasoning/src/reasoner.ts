import { FieldProposalResponse, Narrative } from '@redline/contracts';
import type {
  FieldProposalRequest,
  FieldSpec,
  NarrativeRequest,
} from '@redline/contracts';
import { getModelId, invokeMessages } from './bedrock.js';
import { buildFieldProposalPrompt, buildNarrativePrompt } from './prompts.js';

/**
 * Thrown whenever the Bedrock reasoner cannot produce a validated result: no
 * model id, no AWS credentials, a network failure, or an unparseable reply. The
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
  /** True when a Bedrock model id is configured. Read lazily; no network. */
  readonly available: boolean;
  narrate(req: NarrativeRequest): Promise<Narrative>;
  proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]>;
}

const NARRATE_MAX_TOKENS = 2048;
const FIELDS_MAX_TOKENS = 4096;

/**
 * Build a reasoner backed by Claude on AWS Bedrock. Construction is free and
 * never hits the network; `available` reflects the env at access time. Bedrock
 * is used through `@aws-sdk/client-bedrock-runtime` with an Anthropic Messages
 * body, never the direct Anthropic API.
 */
export function createReasoner(): Reasoner {
  return {
    get available(): boolean {
      return getModelId() !== undefined;
    },

    async narrate(req: NarrativeRequest): Promise<Narrative> {
      const modelId = getModelId();
      if (!modelId) {
        throw new ReasonerUnavailable(
          'REDLINE_BEDROCK_MODEL_ID is not set; use the curated narrative',
        );
      }
      try {
        const { system, user } = buildNarrativePrompt(req);
        const text = await invokeMessages({
          modelId,
          system,
          user,
          maxTokens: NARRATE_MAX_TOKENS,
        });
        const narrative = Narrative.parse(extractJson(text));
        return enforceHonesty(req, narrative);
      } catch (err) {
        throw asUnavailable('narrate', err);
      }
    },

    async proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]> {
      const modelId = getModelId();
      if (!modelId) {
        throw new ReasonerUnavailable(
          'REDLINE_BEDROCK_MODEL_ID is not set; use the fixture fields',
        );
      }
      try {
        const { system, user } = buildFieldProposalPrompt(req);
        const text = await invokeMessages({
          modelId,
          system,
          user,
          maxTokens: FIELDS_MAX_TOKENS,
        });
        const { fields } = FieldProposalResponse.parse(extractJson(text));
        return fields;
      } catch (err) {
        throw asUnavailable('proposeFields', err);
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
function extractJson(text: string): unknown {
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
