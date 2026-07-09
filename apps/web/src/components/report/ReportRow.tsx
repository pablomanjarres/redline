import type { CheckResult } from '@redline/contracts';
import { checkMeta } from '@redline/contracts';
import { signalColor, stateLabel } from '@redline/ui';
import { DistributionStrip, MiniChart } from '@/components/charts';
import { ciLabel } from '@/lib/format';

/**
 * One finding on the audit sheet, in the dark instrument language. A
 * signal-colored rule down the left edge marks the verdict; the check number
 * and name sit up top with a verdict chip; the figure lives on a bright
 * lightbox plate (the only white on the surface); then the named failure mode
 * in mono red, the scientist's claim struck through, the defensible rewrite
 * behind the redline caret, and the method citation footer.
 */
export function ReportRow({ result }: { result: CheckResult }) {
  const { checkId, state, error, original, corrected, missing, citation } = result;
  const light = signalColor(state);
  const meta = checkMeta(checkId);
  const num = checkId < 10 ? `0${checkId}` : String(checkId);

  return (
    <article
      data-testid={`report-row-${checkId}`}
      data-tour={`report.row.${checkId}`}
      aria-label={`Check ${num} ${meta.name}, ${stateLabel(state)}`}
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--edge)',
        borderLeft: `3px solid ${light}`,
        borderRadius: 12,
        padding: '20px 24px',
      }}
    >
      {/* header: number · name · verdict chip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ font: '600 12px/1 var(--mono)', color: 'var(--ink-4)', flex: 'none' }}>{num}</span>
        <span style={{ font: '700 17px/1.15 var(--sans)', letterSpacing: '-.01em', color: 'var(--ink)' }}>{meta.name}</span>
        <span
          style={{
            marginLeft: 'auto',
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            font: '700 10.5px/1 var(--sans)',
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: light,
            border: `1px solid ${light}`,
            background: `color-mix(in srgb, ${light} 12%, transparent)`,
            padding: '7px 11px',
            borderRadius: 8,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 7, background: light, boxShadow: `0 0 8px ${light}`, flex: 'none' }} />
          {stateLabel(state)}
        </span>
      </div>

      {/* body: lightbox figure + verdict readout */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, marginTop: 18, alignItems: 'flex-start' }}>
        {/* lightbox plate: the one bright surface */}
        <div style={{ width: 236, flex: 'none', borderRadius: 14, background: 'var(--plate)', boxShadow: 'var(--plate-glow)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 13px', borderBottom: '1px solid var(--plate-line)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: light, flex: 'none' }} />
            <span style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: '#8792a3' }}>Fig {num}</span>
          </div>
          <div style={{ padding: '14px 16px', height: 132, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MiniChart checkId={checkId} result={result} />
          </div>
        </div>

        {/* verdict content */}
        <div style={{ flex: 1, minWidth: 260 }}>
          {error && <div style={{ font: '600 13px/1.45 var(--mono)', color: 'var(--red)' }}>{error}</div>}

          {original && (
            <p
              style={{
                margin: error ? '11px 0 0' : 0,
                font: '400 16px/1.5 var(--sans)',
                color: 'var(--ink-4)',
                textDecoration: 'line-through',
                textDecorationColor: 'var(--red)',
                textDecorationThickness: 2,
              }}
            >
              {original}
            </p>
          )}

          <p style={{ margin: error || original ? '11px 0 0' : 0, font: '400 16px/1.55 var(--sans)', color: 'var(--ink)', display: 'flex', gap: 10 }}>
            <span style={{ color: 'var(--red)', fontWeight: 800, flex: 'none' }} aria-hidden>
              ▸
            </span>
            <span>{corrected}</span>
          </p>

          {/* confidence intervals: the repeated-run distribution behind a stat */}
          {result.stats.some((s) => s.interval) && (
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
              {result.stats
                .filter((s) => s.interval)
                .map((s, i) => (
                  <div key={i} style={{ minWidth: 148 }}>
                    <div style={{ font: '400 9px/1.2 var(--mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{s.label}</div>
                    <div style={{ marginTop: 4, font: '600 13px/1.3 var(--mono)', color: s.bad ? 'var(--red)' : s.good ? 'var(--green)' : 'var(--ink-2)' }}>
                      {s.value} <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>{ciLabel(s.interval!, s.value)}</span>
                    </div>
                    <div style={{ marginTop: 5, width: 148 }}>
                      <DistributionStrip iv={s.interval!} height={18} accent={s.bad ? 'var(--red)' : s.good ? 'var(--green)' : 'var(--ink-3)'} />
                    </div>
                    <div style={{ marginTop: 3, font: '400 8.5px/1.3 var(--mono)', color: 'var(--ink-4)' }}>{s.interval!.n} runs</div>
                  </div>
                ))}
            </div>
          )}

          {missing && (
            <div
              style={{
                marginTop: 15,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--amber-soft)',
                border: '1px solid color-mix(in srgb, var(--amber) 32%, transparent)',
                borderRadius: 8,
                padding: '9px 12px',
              }}
            >
              <span style={{ font: '700 9px/1 var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--amber)', flex: 'none' }}>Missing</span>
              <span style={{ font: '500 12.5px/1.4 var(--sans)', color: 'var(--ink-2)' }}>{missing}</span>
            </div>
          )}

          {/* method citation footer */}
          <div style={{ marginTop: 16, paddingTop: 13, borderTop: '1px solid var(--edge)', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <span style={{ font: '700 9px/1 var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)', flex: 'none', marginTop: 2 }}>Method</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: '600 12.5px/1.45 var(--mono)', color: 'var(--ink-2)' }}>
                {citation.url ? (
                  <a href={citation.url} target="_blank" rel="noreferrer" style={{ color: 'var(--signal)' }}>
                    {citation.authors} ({citation.year}) · {citation.venue}
                  </a>
                ) : (
                  <>
                    {citation.authors} ({citation.year}) · {citation.venue}
                  </>
                )}
              </div>
              <div style={{ marginTop: 4, font: '400 12.5px/1.5 var(--sans)', color: 'var(--ink-3)' }}>{citation.note}</div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
