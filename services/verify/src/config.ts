/**
 * Paths and knobs for the self-verification harness. Everything resolves from
 * this file's location, so the harness runs the same whatever the cwd.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// services/verify/src -> repo root
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const RIGOR_DIR = resolve(REPO_ROOT, 'services', 'rigor');
export const VENV_PY = resolve(RIGOR_DIR, '.venv', 'bin', 'python');
export const FOILS_DIR = resolve(RIGOR_DIR, 'cache', 'foils');
export const MANIFEST = resolve(FOILS_DIR, 'manifest.json');
export const ORACLE_DIR = resolve(RIGOR_DIR, 'cache', 'oracle');
export const WEB_DIR = resolve(REPO_ROOT, 'apps', 'web');
/** The store the /verifications page reads. */
export const RUN_STORE = resolve(WEB_DIR, 'src', 'verifications', 'latest-run.json');

export const PORT = Number(process.env.REDLINE_VERIFY_PORT ?? 3011);
/** Connect to an app already running (default) or the port the harness boots. */
export const BASE_URL = process.env.REDLINE_VERIFY_BASE_URL ?? `http://localhost:${PORT}`;

export const BEDROCK_MODEL =
  process.env.REDLINE_BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-5-20251101-v1:0';
export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
export const AWS_PROFILE = process.env.AWS_PROFILE ?? 'default';

/** Space between Bedrock-triggering calls so the model does not throttle. */
export const PACE_MS = Number(process.env.REDLINE_VERIFY_PACE_MS ?? 1200);

/** Tolerances the comparator grades displayed-vs-oracle against. */
export const TOL = {
  log10p: 0.5, // p-values compared on log10 scale
  auc: 0.06, // AUC / stability within a few percent
  stability: 0.06,
  cramersV: 0.03,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
