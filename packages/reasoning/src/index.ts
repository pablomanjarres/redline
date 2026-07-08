/**
 * @redline/reasoning — the prose half of a Redline finding. Claude via AWS
 * Bedrock names the failure mode, cites the fixing method, and rewrites the
 * conclusion in defensible language. When Bedrock is unconfigured or errors,
 * `narrate` / `proposeFields` throw `ReasonerUnavailable` so the caller can fall
 * back to the engine's curated narrative.
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
