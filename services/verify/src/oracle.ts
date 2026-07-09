/** Run the independent Python oracle over the foils and load its per-case JSON. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MANIFEST, ORACLE_DIR, RIGOR_DIR, VENV_PY } from './config.js';

export function runOracle(): void {
  const res = spawnSync(
    VENV_PY,
    ['-m', 'redline.oracle', '--manifest', MANIFEST, '--out', ORACLE_DIR],
    { cwd: RIGOR_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(`oracle failed (${res.status}): ${(res.stderr || res.stdout || '').slice(0, 800)}`);
  }
}

export interface OracleCheck {
  verdict?: string;
  [k: string]: unknown;
}
export interface OracleCase {
  caseId: string;
  checks: Record<string, OracleCheck>;
}

export function loadOracle(oracleKey: string): OracleCase {
  return JSON.parse(readFileSync(resolve(ORACLE_DIR, `${oracleKey}.json`), 'utf8')) as OracleCase;
}

/** Number helpers used by the comparator's tolerance checks. */
export function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Compare two p-values on the log10 scale within epsilon; tiny values clamp. */
export function log10pClose(a: number, b: number, eps: number): boolean {
  const la = -Math.log10(Math.max(a, 1e-300));
  const lb = -Math.log10(Math.max(b, 1e-300));
  return Math.abs(la - lb) <= eps;
}
