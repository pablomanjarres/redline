import { FieldProposalResponse, Narrative, RecommendationResponse } from '@redline/contracts';
import type {
  FieldProposalRequest,
  FieldSpec,
  NarrativeRequest,
  Recommendation,
  RecommendationRequest,
} from '@redline/contracts';
import * as anthropic from './anthropic.js';
import * as bedrock from './bedrock.js';
import {
  buildFieldProposalPrompt,
  buildNarrativePrompt,
  buildRecommendationPrompt,
} from './prompts.js';

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
  recommend(req: RecommendationRequest): Promise<Recommendation[]>;
  proposeFields(req: FieldProposalRequest): Promise<FieldSpec[]>;
}

const NARRATE_MAX_TOKENS = 2048;
const RECOMMEND_MAX_TOKENS = 2048;
const FIELDS_MAX_TOKENS = 4096;

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
 * Build a reasoner backed by Claude, the first-party Claude API or AWS Bedrock,
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
