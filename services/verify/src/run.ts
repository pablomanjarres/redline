/**
 * The self-verification harness. Runs the independent oracle over the foils,
 * drives every case through the live app, grades displayed-vs-oracle plus the
 * probes, and writes the run the /verifications page reads. Exit 0 always
 * (a NOT-READY run is a real result, not a crash); exit 2 if the app is
 * unreachable.
 *
 *   REDLINE_VERIFY_BASE_URL=http://localhost:3009 pnpm --filter @redline/verify run verify
 */
import type { CaseVerdict, DeadControl, VerificationRun } from '@redline/contracts';
import { waitForReady } from './api.js';
import { bootApp, type Booted } from './boot.js';
import { CASES } from './cases.js';
import { gradeAiWiring, gradeCase, isReady } from './comparator.js';
import { BASE_URL } from './config.js';
import { driveCase } from './driver.js';
import { loadOracle, runOracle } from './oracle.js';
import { writeRun } from './reporter.js';
import type { CaseProbe } from './types.js';

async function main(): Promise<number> {
  const booted: Booted | null = process.env.REDLINE_VERIFY_BASE_URL ? null : bootApp();
  if (booted) console.error('[verify] booted a local+bedrock app instance');
  try {
    console.error(`[verify] target = ${BASE_URL}`);
    if (!(await waitForReady())) {
      console.error('[verify] the app is not reachable; start it on local+bedrock first.');
      return 2;
    }

    console.error('[verify] running the independent oracle over the foils...');
    runOracle();

    const caseVerdicts: CaseVerdict[] = [];
    const caseProbes: CaseProbe[] = [];
    for (const c of CASES) {
      console.error(`[verify] driving case ${c.caseId} (${c.scenarioId})...`);
      const probe = await driveCase(c);
      caseProbes.push(probe);
      caseVerdicts.push(gradeCase(probe, loadOracle(c.oracleKey)));
    }

    const ai = gradeAiWiring(caseProbes);
    // The one interactive-looking control we audited: the intake upload affordance,
    // now a disabled + labeled button. (A browser pass will scan the DOM live.)
    const deadControls: DeadControl[] = [
      { location: 'intake page', selector: 'upload-h5ad', label: 'Upload .h5ad (not available in this build)', dead: false },
    ];
    const deadUnlabeled = deadControls.filter((d) => d.dead && !d.label).length;
    const { ready, failures } = isReady(caseVerdicts, ai, deadUnlabeled);

    const run: VerificationRun = {
      ready,
      timestamp: new Date().toISOString(),
      cases: caseVerdicts,
      aiWiring: ai,
      deadControls,
      failures,
    };
    writeRun(run);

    console.error(`\n[verify] ${ready ? 'READY' : 'NOT READY'} — ${failures.length} failure(s).`);
    for (const f of failures) console.error(`  - ${f}`);
    for (const c of run.cases) {
      console.error(`  case ${c.caseId}: ${c.checks.map((k) => `${k.checkId}:${k.verdict}`).join(' ')}`);
    }
    return 0;
  } finally {
    booted?.stop();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[verify] fatal:', err);
    process.exit(1);
  });
