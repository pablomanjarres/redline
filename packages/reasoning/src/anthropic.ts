import Anthropic from '@anthropic-ai/sdk';

/**
 * The first-party Claude API backend — the public path anyone can run with an
 * `ANTHROPIC_API_KEY`. Mirrors `bedrock.ts`'s shape (isConfigured / invokeMessages)
 * so `reasoner.ts` can pick either backend behind one interface.
 */

/** Default model. Opus 4.8 unless overridden with REDLINE_ANTHROPIC_MODEL. */
const DEFAULT_MODEL = 'claude-opus-4-8';

/** The configured Claude model id, defaulting to Opus 4.8. */
export function getModelId(): string {
  const raw = process.env.REDLINE_ANTHROPIC_MODEL;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_MODEL;
}

/** True when an ANTHROPIC_API_KEY is present. Reads env only; never the network. */
export function isConfigured(): boolean {
  const raw = process.env.ANTHROPIC_API_KEY;
  return typeof raw === 'string' && raw.trim().length > 0;
}

/**
 * Lazily-constructed client. `new Anthropic()` resolves ANTHROPIC_API_KEY from the
 * env and does not hit the network, so this stays cheap and side-effect-free at
 * import time.
 */
let cachedClient: Anthropic | undefined;

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic();
  }
  return cachedClient;
}

export interface InvokeArgs {
  system: string;
  user: string;
  maxTokens: number;
}

/**
 * Send one Messages request through the first-party Claude API and return the
 * concatenated text content. Throws on any transport or shape error; the caller
 * turns that into a ReasonerUnavailable so the app can fall back to curated copy.
 */
export async function invokeMessages(args: InvokeArgs): Promise<string> {
  const response = await getClient().messages.create({
    model: getModelId(),
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
  });
  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    }
  }
  if (text.length === 0) {
    throw new Error('Claude response contained no text blocks');
  }
  return text;
}
