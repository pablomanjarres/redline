/** Write the graded run to the store the /verifications page reads. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { VerificationRun } from '@redline/contracts';
import { RUN_STORE } from './config.js';

export function writeRun(run: VerificationRun): void {
  mkdirSync(dirname(RUN_STORE), { recursive: true });
  writeFileSync(RUN_STORE, JSON.stringify(run, null, 2), 'utf8');
}
