/**
 * Read a JSON request body with a byte ceiling.
 *
 * `/api/audit/*` is unauthenticated, and the claim routes forward the body's text
 * into a paid model call which is re-sent on retry. Zod's `.max()` on a field
 * rejects an oversized string, but only after the whole body has been read and
 * parsed. This refuses it at the door.
 *
 * Content-Length is a hint, not a guarantee, so the stream is counted as it is
 * read and aborted the moment it passes the ceiling.
 */
export class BodyTooLarge extends Error {
  constructor(readonly limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = 'BodyTooLarge';
  }
}

/** 1 MB. A notebook is text; a megabyte of it is already generous. */
export const MAX_BODY_BYTES = 1_048_576;

export async function readJsonBounded(req: Request, limit: number = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLarge(limit);

  if (!req.body) return JSON.parse(await req.text());

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new BodyTooLarge(limit);
    }
    chunks.push(value);
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buf));
}
