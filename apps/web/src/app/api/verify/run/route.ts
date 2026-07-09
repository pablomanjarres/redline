import { spawn } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';

/**
 * POST /api/verify/run: kick the self-verification harness.
 *
 * Spawns `pnpm --filter @redline/verify run verify` at the repo root, detached,
 * with its stdio discarded, then unrefs it so this request can return without
 * waiting. The harness runs for minutes and overwrites
 * apps/web/src/verifications/latest-run.json when it finishes; the /verifications
 * page reads that file fresh on the next load. We never await the child.
 */
export const runtime = 'nodejs';

export async function POST() {
  try {
    // The running app's cwd is apps/web; the repo root is two levels up.
    const repoRoot = path.resolve(process.cwd(), '..', '..');

    const child = spawn('pnpm', ['--filter', '@redline/verify', 'run', 'verify'], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return NextResponse.json({ started: true, at: new Date().toISOString() });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ started: false, error }, { status: 500 });
  }
}
