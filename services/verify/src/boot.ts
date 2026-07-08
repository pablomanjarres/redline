/**
 * Boot a local+Bedrock app instance for the harness to drive, then tear it down.
 * This makes `pnpm --filter @redline/verify run verify` a single self-contained
 * command. Set REDLINE_VERIFY_BASE_URL to skip the boot and drive an app that is
 * already running.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AWS_PROFILE, AWS_REGION, BEDROCK_MODEL, FOILS_DIR, PORT, RIGOR_DIR, VENV_PY, WEB_DIR } from './config.js';

export interface Booted {
  stop: () => void;
}

/** A space-free wrapper so REDLINE_ENGINE_CMD (split on spaces) survives a repo
 *  path that contains spaces. It cd's into the rigor dir and runs the adapter. */
function writeWrapper(): string {
  const p = join(tmpdir(), `redline-engine-${process.pid}.sh`);
  writeFileSync(p, `#!/bin/bash\ncd ${JSON.stringify(RIGOR_DIR)} || exit 1\nexec ${JSON.stringify(VENV_PY)} -m redline.remote_adapter\n`, 'utf8');
  chmodSync(p, 0o755);
  return p;
}

export function bootApp(): Booted {
  const wrapper = writeWrapper();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    REDLINE_COMPUTE_TARGET: 'local',
    REDLINE_ENGINE_CMD: wrapper,
    REDLINE_MARSON_H5AD: resolve(FOILS_DIR, 'caseA_marson_foil.h5ad'),
    REDLINE_PFC_H5AD: resolve(FOILS_DIR, 'caseB_pfc_foil.h5ad'),
    REDLINE_CLEAN_H5AD: resolve(FOILS_DIR, 'caseC_clean.h5ad'),
    REDLINE_NOCOUNTS_H5AD: resolve(FOILS_DIR, 'caseD_nocounts.h5ad'),
    REDLINE_REASONING_BACKEND: 'bedrock',
    AWS_REGION,
    REDLINE_BEDROCK_MODEL_ID: BEDROCK_MODEL,
    AWS_PROFILE,
  };
  const child: ChildProcess = spawn('pnpm', ['exec', 'next', 'dev', '--webpack', '--port', String(PORT)], {
    cwd: WEB_DIR,
    env,
    stdio: 'ignore',
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  };
  process.on('exit', stop);
  return { stop };
}
