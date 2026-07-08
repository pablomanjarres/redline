/**
 * Typed client for the audit route handlers. Every response is parsed with the
 * contracts' Zod schemas, so a malformed payload fails loudly here instead of
 * corrupting the session store. The route handlers themselves are owned by the
 * api agent (apps/web/src/app/api/audit/*).
 */
import { z } from 'zod';
import {
  CheckResult,
  FieldSpec,
  type CheckConfigMap,
  type CheckId,
  type ScenarioId,
} from '@redline/contracts';

const FieldsResponse = z.object({ fields: z.array(FieldSpec) });

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* body already consumed or unavailable */
    }
    throw new Error(`POST ${url} failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return res.json();
}

/**
 * Foundation step: resolve the scenario's `obs` columns into typed field roles.
 * POST /api/audit/fields with `{ scenarioId }` -> `{ fields: FieldSpec[] }`.
 */
export async function postFields(body: { scenarioId: ScenarioId }): Promise<FieldSpec[]> {
  const json = await postJson('/api/audit/fields', body);
  return FieldsResponse.parse(json).fields;
}

/**
 * Run one check: numbers from the compute target, prose from the reasoner,
 * merged into a `CheckResult`. POST /api/audit/check.
 */
export async function postCheck(body: {
  scenarioId: ScenarioId;
  checkId: CheckId;
  config: CheckConfigMap[CheckId];
  fields: FieldSpec[];
}): Promise<CheckResult> {
  const json = await postJson('/api/audit/check', body);
  return CheckResult.parse(json);
}
