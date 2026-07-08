import type { ReactElement } from 'react';
import type { Interval } from '@redline/contracts';

/**
 * A small distribution strip: the per-run samples as faint ticks, the confidence
 * interval as a translucent band, and the median as a solid mark. It makes the
 * spread of a repeated stochastic check legible at a glance, so a held-out AUC or
 * a stability fraction reads as a distribution, not one point. Static (no motion),
 * and it carries the interval in its aria-label for a screen reader.
 */
export function DistributionStrip({
  iv,
  accent = 'var(--ink-3)',
  domain,
  height = 24,
  ariaLabel,
}: {
  iv: Interval;
  accent?: string;
  domain?: [number, number];
  height?: number;
  ariaLabel?: string;
}): ReactElement {
  const W = 140;
  const H = height;
  const pad = 3;
  const samples = iv.samples && iv.samples.length ? iv.samples : [iv.lo, iv.median, iv.hi];
  const lo = domain ? domain[0] : Math.min(iv.lo, ...samples);
  const hi = domain ? domain[1] : Math.max(iv.hi, ...samples);
  const span = hi - lo || 1;
  const X = (v: number): number => pad + ((v - lo) / span) * (W - 2 * pad);
  const midY = H / 2;
  const label =
    ariaLabel ??
    `Distribution: median ${iv.median}, ${Math.round(iv.level * 100)} percent interval ${iv.lo} to ${iv.hi}, over ${iv.n} runs.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label} style={{ display: 'block' }}>
      <line x1={pad} y1={midY} x2={W - pad} y2={midY} stroke="var(--edge)" strokeWidth={1} />
      <rect
        x={X(iv.lo)}
        y={midY - 5}
        width={Math.max(1, X(iv.hi) - X(iv.lo))}
        height={10}
        rx={3}
        fill={accent}
        opacity={0.16}
      />
      {samples.map((s, i) => (
        <line key={i} x1={X(s)} y1={midY - 6} x2={X(s)} y2={midY + 6} stroke={accent} strokeWidth={1} opacity={0.28} />
      ))}
      <line x1={X(iv.median)} y1={midY - 8} x2={X(iv.median)} y2={midY + 8} stroke={accent} strokeWidth={2} />
    </svg>
  );
}
