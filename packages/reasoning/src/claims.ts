import { ClaimExtractionResponse, ClaimMappingResponse, enforceClaimHonesty } from '@redline/contracts';
import type { DatasetInventory, ExtractedClaim } from '@redline/contracts';
import { extractJson } from './reasoner.js';

/**
 * The claim-extraction and manual-mapping implementations, factored as pure
 * parse-and-enforce steps so the async Reasoner methods stay thin and the tests
 * can drive the honesty backstop without a network call.
 *
 * Each function recovers the JSON from a model reply (tolerating fences and stray
 * prose via the shared `extractJson`), validates it against the contract Zod
 * schema, and pipes the result through `enforceClaimHonesty`. The model does not
 * get the last word on honesty: `enforceClaimHonesty` drops a fabricated claim,
 * empties an out-of-scope claim's checks, prunes impossible routes, and demotes a
 * claim that cites an unknown gene, every time, the same way.
 */

/**
 * Parse a claim-extraction reply into the honesty-checked claim list. Pure: no
 * network, deterministic for a given (text, inventory). Zero claims in the reply
 * yields zero claims out; the backstop never pads the list.
 */
export function parseClaimsReply(
  text: string,
  inventory: DatasetInventory,
): ExtractedClaim[] {
  const { claims } = ClaimExtractionResponse.parse(extractJson(text));
  return enforceClaimHonesty(inventory, claims);
}

/**
 * Parse a manual-mapping reply into one honesty-checked claim. Throws when the
 * backstop rejects the mapped claim (it cited an obs column or uns key the data
 * does not contain); the caller turns that into a ReasonerUnavailable so the app
 * can fall back rather than audit a fabricated target.
 */
export function parseClaimReply(
  text: string,
  inventory: DatasetInventory,
): ExtractedClaim {
  const { claim } = ClaimMappingResponse.parse(extractJson(text));
  const [enforced] = enforceClaimHonesty(inventory, [claim]);
  if (!enforced) {
    throw new Error(
      'the mapped claim referenced data not present in the inventory and cannot be audited',
    );
  }
  return enforced;
}
