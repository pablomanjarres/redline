import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C, stateColor } from '@redline/ui';
import { keyer } from './svg';

/**
 * The card thumbnail: a small, clean glyph per finding, tinted by the verdict
 * color. Miniatures of the full figures, read from the chart union and switched
 * on `chart.kind` (the real discriminator), so a new chart kind slots in here
 * without a per-check branch. No hand-drawn marks.
 */
export function MiniChart({
  checkId,
  result,
}: {
  checkId: RC.CheckId;
  result: RC.CheckResult;
}): ReactElement {
  const col = stateColor(result.state);
  const chart = result.chart;
  const { add, els } = keyer();
  const wrap = (kids: ReactElement[]): ReactElement => (
    <svg viewBox="0 0 210 96" width="100%" height="100%" style={{ display: 'block' }} role="img" aria-label={`Check ${checkId} result thumbnail`}>
      {kids}
    </svg>
  );

  if (chart.kind === 'significance' || chart.kind === 'hardstop') {
    // two bars on a baseline with a dashed alpha rule: tall reported, short honest
    add(<line x1={54} y1={82} x2={156} y2={82} stroke={C.line2} strokeWidth={1} />);
    add(<line x1={54} y1={40} x2={156} y2={40} stroke={C.line2} strokeWidth={1} strokeDasharray="3 3" />);
    add(<rect x={74} y={20} width={22} height={62} rx={3} fill={col} />);
    add(<rect x={116} y={70} width={22} height={12} rx={3} fill={C.ink} />);
    return wrap(els);
  }

  if (chart.kind === 'groups') {
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

  if (chart.kind === 'fragility') {
    const fragile = chart.steps.some((s) => !s.present);
    const stability = chart.stability;
    for (let i = 0; i < 8; i++) {
      const x = 26 + i * 20;
      const on = fragile ? i >= 3 && i <= 5 : true;
      add(<rect x={x} y={28} width={15} height={24} rx={3} fill={on ? col : C.panel2} stroke={on ? 'none' : C.line2} strokeWidth={1} />);
    }
    add(<rect x={26} y={66} width={149} height={7} rx={3.5} fill={C.panel2} stroke={C.line2} strokeWidth={1} />);
    add(<rect x={26} y={66} width={Math.max(4, 149 * stability)} height={7} rx={3.5} fill={col} />);
    return wrap(els);
  }

  if (chart.kind === 'volcano') {
    // a cloud with a threshold cross; survivors and claimed points in verdict color
    add(<line x1={105} y1={12} x2={105} y2={84} stroke={C.line2} strokeWidth={1} strokeDasharray="3 3" />);
    add(<line x1={30} y1={40} x2={180} y2={40} stroke={C.line2} strokeWidth={1} strokeDasharray="3 3" />);
    for (let i = 0; i < 26; i++) {
      const a = i * 2.399963;
      const rr = 8 + (i % 7) * 4.4;
      const x = 105 + Math.cos(a) * rr;
      const y = 50 + Math.sin(a) * rr * 0.5;
      add(<circle cx={x} cy={y} r={1.8} fill={C.line2} />);
    }
    const sig = chart.points.filter((p) => p.sig).slice(0, 6);
    sig.forEach((p, i) => {
      const x = 128 + (i % 3) * 16 + (p.log2fc < 0 ? -60 : 0);
      const y = 22 + Math.floor(i / 3) * 12;
      add(<circle cx={x} cy={y} r={3} fill={col} />);
    });
    return wrap(els);
  }

  if (chart.kind === 'fdr') {
    // two bars: raw hits (verdict) beside surviving hits (ink)
    const maxV = Math.max(chart.rawHits, 1);
    const hRaw = Math.max(6, (chart.rawHits / maxV) * 60);
    const hAdj = Math.max(4, (chart.adjustedHits / maxV) * 60);
    add(<line x1={54} y1={80} x2={156} y2={80} stroke={C.line2} strokeWidth={1} />);
    add(<rect x={74} y={80 - hRaw} width={22} height={hRaw} rx={3} fill={col} />);
    add(<rect x={116} y={80 - hAdj} width={22} height={hAdj} rx={3} fill={C.ink} />);
    return wrap(els);
  }

  // confound: 2x2 contingency grid; occupied diagonal ringed when confounded
  const ox = 76;
  const oy = 20;
  const s = 30;
  const verified = chart.kind === 'confound' ? chart.verified : false;
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
