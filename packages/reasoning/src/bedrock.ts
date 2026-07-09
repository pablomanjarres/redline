import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/** The Anthropic Messages API version string for the Bedrock InvokeModel path. */
const ANTHROPIC_BEDROCK_VERSION = 'bedrock-2023-05-31';

/**
 * Lazily-constructed client. Building it does not hit the network (the AWS SDK
 * resolves region and credentials on the first `send`), so this stays cheap and
 * side-effect-free at import time.
 */
let cachedClient: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
  }
  return cachedClient;
}

/** The configured Bedrock model id, or undefined when the env var is unset/blank. */
export function getModelId(): string | undefined {
  const raw = process.env.REDLINE_BEDROCK_MODEL_ID;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when a model id is present. Reads env only; never touches the network. */
export function isConfigured(): boolean {
  return getModelId() !== undefined;
}

export interface InvokeArgs {
  modelId: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Omit to use the model default. Pin to 0 for a judgment that must not vary
   *  between runs (the critic gate). */
  temperature?: number;
}

/**
 * Send one Anthropic Messages request through Bedrock InvokeModel and return the
 * concatenated text content. Throws on any transport, credential, or shape error;
 * the caller turns that into a ReasonerUnavailable so the app can fall back.
 */
export async function invokeMessages(args: InvokeArgs): Promise<string> {
  const body: Record<string, unknown> = {
    anthropic_version: ANTHROPIC_BEDROCK_VERSION,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
  };
  if (args.temperature !== undefined) body.temperature = args.temperature;
  const command = new InvokeModelCommand({
    modelId: args.modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: Buffer.from(JSON.stringify(body), 'utf8'),
  });
  const response = await getClient().send(command);
  if (!response.body) {
    throw new Error('Bedrock returned an empty response body');
  }
  const decoded = Buffer.from(response.body).toString('utf8');
  const payload: unknown = JSON.parse(decoded);
  return extractText(payload);
}

/** Pull the text blocks out of an Anthropic Messages response body. */
function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Bedrock response was not a JSON object');
  }
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('Bedrock response had no content array');
  }
  let text = '';
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      text += (block as { text: string }).text;
    }
  }
  if (text.length === 0) {
    throw new Error('Bedrock response contained no text blocks');
  }
  return text;
}
