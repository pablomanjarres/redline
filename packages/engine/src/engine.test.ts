import { describe, it, expect, vi, afterEach } from 'vitest';
import { ComputeResult, CheckResult, Scenario, Chart } from '@redline/contracts';
import type {
  ScenarioId,
  CheckId,
  Check1Config,
  Check2Config,
  Check3Config,
  Check4Config,
  StatReadout,
} from '@redline/contracts';
import {
  curatedNarrative,
  assembleReport,
  reasoningLines,
  SCENARIOS,
  DEFAULT_CONFIG,
  DEFAULT_SCENARIO,
  defaultConfigFor,
} from './index.js';
// The compute seam (fixture + remote targets) is server-only — it touches
// child_process/fetch — so it lives in ./server, not the client-safe ./index.
import { fixtureTarget, getComputeTarget, RemoteTarget } from './server.js';

type AnyConfig = Check1Config | Check2Config | Check3Config | Check4Config;

const ket = defaultConfigFor('ketamine');
const mar = defaultConfigFor('marson');

function run(scenarioId: ScenarioId, checkId: CheckId, config: AnyConfig) {
  return fixtureTarget.computeCheck({
    scenarioId,
    checkId,
    config,
    fields: SCENARIOS[scenarioId].fields,
  });
}

function stat(stats: StatReadout[], label: string): string | undefined {
  return stats.find((s) => s.label === label)?.value;
}

afterEach(() => vi.unstubAllEnvs());

describe('ketamine - locked reference numbers', () => {
  it('check 1 default: p 3.1e-9 collapses to honest 0.34, flagged', async () => {
    const c = await run('ketamine', 1, ket[1]);
    expect(c.state).toBe('flagged');
    expect(c.chart.kind).toBe('significance');
    if (c.chart.kind !== 'significance') throw new Error('unreachable');
    expect(c.chart.naive.p).toBe(3.1e-9);
    expect(c.chart.naive.sig).toBe(true);
    expect(c.chart.honest.p).toBe(0.34);
    expect(c.chart.honest.sig).toBe(false);
    expect(c.chart.honest.n).toBe(6);
    expect(c.chart.badUnit).toBe(false);
    expect(stat(c.stats, 'Original p')).toBe('3.1×10⁻⁹');
    expect(stat(c.stats, 'Honest p (mouse-level)')).toBe('0.34');
  });

  it('check 1 cell_barcode: bad unit, counts cells', async () => {
    const c = await run('ketamine', 1, { ...ket[1], unit: 'cell_barcode' });
    expect(c.state).toBe('flagged');
    expect(c.headline).toContain('counting cells');
    if (c.chart.kind !== 'significance') throw new Error('unreachable');
    expect(c.chart.badUnit).toBe(true);
  });

  it('check 1 litter_id: hard stop, 2 units / 1 per group', async () => {
    const c = await run('ketamine', 1, { ...ket[1], unit: 'litter_id' });
    expect(c.state).toBe('hard_stop');
    expect(c.chart.kind).toBe('hardstop');
    if (c.chart.kind !== 'hardstop') throw new Error('unreachable');
    expect(c.chart.units).toBe(2);
    expect(c.chart.perGroup).toBe(1);
    expect(c.chart.profiles).toHaveLength(6);
  });

  it('check 2 default: discovery AUC 0.90 vs held-out 0.58, 0/4, flagged', async () => {
    const c = await run('ketamine', 2, ket[2]);
    expect(c.state).toBe('flagged');
    if (c.chart.kind !== 'groups') throw new Error('unreachable');
    expect(c.chart.discAUC).toBe(0.9);
    expect(c.chart.holdAUC).toBe(0.58);
    expect(c.chart.verified).toBe(true);
    expect(stat(c.stats, 'Discovery AUC')).toBe('0.90');
    expect(stat(c.stats, 'Held-out AUC')).toBe('0.58');
    expect(stat(c.stats, 'Markers holding')).toBe('0 / 4');
  });

  it('check 2 below 15% split: flag_only, not verified', async () => {
    const c = await run('ketamine', 2, { ...ket[2], split: 0.1 });
    expect(c.state).toBe('flag_only');
    if (c.chart.kind !== 'groups') throw new Error('unreachable');
    expect(c.chart.verified).toBe(false);
  });

  it('check 3 Responder: fragile, flagged at 30% stability', async () => {
    const c = await run('ketamine', 3, ket[3]);
    expect(c.state).toBe('flagged');
    if (c.chart.kind !== 'fragility') throw new Error('unreachable');
    expect(c.chart.stability).toBeCloseTo(0.3, 10);
    expect(stat(c.stats, 'Stability')).toBe('30%');
  });

  it('check 3 stable group: clean at 100%', async () => {
    const c = await run('ketamine', 3, { ...ket[3], track: 'Homeostatic' });
    expect(c.state).toBe('clean');
    if (c.chart.kind !== 'fragility') throw new Error('unreachable');
    expect(c.chart.stability).toBeCloseTo(1, 10);
    expect(stat(c.stats, 'Stability')).toBe('100%');
  });

  it('check 4 seq_batch: Cramér V 1.00, flagged', async () => {
    const c = await run('ketamine', 4, ket[4]);
    expect(c.state).toBe('flagged');
    if (c.chart.kind !== 'confound') throw new Error('unreachable');
    expect(c.chart.cramersV).toBe(1);
    expect(stat(c.stats, "Cramér's V")).toBe('1.00');
  });

  it('check 4 no nuisance: flag_only, Cramér V unassessed', async () => {
    const c = await run('ketamine', 4, { ...ket[4], nuisance: [] });
    expect(c.state).toBe('flag_only');
    if (c.chart.kind !== 'confound') throw new Error('unreachable');
    expect(c.chart.cramersV).toBeNull();
  });
});

describe('marson - hero default (naive foil)', () => {
  it('is the default scenario and DEFAULT_CONFIG', () => {
    expect(DEFAULT_SCENARIO).toBe('marson');
    expect(DEFAULT_CONFIG).toEqual(mar);
    expect(SCENARIOS.marson.dataset.replicateLabel).toBe('donors');
    expect(SCENARIOS.marson.dataset.replicates).toBe(4);
  });

  it('check 1 collapses to non-significant across the 4 donors', async () => {
    const c = await run('marson', 1, mar[1]);
    expect(c.state).toBe('flagged');
    if (c.chart.kind !== 'significance') throw new Error('unreachable');
    expect(c.chart.naive.sig).toBe(true);
    expect(c.chart.naive.p).toBe(6.2e-11);
    expect(c.chart.honest.sig).toBe(false);
    expect(c.chart.honest.p).toBe(0.21);
    expect(c.chart.honest.n).toBe(4);
    expect(c.chart.units).toHaveLength(4);
    expect(stat(c.stats, 'Honest p (donor-level)')).toBe('0.21');
    expect(stat(c.stats, 'True n')).toBe('4 donors');
  });

  it('check 1 guide_batch: hard stop (n=1/group)', async () => {
    const c = await run('marson', 1, { ...mar[1], unit: 'guide_batch' });
    expect(c.state).toBe('hard_stop');
    if (c.chart.kind !== 'hardstop') throw new Error('unreachable');
    expect(c.chart.units).toBe(2);
    expect(c.chart.perGroup).toBe(1);
  });

  it('check 2: discovery 0.90 vs held-out 0.57, 0/4 survive', async () => {
    const c = await run('marson', 2, mar[2]);
    expect(c.state).toBe('flagged');
    if (c.chart.kind !== 'groups') throw new Error('unreachable');
    expect(c.chart.discAUC).toBe(0.9);
    expect(c.chart.holdAUC).toBe(0.57);
    expect(stat(c.stats, 'Markers holding')).toBe('0 / 4');
    expect(c.chart.markers.map((m) => m.gene)).toEqual(['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4']);
  });

  it('check 3: Effector flagged, Naive clean', async () => {
    const flagged = await run('marson', 3, mar[3]);
    expect(flagged.state).toBe('flagged');
    const clean = await run('marson', 3, { ...mar[3], track: 'Naive' });
    expect(clean.state).toBe('clean');
  });

  it('check 4: lane confound V=1.00, excluded -> flag_only', async () => {
    const confounded = await run('marson', 4, mar[4]);
    expect(confounded.state).toBe('flagged');
    if (confounded.chart.kind !== 'confound') throw new Error('unreachable');
    expect(confounded.chart.cramersV).toBe(1);
    const excluded = await run('marson', 4, { ...mar[4], nuisance: [] });
    expect(excluded.state).toBe('flag_only');
  });
});

describe('contract conformance', () => {
  it('both scenarios validate as Scenario', () => {
    expect(() => Scenario.parse(SCENARIOS.marson)).not.toThrow();
    expect(() => Scenario.parse(SCENARIOS.ketamine)).not.toThrow();
  });

  it('every (scenario, check) computes a valid ComputeResult that merges into a CheckResult', async () => {
    const ids: CheckId[] = [1, 2, 3, 4];
    for (const sid of ['marson', 'ketamine'] as ScenarioId[]) {
      const cfg = defaultConfigFor(sid);
      for (const id of ids) {
        const config = cfg[id];
        const compute = await run(sid, id, config);
        expect(compute.checkId).toBe(id);
        expect(() => ComputeResult.parse(compute)).not.toThrow();
        expect(() => Chart.parse(compute.chart)).not.toThrow();
        const narrative = curatedNarrative(sid, id, config);
        expect(() => CheckResult.parse({ ...compute, ...narrative })).not.toThrow();
      }
    }
  });
});

describe('narrative, reasoning, and report', () => {
  it('curatedNarrative slices prose that matches the numbers', () => {
    const n = curatedNarrative('marson', 1, mar[1]);
    expect(n.citation.authors).toBe('Squair et al.');
    expect(n.citation.url).toMatch(/^https:\/\//);
    expect(n.error).toContain('pseudoreplication');
    expect(n.corrected).toContain('donor');
  });

  it('reasoningLines infers the scenario from the config', () => {
    expect(reasoningLines(1, mar[1]).join(' ')).toContain('non-targeting');
    expect(reasoningLines(1, ket[1]).join(' ')).toContain('ketamine');
    // explicit scenario overrides inference
    expect(reasoningLines(1, ket[1], 'marson').join(' ')).toContain('IL2RA');
  });

  it('assembleReport counts states and writes a concrete verdict', async () => {
    const ids: CheckId[] = [1, 2, 3, 4];
    const results = [];
    for (const id of ids) {
      const compute = await run('marson', id, mar[id]);
      results.push(CheckResult.parse({ ...compute, ...curatedNarrative('marson', id, mar[id]) }));
    }
    const report = assembleReport(SCENARIOS.marson.dataset, results);
    expect(report.flagged).toBe(4);
    expect(report.clean).toBe(0);
    expect(report.needInput).toBe(0);
    expect(report.verdict).toContain('4 of 4');
  });

  it('assembleReport tallies clean and needs-input verdicts', async () => {
    const clean = await run('marson', 3, { ...mar[3], track: 'Naive' });
    const needInput = await run('marson', 2, { ...mar[2], split: 0.1 });
    const results = [
      CheckResult.parse({ ...clean, ...curatedNarrative('marson', 3, { ...mar[3], track: 'Naive' }) }),
      CheckResult.parse({
        ...needInput,
        ...curatedNarrative('marson', 2, { ...mar[2], split: 0.1 }),
      }),
    ];
    const report = assembleReport(SCENARIOS.marson.dataset, results);
    expect(report.clean).toBe(1);
    expect(report.needInput).toBe(1);
    expect(report.flagged).toBe(0);
  });

  it('marson prose carries no em dash (voice rule)', async () => {
    const cases: Array<{ id: CheckId; config: AnyConfig }> = [
      { id: 1, config: mar[1] },
      { id: 1, config: { ...mar[1], unit: 'cell_barcode' } },
      { id: 1, config: { ...mar[1], unit: 'guide_batch' } },
      { id: 2, config: mar[2] },
      { id: 2, config: { ...mar[2], split: 0.1 } },
      { id: 3, config: mar[3] },
      { id: 3, config: { ...mar[3], track: 'Naive' } },
      { id: 4, config: mar[4] },
      { id: 4, config: { ...mar[4], nuisance: [] } },
    ];
    const parts: string[] = [JSON.stringify(SCENARIOS.marson)];
    for (const { id, config } of cases) {
      parts.push(JSON.stringify(await run('marson', id, config)));
      parts.push(JSON.stringify(curatedNarrative('marson', id, config)));
      parts.push(reasoningLines(id, config, 'marson').join(' '));
    }
    expect(parts.join(' ')).not.toContain('—');
  });
});

describe('compute-target honesty', () => {
  it('getComputeTarget defaults to the fixture', () => {
    vi.stubEnv('REDLINE_COMPUTE_TARGET', '');
    const t = getComputeTarget();
    expect(t.id).toBe('fixture');
    expect(t.available).toBe(true);
  });

  it('an unwired remote target reports available: false', () => {
    vi.stubEnv('REDLINE_ENGINE_CMD', '');
    vi.stubEnv('REDLINE_CLOUDRUN_URL', '');
    vi.stubEnv('REDLINE_ENDPOINT_URL', '');
    expect(new RemoteTarget('local').available).toBe(false);
    expect(new RemoteTarget('cloudrun').available).toBe(false);
    expect(new RemoteTarget('endpoint').available).toBe(false);
  });

  it('getComputeTarget falls back to the fixture when the remote is unwired', () => {
    vi.stubEnv('REDLINE_COMPUTE_TARGET', 'cloudrun');
    vi.stubEnv('REDLINE_CLOUDRUN_URL', '');
    expect(getComputeTarget().id).toBe('fixture');
  });

  it('an unavailable remote target refuses to compute (no fake control)', async () => {
    vi.stubEnv('REDLINE_ENGINE_CMD', '');
    const remote = new RemoteTarget('local');
    await expect(
      remote.computeCheck({ scenarioId: 'marson', checkId: 1, config: mar[1], fields: SCENARIOS.marson.fields }),
    ).rejects.toThrow();
  });
});
