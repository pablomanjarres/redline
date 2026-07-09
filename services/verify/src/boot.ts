/**
 * Boot a local+Bedrock app instance for the harness to drive, then tear it down.
 * This makes `pnpm --filter @redline/verify run verify` a single self-contained
 * command. Set REDLINE_VERIFY_BASE_URL to skip the boot and drive an app that is
 * already running.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
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

/** Refuse to boot onto a port something else already holds.
 *
 *  The child is spawned with stdio ignored, so a failed bind is invisible: the
 *  driver would then grade whatever server is already listening, which on a
 *  re-run is the previous build. A stale green is worse than a loud failure. */
function assertPortFree(): void {
  const probe = spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) {
    throw new Error(
      `port ${PORT} is already in use, so the harness would drive a server it did not build. ` +
        `Stop it, or set REDLINE_VERIFY_BASE_URL to drive it deliberately.\n${probe.stdout.trim()}`,
    );
  }
}

export function bootApp(): Booted {
  assertPortFree();
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
  // A production build plus `next start` is far more stable than the dev server
  // for a long run: no per-route webpack recompiles while the Python engine is
  // spawning subprocesses, and a much smaller memory footprint. The dev server
  // died mid-run; this does not.
  if (!process.env.REDLINE_VERIFY_SKIP_BUILD) {
    console.error('[verify] building the app (once) for a stable server...');
    const build = spawnSync('pnpm', ['exec', 'next', 'build', '--webpack'], { cwd: WEB_DIR, env, stdio: 'ignore' });
    if (build.status !== 0) {
      throw new Error(`next build failed (${build.status}); cannot boot the app`);
    }
  }
  // Its own process group: `pnpm exec next start` is a wrapper around the real
  // server, so killing only the wrapper would orphan the server on the port.
  const child: ChildProcess = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
    cwd: WEB_DIR,
    env,
    stdio: 'ignore',
    detached: true,
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  };
  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  return { stop };
}
