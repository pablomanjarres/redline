'use client';

/**
 * The reasoning console: Redline's thinking as a terminal log. `lines` is the
 * already-revealed slice (the session streams one line at a time while a check
 * runs); a blinking cursor and a LIVE light show while it runs.
 */
export function ReasoningConsole({ lines, running }: { lines: string[]; running: boolean }) {
  return (
    <section data-tour="check.reasoning" style={{ background: 'var(--void)', border: '1px solid var(--edge)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--edge)', background: 'var(--panel)' }}>
        <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', color: 'var(--ink)' }}>REASONING</span>
        {running && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)', animation: 'rl-pulse 1s infinite' }} />
            <span style={{ font: '600 9px/1 var(--mono)', letterSpacing: '.16em', color: 'var(--signal)' }}>LIVE</span>
          </span>
        )}
      </div>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9, minHeight: 92 }}>
        {lines.length === 0 && !running && (
          <span style={{ font: '400 11.5px/1.5 var(--mono)', color: 'var(--ink-4)' }}>Awaiting run.</span>
        )}
        {lines.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 9, animation: 'rl-rise .3s ease both' }}>
            <span style={{ font: '600 11.5px/1.55 var(--mono)', color: running && i === lines.length - 1 ? 'var(--signal)' : 'var(--ink-4)', flex: 'none' }}>›</span>
            <span style={{ font: '400 11.5px/1.55 var(--mono)', color: 'var(--ink-2)' }}>{t}</span>
          </div>
        ))}
        {running && <span style={{ width: 8, height: 14, background: 'var(--signal)', animation: 'rl-blink .9s steps(1) infinite', marginLeft: 18 }} />}
      </div>
    </section>
  );
}
