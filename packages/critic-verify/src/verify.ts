/**
 * The live actor-critic acceptance run. It builds a real reasoning backend (Bedrock
 * for the internal demo, or the Claude API), runs the critic over every candidate
 * finding with real model calls, runs the offline self-honesty foils, writes the
 * run to `apps/web/src/verifications/latest-critic-run.json` for the /verifications
 * page, prints a summary, and exits non-zero if the run is not ready.
 *
 *   AWS_REGION=us-east-1 \
 *   REDLINE_BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-5-20251101-v1:0 \
 *   pnpm --filter @redline/critic-verify verify
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CriticVerification, VerificationRun } from '@redline/contracts';
import { createReasoner } from '@redline/reasoning';
import { buildCriticCases } from './cases.js';
import {
  assembleVerification,
  failSafeSelfTest,
  rubberStampSelfTest,
  runCritic,
} from './runner.js';

function collectFailures(critic: CriticVerification): string[] {
  const failures: string[] = [];
  for (const o of critic.outcomes) {
    if (!o.passed) {
      failures.push(
        `${o.label}: expected ${o.expected}, got ${o.verdict}${o.realModelCall ? '' : ' (no real model call)'}`,
      );
    }
  }
  if (!critic.cleanCaseGreen) {
    failures.push('the clean case is not green: an over-fired flag was not vetoed');
  }
  if (critic.realModelCalls !== critic.outcomes.length) {
    failures.push(`only ${critic.realModelCalls}/${critic.outcomes.length} findings got a real model call`);
  }
  for (const t of critic.selfTests) {
    if (!t.caught) failures.push(`self-test failed: ${t.name}`);
  }
  return failures;
}

async function main(): Promise<number> {
  const model = process.env.REDLINE_BEDROCK_MODEL_ID?.trim() || '(model id unset)';
  const reasoner = createReasoner();
  if (!reasoner.available) {
    console.error(
      'No reasoning backend configured. Set REDLINE_BEDROCK_MODEL_ID (+ AWS creds) or ANTHROPIC_API_KEY.',
    );
    return 2;
  }

  const cases = buildCriticCases();
  console.error(
    `Critic acceptance: ${cases.length} candidate findings via ${reasoner.backend} (${model}).`,
  );

  const outcomes = await runCritic(reasoner, cases, { realModelCalls: true });
  const selfTests = [await rubberStampSelfTest(cases), await failSafeSelfTest(cases)];
  const critic = assembleVerification(model, cases, outcomes, selfTests, true);

  const run: VerificationRun = {
    ready: critic.ready,
    timestamp: new Date().toISOString(),
    cases: [],
    aiWiring: {
      fieldResolution: {
        source: 'n/a',
        real: false,
        detail: 'Field resolution is graded by the base harness, not the critic slice.',
      },
      reasoning: {
        source: reasoner.backend ?? 'bedrock',
        real: critic.realModelCalls > 0,
        detail: `The critic fired ${critic.realModelCalls} real ${reasoner.backend} calls, one per candidate finding.`,
      },
      fieldResolutionAdaptsAcrossCases: false,
    },
    deadControls: [],
    failures: collectFailures(critic),
    critic,
  };

  const outUrl = new URL(
    '../../../apps/web/src/verifications/latest-critic-run.json',
    import.meta.url,
  );
  const outPath = fileURLToPath(outUrl);
  mkdirSync(fileURLToPath(new URL('.', outUrl)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
  console.error(`Wrote ${outPath}`);

  // Print a legible per-finding summary.
  for (const o of critic.outcomes) {
    const mark = o.passed ? 'OK ' : 'XX ';
    console.error(
      `  [${mark}] ${o.label}: ${o.verdict} (expected ${o.expected}) -> ${o.effectiveState}  · keys on ${o.keysOn}`,
    );
  }
  for (const t of critic.selfTests) {
    console.error(`  [${t.caught ? 'OK ' : 'XX '}] self-test: ${t.name}`);
  }
  console.error(
    `\nreal model calls: ${critic.realModelCalls}/${critic.outcomes.length}  · clean case green: ${critic.cleanCaseGreen}  · READY: ${critic.ready}`,
  );

  if (!critic.ready) {
    console.error('\nNOT READY:');
    for (const f of run.failures) console.error(`  - ${f}`);
    return 1;
  }
  console.error('\nREADY: the critic confirmed the genuine flags, vetoed the over-fires (green), and downgraded the underpowered split.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('critic-verify crashed:', err);
    process.exit(3);
  });
