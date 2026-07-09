import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { VerificationRun } from '@redline/contracts';
import type {
  AiChannel,
  AiWiring,
  CaseVerdict,
  CheckVerdict,
  DeadControl,
  ProbeOutcome,
  ValueComparison,
  Verdict,
} from '@redline/contracts';
import { C } from '@redline/ui';
import { CriticPanel } from './CriticPanel';
import { RerunButton } from './RerunButton';

/**
 * /verifications: the internal QA surface for the self-verification harness.
 *
 * A server component. It reads apps/web/src/verifications/latest-run.json at
 * request time (force-dynamic) so it always reflects the newest run the reporter
 * wrote, validates it against the VerificationRun contract, and renders the
 * verdict: a readiness banner, per-case check rows (verdict chip + displayed vs
 * oracle + probes), the AI-wiring status, and the dead-control list. Clarity
 * over polish; this is a dashboard for us, not the product UI.
 */
export const dynamic = 'force-dynamic';

const CHECK_NAMES: Record<number, string> = {
  1: 'Pseudoreplication',
  2: 'Double dipping',
  3: 'Fragility',
  4: 'Confounding',
};

/** Verdict -> its color and a soft tint for the chip background. */
const VERDICT_STYLE: Record<Verdict, { fg: string; soft: string }> = {
  WIRED: { fg: C.pass, soft: 'rgba(18,146,94,0.12)' },
  STATIC: { fg: C.amber, soft: 'rgba(180,83,9,0.13)' },
  BROKEN: { fg: C.redDeep, soft: 'rgba(229,72,77,0.13)' },
  TEMPLATED: { fg: C.redDeep, soft: 'rgba(229,72,77,0.13)' },
  MISSING: { fg: C.ink3, soft: 'rgba(154,166,184,0.18)' },
};

type LoadResult = { run: VerificationRun } | { error: 'missing' | 'invalid'; detail?: string };

async function loadRun(): Promise<LoadResult> {
  // The running app's cwd is apps/web; the run store sits under src/.
  const file = path.join(process.cwd(), 'src', 'verifications', 'latest-run.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { error: 'missing' };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: 'invalid', detail: 'The run file is not valid JSON.' };
  }
  const parsed = VerificationRun.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: 'invalid',
      detail: first ? `${first.path.join('.')}: ${first.message}` : 'The run file did not match the expected shape.',
    };
  }
  return { run: parsed.data };
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toUTCString();
}

export default async function VerificationsPage() {
  const result = await loadRun();

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 40px 96px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: '600 12px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--red)' }}>
            Self-verification harness
          </div>
          <h1 style={{ margin: '13px 0 0', font: '800 30px/1.05 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)' }}>
            Verification run
          </h1>
          <p style={{ margin: '11px 0 0', font: '400 13px/1.6 var(--sans)', color: 'var(--ink-3)', maxWidth: 660 }}>
            Internal QA. The harness drives the running app against an independent oracle and grades whether every displayed
            number is wired to real compute or faked.
          </p>
        </div>
        <RerunButton />
      </div>

      {'run' in result ? <RunView run={result.run} /> : <EmptyState kind={result.error} detail={result.detail} />}

      {/* The actor-critic slice. Independent of the harness run above: this one is
          committed, that one is written by `pnpm --filter @redline/verify verify`. */}
      <CriticPanel />
    </div>
  );
}

function RunView({ run }: { run: VerificationRun }) {
  return (
    <>
      <div style={{ marginTop: 16, font: '400 12px/1 var(--mono)', color: 'var(--ink-4)' }}>
        Ran <span style={{ color: 'var(--ink-2)' }}>{formatTimestamp(run.timestamp)}</span>
      </div>

      <ReadyBanner run={run} />

      {run.cases.map((c) => (
        <CaseSection key={c.caseId} c={c} />
      ))}

      <AiWiringPanel ai={run.aiWiring} />
      <DeadControlsPanel controls={run.deadControls} />
    </>
  );
}

function ReadyBanner({ run }: { run: VerificationRun }) {
  const ready = run.ready;
  const col = ready ? C.pass : C.red;
  const soft = ready ? 'rgba(18,146,94,0.09)' : 'rgba(229,72,77,0.09)';
  return (
    <section
      aria-label="Readiness"
      style={{
        marginTop: 20,
        border: `1px solid color-mix(in srgb, ${col} 30%, var(--edge))`,
        borderLeft: `3px solid ${col}`,
        borderRadius: 14,
        background: `linear-gradient(180deg, ${soft}, transparent), var(--panel)`,
        padding: '24px 26px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span aria-hidden style={{ width: 14, height: 14, borderRadius: 14, background: col, boxShadow: `0 0 12px ${col}`, flex: 'none' }} />
        <span style={{ font: '900 40px/1 var(--display)', letterSpacing: '-.02em', color: col }}>{ready ? 'READY' : 'NOT READY'}</span>
        <span style={{ font: '500 13px/1.45 var(--sans)', color: 'var(--ink-2)', maxWidth: 540 }}>
          {ready
            ? 'Every check wired across all four cases. Field resolution and reasoning are real model calls. Case C reads Verified, case D degrades to flag-only, and no dead control is unlabeled.'
            : 'The harness found gaps. The failing items are listed below.'}
        </span>
      </div>

      {!ready && run.failures.length > 0 && (
        <ul style={{ margin: '18px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {run.failures.map((f, i) => (
            <li key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', font: '500 13px/1.5 var(--sans)', color: 'var(--ink)' }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--red)', flex: 'none', marginTop: 6 }} />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CaseSection({ c }: { c: CaseVerdict }) {
  return (
    <section aria-label={`Case ${c.caseId}: ${c.label}`} style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ font: '800 22px/1 var(--display)', letterSpacing: '-.01em', color: 'var(--ink)' }}>Case {c.caseId}</span>
        <span style={{ font: '500 13.5px/1.3 var(--sans)', color: 'var(--ink-2)' }}>{c.label}</span>
        <span style={{ font: '400 11.5px/1 var(--mono)', color: 'var(--ink-4)' }}>{c.scenarioId}</span>
      </div>
      {c.notes && (
        <p style={{ margin: '9px 0 0', font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-3)', maxWidth: 780 }}>{c.notes}</p>
      )}
      <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {c.checks.map((ch) => (
          <CheckRow key={ch.checkId} check={ch} />
        ))}
      </div>
    </section>
  );
}

function CheckRow({ check }: { check: CheckVerdict }) {
  const name = CHECK_NAMES[check.checkId] ?? `Check ${check.checkId}`;
  const num = `0${check.checkId}`;
  return (
    <div
      data-testid={`verify-check-${check.checkId}`}
      style={{ border: '1px solid var(--edge)', borderRadius: 12, background: 'var(--panel)', padding: '16px 18px', boxShadow: '0 1px 2px rgba(16,24,40,0.03)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ font: '700 12px/1 var(--mono)', color: 'var(--ink-4)', flex: 'none' }}>{num}</span>
        <span style={{ flex: '1 1 auto', minWidth: 0, font: '700 14px/1.2 var(--sans)', color: 'var(--ink)' }}>{name}</span>
        <VerdictChip verdict={check.verdict} />
      </div>

      {check.comparisons.length > 0 && (
        <div style={{ marginTop: 13 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              font: '600 9px/1 var(--mono)',
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
            }}
          >
            <span>Check value</span>
            <span>displayed / oracle</span>
          </div>
          <div style={{ marginTop: 2 }}>
            {check.comparisons.map((cmp, i) => (
              <ComparisonRow key={`${cmp.key}-${i}`} cmp={cmp} />
            ))}
          </div>
        </div>
      )}

      {check.probes.length > 0 && (
        <div style={{ marginTop: 15 }}>
          <div style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Probes</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {check.probes.map((p, i) => (
              <ProbeRow key={`${p.name}-${i}`} probe={p} />
            ))}
          </div>
        </div>
      )}

      {check.note && (
        <p style={{ margin: '13px 0 0', font: '400 12px/1.55 var(--sans)', color: 'var(--ink-3)' }}>{check.note}</p>
      )}
    </div>
  );
}

function ComparisonRow({ cmp }: { cmp: ValueComparison }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--edge)' }}>
      <Tolerance ok={cmp.withinTolerance} />
      <span style={{ flex: '1 1 auto', minWidth: 0, font: '500 11.5px/1.4 var(--mono)', color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cmp.key}
      </span>
      <span style={{ flex: 'none', font: '600 12.5px/1 var(--mono)', color: 'var(--ink)' }}>{cmp.displayed}</span>
      <span aria-hidden style={{ flex: 'none', font: '400 12px/1 var(--mono)', color: 'var(--ink-4)' }}>/</span>
      <span style={{ flex: 'none', font: '500 12.5px/1 var(--mono)', color: 'var(--ink-3)' }}>{cmp.oracle}</span>
    </div>
  );
}

function ProbeRow({ probe }: { probe: ProbeOutcome }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <PassPill passed={probe.passed} />
      <div style={{ minWidth: 0 }}>
        <div style={{ font: '600 11.5px/1.4 var(--mono)', color: 'var(--ink-2)' }}>{probe.name}</div>
        <div style={{ marginTop: 2, font: '400 11.5px/1.5 var(--sans)', color: 'var(--ink-3)' }}>{probe.detail}</div>
      </div>
    </div>
  );
}

function VerdictChip({ verdict }: { verdict: Verdict }) {
  const v = VERDICT_STYLE[verdict];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flex: 'none',
        font: '700 10px/1 var(--mono)',
        letterSpacing: '.12em',
        color: v.fg,
        background: v.soft,
        border: `1px solid color-mix(in srgb, ${v.fg} 35%, transparent)`,
        padding: '6px 10px',
        borderRadius: 6,
      }}
    >
      {verdict}
    </span>
  );
}

function PassPill({ passed }: { passed: boolean }) {
  const fg = passed ? C.pass : C.redDeep;
  const soft = passed ? 'rgba(18,146,94,0.12)' : 'rgba(229,72,77,0.13)';
  return (
    <span
      style={{
        flex: 'none',
        minWidth: 44,
        textAlign: 'center',
        font: '700 9px/1 var(--mono)',
        letterSpacing: '.1em',
        color: fg,
        background: soft,
        border: `1px solid color-mix(in srgb, ${fg} 35%, transparent)`,
        padding: '5px 7px',
        borderRadius: 5,
      }}
    >
      {passed ? 'PASS' : 'FAIL'}
    </span>
  );
}

function Tolerance({ ok }: { ok: boolean }) {
  return (
    <span role="img" aria-label={ok ? 'within tolerance' : 'out of tolerance'} style={{ display: 'inline-flex', flex: 'none', width: 14, height: 14 }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {ok ? (
          <path d="M3.5 8.5l3 3 6-7" stroke={C.pass} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M4 4l8 8M12 4l-8 8" stroke={C.red} strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
    </span>
  );
}

function AiWiringPanel({ ai }: { ai: AiWiring }) {
  return (
    <section aria-label="AI wiring" style={{ marginTop: 34 }}>
      <SectionTitle kicker="Model calls" title="AI wiring" />
      <div style={{ marginTop: 13, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <ChannelCard title="Field resolution" ch={ai.fieldResolution} />
        <ChannelCard title="Reasoning" ch={ai.reasoning} />
      </div>
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          border: '1px solid var(--edge)',
          borderRadius: 12,
          background: 'var(--panel)',
          padding: '13px 17px',
        }}
      >
        <span style={{ flex: '1 1 auto', minWidth: 0, font: '500 12.5px/1.4 var(--sans)', color: 'var(--ink-2)' }}>
          Field resolution adapts across cases A and B
        </span>
        <StatusBadge ok={ai.fieldResolutionAdaptsAcrossCases} yes="adapts" no="does not adapt" />
      </div>
    </section>
  );
}

function ChannelCard({ title, ch }: { title: string; ch: AiChannel }) {
  return (
    <div style={{ border: '1px solid var(--edge)', borderRadius: 12, background: 'var(--panel)', padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ font: '700 13px/1.2 var(--sans)', color: 'var(--ink)' }}>{title}</span>
        <StatusBadge ok={ch.real} yes="real call" no="fallback" />
      </div>
      <div style={{ marginTop: 10, font: '500 11.5px/1 var(--mono)', color: 'var(--ink-3)' }}>
        source: <span style={{ color: 'var(--ink)' }}>{ch.source}</span>
      </div>
      <p style={{ margin: '10px 0 0', font: '400 12px/1.55 var(--sans)', color: 'var(--ink-3)' }}>{ch.detail}</p>
    </div>
  );
}

function DeadControlsPanel({ controls }: { controls: DeadControl[] }) {
  return (
    <section aria-label="Dead controls" style={{ marginTop: 34 }}>
      <SectionTitle kicker="Interactive elements" title="Dead controls" />
      {controls.length === 0 ? (
        <p style={{ margin: '13px 0 0', font: '400 12.5px/1.6 var(--sans)', color: 'var(--ink-3)' }}>
          No interactive controls were found dead.
        </p>
      ) : (
        <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {controls.map((d, i) => {
            const unlabeled = d.label === null;
            return (
              <div
                key={`${d.selector}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  border: '1px solid var(--edge)',
                  borderRadius: 10,
                  background: 'var(--panel)',
                  padding: '12px 15px',
                  flexWrap: 'wrap',
                }}
              >
                <StatusBadge ok={!d.dead} yes="ok" no="dead" />
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <div style={{ font: '600 12.5px/1.35 var(--sans)', color: unlabeled ? 'var(--amber)' : 'var(--ink)' }}>
                    {d.label ?? 'unlabeled control'}
                  </div>
                  <div style={{ marginTop: 2, font: '400 11px/1.45 var(--mono)', color: 'var(--ink-4)' }}>
                    {d.location} · {d.selector}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  const fg = ok ? C.pass : C.redDeep;
  const soft = ok ? 'rgba(18,146,94,0.12)' : 'rgba(229,72,77,0.13)';
  return (
    <span
      style={{
        flex: 'none',
        font: '700 10px/1 var(--mono)',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: fg,
        background: soft,
        border: `1px solid color-mix(in srgb, ${fg} 35%, transparent)`,
        padding: '5px 9px',
        borderRadius: 20,
      }}
    >
      {ok ? yes : no}
    </span>
  );
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <div style={{ font: '600 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--red)' }}>{kicker}</div>
      <h2 style={{ margin: '9px 0 0', font: '800 20px/1.1 var(--display)', letterSpacing: '-.01em', color: 'var(--ink)' }}>{title}</h2>
    </div>
  );
}

function EmptyState({ kind, detail }: { kind: 'missing' | 'invalid'; detail?: string }) {
  const missing = kind === 'missing';
  return (
    <section
      aria-label="No verification run"
      style={{ marginTop: 26, border: '1px dashed var(--edge-2)', borderRadius: 14, background: 'var(--panel)', padding: '44px 30px', textAlign: 'center' }}
    >
      <div style={{ font: '800 20px/1.2 var(--display)', color: 'var(--ink)' }}>{missing ? 'No run yet' : 'Run file could not be read'}</div>
      <p style={{ margin: '12px auto 0', maxWidth: 480, font: '400 13px/1.6 var(--sans)', color: 'var(--ink-3)' }}>
        {missing
          ? 'The harness has not written a verdict yet. Press Re-run harness above to start it. The reporter writes latest-run.json when it finishes; refresh this page to see the result.'
          : (detail ?? 'The run file exists but did not match the expected shape.')}
      </p>
    </section>
  );
}
