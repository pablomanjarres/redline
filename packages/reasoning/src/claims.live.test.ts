import { beforeAll, describe, expect, it } from 'vitest';
import { enforceClaimHonesty, inventoryHasField, inventoryKnowsGene } from '@redline/contracts';
import type {
  DatasetInventory,
  ExtractedClaim,
  FieldSpec,
} from '@redline/contracts';
import { routedChecksFrom } from '@redline/engine';
import { createReasoner } from './index.js';

/**
 * The credential-gated live mirror of scripts/verify-intake.mjs (spec section 10).
 * These tests fire REAL model calls, so they run only when a reasoning backend is
 * configured. `describe.skipIf(!hasCreds)` keeps the normal `pnpm turbo test` run
 * hermetic and offline: with no backend the whole suite is skipped, never faked.
 *
 * The claim-to-check routing reducer is imported from `@redline/engine`
 * (routedChecksFrom), the same function apps/web/src/state/session.tsx uses, so a
 * drift in the reducer is caught here instead of passing silently against a local
 * copy. The fixture inventories, the resolved fields, and the marson claim set
 * stay inlined as explicit inputs to the live calls. They are faithful copies of
 * the engine values, and unlike a copied reducer they cannot make an assertion
 * pass silently, since the live model output is asserted against whatever
 * inventory the call was given.
 *
 * Run it against Bedrock:
 *   REDLINE_REASONING_BACKEND=bedrock AWS_REGION=us-east-1 \
 *     REDLINE_BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-5-20251101-v1:0 \
 *     pnpm --filter @redline/reasoning test
 */

const hasCreds =
  createReasoner().available &&
  Boolean(process.env.AWS_REGION) &&
  Boolean(process.env.REDLINE_BEDROCK_MODEL_ID);

const CALL_TIMEOUT_MS = 120_000;

// ── Inlined fixtures (faithful copies of the engine values) ────────────────────

const MARSON_INVENTORY: DatasetInventory = {
  file: 'cd4_tcell_perturbseq_subset.h5ad',
  nCells: 51842,
  nGenes: 3200,
  obs: [
    { name: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, sample: ['D1', 'D2', 'D3', 'D4'] },
    { name: 'condition', dtype: 'categorical', levels: 2, missing: 0, sample: ['IL2RA-KD', 'non-targeting'] },
    { name: 'cell_barcode', dtype: 'identifier', levels: 51842, missing: 0, sample: ['AAACCTGAGACTGTAA-1'] },
    { name: 'lane', dtype: 'categorical', levels: 2, missing: 0, sample: ['Lane-A', 'Lane-B'] },
    { name: 'guide_id', dtype: 'categorical', levels: 4, missing: 0, sample: ['IL2RA-g1', 'NT-g1'] },
    { name: 'n_genes', dtype: 'numeric', levels: null, missing: 0, sample: ['1204', '2310'] },
    { name: 'pct_mito', dtype: 'numeric', levels: null, missing: 0, sample: ['1.2', '3.8'] },
    { name: 'leiden', dtype: 'categorical', levels: 14, missing: 0, sample: ['0', '1', '2', '3'] },
    { name: 'phase', dtype: 'categorical', levels: 3, missing: 0, sample: ['G1', 'S', 'G2M'] },
  ],
  uns: [
    {
      key: 'rank_genes_groups',
      kind: 'marker_table',
      shape: '5 groups x 50 genes',
      columns: ['names', 'scores', 'logfoldchanges', 'pvals', 'pvals_adj'],
      groups: ['Naive', 'Effector', 'Activated Treg-like', 'Cytotoxic', 'Memory'],
      genes: ['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4', 'IKZF2', 'GZMB'],
      preview:
        'Stored marker table over the annotated leiden states. The Activated Treg-like state is topped by TNFRSF9, ICOS, TIGIT, and CTLA4.',
    },
    {
      key: 'de_KD_vs_NT',
      kind: 'de_result',
      shape: '3200 genes x 5',
      columns: ['names', 'logfoldchanges', 'pvals', 'pvals_adj', 'scores'],
      groups: ['IL2RA-KD', 'non-targeting'],
      genes: ['FOXP3', 'IL2RA', 'IL7R'],
      preview:
        'Stored cell-level differential expression, IL2RA knockdown versus non-targeting. FOXP3 is reported up at p = 6.2e-11.',
    },
  ],
  clusterFields: ['leiden'],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts', 'logcounts'],
  obsm: ['X_pca', 'X_umap'],
  varNamesSample: ['IL2RA', 'FOXP3', 'TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4', 'IKZF2', 'CD3D', 'CD4', 'IL7R', 'CCR7', 'GZMB'],
};

const KETAMINE_INVENTORY: DatasetInventory = {
  file: 'pfc_ketamine_scRNAseq.h5ad',
  nCells: 48213,
  nGenes: 2431,
  obs: [
    { name: 'mouse_id', dtype: 'categorical', levels: 6, missing: 0, sample: ['m1', 'm2', 'm3', 'm4'] },
    { name: 'condition', dtype: 'categorical', levels: 2, missing: 0, sample: ['ketamine', 'saline'] },
    { name: 'cell_barcode', dtype: 'identifier', levels: 48213, missing: 0, sample: ['TTGCCGTCATGC-1'] },
    { name: 'seq_batch', dtype: 'categorical', levels: 2, missing: 0, sample: ['2024-11-03', '2024-11-05'] },
    { name: 'n_genes', dtype: 'numeric', levels: null, missing: 0, sample: ['980', '2100'] },
    { name: 'pct_mito', dtype: 'numeric', levels: null, missing: 0, sample: ['0.9', '4.1'] },
    { name: 'leiden', dtype: 'categorical', levels: 12, missing: 0, sample: ['0', '1', '2', '3'] },
    { name: 'sex', dtype: 'categorical', levels: 2, missing: 0, sample: ['M', 'F'] },
  ],
  uns: [
    {
      key: 'rank_genes_groups',
      kind: 'marker_table',
      shape: '5 groups x 50 genes',
      columns: ['names', 'scores', 'logfoldchanges', 'pvals', 'pvals_adj'],
      groups: ['Homeostatic', 'Responder', 'Activated microglia', 'Interferon', 'Proliferating'],
      genes: ['Il1b', 'Tnf', 'Ccl4', 'Nfkbia', 'C1qa', 'C1qb'],
      preview:
        'Stored marker table over the annotated leiden states. The Activated microglia state is topped by Il1b, Tnf, Ccl4, and Nfkbia.',
    },
    {
      key: 'de_ket_vs_sal',
      kind: 'de_result',
      shape: '2431 genes x 5',
      columns: ['names', 'logfoldchanges', 'pvals', 'pvals_adj', 'scores'],
      groups: ['ketamine', 'saline'],
      genes: ['Bdnf', 'Fos', 'Egr1'],
      preview:
        'Stored cell-level differential expression, ketamine versus saline. Bdnf is reported up at p = 3.1e-9.',
    },
  ],
  clusterFields: ['leiden'],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts', 'logcounts'],
  obsm: ['X_pca', 'X_umap'],
  varNamesSample: ['Bdnf', 'Il1b', 'Tnf', 'Ccl4', 'Nfkbia', 'Cx3cr1', 'P2ry12', 'Tmem119', 'Aif1', 'Csf1r', 'Fos', 'Egr1'],
};

// Case C: the canonical bare inventory (mirrors services/rigor build_case_c):
// obs donor_id / condition / cell_barcode, raw counts, EMPTY uns, no cluster
// field, no notebook or prose. Nothing to audit. The genes are present, so only
// the model's honesty stops a fabricated significance claim, not the backstop.
// No cluster field on purpose: one would make an existence claim legitimately
// extractable (spec section 4), which is not fabrication.
const CASE_C_INVENTORY: DatasetInventory = {
  file: 'case_c_bare.h5ad',
  nCells: 300,
  nGenes: 80,
  obs: [
    { name: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, sample: ['S1', 'S2', 'S3', 'S4'] },
    { name: 'condition', dtype: 'categorical', levels: 2, missing: 0, sample: ['case', 'ctrl'] },
    { name: 'cell_barcode', dtype: 'identifier', levels: 300, missing: 0, sample: ['BARE0000000-1'] },
  ],
  uns: [],
  clusterFields: [],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts'],
  obsm: [],
  varNamesSample: ['g000', 'g001', 'g002', 'g003', 'g004', 'g005'],
};

const MARSON_FIELDS: FieldSpec[] = [
  { id: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, role: 'unit', confidence: 'high', reason: 'The biological replicate.' },
  { id: 'condition', dtype: 'categorical', levels: 2, missing: 0, role: 'grouping', confidence: 'high', reason: 'The contrast compared.' },
  { id: 'cell_barcode', dtype: 'identifier', levels: 51842, missing: 0, role: 'observation', confidence: 'high', reason: 'One per cell.' },
  { id: 'lane', dtype: 'categorical', levels: 2, missing: 0, role: 'nuisance', confidence: 'medium', reason: 'Technical variable aligned with condition.' },
  { id: 'guide_id', dtype: 'categorical', levels: 4, missing: 0, role: 'derived', confidence: 'medium', reason: 'CRISPR guide assignment.' },
  { id: 'n_genes', dtype: 'numeric', levels: null, missing: 0, role: 'covariate', confidence: 'high', reason: 'Per-cell quality covariate.' },
  { id: 'pct_mito', dtype: 'numeric', levels: null, missing: 0, role: 'covariate', confidence: 'high', reason: 'Per-cell quality covariate.' },
  { id: 'leiden', dtype: 'categorical', levels: 14, missing: 0, role: 'derived', confidence: 'medium', reason: 'Cluster labels.' },
  { id: 'phase', dtype: 'categorical', levels: 3, missing: 0, role: 'nuisance', confidence: 'low', reason: 'Cell-cycle phase.' },
];

const KETAMINE_FIELDS: FieldSpec[] = [
  { id: 'mouse_id', dtype: 'categorical', levels: 6, missing: 0, role: 'unit', confidence: 'high', reason: 'The biological replicate.' },
  { id: 'condition', dtype: 'categorical', levels: 2, missing: 0, role: 'grouping', confidence: 'high', reason: 'The contrast compared.' },
  { id: 'cell_barcode', dtype: 'identifier', levels: 48213, missing: 0, role: 'observation', confidence: 'high', reason: 'One per cell.' },
  { id: 'seq_batch', dtype: 'categorical', levels: 2, missing: 0, role: 'nuisance', confidence: 'medium', reason: 'Sequencing batch.' },
  { id: 'n_genes', dtype: 'numeric', levels: null, missing: 0, role: 'covariate', confidence: 'high', reason: 'Per-cell quality covariate.' },
  { id: 'pct_mito', dtype: 'numeric', levels: null, missing: 0, role: 'covariate', confidence: 'high', reason: 'Per-cell quality covariate.' },
  { id: 'leiden', dtype: 'categorical', levels: 12, missing: 0, role: 'derived', confidence: 'medium', reason: 'Cluster labels.' },
  { id: 'sex', dtype: 'categorical', levels: 2, missing: 0, role: 'nuisance', confidence: 'low', reason: 'Animal sex.' },
];

// The real section-5 fan-out, matching engine MARSON_CLAIMS ids exactly.
const MARSON_CLAIMS: ExtractedClaim[] = [
  {
    id: 'marson-foxp3-significance',
    text: 'IL2RA knockdown significantly upregulates FOXP3 across CD4 T cells (p < 0.001).',
    source: 'stored_result',
    restsOn: 'The stored differential-expression result de_KD_vs_NT on the condition field.',
    evidenceRefs: { obsColumns: ['condition', 'donor_id', 'lane'], unsKeys: ['de_KD_vs_NT'], genes: ['FOXP3'] },
    checks: [
      { check: 1, params: { grouping: 'condition', unit: 'donor_id', gene: 'FOXP3', reported: 'p = 6.2e-11' } },
      { check: 4, params: { interest: 'condition', nuisance: 'lane' } },
    ],
    confidence: 'high',
    status: 'proposed',
  },
  {
    id: 'marson-activated-treg-state',
    text: 'An activated Treg-like state defined by TNFRSF9, ICOS, TIGIT, and CTLA4, enriched under knockdown.',
    source: 'stored_result',
    restsOn: 'The stored marker table rank_genes_groups over the leiden clustering.',
    evidenceRefs: { obsColumns: ['leiden', 'condition'], unsKeys: ['rank_genes_groups'], genes: ['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4'] },
    checks: [
      { check: 2, params: { grouping: 'leiden', cluster: 'Activated Treg-like', markers: ['TNFRSF9', 'ICOS', 'TIGIT', 'CTLA4'] } },
      { check: 3, params: { cluster: 'Activated Treg-like' } },
    ],
    confidence: 'high',
    status: 'proposed',
  },
  {
    id: 'marson-effector-state',
    text: 'A distinct knockdown-responsive Effector T-cell state.',
    source: 'stored_result',
    restsOn: 'The Effector cluster in the leiden clustering.',
    evidenceRefs: { obsColumns: ['leiden'], unsKeys: [], genes: [] },
    checks: [{ check: 3, params: { cluster: 'Effector' } }],
    confidence: 'medium',
    status: 'proposed',
  },
  {
    id: 'marson-pseudotime-trajectory',
    text: 'IL2RA knockdown accelerates a pseudotime trajectory toward an exhausted state.',
    source: 'stored_result',
    restsOn: 'A diffusion-pseudotime ordering computed from the UMAP embedding.',
    evidenceRefs: { obsColumns: [], unsKeys: [], genes: [] },
    checks: [],
    confidence: 'medium',
    status: 'out_of_scope',
    outOfScopeReason: 'A pseudotime trajectory claim needs trajectory-specific validation the four checks do not provide.',
  },
];

const OUT_OF_SCOPE_PROSE = [
  'We compared IL2RA knockdown against non-targeting control in CD4 T cells.',
  'IL2RA knockdown significantly upregulates FOXP3 across the population (p < 0.001).',
  'We then validated FOXP3 at the protein level by Western blot, and confirmed a',
  'roughly two-fold increase in FOXP3 protein under knockdown.',
  'Finally, a Kaplan-Meier survival analysis of engrafted mice showed longer',
  'survival in the knockdown arm.',
].join(' ');

const MARSON_ONLY_GENES = ['foxp3', 'tnfrsf9', 'icos', 'tigit', 'ctla4', 'il2ra', 'ikzf2'];
const MARSON_ONLY_COLS = ['donor_id', 'lane', 'guide_id', 'phase'];
const KETAMINE_DISTINCT_COLS = ['mouse_id', 'seq_batch', 'sex'];
const TREG_MARKERS = ['tnfrsf9', 'icos', 'tigit', 'ctla4'];

// ── Structural helpers (no wording assumptions) ────────────────────────────────

function geneRefsOf(claim: ExtractedClaim): Set<string> {
  const out = new Set(claim.evidenceRefs.genes.map((g) => g.toLowerCase()));
  for (const route of claim.checks) {
    const p = route.params as Record<string, unknown>;
    if (typeof p.gene === 'string') out.add(p.gene.toLowerCase());
    if (Array.isArray(p.markers)) for (const m of p.markers) out.add(String(m).toLowerCase());
  }
  return out;
}

function colRefsOf(claim: ExtractedClaim): Set<string> {
  const out = new Set(claim.evidenceRefs.obsColumns.map((c) => c.toLowerCase()));
  for (const route of claim.checks) {
    const p = route.params as Record<string, unknown>;
    for (const key of ['grouping', 'unit', 'nuisance', 'interest']) {
      const v = p[key];
      if (typeof v === 'string' && v) out.add(v.toLowerCase());
      else if (Array.isArray(v)) for (const s of v) out.add(String(s).toLowerCase());
    }
  }
  return out;
}

function checksOf(claim: ExtractedClaim): Set<number> {
  const out = new Set<number>();
  for (const route of claim.checks) if ([1, 2, 3, 4].includes(route.check)) out.add(route.check);
  return out;
}

function allGenes(claims: ExtractedClaim[]): Set<string> {
  const out = new Set<string>();
  for (const c of claims) for (const g of geneRefsOf(c)) out.add(g);
  return out;
}

function allCols(claims: ExtractedClaim[]): Set<string> {
  const out = new Set<string>();
  for (const c of claims) for (const col of colRefsOf(c)) out.add(col);
  return out;
}

function intersect(a: Iterable<string>, b: string[]): string[] {
  const sb = new Set(b);
  return [...a].filter((x) => sb.has(x));
}

describe.skipIf(!hasCreds)('claim extraction, live model calls (spec section 10)', () => {
  const reasoner = createReasoner();
  let marsonClaims: ExtractedClaim[] = [];
  let ketamineClaims: ExtractedClaim[] = [];
  let proseClaims: ExtractedClaim[] = [];
  let caseCClaims: ExtractedClaim[] = [];

  beforeAll(async () => {
    marsonClaims = await reasoner.extractClaims({
      datasetTitle: 'CD4+ T cells, IL2RA knockdown vs non-targeting, Perturb-seq',
      inventory: MARSON_INVENTORY,
      fields: MARSON_FIELDS,
    });
    ketamineClaims = await reasoner.extractClaims({
      datasetTitle: 'Prefrontal cortex, ketamine vs saline, scRNA-seq',
      inventory: KETAMINE_INVENTORY,
      fields: KETAMINE_FIELDS,
    });
    proseClaims = await reasoner.extractClaims({
      datasetTitle: 'CD4+ T cells, IL2RA knockdown vs non-targeting, Perturb-seq',
      inventory: MARSON_INVENTORY,
      fields: MARSON_FIELDS,
      prose: OUT_OF_SCOPE_PROSE,
    });
    caseCClaims = await reasoner.extractClaims({
      datasetTitle: 'Case C bare inventory',
      inventory: CASE_C_INVENTORY,
      fields: [],
    });
  }, CALL_TIMEOUT_MS * 4);

  it('1. bare file works: the marson fan-out routes to the right checks', () => {
    const foxp3Sig = marsonClaims.find(
      (c) => geneRefsOf(c).has('foxp3') && checksOf(c).has(1) && checksOf(c).has(4),
    );
    expect(foxp3Sig, 'a FOXP3 significance claim routed to Check 1 and Check 4').toBeTruthy();

    const markerState = marsonClaims.find(
      (c) => checksOf(c).has(2) && checksOf(c).has(3) && intersect(geneRefsOf(c), TREG_MARKERS).length > 0,
    );
    expect(markerState, 'a marker-defined activated state routed to Check 2 and Check 3').toBeTruthy();

    const existence = marsonClaims.find((c) => c !== markerState && checksOf(c).has(3));
    expect(existence, 'a separate existence claim routed to Check 3').toBeTruthy();

    const union = new Set<number>();
    for (const c of marsonClaims) for (const id of checksOf(c)) union.add(id);
    expect([...union].sort()).toEqual([1, 2, 3, 4]);
  });

  it('2. generality: ketamine yields ketamine claims, none of marson', () => {
    expect(ketamineClaims.length).toBeGreaterThan(0);
    const ketGenes = allGenes(ketamineClaims);
    const ketCols = allCols(ketamineClaims);

    // Positive preconditions FIRST: every assertion below intersects against
    // ketGenes / ketCols (and marson's), and each is vacuously true on an empty
    // set. Require the real, non-empty sets so a faked or empty extraction that
    // referenced nothing cannot pass "no marson leak" and "disjoint" for free.
    expect(ketGenes.size, 'ketamine references genes (else the checks below are vacuous)').toBeGreaterThan(0);
    expect(ketCols.size, 'ketamine references columns (else the checks below are vacuous)').toBeGreaterThan(0);
    expect(allGenes(marsonClaims).size, 'marson references genes (else disjointness is vacuous)').toBeGreaterThan(0);

    for (const g of ketGenes) expect(inventoryKnowsGene(KETAMINE_INVENTORY, g), `gene ${g} known`).toBe(true);
    expect(intersect(ketCols, KETAMINE_DISTINCT_COLS).length, 'references ketamine columns').toBeGreaterThan(0);
    expect(intersect(ketGenes, MARSON_ONLY_GENES), 'no marson genes leaked').toEqual([]);
    expect(intersect(ketCols, MARSON_ONLY_COLS), 'no marson columns leaked').toEqual([]);
    expect(intersect(ketGenes, [...allGenes(marsonClaims)]), 'gene sets disjoint').toEqual([]);
  });

  it('3. real AI: a live call fired and the claims cite real data', () => {
    expect(reasoner.available).toBe(true);
    // Positive precondition FIRST: with zero claims the "cites real data" loop
    // below is vacuous. A real reading of a dataset with stored results proposes
    // claims, so require them before asserting they reference real data.
    expect(marsonClaims.length, 'marson extraction returned claims (else the citation checks are vacuous)').toBeGreaterThan(0);
    // The curated fallback is engine's canonical MARSON_CLAIMS (inlined above as a
    // faithful copy). A live model reading must not simply echo that id set.
    const curatedIds = new Set(MARSON_CLAIMS.map((c) => c.id));
    const modelIds = marsonClaims.map((c) => c.id);
    const echoes = modelIds.length === curatedIds.size && modelIds.every((id) => curatedIds.has(id));
    expect(echoes, 'output is not the curated fallback').toBe(false);
    for (const c of marsonClaims) {
      for (const g of geneRefsOf(c)) expect(inventoryKnowsGene(MARSON_INVENTORY, g), `gene ${g} present`).toBe(true);
      for (const col of colRefsOf(c)) expect(inventoryHasField(MARSON_INVENTORY, col), `col ${col} present`).toBe(true);
    }
  });

  it('4. out-of-scope honesty: unauditable claims are labeled with empty checks', () => {
    const oos = proseClaims.filter((c) => c.status === 'out_of_scope');
    expect(oos.length, 'at least one out-of-scope claim').toBeGreaterThanOrEqual(1);
    for (const c of oos) {
      expect(c.checks, `${c.id} has empty checks`).toEqual([]);
      expect((c.outOfScopeReason ?? '').trim().length, `${c.id} states a reason`).toBeGreaterThan(0);
    }
    const auditable = proseClaims.filter((c) => c.status !== 'out_of_scope' && checksOf(c).size > 0);
    expect(auditable.length, 'the auditable claim survived').toBeGreaterThanOrEqual(1);
  });

  it('5. no fabrication: a bare inventory with empty uns invents nothing', () => {
    const routed = caseCClaims.filter((c) => checksOf(c).size > 0);
    const inScope = caseCClaims.filter((c) => c.status !== 'out_of_scope');
    expect(routed, 'no fabricated auditable claims').toEqual([]);
    expect(inScope, 'no in-scope claims with nothing to rest on').toEqual([]);
  });

  it('6. claim invariants: unique, non-empty ids and no silent zero-route in-scope claim', () => {
    // Hardened in enforceClaimHonesty (packages/contracts/src/claims.ts): ids are
    // unique within one extraction (so the Claim Review UI keys and patches by id
    // without collisions), and no in-scope claim routes to nothing in silence (an
    // unroutable in-scope claim must carry ambiguousRouting, honesty rule 12).
    // out_of_scope claims are exempt from the routing rule: they carry checks:[]
    // by design and are labeled with outOfScopeReason (honesty rule 10).
    const lists: Array<[string, ExtractedClaim[]]> = [
      ['marson', marsonClaims],
      ['ketamine', ketamineClaims],
      ['prose', proseClaims],
      ['caseC', caseCClaims],
    ];
    expect(
      lists.some(([, claims]) => claims.length > 0),
      'at least one live extraction returned claims (else id-uniqueness is vacuous)',
    ).toBe(true);

    for (const [label, claims] of lists) {
      const ids = claims.map((c) => c.id);
      for (const id of ids) expect(id.trim().length, `${label}: claim id is non-empty`).toBeGreaterThan(0);
      expect(new Set(ids).size, `${label}: claim ids are unique`).toBe(ids.length);

      for (const c of claims) {
        const inScope = c.status !== 'out_of_scope' && c.status !== 'removed';
        if (!inScope || c.checks.length > 0) continue;
        expect(
          (c.ambiguousRouting ?? '').trim().length,
          `${label}: in-scope claim ${c.id} routes to nothing, so it must carry ambiguousRouting`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

// Check 7 is pure: no backend, so it always runs.
describe('user control flows through (spec section 10)', () => {
  it('removing a claim and editing routing change what runs', () => {
    const base = enforceClaimHonesty(MARSON_INVENTORY, MARSON_CLAIMS);
    expect(routedChecksFrom(base)).toEqual([1, 2, 3, 4]);

    const withoutTreg = base.map((c) =>
      c.id === 'marson-activated-treg-state' ? { ...c, status: 'removed' as const } : c,
    );
    const routedNoTreg = routedChecksFrom(withoutTreg);
    expect(routedNoTreg).not.toContain(2);
    expect(routedNoTreg).toContain(3);

    const withoutBoth = withoutTreg.map((c) =>
      c.id === 'marson-effector-state' ? { ...c, status: 'removed' as const } : c,
    );
    expect(routedChecksFrom(withoutBoth)).not.toContain(3);

    const edited = base.map((c) =>
      c.id === 'marson-foxp3-significance'
        ? { ...c, checks: c.checks.filter((r) => r.check !== 4) }
        : c,
    );
    const routedEdited = routedChecksFrom(edited);
    expect(routedEdited).not.toContain(4);
    expect(routedEdited).toEqual([1, 2, 3]);
  });

  it('a manual addition brings its routed check into the audit', () => {
    // The manual-add path (spec section 7): the store appends a mapped claim with
    // status 'user_added'; routedChecksFrom counts it (status is not 'removed'),
    // so adding it brings its check back. Start from the Treg removal (Check 2
    // dropped), add a user_added claim routing to Check 2, and prove 2 returns.
    const base = enforceClaimHonesty(MARSON_INVENTORY, MARSON_CLAIMS);
    const withoutTreg = base.map((c) =>
      c.id === 'marson-activated-treg-state' ? { ...c, status: 'removed' as const } : c,
    );
    expect(routedChecksFrom(withoutTreg)).not.toContain(2);

    const [manualClaim] = enforceClaimHonesty(MARSON_INVENTORY, [
      {
        id: 'user-manual-treg',
        text: 'The activated Treg-like state is a real, separable population.',
        source: 'user_added',
        restsOn: 'The stored marker table rank_genes_groups over the leiden clustering.',
        evidenceRefs: { obsColumns: ['leiden'], unsKeys: ['rank_genes_groups'], genes: ['TNFRSF9'] },
        checks: [
          { check: 2, params: { grouping: 'leiden', cluster: 'Activated Treg-like', markers: ['TNFRSF9'] } },
        ],
        confidence: 'high',
        status: 'user_added',
      },
    ]);
    if (!manualClaim) throw new Error('the manual claim was dropped by the honesty backstop');
    expect(manualClaim.status).toBe('user_added');
    expect(checksOf(manualClaim).has(2)).toBe(true);

    const withManual = [...withoutTreg, manualClaim];
    expect(routedChecksFrom(withManual)).toContain(2);
  });
});
