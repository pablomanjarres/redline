import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C, stateColor } from '@redline/ui';
import { keyer } from './svg';

/**
 * The card thumbnail. Ported from `Redline.dc.html` `buildMini`: a compact
 * glyph per check, tinted by the verdict color. The two data-driven glyphs read
 * the check's chart off the result union: check 3 lights the middle presence
 * tiles and a stability meter when the tracked group is fragile (absent at some
 * sampled resolution); check 4 traces the confound diagonal once verified.
 */
export function MiniChart({
  checkId,
  result,
}: {
  checkId: 1 | 2 | 3 | 4;
  result: RC.CheckResult;
}): ReactElement {
  const col = stateColor(result.state);
  const { add, els } = keyer();
  const wrap = (kids: ReactElement[]): ReactElement => (
    <svg viewBox="0 0 210 96" width="100%" height="100%" style={{ display: 'block' }} role="img" aria-label={`Check ${checkId} result thumbnail`}>
      {kids}
    </svg>
  );

  if (checkId === 1) {
    add(<rect x={70} y={16} width={26} height={64} rx={2} fill="#ECE9E0" stroke={C.line2} />);
    add(<line x1={66} y1={26} x2={100} y2={18} stroke={C.red} strokeWidth={2.4} strokeLinecap="round" />);
    add(<rect x={116} y={66} width={26} height={14} rx={2} fill={C.ink} />);
    add(<line x1={60} y1={80} x2={158} y2={80} stroke={C.line2} />);
    return wrap(els);
  }

  if (checkId === 2) {
    for (let i = 0; i < 4; i++) {
      const y = 20 + i * 18;
      add(<line x1={70} y1={y} x2={150} y2={y} stroke={C.line2} strokeWidth={1.5} />);
      add(<circle cx={150} cy={y} r={3.5} fill={C.ink} />);
      add(<circle cx={78} cy={y} r={3.5} fill="#fff" stroke={col} strokeWidth={2} />);
    }
    return wrap(els);
  }

  if (checkId === 3) {
    const fragile = result.chart.kind === 'fragility' ? result.chart.steps.some((s) => !s.present) : false;
    const stability = result.chart.kind === 'fragility' ? result.chart.stability : 0;
    for (let i = 0; i < 8; i++) {
      const x = 30 + i * 20;
      const on = fragile ? i >= 3 && i <= 5 : true;
      add(<rect x={x} y={30} width={15} height={22} rx={3} fill={on ? col : C.panel3} stroke={on ? 'none' : '#DDD8CC'} />);
    }
    add(<rect x={30} y={64} width={150 * stability} height={8} rx={4} fill={col} />);
    add(<rect x={30} y={64} width={150} height={8} rx={4} fill="none" stroke="#DDD8CC" />);
    return wrap(els);
  }

  const ox = 78;
  const oy = 18;
  const s = 30;
  for (let r = 0; r < 2; r++) {
    for (let cc = 0; cc < 2; cc++) {
      const f = r === cc;
      add(
        <rect
          x={ox + cc * s}
          y={oy + r * s}
          width={s - 5}
          height={s - 5}
          rx={3}
          fill={f ? C.ink : C.panel2}
          stroke={f ? 'none' : '#DDD8CC'}
          strokeDasharray={f ? '0' : '3 3'}
        />,
      );
    }
  }
  const verified = result.chart.kind === 'confound' ? result.chart.verified : false;
  if (verified) {
    add(
      <path
        d={`M${ox} ${oy} C ${ox + s} ${oy + s * 0.4}, ${ox + s} ${oy + s}, ${ox + 2 * s - 6} ${oy + 2 * s - 8}`}
        fill="none"
        stroke={C.red}
        strokeWidth={2}
        strokeLinecap="round"
      />,
    );
  }
  return wrap(els);
}
