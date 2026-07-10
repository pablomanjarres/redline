import { describe, it, expect } from 'vitest';
import { DatasetInventory, enforceClaimHonesty } from '@redline/contracts';
import type { DatasetInventory as DatasetInventoryT, ExtractedClaim } from '@redline/contracts';
import {
  MARSON_INVENTORY,
  KETAMINE_INVENTORY,
  MARSON_CLAIMS,
  KETAMINE_CLAIMS,
  SCENARIOS,
  extractionLines,
} from './index.js';
// The compute seam is server-only (child_process / fetch), so it comes from
// ./server, not the client-safe ./index.
import { fixtureTarget, createRemoteTarget } from './server.js';

/** Every gene the inventory knows, lowercased (matches inventoryKnowsGene). */
function genesOf(inv: DatasetInventoryT): Set<string> {
  const s = new Set<string>();
  for (const g of inv.varNamesSample) s.add(g.toLowerCase());
  for (const u of inv.uns) for (const g of u.genes) s.add(g.toLowerCase());
  return s;
}

function obsNames(inv: DatasetInventoryT): string[] {
  return inv.obs.map((c) => c.name);
}

describe('dataset inventories', () => {
  it('DatasetInventory.parse succeeds for both scenarios', () => {
    expect(() => DatasetInventory.parse(MARSON_INVENTORY)).not.toThrow();
    expect(() => DatasetInventory.parse(KETAMINE_INVENTORY)).not.toThrow();
  });

  it('the inventory cell and gene counts match the fixture DatasetMeta', () => {
    expect(MARSON_INVENTORY.nCells).toBe(SCENARIOS.marson.dataset.cells);
    expect(MARSON_INVENTORY.nGenes).toBe(SCENARIOS.marson.dataset.genes);
    expect(KETAMINE_INVENTORY.nCells).toBe(SCENARIOS.ketamine.dataset.cells);
    expect(KETAMINE_INVENTORY.nGenes).toBe(SCENARIOS.ketamine.dataset.genes);
  });

  // The anti-faking guard. If the two datasets shared genes, a hardcoded
  // extractor that always emitted one scenario's claims could pass on the other.
  it('the two inventories share zero genes', () => {
    const m = genesOf(MARSON_INVENTORY);
    const k = genesOf(KETAMINE_INVENTORY);
    const shared = [...m].filter((g) => k.has(g));
    expect(shared).toEqual([]);
  });

  // Every distinctive column (the unit, the technical nuisance, and the
  // scenario-specific fields) is unique to one dataset. The only columns the two
  // may share are the generic scRNA-seq fields both datasets genuinely carry, so
  // forcing them apart would make an inventory contradict its own resolved
  // fields. See the header note in inventories.ts.
  it('each scenario keeps its distinctive obs columns; overlap is generic only', () => {
    const m = new Set(obsNames(MARSON_INVENTORY));
    const k = new Set(obsNames(KETAMINE_INVENTORY));

    const marsonOnly = ['donor_id', 'lane', 'guide_id', 'phase'];
    const ketamineOnly = ['mouse_id', 'seq_batch', 'sex'];
    for (const c of marsonOnly) {
      expect(m.has(c)).toBe(true);
      expect(k.has(c)).toBe(false);
    }
    for (const c of ketamineOnly) {
      expect(k.has(c)).toBe(true);
      expect(m.has(c)).toBe(false);
    }

    const generic = new Set(['condition', 'cell_barcode', 'n_genes', 'pct_mito', 'leiden']);
    const overlap = [...m].filter((c) => k.has(c));
    for (const c of overlap) expect(generic.has(c)).toBe(true);
  });

  it('every resolved field appears as an obs column in its scenario inventory', () => {
    for (const f of SCENARIOS.marson.fields) {
      expect(obsNames(MARSON_INVENTORY)).toContain(f.id);
    }
    for (const f of SCENARIOS.ketamine.fields) {
      expect(obsNames(KETAMINE_INVENTORY)).toContain(f.id);
    }
  });
});

describe('curated extracted claims', () => {
  it('every extracted claim survives the honesty backstop unchanged against its own inventory', () => {
    expect(enforceClaimHonesty(MARSON_INVENTORY, MARSON_CLAIMS)).toEqual(MARSON_CLAIMS);
    expect(enforceClaimHonesty(KETAMINE_INVENTORY, KETAMINE_CLAIMS)).toEqual(KETAMINE_CLAIMS);
  });

  it('the marson out-of-scope claim carries no checks', () => {
    const oos = MARSON_CLAIMS.find((c: ExtractedClaim) => c.status === 'out_of_scope');
    expect(oos).toBeDefined();
    expect(oos?.checks.length).toBe(0);
  });

  it('the marson claims reproduce the worked example fan-out', () => {
    const routed = (id: string) => {
      const claim = MARSON_CLAIMS.find((c) => c.id === id);
      return (claim?.checks ?? []).map((r) => r.check).sort();
    };
    expect(routed('marson-foxp3-significance')).toEqual([1, 4]);
    expect(routed('marson-activated-treg-state')).toEqual([2, 3]);
    expect(routed('marson-effector-state')).toEqual([3]);
  });

  // The direct anti-faking test. Feed one scenario's claims through the other's
  // inventory: the cited genes and distinctive columns are absent, so the
  // backstop must alter them (drop routes, demote confidence). A faked extractor
  // is caught here.
  it('a faked extractor is caught: cross-dataset claims do not survive unchanged', () => {
    expect(enforceClaimHonesty(KETAMINE_INVENTORY, MARSON_CLAIMS)).not.toEqual(MARSON_CLAIMS);
    expect(enforceClaimHonesty(MARSON_INVENTORY, KETAMINE_CLAIMS)).not.toEqual(KETAMINE_CLAIMS);
  });

  it('the scenarios expose their inventory and extracted claims', () => {
    expect(SCENARIOS.marson.inventory).toEqual(MARSON_INVENTORY);
    expect(SCENARIOS.marson.extractedClaims).toEqual(MARSON_CLAIMS);
    expect(SCENARIOS.ketamine.inventory).toEqual(KETAMINE_INVENTORY);
    expect(SCENARIOS.ketamine.extractedClaims).toEqual(KETAMINE_CLAIMS);
  });
});

describe('the inspect seam', () => {
  it('the fixture target inspect() returns the scenario inventory', async () => {
    expect(await fixtureTarget.inspect({ scenarioId: 'marson' })).toEqual(MARSON_INVENTORY);
    expect(await fixtureTarget.inspect({ scenarioId: 'ketamine' })).toEqual(KETAMINE_INVENTORY);
  });

  it('an unwired remote target reports available: false, so the fixture stays in charge', () => {
    expect(createRemoteTarget('local').available).toBe(false);
    expect(createRemoteTarget('cloudrun').available).toBe(false);
    expect(createRemoteTarget('endpoint').available).toBe(false);
  });
});

describe('extraction stream copy', () => {
  it('names three auditable claims for each scenario and stays em-dash free', () => {
    for (const sid of ['marson', 'ketamine'] as const) {
      const lines = extractionLines(sid);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes('3 auditable claims'))).toBe(true);
      for (const l of lines) expect(l.includes('\u2014')).toBe(false);
    }
  });
});
