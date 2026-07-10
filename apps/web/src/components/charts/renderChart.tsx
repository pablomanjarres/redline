import type { ReactNode } from 'react';
import type { Chart, Check3Config } from '@redline/contracts';
import { SignificanceChart } from './SignificanceChart';
import { GroupsChart } from './GroupsChart';
import { FragilityChart } from './FragilityChart';
import { ConfoundChart } from './ConfoundChart';
import { VolcanoChart } from './VolcanoChart';
import { FdrChart } from './FdrChart';

/**
 * One dispatcher over the chart union, so the check stage, the before/after
 * preview, and anything else that renders a `Chart` all draw it the same way.
 * The discriminant is `chart.kind`, the real discriminator, never the check id.
 *
 * The fragility chart needs a Check3Config for the scrub playhead. On the check
 * panel the live config is passed in; a preview chart or a check-7 sweep carries
 * no live scrub, so a config is synthesized from the chart's own range with the
 * playhead parked on the chosen (or present) resolution.
 */
export function renderChart(chart: Chart, cfg3?: Check3Config): ReactNode {
  switch (chart.kind) {
    case 'significance':
    case 'hardstop':
      return <SignificanceChart chart={chart} />;
    case 'groups':
      return <GroupsChart chart={chart} />;
    case 'fragility':
      return <FragilityChart chart={chart} cfg={cfg3 ?? fallbackCfg3(chart)} />;
    case 'confound':
      return <ConfoundChart chart={chart} />;
    case 'volcano':
      return <VolcanoChart chart={chart} />;
    case 'fdr':
      return <FdrChart chart={chart} />;
    default:
      return null;
  }
}

function fallbackCfg3(chart: Extract<Chart, { kind: 'fragility' }>): Check3Config {
  const rs = chart.steps.map((s) => s.r);
  const min = rs.length ? Math.min(...rs) : 0.2;
  const max = rs.length ? Math.max(...rs) : 2;
  const step = chart.steps.length > 1 ? Number((chart.steps[1]!.r - chart.steps[0]!.r).toFixed(3)) : 0.2;
  const scrub = chart.chosen ?? (chart.present[0] + chart.present[1]) / 2;
  return { min, max, step: step || 0.2, track: chart.track, scrub };
}
