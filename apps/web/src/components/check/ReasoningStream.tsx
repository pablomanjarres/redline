'use client';

/**
 * The streaming reasoning panel. `lines` is the already-revealed slice (the
 * session reveals one line every ~165ms while a check runs); `running` shows the
 * "live" tag and the blinking caret. Static and quiet once the run resolves.
 */
export function ReasoningStream({ lines, running }: { lines: string[]; running: boolean }) {
  return (
    <div
      style={{
        marginTop: 16,
        background: 'var(--panel)',
        border: '1px solid var(--line2)',
        borderRadius: 13,
        padding: '18px 22px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            font: '600 10.5px/1 var(--mono)',
            letterSpacing: '.14em',
            color: 'var(--ink3)',
            textTransform: 'uppercase',
          }}
        >
          Redline&apos;s reasoning
        </span>
        {running ? (
          <span style={{ font: '500 10.5px/1 var(--mono)', color: 'var(--accent)' }}>live</span>
        ) : null}
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 11 }}>
        {lines.map((t, i) => (
          <div
            key={i}
            style={{ display: 'flex', gap: 11, animation: 'rl-rise .3s ease both' }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                flex: 'none',
                marginTop: 6,
                background: running && i === lines.length - 1 ? 'var(--accent)' : 'var(--ink4)',
              }}
            />
            <span style={{ font: '400 13.5px/1.45 var(--serif)', color: 'var(--ink2)' }}>{t}</span>
          </div>
        ))}
        {running ? (
          <span
            style={{
              width: 8,
              height: 15,
              background: 'var(--accent)',
              animation: 'rl-blink .9s steps(1) infinite',
              marginLeft: 16,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
