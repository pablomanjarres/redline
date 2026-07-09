import { describe, expect, it } from 'vitest';
import { BodyTooLarge, MAX_BODY_BYTES, readJsonBounded } from './body';

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://x/api/audit/claims', { method: 'POST', body, headers });
}

describe('readJsonBounded', () => {
  it('reads a normal body', async () => {
    await expect(readJsonBounded(post(JSON.stringify({ a: 1 })))).resolves.toEqual({ a: 1 });
  });

  it('refuses a body that declares itself too large, without reading it', async () => {
    const req = post('{}', { 'content-length': String(MAX_BODY_BYTES + 1) });
    await expect(readJsonBounded(req)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it('refuses a body that LIES about its length, counting the stream', async () => {
    // Content-Length is a hint. A client can omit it or understate it, so the
    // ceiling has to hold on the bytes actually delivered.
    const big = JSON.stringify({ notebook: 'z'.repeat(2048) });
    const req = new Request('http://x', {
      method: 'POST',
      body: big,
      headers: { 'content-length': '10' },
    });
    await expect(readJsonBounded(req, 1024)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it('accepts a body exactly at the limit', async () => {
    const payload = JSON.stringify({ n: 'a'.repeat(50) });
    await expect(readJsonBounded(post(payload), payload.length)).resolves.toBeTruthy();
  });

  it('still throws on malformed JSON, so the caller can answer 400', async () => {
    await expect(readJsonBounded(post('not json'))).rejects.toThrow();
  });
});
