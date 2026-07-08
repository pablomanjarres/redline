import type { ReactElement } from 'react';
import type * as RC from '@redline/contracts';
import { C } from '@redline/ui';
import { Svg, txt, keyer, fSans, fMono, RL_ANIM } from './svg';

/**
 * Check 3 (clustering fragility). Ported from `Redline.dc.html` `chartFrag`: a
 * row of presence tiles across a resolution sweep, the operator's blue scrub
 * playhead (driven by `cfg.scrub`), and a live scatter at the scrubbed
 * resolution. Whether the tracked group is fragile is read from the data (it is
 * absent at some sampled resolution), never from a hardcoded group name: a
 * fragile group draws the red "appears only here" band and dissolves in the
 * scatter outside its band; a stable group stays green and present throughout.
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
  const { add, els } = keyer();

  const x0 = 64;
  const x1 = 596;
  const span = cfg.max - cfg.min || 1;
  const RX = (r: number): number => x0 + ((r - cfg.min) / span) * (x1 - x0);
  const ty = 70;
  const th = 30;

  add(
    txt(64, 44, `Is the ‘${track}’ group a discrete cluster at this resolution?`, {
      fill: C.ink2,
      style: { font: fSans(500, 11) },
    }),
  );
  const tw = steps.length > 1 ? RX(steps[1].r) - RX(steps[0].r) - 6 : 26;
  steps.forEach((s) => {
    const x = RX(s.r) - tw / 2;
    add(
      <rect
        x={x}
        y={ty}
        width={tw}
        height={th}
        rx={4}
        fill={s.present ? (fragile ? C.ink : C.pass) : C.panel3}
        stroke={s.present ? 'none' : '#DDD8CC'}
        strokeWidth={1}
      />,
    );
    if (s.present) {
      add(txt(x + tw / 2, ty + 20, '✓', { textAnchor: 'middle', fill: '#fff', style: { font: fSans(600, 13) } }));
    }
    add(txt(RX(s.r), ty + th + 16, s.r.toFixed(1), { textAnchor: 'middle', fill: C.ink4, style: { font: fMono(500, 9) } }));
  });
  add(txt(600, 44, 'resolution →', { textAnchor: 'end', fill: C.ink4, style: { font: fMono(500, 10) } }));

  // fragile band bracket (only when the group appears and vanishes)
  if (fragile) {
    const bx0 = RX(c.present[0]) - tw / 2 - 4;
    const bx1b = RX(c.present[1]) + tw / 2 + 4;
    add(
      <rect
        x={bx0}
        y={ty - 8}
        width={bx1b - bx0}
        height={th + 16}
        rx={6}
        fill="none"
        stroke={C.red}
        strokeWidth={2}
        strokeDasharray={400}
        strokeDashoffset={400}
        className={RL_ANIM}
        style={{ animation: 'rl-draw .8s .2s ease forwards' }}
      />,
    );
    add(txt((bx0 + bx1b) / 2, ty - 16, 'appears only here', { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 11) } }));
  }

  // scrub playhead (blue = the operator's control)
  const px = RX(Math.min(cfg.max, Math.max(cfg.min, cfg.scrub)));
  add(<line x1={px} y1={ty - 24} x2={px} y2={ty + th + 24} stroke={C.accent} strokeWidth={2} />);
  add(<circle cx={px} cy={ty - 24} r={4} fill={C.accent} />);

  // scatter: live view at the scrubbed resolution
  const sy = 180;
  const present = cfg.scrub >= c.present[0] - 1e-9 && cfg.scrub <= c.present[1] + 1e-9;
  add(txt(64, sy - 8, `View at resolution ${cfg.scrub.toFixed(2)}`, { fill: C.ink2, style: { font: fSans(500, 11) } }));
  add(<rect x={64} y={sy} width={532} height={150} rx={10} fill={C.frame} stroke={C.line} strokeWidth={1} />);
  const blobs: [number, number][] = [
    [150, 255],
    [300, 255],
    [450, 255],
  ];
  blobs.forEach((b, bi) => {
    for (let i = 0; i < 22; i++) {
      add(<circle cx={b[0] + Math.sin(i * 2.3 + bi) * 34} cy={b[1] + Math.cos(i * 1.7 + bi) * 38} r={2.4} fill="#C8C3B6" />);
    }
  });
  if (fragile) {
    if (present) {
      for (let i = 0; i < 20; i++) {
        add(<circle cx={300 + Math.sin(i * 1.9) * 20} cy={230 + Math.cos(i * 2.1) * 20} r={2.6} fill={C.ink} />);
      }
      add(<ellipse cx={300} cy={230} rx={30} ry={28} fill="none" stroke={C.ink} strokeWidth={1.5} />);
      add(txt(300, 300, `${track} · present`, { textAnchor: 'middle', fill: C.ink, style: { font: fSans(600, 11) } }));
    } else {
      add(txt(300, 300, `${track} · dissolved into neighbours`, { textAnchor: 'middle', fill: C.redDeep, style: { font: fSans(600, 11) } }));
    }
  } else {
    for (let i = 0; i < 24; i++) {
      add(<circle cx={300 + Math.sin(i * 1.9) * 44} cy={255 + Math.cos(i * 2.1) * 40} r={2.6} fill={C.pass} />);
    }
    add(txt(300, 300, `${track} · present`, { textAnchor: 'middle', fill: C.pass, style: { font: fSans(600, 11) } }));
  }

  return <Svg label={`Resolution sweep for the ${track} cluster`}>{els}</Svg>;
}
