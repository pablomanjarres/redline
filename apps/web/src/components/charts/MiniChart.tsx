import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C, stateColor } from '@redline/ui';
import { keyer } from './svg';

/**
 * The card thumbnail: a small, clean glyph per check, tinted by the verdict
 * color. Miniatures of the full figures (bars, dumbbell, presence strip, 2x2
 * grid), read from the result union. No hand-drawn marks.
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
    // two bars on a baseline with a dashed alpha rule: tall reported, short honest
    add(<line x1={54} y1={82} x2={156} y2={82} stroke={C.line2} strokeWidth={1} />);
    add(<line x1={54} y1={40} x2={156} y2={40} stroke={C.line2} strokeWidth={1} strokeDasharray="3 3" />);
    add(<rect x={74} y={20} width={22} height={62} rx={3} fill={col} />);
    add(<rect x={116} y={70} width={22} height={12} rx={3} fill={C.ink} />);
    return wrap(els);
  }

  if (checkId === 2) {
    // dumbbell rows: discovery (ink) to held-out (verdict), collapsing left
    for (let i = 0; i < 4; i++) {
      const y = 22 + i * 17;
      add(<line x1={78} y1={y} x2={150} y2={y} stroke={C.line2} strokeWidth={1.5} strokeLinecap="round" />);
      add(<circle cx={150} cy={y} r={3.5} fill={C.ink} />);
      add(<circle cx={78} cy={y} r={3.5} fill="#fff" stroke={col} strokeWidth={2} />);
    }
    add(<line x1={70} y1={14} x2={70} y2={86} stroke={C.line2} strokeWidth={1} strokeDasharray="3 3" />);
    return wrap(els);
  }

  if (checkId === 3) {
    const fragile = result.chart.kind === 'fragility' ? result.chart.steps.some((s) => !s.present) : false;
    const stability = result.chart.kind === 'fragility' ? result.chart.stability : 0;
    for (let i = 0; i < 8; i++) {
      const x = 26 + i * 20;
      const on = fragile ? i >= 3 && i <= 5 : true;
      add(<rect x={x} y={28} width={15} height={24} rx={3} fill={on ? col : C.panel2} stroke={on ? 'none' : C.line2} strokeWidth={1} />);
    }
    add(<rect x={26} y={66} width={149} height={7} rx={3.5} fill={C.panel2} stroke={C.line2} strokeWidth={1} />);
    add(<rect x={26} y={66} width={Math.max(4, 149 * stability)} height={7} rx={3.5} fill={col} />);
    return wrap(els);
  }

  // 2x2 contingency grid; occupied diagonal ringed when confounded
  const ox = 76;
  const oy = 20;
  const s = 30;
  const verified = result.chart.kind === 'confound' ? result.chart.verified : false;
  for (let r = 0; r < 2; r++) {
    for (let cc = 0; cc < 2; cc++) {
      const f = r === cc;
      add(<rect x={ox + cc * s} y={oy + r * s} width={s - 5} height={s - 5} rx={3} fill={f ? C.ink : C.panel2} stroke={f ? 'none' : C.line2} strokeWidth={1} strokeDasharray={f ? '0' : '3 3'} />);
      if (f && verified) {
        add(<rect x={ox + cc * s - 2} y={oy + r * s - 2} width={s - 1} height={s - 1} rx={4} fill="none" stroke={col} strokeWidth={1.75} />);
      }
    }
  }
  return wrap(els);
}
