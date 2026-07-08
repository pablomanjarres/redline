/**
 * @redline/reasoning — the prose half of a Redline finding. Claude names the
 * failure mode, cites the fixing method, and rewrites the conclusion in
 * defensible language, over the first-party Claude API (the public path,
 * `ANTHROPIC_API_KEY`) or AWS Bedrock (the internal demo). When no backend is
 * configured or a call errors, `narrate` / `proposeFields` throw
 * `ReasonerUnavailable` so the caller can fall back to the curated narrative.
 */
export { createReasoner, ReasonerUnavailable } from './reasoner.js';
export type { Reasoner } from './reasoner.js';
export {
  SYSTEM_PROMPT,
  FIELD_SYSTEM_PROMPT,
  buildNarrativePrompt,
  buildFieldProposalPrompt,
} from './prompts.js';
export type { PromptPair } from './prompts.js';
