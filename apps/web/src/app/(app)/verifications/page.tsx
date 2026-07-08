import Link from 'next/link';
import { VerificationRun, type CriticFindingOutcome, type CriticVerdict } from '@redline/contracts';
import runJson from '@/verifications/latest-critic-run.json';

/**
 * The self-verification surface: the actor-critic slice. It renders the committed
 * harness run (`latest-critic-run.json`) so a real critic call can be seen per
 * finding, the never-cry-wolf veto can be read on the clean case, and the
 * self-honesty foils are on the record. Internal QA: clarity over polish.
 *
 * This is the actor-critic slice only. The base page harness (field resolution,
 * per-check WIRED grading, dead controls) is a separate deliverable on the
 * verify-harness branch; its sections render empty here until it lands.
 */

const run = VerificationRun.parse(runJson);

const VERDICT_COLOR: Record<CriticVerdict, string> = {
  confirm: 'var(--ink-2)',
  downgrade: 'var(--amber)',
  veto: 'var(--green)',
};

const VERDICT_LABEL: Record<CriticVerdict, string> = {
  confirm: 'Confirm',
  downgrade: 'Downgrade',
  veto: 'Veto',
};

const KIND_ORDER = ['genuine', 'over-fire', 'underpowered'] as const;

function Kicker({ color, children }: { color: string; children: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ width: 6, height: 6, borderRadius: 2, background: color, boxShadow: `0 0 8px ${color}`, flex: 'none' }} />
      <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{children}</span>
    </div>
  );
}

function MetaStat({ v, l, accent }: { v: string; l: string; accent?: string }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 10, padding: '13px 15px' }}>
      <div style={{ font: '700 18px/1.1 var(--mono)', letterSpacing: '-.01em', color: accent ?? 'var(--ink)' }}>{v}</div>
      <div style={{ marginTop: 6, font: '400 9.5px/1.3 var(--mono)', letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{l}</div>
    </div>
  );
}

function OutcomeRow({ o }: { o: CriticFindingOutcome }) {
  const color = VERDICT_COLOR[o.verdict];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, padding: '16px 18px', borderTop: '1px solid var(--edge)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              font: '700 10px/1 var(--sans)',
              letterSpacing: '.05em',
              textTransform: 'uppercase',
              color,
              border: `1px solid ${color}`,
              background: `color-mix(in srgb, ${color} 12%, transparent)`,
              padding: '4px 8px',
              borderRadius: 6,
            }}
          >
            {VERDICT_LABEL[o.verdict]}
          </span>
          <span style={{ font: '600 13px/1.3 var(--sans)', color: 'var(--ink)' }}>{o.label}</span>
        </div>
        <div style={{ marginTop: 7, font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-3)' }}>{o.justification}</div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ font: '500 10.5px/1 var(--mono)', color: 'var(--ink-4)' }}>keys on {o.keysOn}</span>
          <span style={{ font: '500 10.5px/1 var(--mono)', color: 'var(--ink-4)' }}>
            {o.computeState} → {o.effectiveState}
          </span>
          {o.realModelCall && (
            <span style={{ font: '500 10.5px/1 var(--mono)', color: 'var(--signal)' }}>real model call</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <span style={{ font: '500 9.5px/1 var(--mono)', letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          {o.confidence}
        </span>
        <span
          title={o.passed ? 'graded as expected' : 'did not match the expected ruling'}
          style={{
            width: 18,
            height: 18,
            borderRadius: 18,
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: '800 11px/1 var(--sans)',
            color: 'var(--surface)',
            background: o.passed ? 'var(--green)' : 'var(--red)',
          }}
        >
          {o.passed ? '✓' : '✕'}
        </span>
      </div>
    </div>
  );
}

export default function VerificationsPage() {
  const critic = run.critic;
  const ready = critic?.ready ?? false;
  const bannerColor = ready ? 'var(--green)' : 'var(--red)';

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '44px 40px 80px' }}>
      <Kicker color="var(--signal)">Self-verification · actor-critic</Kicker>
      <h1 style={{ margin: '16px 0 0', font: '800 28px/1.15 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)', maxWidth: 720 }}>
        Does the second pass actually second-guess the first?
      </h1>
      <p style={{ margin: '13px 0 0', maxWidth: 720, font: '400 14px/1.6 var(--sans)', color: 'var(--ink-2)' }}>
        Every flagged finding is put to an independent critic before it reaches you. This surface is the record: a real
        model call per finding, the never-cry-wolf veto on the clean case, and the self-honesty foils that prove the
        critic can overturn a flag, not only wave it through.
      </p>

      {!critic ? (
        <div style={{ marginTop: 26, border: '1px solid var(--edge)', borderRadius: 12, padding: '18px 20px', background: 'var(--panel)' }}>
          <span style={{ font: '500 13px/1.5 var(--sans)', color: 'var(--ink-3)' }}>No critic run recorded yet.</span>
        </div>
      ) : (
        <>
          {/* banner */}
          <div
            style={{
              marginTop: 26,
              borderRadius: 12,
              border: `1px solid ${bannerColor}`,
              borderLeft: `4px solid ${bannerColor}`,
              background: `linear-gradient(180deg, color-mix(in srgb, ${bannerColor} 8%, transparent), transparent), var(--panel)`,
              padding: '18px 22px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: bannerColor, boxShadow: `0 0 9px ${bannerColor}` }} />
              <span style={{ font: '800 15px/1 var(--sans)', letterSpacing: '.02em', color: bannerColor }}>
                {ready ? 'READY' : 'NOT READY'}
              </span>
            </div>
            <p style={{ margin: '10px 0 0', font: '400 13px/1.55 var(--sans)', color: 'var(--ink-2)' }}>
              {ready
                ? 'The critic confirmed the genuine flags, vetoed the over-fired flags on the clean case, and downgraded the underpowered split, with a real model call on every finding.'
                : 'The critic run did not meet acceptance. See the findings and self-tests below.'}
            </p>
            {run.failures.length > 0 && (
              <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                {run.failures.map((f, i) => (
                  <li key={i} style={{ font: '400 12px/1.5 var(--sans)', color: 'var(--red-2)' }}>{f}</li>
                ))}
              </ul>
            )}
          </div>

          {/* meta */}
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <MetaStat v={`${critic.realModelCalls}/${critic.outcomes.length}`} l="real model calls" accent="var(--signal)" />
            <MetaStat v={critic.cleanCaseGreen ? 'green' : 'not green'} l="clean case (never cry wolf)" accent={critic.cleanCaseGreen ? 'var(--green)' : 'var(--red)'} />
            <MetaStat v={String(critic.selfTests.filter((t) => t.caught).length)} l={`of ${critic.selfTests.length} self-tests caught`} />
            <MetaStat v={run.timestamp.slice(0, 10)} l="last run" />
          </div>
          <p style={{ margin: '10px 0 0', font: '400 11px/1.5 var(--mono)', color: 'var(--ink-4)' }}>
            model {critic.model} · reasoning {run.aiWiring.reasoning.source}
          </p>

          {/* outcomes */}
          <div style={{ marginTop: 26 }}>
            <Kicker color="var(--red)">Per-finding rulings</Kicker>
          </div>
          <div style={{ marginTop: 14, border: '1px solid var(--edge)', borderRadius: 12, overflow: 'hidden', background: 'var(--panel-2)' }}>
            {KIND_ORDER.map((kind) => {
              const group = groupByKind(critic.outcomes, kind);
              if (group.length === 0) return null;
              return (
                <div key={kind}>
                  <div style={{ padding: '11px 18px', background: 'var(--panel)', borderTop: '1px solid var(--edge)' }}>
                    <span style={{ font: '700 9.5px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                      {KIND_TITLE[kind]}
                    </span>
                  </div>
                  {group.map((o, i) => (
                    <OutcomeRow key={`${kind}-${i}`} o={o} />
                  ))}
                </div>
              );
            })}
          </div>

          {/* self-tests */}
          <div style={{ marginTop: 30 }}>
            <Kicker color="var(--signal)">Self-honesty foils</Kicker>
          </div>
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            {critic.selfTests.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, border: '1px solid var(--edge)', borderRadius: 10, padding: '14px 16px', background: 'var(--panel)' }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 18,
                    flex: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    font: '800 11px/1 var(--sans)',
                    color: 'var(--surface)',
                    background: t.caught ? 'var(--green)' : 'var(--red)',
                    marginTop: 1,
                  }}
                >
                  {t.caught ? '✓' : '✕'}
                </span>
                <div>
                  <div style={{ font: '700 12.5px/1.3 var(--sans)', color: 'var(--ink)' }}>{t.name}</div>
                  <div style={{ marginTop: 4, font: '400 12px/1.5 var(--sans)', color: 'var(--ink-3)' }}>{t.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 34 }}>
        <Link href="/workbench" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: '600 12.5px/1 var(--sans)', color: 'var(--signal)' }}>
          <span aria-hidden style={{ font: '600 13px/1 var(--mono)' }}>←</span>
          Back to the workbench
        </Link>
      </div>
    </div>
  );
}

const KIND_TITLE: Record<(typeof KIND_ORDER)[number], string> = {
  genuine: 'Genuine flags — the critic must confirm',
  'over-fire': 'Over-fired flags on the clean case — the critic must veto (green)',
  underpowered: 'Underpowered split — the critic must downgrade',
};

// The outcome carries no kind, so group by the case shape the harness encodes in
// the label. Genuine and over-fire are disjoint by their label suffix.
function groupByKind(
  outcomes: CriticFindingOutcome[],
  kind: (typeof KIND_ORDER)[number],
): CriticFindingOutcome[] {
  return outcomes.filter((o) => {
    if (kind === 'over-fire') return o.label.includes('over-fired');
    if (kind === 'underpowered') return o.label.includes('underpowered');
    return !o.label.includes('over-fired') && !o.label.includes('underpowered');
  });
}
