import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ComputeResult,
  EngineResult,
  CheckResult,
  Scenario,
  Chart,
  PreviewArtifact,
  CHECK_IDS,
  checkMeta,
} from '@redline/contracts';
import type { ScenarioId, CheckId, AnyCheckConfig, StatReadout } from '@redline/contracts';
import {
  curatedNarrative,
  assembleReport,
  buildBundle,
  reasoningLines,
  SCENARIOS,
  DEFAULT_CONFIG,
  DEFAULT_SCENARIO,
  defaultConfigFor,
} from './index.js';
// The compute seam (fixture + remote targets) is server-only — it touches
// child_process/fetch — so it lives in ./server, not the client-safe ./index.
import { fixtureTarget, getComputeTarget, RemoteTarget } from './server.js';

const ket = defaultConfigFor('ketamine');
const mar = defaultConfigFor('marson');

function run(scenarioId: ScenarioId, checkId: CheckId, config: AnyCheckConfig) {
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

describe('rigor checks 5 to 8 (both scenarios carry them)', () => {
  it('marson check 5: 412 raw hits, 23 survive BH', async () => {
    const c = await run('marson', 5, mar[5]);
    expect(c.state).toBe('flagged');
    if (c.chart.kind !== 'fdr') throw new Error('unreachable');
    expect(c.chart.rawHits).toBe(412);
    expect(c.chart.adjustedHits).toBe(23);
    expect(c.chart.tests).toBe(2000);
  });

  it('marson check 6: separable phase covariate, effect crosses alpha once modeled', async () => {
    const c = await run('marson', 6, mar[6]);
    expect(c.state).toBe('flagged');
    if (c.chart.kind !== 'significance') throw new Error('unreachable');
    expect(c.chart.naive.sig).toBe(true);
    expect(c.chart.honest.sig).toBe(false);
    expect(stat(c.stats, 'phase vs condition')).toContain('0.31');
  });

  it('marson check 7: chosen 1.0 sits outside the supported window, flagged', async () => {
    const c = await run('marson', 7, mar[7]);
    expect(c.state).toBe('flagged');
    if (c.chart.kind !== 'fragility') throw new Error('unreachable');
    expect(c.chart.chosen).toBe(1.0);
    expect(c.chart.supported).toEqual([0.4, 0.8]);
  });

  it('marson check 8: t-test on raw counts, overdispersion flagged', async () => {
    const c = await run('marson', 8, mar[8]);
    expect(c.state).toBe('flagged');
    expect(stat(c.stats, 'Overdispersion')).toContain('6.2');
  });

  it('ketamine check 7 is CLEAN: chosen 0.6 inside the supported window', async () => {
    const c = await run('ketamine', 7, ket[7]);
    expect(c.state).toBe('clean');
    if (c.chart.kind !== 'fragility') throw new Error('unreachable');
    expect(c.chart.chosen).toBe(0.6);
    expect(c.chart.supported).toEqual([0.4, 0.8]);
    // never cry wolf: a clean rigor check carries no correction payload.
    expect(c.correctedCode).toBeUndefined();
    expect(c.recommendations).toBeUndefined();
    expect(c.preview).toBeUndefined();
  });
});

describe('the correction seam holds for every registered check', () => {
  it('every check id has a fixture in both scenarios that parses as EngineResult', async () => {
    for (const sid of ['marson', 'ketamine'] as ScenarioId[]) {
      const cfg = defaultConfigFor(sid);
      for (const id of CHECK_IDS) {
        const r = await run(sid, id, cfg[id]);
        expect(r.checkId).toBe(id);
        expect(() => EngineResult.parse(r)).not.toThrow();
        expect(() => ComputeResult.parse(r)).not.toThrow();
        expect(() => Chart.parse(r.chart)).not.toThrow();
      }
    }
  });

  it('a flagged finding carries corrected code, at least one recommendation, and a preview', async () => {
    for (const sid of ['marson', 'ketamine'] as ScenarioId[]) {
      const cfg = defaultConfigFor(sid);
      for (const id of CHECK_IDS) {
        const r = await run(sid, id, cfg[id]);
        if (r.state === 'flagged') {
          expect(r.correctedCode, `check ${id} on ${sid} correctedCode`).toBeDefined();
          expect((r.recommendations ?? []).length).toBeGreaterThanOrEqual(1);
          expect(r.preview, `check ${id} on ${sid} preview`).toBeDefined();
        }
        if (r.state === 'clean') {
          expect(r.correctedCode).toBeUndefined();
          expect(r.recommendations).toBeUndefined();
          expect(r.preview).toBeUndefined();
        }
      }
    }
  });

  it("corrected code params carry the scenario's real field names (Case B generality)", async () => {
    const m = await run('marson', 1, mar[1]);
    const k = await run('ketamine', 1, ket[1]);
    expect(m.correctedCode?.params.unit).toBe('donor_id');
    expect(m.correctedCode?.params.gene).toBe('FOXP3');
    expect(k.correctedCode?.params.unit).toBe('mouse_id');
    expect(k.correctedCode?.params.gene).toBe('Bdnf');
    // Same template, different injected params: the emitted scripts differ.
    expect(m.correctedCode?.inline).not.toBe(k.correctedCode?.inline);
  });

  it('Case A and Case B recommendations differ (the generality test)', async () => {
    const m = await run('marson', 5, mar[5]);
    const k = await run('ketamine', 5, ket[5]);
    expect(JSON.stringify(m.recommendations)).not.toBe(JSON.stringify(k.recommendations));
  });

  it('every corrected script prints a REDLINE_RESULT line and reads --h5ad', async () => {
    for (const sid of ['marson', 'ketamine'] as ScenarioId[]) {
      const cfg = defaultConfigFor(sid);
      for (const id of CHECK_IDS) {
        const r = await run(sid, id, cfg[id]);
        if (!r.correctedCode) continue;
        expect(r.correctedCode.inline).toContain('REDLINE_RESULT');
        expect(r.correctedCode.inline).toContain('--h5ad');
        expect(r.correctedCode.entrypoint).toContain('--h5ad');
      }
    }
  });
});

describe('the unsalvageable invariant (structural, not a hope)', () => {
  it('PreviewArtifact rejects an unsalvageable finding that carries an after chart', () => {
    const someChart = {
      kind: 'confound' as const,
      grid: { rows: ['a'], cols: ['b'], cells: [[1]] },
      cramersV: 1,
      verified: true,
    };
    const bad = {
      methodLabel: 'fabricated fix',
      unsalvageable: true,
      before: someChart,
      after: someChart, // an unsalvageable finding must NOT carry a corrected artifact
    };
    expect(() => PreviewArtifact.parse(bad)).toThrow();
  });

  it('marson check 4 is unsalvageable: recommendation feasibility and null preview', async () => {
    const c = await run('marson', 4, mar[4]);
    expect(c.state).toBe('flagged');
    expect((c.recommendations ?? []).some((r) => r.feasibility === 'unsalvageable')).toBe(true);
    expect(c.preview?.unsalvageable).toBe(true);
    expect(c.preview?.after).toBeNull();
  });
});

describe('the preview is the output of the corrected analysis (no faked preview)', () => {
  // For a significance-backed DE finding (checks 1, 6, 8) the fix-and-preview
  // volcano must BE the honest re-test: the claimed gene sits at the naive stat
  // before and the honest stat after, matching the evidence chart exactly. A
  // preview that drifts from the reported number is the fake this layer exists
  // to stop.
  for (const sid of ['marson', 'ketamine'] as ScenarioId[]) {
    for (const id of [1, 6, 8] as CheckId[]) {
      it(`${sid} check ${id}: claimed gene tracks naive -> honest in the preview`, async () => {
        const cfg = defaultConfigFor(sid);
        const r = await run(sid, id, cfg[id]);
        expect(r.state).toBe('flagged');
        if (r.chart.kind !== 'significance') throw new Error('expected a significance chart');
        const before = r.preview?.before;
        const after = r.preview?.after;
        if (before?.kind !== 'volcano' || after?.kind !== 'volcano') {
          throw new Error('expected a before/after volcano preview');
        }
        const cb = before.points.find((p) => p.claimed);
        const ca = after.points.find((p) => p.claimed);
        expect(cb, 'a claimed gene in before').toBeDefined();
        expect(ca, 'a claimed gene in after').toBeDefined();
        expect(ca?.gene).toBe(cb?.gene);
        // before == the naive stat; after == the honest stat; both exactly.
        expect(cb?.negLog10P).toBeCloseTo(r.chart.naive.log10p, 9);
        expect(cb?.sig).toBe(r.chart.naive.sig);
        expect(ca?.negLog10P).toBeCloseTo(r.chart.honest.log10p, 9);
        expect(ca?.sig).toBe(r.chart.honest.sig);
        // and the honest log10p really is -log10 of the reported honest p, so the
        // stat, the chart, and the preview cannot quietly disagree.
        expect(Math.pow(10, -r.chart.honest.log10p)).toBeCloseTo(r.chart.honest.p, 2);
      });
    }
  }

  it('check 5: a claimed gene is significant after BH iff the FDR table keeps it', async () => {
    for (const sid of ['marson', 'ketamine'] as ScenarioId[]) {
      const cfg = defaultConfigFor(sid);
      const r = await run(sid, 5, cfg[5]);
      if (r.chart.kind !== 'fdr') throw new Error('expected an fdr chart');
      const after = r.preview?.after;
      if (after?.kind !== 'volcano') throw new Error('expected a volcano preview');
      const claimed = after.points.filter((p) => p.claimed);
      expect(claimed.length).toBeGreaterThan(0);
      for (const p of claimed) {
        const row = r.chart.top.find((g) => g.gene === p.gene);
        expect(row, `claimed gene ${p.gene} present in fdr.top`).toBeDefined();
        expect(p.sig).toBe(row?.survives);
      }
    }
  });

  it('an unsalvageable finding shows no corrected number anywhere', async () => {
    const c = await run('marson', 4, mar[4]);
    expect(c.preview?.unsalvageable).toBe(true);
    expect(c.preview?.after).toBeNull();
    // the corrected volcano/number lives only in `after`, which is null, so there
    // is no corrected figure to render for the dead end.
    expect(c.preview?.before.kind).not.toBe('volcano');
  });
});

describe('Case B generality: no cross-scenario field leakage in the correction payload', () => {
  // Tokens unique to ONE scenario. Shared field names (condition, leiden,
  // cell_barcode, n_genes, pct_mito) are deliberately excluded: they are not
  // distinguishing, and either scenario may legitimately name them.
  const MARSON_ONLY = ['donor', 'lane', 'IL2RA', 'FOXP3', 'guide_batch', 'guide_id', 'IKZF2', 'Effector', 'non-targeting', 'knockdown'];
  const KETAMINE_ONLY = ['mouse', 'litter_id', 'seq_batch', 'Bdnf', 'ketamine', 'saline', 'Responder', 'Homeostatic', 'microglia', 'Xist', 'Ddx3y'];

  function correctionText(r: Awaited<ReturnType<typeof run>>): string {
    return JSON.stringify({
      correctedCode: r.correctedCode,
      recommendations: r.recommendations,
      preview: r.preview,
    });
  }

  it('a ketamine finding never names a marson-only field, and vice versa', async () => {
    for (const id of CHECK_IDS) {
      const k = correctionText(await run('ketamine', id, ket[id]));
      for (const tok of MARSON_ONLY) {
        expect(k.includes(tok), `ketamine check ${id} leaked "${tok}"`).toBe(false);
      }
      const m = correctionText(await run('marson', id, mar[id]));
      for (const tok of KETAMINE_ONLY) {
        expect(m.includes(tok), `marson check ${id} leaked "${tok}"`).toBe(false);
      }
    }
  });

  it('each scenario names its own unit field in the corrected code', async () => {
    expect(JSON.stringify((await run('marson', 1, mar[1])).correctedCode)).toContain('donor_id');
    expect(JSON.stringify((await run('ketamine', 1, ket[1])).correctedCode)).toContain('mouse_id');
  });
});

describe('the corrected notebook is valid nbformat 4', () => {
  async function marsonBundle() {
    const results = [];
    for (const id of CHECK_IDS) {
      const compute = await run('marson', id, mar[id]);
      results.push(CheckResult.parse({ ...compute, ...curatedNarrative('marson', id, mar[id]) }));
    }
    return buildBundle(assembleReport(SCENARIOS.marson.dataset, results), SCENARIOS.marson.dataset);
  }

  it('satisfies the nbformat 4 cell structure Jupyter requires', async () => {
    const nb = JSON.parse((await marsonBundle()).notebook) as {
      nbformat: number;
      nbformat_minor: number;
      cells: Array<Record<string, unknown>>;
      metadata: unknown;
    };
    expect(nb.nbformat).toBe(4);
    expect(Number.isInteger(nb.nbformat_minor)).toBe(true);
    expect(Array.isArray(nb.cells)).toBe(true);
    expect(nb.metadata && typeof nb.metadata).toBe('object');
    for (const cell of nb.cells) {
      expect(['markdown', 'code']).toContain(cell.cell_type);
      expect(Array.isArray(cell.source)).toBe(true);
      expect((cell.source as unknown[]).every((s) => typeof s === 'string')).toBe(true);
      if (cell.cell_type === 'code') {
        // nbformat 4 requires both keys on a code cell.
        expect('execution_count' in cell).toBe(true);
        expect(Array.isArray(cell.outputs)).toBe(true);
      } else {
        // a markdown cell must carry neither.
        expect('execution_count' in cell).toBe(false);
        expect('outputs' in cell).toBe(false);
      }
    }
  });

  it('declares a minor version whose schema the emitted cells satisfy', async () => {
    // nbformat 4.5 makes a per-cell `id` mandatory. Either the notebook declares
    // minor < 5, or every cell carries a non-empty id; otherwise nbformat.validate
    // rejects it with one "'id' is a required property" per cell. (Verified with
    // the real nbformat 5.10 validator: minor 5 -> 16 errors, minor 4 -> 0.)
    const nb = JSON.parse((await marsonBundle()).notebook) as {
      nbformat_minor: number;
      cells: Array<{ id?: unknown }>;
    };
    const everyCellHasId = nb.cells.every(
      (c) => typeof c.id === 'string' && c.id.length > 0,
    );
    expect(nb.nbformat_minor < 5 || everyCellHasId).toBe(true);
  });
});

describe('contract conformance', () => {
  it('both scenarios validate as Scenario', () => {
    expect(() => Scenario.parse(SCENARIOS.marson)).not.toThrow();
    expect(() => Scenario.parse(SCENARIOS.ketamine)).not.toThrow();
  });

  it('every (scenario, check) merges into a valid CheckResult', async () => {
    for (const sid of ['marson', 'ketamine'] as ScenarioId[]) {
      const cfg = defaultConfigFor(sid);
      for (const id of CHECK_IDS) {
        const compute = await run(sid, id, cfg[id]);
        const narrative = curatedNarrative(sid, id, cfg[id]);
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

  it('assembleReport counts states and never says "of 4"', async () => {
    const results = [];
    for (const id of CHECK_IDS) {
      const compute = await run('marson', id, mar[id]);
      results.push(CheckResult.parse({ ...compute, ...curatedNarrative('marson', id, mar[id]) }));
    }
    const report = assembleReport(SCENARIOS.marson.dataset, results);
    expect(report.flagged).toBe(8);
    expect(report.clean).toBe(0);
    expect(report.needInput).toBe(0);
    expect(report.verdict).not.toContain('of 4');
    expect(report.verdict).not.toContain('four');
    expect(report.verdict).toContain('8 checks flagged');
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

  it('marson prose carries no em dash (voice rule), across all eight checks', async () => {
    const cases: Array<{ id: CheckId; config: AnyCheckConfig }> = [
      { id: 1, config: mar[1] },
      { id: 1, config: { ...mar[1], unit: 'cell_barcode' } },
      { id: 1, config: { ...mar[1], unit: 'guide_batch' } },
      { id: 2, config: mar[2] },
      { id: 2, config: { ...mar[2], split: 0.1 } },
      { id: 3, config: mar[3] },
      { id: 3, config: { ...mar[3], track: 'Naive' } },
      { id: 4, config: mar[4] },
      { id: 4, config: { ...mar[4], nuisance: [] } },
      { id: 5, config: mar[5] },
      { id: 6, config: mar[6] },
      { id: 7, config: mar[7] },
      { id: 8, config: mar[8] },
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

describe('buildBundle - the artifact that outlasts the week', () => {
  async function marsonReport() {
    const results = [];
    for (const id of CHECK_IDS) {
      const compute = await run('marson', id, mar[id]);
      results.push(CheckResult.parse({ ...compute, ...curatedNarrative('marson', id, mar[id]) }));
    }
    return assembleReport(SCENARIOS.marson.dataset, results);
  }

  it('emits one script per flagged finding and skips clean findings', async () => {
    const report = await marsonReport();
    const bundle = buildBundle(report, SCENARIOS.marson.dataset);
    const flaggedCount = report.results.filter((r) => r.state === 'flagged').length;
    expect(bundle.scripts.length).toBe(flaggedCount);
    expect(bundle.scripts.length).toBe(8);
  });

  it('the notebook has no code cell for the unsalvageable finding', async () => {
    const report = await marsonReport();
    const bundle = buildBundle(report, SCENARIOS.marson.dataset);
    const nb = JSON.parse(bundle.notebook) as { nbformat: number; cells: Array<{ cell_type: string; source: string[] }> };
    expect(nb.nbformat).toBe(4);
    const codeCells = nb.cells.filter((c) => c.cell_type === 'code');
    const unsalvageable = report.results.filter((r) => r.preview?.unsalvageable === true).length;
    const flagged = report.results.filter((r) => r.state === 'flagged').length;
    expect(unsalvageable).toBe(1);
    // one code cell per flagged finding EXCEPT the unsalvageable one.
    expect(codeCells.length).toBe(flagged - unsalvageable);
    // the unsalvageable finding still gets a markdown cell that says so.
    const md = nb.cells.filter((c) => c.cell_type === 'markdown').map((c) => c.source.join('')).join('\n');
    expect(md).toContain('cannot be rescued');
  });

  it('the README names the dataset and the honest verdict', async () => {
    const report = await marsonReport();
    const bundle = buildBundle(report, SCENARIOS.marson.dataset);
    expect(bundle.readme).toContain(SCENARIOS.marson.dataset.file);
    expect(bundle.readme).toContain(checkMeta(1).name);
  });
});

describe('compute-target honesty', () => {
  it('getComputeTarget defaults to the fixture', () => {
    vi.stubEnv('REDLINE_COMPUTE_TARGET', '');
    const t = getComputeTarget();
    expect(t.id).toBe('fixture');
    expect(t.available).toBe(true);
  });

  it('the fixture target returns a preview for a flagged finding and null for a clean one', async () => {
    const flagged = await fixtureTarget.preview?.({
      scenarioId: 'marson',
      checkId: 1,
      config: mar[1],
      fields: SCENARIOS.marson.fields,
    });
    expect(flagged).not.toBeNull();
    const clean = await fixtureTarget.preview?.({
      scenarioId: 'ketamine',
      checkId: 7,
      config: ket[7],
      fields: SCENARIOS.ketamine.fields,
    });
    expect(clean).toBeNull();
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
