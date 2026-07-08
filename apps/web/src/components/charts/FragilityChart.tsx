import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono } from './svg';

/**
 * Check 3 (clustering fragility), as clean data-viz. A presence strip across the
 * resolution sweep (a filled cell where the tracked group is a discrete cluster,
 * empty where it dissolves), the operator's scrub playhead, and a small scatter
 * of the clustering at the scrubbed resolution. Fragility is read from the data
 * (the group is absent at some setting), never a hardcoded name: a fragile group
 * gets a shaded present-band; a stable group stays filled throughout.
 */
export function FragilityChart({
  chart,
  cfg,
}: {
  chart: RC.FragilityChart;
  cfg: RC.Check3Config;
}): ReactElement {
  const c = chart;
  const steps = c.steps;
  const track = c.track;
  const fragile = steps.some((s) => !s.present);
  const on = fragile ? C.ink : C.pass;
  const { add, els } = keyer();

  const x0 = 64;
  const x1 = 588;
  const span = cfg.max - cfg.min || 1;
  const RX = (r: number): number => x0 + ((r - cfg.min) / span) * (x1 - x0);
  const ty = 78;
  const th = 30;
  const tw = steps.length > 1 ? Math.min(34, RX(steps[1]!.r) - RX(steps[0]!.r) - 8) : 26;

  add(txt(64, 44, `Is ‘${track}’ a discrete cluster across the resolution sweep?`, { fill: C.ink3, style: { font: fSans(600, 11) } }));
  add(txt(588, 44, 'resolution →', { textAnchor: 'end', fill: C.ink4, style: { font: fMono(500, 10) } }));

  // shaded present-band (only when fragile: the narrow window it exists in)
  if (fragile) {
    const bx0 = RX(c.present[0]) - tw / 2 - 5;
    const bx1b = RX(c.present[1]) + tw / 2 + 5;
    add(<rect x={bx0} y={ty - 10} width={bx1b - bx0} height={th + 20} rx={7} fill={C.red} opacity={0.06} />);
    add(<text x={(bx0 + bx1b) / 2} y={ty - 16} textAnchor="middle" fill={C.redDeep} style={{ font: fSans(600, 10.5) }}>present only here</text>);
  }

  // presence tiles
  steps.forEach((s) => {
    const x = RX(s.r) - tw / 2;
    add(<rect x={x} y={ty} width={tw} height={th} rx={5} fill={s.present ? on : C.panel2} stroke={s.present ? 'none' : C.line2} strokeWidth={1} />);
    add(txt(RX(s.r), ty + th + 15, s.r.toFixed(1), { textAnchor: 'middle', fill: C.ink4, style: { font: fMono(400, 9) } }));
  });

  // scrub playhead (indigo = the operator's control)
  const px = RX(Math.min(cfg.max, Math.max(cfg.min, cfg.scrub)));
  add(<line x1={px} y1={ty - 22} x2={px} y2={ty + th + 22} stroke={C.accent} strokeWidth={2} />);
  add(<circle cx={px} cy={ty - 22} r={4} fill={C.accent} />);

  // scatter: the clustering at the scrubbed resolution
  const sy = 168;
  const present = cfg.scrub >= c.present[0] - 1e-9 && cfg.scrub <= c.present[1] + 1e-9;
  add(txt(64, sy - 8, `Clustering at resolution ${cfg.scrub.toFixed(2)}`, { fill: C.ink3, style: { font: fSans(600, 11) } }));
  add(<rect x={64} y={sy} width={524} height={150} rx={10} fill={C.frame} stroke={C.line} strokeWidth={1} />);
  const centers: [number, number][] = [
    [176, 250],
    [326, 232],
    [476, 250],
  ];
  centers.forEach(([bx, by], bi) => {
    for (let i = 0; i < 26; i++) {
      const a = i * 2.399963 + bi;
      const rr = 6 + (i % 7) * 5.4;
      add(<circle cx={bx + Math.cos(a) * rr} cy={by + Math.sin(a) * rr * 0.7} r={2.4} fill={C.line2} />);
    }
  });
  if (fragile && present) {
    for (let i = 0; i < 22; i++) {
      const a = i * 2.399963;
      const rr = 4 + (i % 6) * 3.6;
      add(<circle cx={326 + Math.cos(a) * rr} cy={210 + Math.sin(a) * rr} r={2.6} fill={C.ink} />);
    }
    add(<circle cx={326} cy={210} r={30} fill="none" stroke={C.ink} strokeWidth={1.5} />);
    add(txt(326, 300, `${track} · present`, { textAnchor: 'middle', fill: C.ink, style: { font: fSans(600, 11) } }));
  } else if (fragile) {
    add(txt(326, 300, `${track} · dissolved into neighbours`, { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 11) } }));
  } else {
    centers.forEach(([bx, by], bi) => {
      for (let i = 0; i < 20; i++) {
        const a = i * 2.399963 + bi;
        const rr = 5 + (i % 6) * 4.2;
        add(<circle cx={bx + Math.cos(a) * rr} cy={by + Math.sin(a) * rr * 0.7} r={2.4} fill={C.pass} />);
      }
    });
    add(txt(326, 300, `${track} · present at every setting`, { textAnchor: 'middle', fill: C.pass, style: { font: fSans(600, 11) } }));
  }

  return <Svg vb="0 0 620 336" label={`Resolution sweep for the ${track} cluster`}>{els}</Svg>;
}
