/** Typed HTTP client for the two audit routes plus a readiness probe. */
import type { CheckResult, FieldSpec } from '@redline/contracts';
import { BASE_URL } from './config.js';

export interface FieldsResponse {
  fields: FieldSpec[];
  source?: string;
}

async function post<T>(path: string, body: unknown, timeoutMs = 200000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function postFields(scenarioId: string): Promise<FieldsResponse> {
  return post<FieldsResponse>('/api/audit/fields', { scenarioId });
}

export function postCheck(
  scenarioId: string,
  checkId: number,
  config: Record<string, unknown>,
  fields: FieldSpec[],
  noReason = false,
): Promise<CheckResult> {
  return post<CheckResult>('/api/audit/check', { scenarioId, checkId, config, fields, noReason });
}

export async function waitForReady(timeoutMs = 150000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/`, { method: 'GET' });
      if (res.ok) return true;
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
