/**
 * Acceptance harness for the intake and claim-extraction feature (spec section 10).
 *
 * This proves the spec with REAL model calls, not fixtures. It drives the actual
 * reasoner (packages/reasoning) against the built-in inventories and asserts on
 * structure and routing, never on exact wording (the model writes the prose).
 *
 * The seven checks cover spec section 10 plus the hardened contract invariants:
 *   1. Bare file works        a bare marson inventory extracts the section-5 fan-out.
 *   2. Generality             ketamine yields ketamine-specific claims, none of marson's.
 *   3. Real AI                a real Bedrock call fired, and the claims cite real data.
 *   4. Out-of-scope honesty   an unauditable claim comes back labeled with empty checks.
 *   5. No fabrication         a bare inventory with empty uns invents nothing.
 *   6. Claim invariants       extractor output has unique, non-empty ids; no in-scope
 *                             claim routes to nothing without an ambiguousRouting note.
 *   7. User control           removing, editing routing, and a manual add change what runs.
 *
 * Checks 1 to 6 read real extractor output, so they need a reasoning backend. With
 * none configured the harness SKIPS them with a loud message naming the missing env
 * vars, still runs check 7, and exits non-zero, so a missing credential never turns
 * into a green run. Check 7 is pure and always runs.
 *
 * Run it against Bedrock:
 *   REDLINE_REASONING_BACKEND=bedrock AWS_REGION=us-east-1 \
 *     REDLINE_BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-5-20251101-v1:0 \
 *     node scripts/verify-intake.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const distPath = (pkg) => resolve(HERE, '..', 'packages', pkg, 'dist', 'index.js');

// ── Loud module load, so a missing build is a clear message, not a stack trace ──
let engine, reasoning, contracts;
try {
  engine = await import(distPath('engine'));
  reasoning = await import(distPath('reasoning'));
  contracts = await import(distPath('contracts'));
} catch (err) {
  console.error('Could not load the built packages. Build them first:');
  console.error('  pnpm turbo build --filter=@redline/engine --filter=@redline/reasoning');
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
}

// routedChecksFrom is the REAL routing reducer (packages/engine/src/routing.ts),
// the same function apps/web/src/state/session.tsx now imports. Pulling it from
// the built engine dist, instead of restating it here, is the point of check 6:
// if the reducer drifts, this harness drifts with it and can still fail. It is
// exported from the client-safe engine entry (no Node builtins), already loaded
// above via distPath('engine').
const {
  SCENARIOS,
  MARSON_INVENTORY,
  KETAMINE_INVENTORY,
  MARSON_CLAIMS,
  curatedClaimsFor,
  routedChecksFrom,
} = engine;
const { createReasoner } = reasoning;
const { enforceClaimHonesty, inventoryKnowsGene, inventoryHasField } = contracts;

if (typeof routedChecksFrom !== 'function') {
  console.error(
    'The built @redline/engine does not export routedChecksFrom. Rebuild it:\n' +
      '  pnpm turbo build --filter=@redline/engine',
  );
  process.exit(1);
}

// ── The identifiers that make the two datasets distinct. A faked extractor that ──
// ── echoed one dataset's claims against the other would trip these.            ──
const MARSON_ONLY_GENES = ['foxp3', 'tnfrsf9', 'icos', 'tigit', 'ctla4', 'il2ra', 'ikzf2'];
const MARSON_ONLY_COLS = ['donor_id', 'lane', 'guide_id', 'phase'];
const KETAMINE_DISTINCT_COLS = ['mouse_id', 'seq_batch', 'sex'];
const TREG_MARKERS = ['tnfrsf9', 'icos', 'tigit', 'ctla4'];

// ── Small structural helpers over a claim list (no wording assumptions) ────────

const lower = (xs) => xs.map((x) => String(x).toLowerCase());

/** Every gene a claim references: its evidenceRefs plus any gene / markers param. */
function geneRefsOf(claim) {
  const out = new Set(lower(claim.evidenceRefs?.genes ?? []));
  for (const route of claim.checks ?? []) {
    const p = route.params ?? {};
    if (typeof p.gene === 'string') out.add(p.gene.toLowerCase());
    if (Array.isArray(p.markers)) for (const m of p.markers) out.add(String(m).toLowerCase());
  }
  return out;
}

/** Every obs column a claim references: its evidenceRefs plus any column param. */
function colRefsOf(claim) {
  const out = new Set(lower(claim.evidenceRefs?.obsColumns ?? []));
  for (const route of claim.checks ?? []) {
    const p = route.params ?? {};
    for (const key of ['grouping', 'unit', 'nuisance', 'interest']) {
      const v = p[key];
      if (typeof v === 'string' && v) out.add(v.toLowerCase());
      else if (Array.isArray(v)) for (const s of v) out.add(String(s).toLowerCase());
    }
  }
  return out;
}

/** The valid check ids a claim routes to. */
function checksOf(claim) {
  const out = new Set();
  for (const route of claim.checks ?? []) {
    if ([1, 2, 3, 4].includes(route.check)) out.add(route.check);
  }
  return out;
}

/** Union of genes across a list of claims. */
function allGenes(claims) {
  const out = new Set();
  for (const c of claims) for (const g of geneRefsOf(c)) out.add(g);
  return out;
}

/** Union of obs columns across a list of claims. */
function allCols(claims) {
  const out = new Set();
  for (const c of claims) for (const col of colRefsOf(c)) out.add(col);
  return out;
}

function setEq(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function intersect(a, b) {
  const sb = new Set(b);
  return [...a].filter((x) => sb.has(x));
}

class AssertionError extends Error {}
function assert(cond, message) {
  if (!cond) throw new AssertionError(message);
}

// ── The extraction requests (one model call each; checks 1 and 3 share one) ────

function marsonBareRequest() {
  return {
    datasetTitle: SCENARIOS.marson.dataset.title,
    inventory: MARSON_INVENTORY,
    fields: SCENARIOS.marson.fields,
  };
}

function ketamineRequest() {
  return {
    datasetTitle: SCENARIOS.ketamine.dataset.title,
    inventory: KETAMINE_INVENTORY,
    fields: SCENARIOS.ketamine.fields,
  };
}

/**
 * One auditable claim (a significance claim Redline can test) plus two claims no
 * check can settle: a protein-level Western blot validation and a Kaplan-Meier
 * survival curve. Neither of the four checks can test a protein assay or a
 * survival analysis, so both must come back labeled out of scope.
 */
const OUT_OF_SCOPE_PROSE = [
  'We compared IL2RA knockdown against non-targeting control in CD4 T cells.',
  'IL2RA knockdown significantly upregulates FOXP3 across the population (p < 0.001).',
  'We then validated FOXP3 at the protein level by Western blot, and confirmed a',
  'roughly two-fold increase in FOXP3 protein under knockdown.',
  'Finally, a Kaplan-Meier survival analysis of engrafted mice showed longer',
  'survival in the knockdown arm.',
].join(' ');

function marsonProseRequest() {
  return {
    datasetTitle: SCENARIOS.marson.dataset.title,
    inventory: MARSON_INVENTORY,
    fields: SCENARIOS.marson.fields,
    prose: OUT_OF_SCOPE_PROSE,
  };
}

/**
 * Case C: the canonical bare inventory, mirroring services/rigor/data
 * build_case_fixtures.py build_case_c (obs donor_id / condition / cell_barcode,
 * raw counts, an EMPTY uns, no cluster field, no notebook, no prose). There is no
 * stored result to rest a significance or marker claim on, and no clustering to
 * imply an existence claim, so an honest extractor finds nothing to audit. The
 * genes are present in varNamesSample, so the ONLY thing stopping a fabricated
 * significance claim is the model's own honesty, not the deterministic backstop.
 * That is the point of this check.
 *
 * The inventory carries no `leiden` / cluster field on purpose. Adding one would
 * make an existence claim legitimately extractable (spec section 4: a named
 * cluster implies an existence claim routed to Check 3), which is not fabrication.
 * The honest no-claims state is a dataset with counts and obs and nothing stored.
 */
const CASE_C_INVENTORY = {
  file: 'case_c_bare.h5ad',
  nCells: 300,
  nGenes: 80,
  obs: [
    { name: 'donor_id', dtype: 'categorical', levels: 4, missing: 0, sample: ['S1', 'S2', 'S3', 'S4'] },
    { name: 'condition', dtype: 'categorical', levels: 2, missing: 0, sample: ['case', 'ctrl'] },
    { name: 'cell_barcode', dtype: 'identifier', levels: 300, missing: 0, sample: ['BARE0000000-1', 'BARE0000001-1'] },
  ],
  uns: [],
  clusterFields: [],
  hasRawCounts: true,
  countsSource: 'layers/counts',
  layers: ['counts'],
  obsm: [],
  varNamesSample: ['g000', 'g001', 'g002', 'g003', 'g004', 'g005'],
};

function caseCRequest() {
  return {
    datasetTitle: 'Case C bare inventory',
    inventory: CASE_C_INVENTORY,
    fields: [],
  };
}

// ── The six checks. Each returns { detail } on pass or throws AssertionError. ──

function checkBareFileWorks(marsonClaims) {
  const foxp3Sig = marsonClaims.find(
    (c) => geneRefsOf(c).has('foxp3') && checksOf(c).has(1) && checksOf(c).has(4),
  );
  assert(
    foxp3Sig,
    'expected a FOXP3 significance claim routed to Check 1 AND Check 4. ' +
      `Got claims: ${JSON.stringify(marsonClaims.map((c) => ({ genes: [...geneRefsOf(c)], checks: [...checksOf(c)] })))}`,
  );

  const markerState = marsonClaims.find(
    (c) => checksOf(c).has(2) && checksOf(c).has(3) && intersect(geneRefsOf(c), TREG_MARKERS).length > 0,
  );
  assert(
    markerState,
    'expected a marker-defined activated state routed to Check 2 AND Check 3, citing at least one of ' +
      `${TREG_MARKERS.join(', ')}. Got: ${JSON.stringify(marsonClaims.map((c) => ({ genes: [...geneRefsOf(c)], checks: [...checksOf(c)] })))}`,
  );

  // An existence claim routed to Check 3: a distinct claim (not the marker state)
  // that routes to Check 3, defined by a cluster rather than a marker gene set.
  const existence = marsonClaims.find(
    (c) => c !== markerState && checksOf(c).has(3),
  );
  assert(
    existence,
    'expected a separate existence claim routed to Check 3 (a distinct cell state), ' +
      'beyond the marker-defined state claim.',
  );

  const union = new Set();
  for (const c of marsonClaims) for (const id of checksOf(c)) union.add(id);
  assert(
    setEq(union, [1, 2, 3, 4]),
    `expected the claim set to fan out across all four checks, got routed set {${[...union].sort().join(',')}}`,
  );

  return {
    detail: `${marsonClaims.length} claims, fan-out {${[...union].sort().join(',')}}; FOXP3 to Check 1+4; markers ${intersect(geneRefsOf(markerState), TREG_MARKERS).join('/')} to Check 2+3`,
  };
}

function checkGenerality(marsonClaims, ketamineClaims) {
  const ketGenes = allGenes(ketamineClaims);
  const ketCols = allCols(ketamineClaims);

  assert(ketamineClaims.length > 0, 'ketamine extraction returned no claims');

  // Positive preconditions FIRST. Every gene/column assertion below (known-gene,
  // no-marson-leak, disjoint) intersects against ketGenes/ketCols, and every one
  // of them is trivially true when that set is empty. A faked or empty extraction
  // that referenced nothing would sail through "leaked marson genes == 0" and
  // "gene sets disjoint" without ever proving the positive. So require the real,
  // non-empty set here and fail loudly (naming it vacuous) when it is missing.
  assert(
    ketGenes.size > 0,
    'vacuous: the ketamine extraction referenced zero genes, so the known-gene, ' +
      'no-marson-leak, and disjointness assertions below would all pass trivially. ' +
      'A real extraction cites the genes it audits.',
  );
  assert(
    ketCols.size > 0,
    'vacuous: the ketamine extraction referenced zero obs columns, so the ' +
      'column no-leak assertion below would pass trivially. A real extraction ' +
      'cites the columns it audits.',
  );

  // Every referenced gene is one the ketamine inventory actually knows.
  for (const g of ketGenes) {
    assert(
      inventoryKnowsGene(KETAMINE_INVENTORY, g),
      `ketamine claim references gene "${g}" which is not in the ketamine inventory`,
    );
  }
  // It references ketamine's own obs columns.
  const referencedDistinct = intersect(ketCols, KETAMINE_DISTINCT_COLS);
  assert(
    referencedDistinct.length > 0,
    `expected ketamine claims to reference at least one of ${KETAMINE_DISTINCT_COLS.join(', ')}, got columns {${[...ketCols].join(',')}}`,
  );
  // It references NONE of marson's distinctive genes or columns.
  const leakedGenes = intersect(ketGenes, MARSON_ONLY_GENES);
  assert(
    leakedGenes.length === 0,
    `ketamine claims leaked marson-only genes: ${leakedGenes.join(', ')} (the extractor is faked)`,
  );
  const leakedCols = intersect(ketCols, MARSON_ONLY_COLS);
  assert(
    leakedCols.length === 0,
    `ketamine claims leaked marson-only columns: ${leakedCols.join(', ')} (the extractor is faked)`,
  );
  // The two datasets' referenced gene sets are disjoint: identical claims would
  // fail here. Guard the marson side too, so an empty marson set cannot make
  // disjointness trivially true (ketGenes non-empty was proven above).
  const marsonGenes = allGenes(marsonClaims);
  assert(
    marsonGenes.size > 0,
    'vacuous: the marson extraction referenced zero genes, so disjointness with ' +
      'ketamine would be trivially true on the marson side.',
  );
  const overlap = intersect(ketGenes, marsonGenes);
  assert(
    overlap.length === 0,
    `marson and ketamine extractions share genes ${overlap.join(', ')}; a real extractor adapts to the data`,
  );

  return {
    detail: `ketamine genes {${[...ketGenes].join(',')}}, cols {${referencedDistinct.join(',')}}; zero marson genes/cols; disjoint from marson genes {${[...marsonGenes].join(',')}}`,
  };
}

function checkRealAi(reasoner, marsonClaims, latencyMs) {
  assert(reasoner.available === true, 'no reasoning backend is available; this was not a real model call');

  // Positive precondition FIRST: a real reading of a dataset with stored results
  // produces claims. With zero claims the "cites real data" loop below is vacuous
  // (nothing to check), so it would pass without proving anything about the model.
  assert(
    marsonClaims.length > 0,
    'vacuous: the marson extraction returned zero claims, so the "cites real ' +
      'data" checks below would pass trivially. A real reading of a dataset with ' +
      'stored results proposes claims.',
  );

  // extractClaims has no curated branch (it throws when unavailable), so reaching
  // here with claims proves a live call fired. Confirm the output is not the
  // curated fixture: the curated ids are fixed strings the model would not emit.
  // curatedClaimsFor is the exact fallback the /api/audit/claims route serves.
  const curated = curatedClaimsFor('marson', MARSON_INVENTORY);
  const curatedIds = new Set(curated.map((c) => c.id));
  const modelIds = marsonClaims.map((c) => c.id);
  const echoesCurated = modelIds.length === curatedIds.size && modelIds.every((id) => curatedIds.has(id));
  assert(
    !echoesCurated,
    'the extraction output is byte-identical to the curated fallback ids; a real call did not fire',
  );

  // Every referenced gene and column is actually present in the inventory (real
  // data, not generic text).
  for (const c of marsonClaims) {
    for (const g of geneRefsOf(c)) {
      assert(inventoryKnowsGene(MARSON_INVENTORY, g), `claim cites gene "${g}" absent from the marson inventory`);
    }
    for (const col of colRefsOf(c)) {
      assert(inventoryHasField(MARSON_INVENTORY, col), `claim cites column "${col}" absent from the marson inventory`);
    }
  }

  return { detail: `live Bedrock call, ${latencyMs} ms; model ids ${modelIds.join(', ')} differ from curated` };
}

function checkOutOfScope(claims) {
  const oos = claims.filter((c) => c.status === 'out_of_scope');
  assert(
    oos.length >= 1,
    'expected at least one out-of-scope claim (protein-level validation or survival curve), got none. ' +
      `Statuses: ${JSON.stringify(claims.map((c) => c.status))}`,
  );
  for (const c of oos) {
    assert(
      (c.checks ?? []).length === 0,
      `out-of-scope claim "${c.id}" carries checks ${JSON.stringify(c.checks)}; it must have an empty checks array`,
    );
    assert(
      typeof c.outOfScopeReason === 'string' && c.outOfScopeReason.trim().length > 0,
      `out-of-scope claim "${c.id}" has no stated reason`,
    );
  }
  // At least one auditable claim survived and routes to a check: the model did not
  // just dump everything as out of scope.
  const auditable = claims.filter((c) => c.status !== 'out_of_scope' && checksOf(c).size > 0);
  assert(
    auditable.length >= 1,
    'expected at least one in-scope, routed claim (the FOXP3 significance claim). ' +
      'Everything came back out of scope, which is wrong.',
  );

  return {
    detail: `${oos.length} out-of-scope (empty checks + reason), ${auditable.length} auditable. Reason: "${oos[0].outOfScopeReason.slice(0, 80)}..."`,
  };
}

function checkNoFabrication(claims) {
  const routed = claims.filter((c) => checksOf(c).size > 0);
  const inScope = claims.filter((c) => c.status !== 'out_of_scope');
  // The honesty invariant: with no stored result and no prose, the model must not
  // invent an auditable claim. Zero routed claims, zero in-scope proposed claims.
  assert(
    routed.length === 0,
    `the model fabricated ${routed.length} auditable claim(s) from a bare inventory with no stored results: ` +
      `${JSON.stringify(routed.map((c) => ({ text: c.text, checks: [...checksOf(c)] })))}`,
  );
  assert(
    inScope.length === 0,
    `the model proposed ${inScope.length} in-scope claim(s) with nothing to rest them on: ` +
      `${JSON.stringify(inScope.map((c) => c.text))}`,
  );

  const words =
    claims.length === 0
      ? 'the model returned an empty list { "claims": [] }'
      : `the model returned only labeled non-claims: ${JSON.stringify(claims.map((c) => c.outOfScopeReason ?? c.text))}`;
  return { detail: `no fabricated claims. ${words}` };
}

function checkUserControl() {
  // Real code: the extracted claims pass through the same deterministic backstop
  // the API and session use before routing is read.
  const base = enforceClaimHonesty(MARSON_INVENTORY, MARSON_CLAIMS);
  const routedAll = routedChecksFrom(base);
  assert(
    setEq(routedAll, [1, 2, 3, 4]),
    `expected the full marson claim set to route to all four checks, got {${routedAll.join(',')}}`,
  );

  // Removal: mark the marker-defined state claim removed. It is the only claim
  // routing to Check 2, so Check 2 drops. Check 3 stays (the effector state still
  // routes to it).
  const withoutTreg = base.map((c) =>
    c.id === 'marson-activated-treg-state' ? { ...c, status: 'removed' } : c,
  );
  const routedNoTreg = routedChecksFrom(withoutTreg);
  assert(
    !routedNoTreg.includes(2),
    `removing the Treg-state claim should drop Check 2, still routed: {${routedNoTreg.join(',')}}`,
  );
  assert(
    routedNoTreg.includes(3),
    `Check 3 should survive (the effector-state claim still routes to it), got {${routedNoTreg.join(',')}}`,
  );

  // Remove the effector state too: now nothing routes to Check 3, so it drops.
  const withoutBoth = withoutTreg.map((c) =>
    c.id === 'marson-effector-state' ? { ...c, status: 'removed' } : c,
  );
  const routedNoBoth = routedChecksFrom(withoutBoth);
  assert(
    !routedNoBoth.includes(3),
    `removing both cluster claims should drop Check 3, still routed: {${routedNoBoth.join(',')}}`,
  );

  // Editing routing: strip the Check 4 route off the FOXP3 claim (the only claim
  // routing to Check 4). Check 4 then drops from the routed set.
  const edited = base.map((c) =>
    c.id === 'marson-foxp3-significance'
      ? { ...c, checks: c.checks.filter((r) => r.check !== 4) }
      : c,
  );
  const routedEdited = routedChecksFrom(edited);
  assert(
    !routedEdited.includes(4),
    `editing the FOXP3 claim to drop its Check 4 route should drop Check 4, still routed: {${routedEdited.join(',')}}`,
  );
  assert(
    setEq(routedEdited, [1, 2, 3]),
    `after the edit the routed set should be {1,2,3}, got {${routedEdited.join(',')}}`,
  );

  // Manual addition (spec section 7): the user types a claim, postMapClaim routes
  // it, and the store appends it with status 'user_added'. activeClaims and
  // routedChecksFrom count it (its status is not 'removed'), so a manual add
  // brings its routed check into the audit. Starting from the Treg removal above
  // (Check 2 dropped), a user_added claim routing to Check 2 must bring Check 2
  // back. The claim passes the same enforceClaimHonesty backstop the mapper uses.
  const manualClaim = enforceClaimHonesty(MARSON_INVENTORY, [
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
  ])[0];
  assert(
    manualClaim && manualClaim.status === 'user_added' && checksOf(manualClaim).has(2),
    'the mapped manual claim should survive the honesty backstop as a user_added claim routed to Check 2',
  );
  // Prove the manual add is what flips Check 2 back on, through the SAME engine
  // reducer the session uses. With the Treg claim removed Check 2 is unrouted;
  // appending this user_added claim (and nothing else) is the one change that
  // restores it. Asserting the before-state here (not just at the removal step)
  // makes the causation local and airtight: Check 2 returns because of the add.
  const routedBeforeManual = routedChecksFrom(withoutTreg);
  assert(
    !routedBeforeManual.includes(2),
    `precondition: with the Treg claim removed Check 2 must be unrouted, got {${routedBeforeManual.join(',')}}`,
  );
  const withManual = [...withoutTreg, manualClaim];
  const routedWithManual = routedChecksFrom(withManual);
  assert(
    routedWithManual.includes(2),
    `adding a user_added claim routing to Check 2 should bring Check 2 back, got {${routedWithManual.join(',')}}`,
  );

  return {
    detail:
      'all={1,2,3,4}; remove Treg drops 2 keeps 3; remove both drops 3; edit FOXP3 drops 4; add user_added claim restores 2',
  };
}

/**
 * Contract invariants that hold on ANY extractor output, hardened in
 * enforceClaimHonesty (packages/contracts/src/claims.ts):
 *   - every claim id is a non-empty string and unique within one extraction, so
 *     the Claim Review UI can key and patch by id with no collisions;
 *   - no in-scope claim silently carries zero routes: a claim the user could
 *     ratify (status neither out_of_scope nor removed) that routes to no check
 *     must carry an ambiguousRouting note, so the uncertainty reaches the user
 *     instead of an unaudited claim that looks settled (honesty rule 12).
 * out_of_scope claims are exempt from the routing rule by design: they carry
 * checks:[] and are labeled with outOfScopeReason instead (honesty rule 10).
 *
 * @param lists Array of [label, claims] for each extraction that succeeded.
 */
function checkClaimInvariants(lists) {
  assert(
    lists.some(([, claims]) => claims.length > 0),
    'vacuous: every extraction list is empty, so id-uniqueness has nothing to ' +
      'prove. At least one live extraction must return claims.',
  );

  const parts = [];
  for (const [label, claims] of lists) {
    const ids = claims.map((c) => c.id);
    for (const id of ids) {
      assert(
        typeof id === 'string' && id.trim().length > 0,
        `${label}: a claim has an empty or non-string id; ids must be stable, non-empty strings`,
      );
    }
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert(
      dupes.length === 0,
      `${label}: duplicate claim ids ${JSON.stringify([...new Set(dupes)])}; ids must be unique so the UI can key and patch by id`,
    );

    let silent = 0;
    for (const c of claims) {
      const inScope = c.status !== 'out_of_scope' && c.status !== 'removed';
      if (!inScope) continue;
      if ((c.checks ?? []).length > 0) continue;
      // In-scope, routes to nothing: it must not be silent.
      assert(
        typeof c.ambiguousRouting === 'string' && c.ambiguousRouting.trim().length > 0,
        `${label}: in-scope claim "${c.id}" routes to no check but carries no ` +
          'ambiguousRouting note. An unroutable in-scope claim must surface its ' +
          'uncertainty (or be labeled out of scope), never sit silent.',
      );
      silent += 1;
    }
    parts.push(`${label}:${claims.length} ids-unique${silent ? `,${silent} surfaced-zero-route` : ''}`);
  }
  return { detail: parts.join('; ') };
}

// ── Runner ─────────────────────────────────────────────────────────────────────

function missingEnv() {
  const need = { AWS_REGION: process.env.AWS_REGION, REDLINE_BEDROCK_MODEL_ID: process.env.REDLINE_BEDROCK_MODEL_ID };
  return Object.entries(need)
    .filter(([, v]) => !v || !String(v).trim())
    .map(([k]) => k);
}

function printTable(rows) {
  const nameW = Math.max(...rows.map((r) => r.name.length), 6);
  const statusW = 5;
  const line = (n, s, d) => `  ${n.padEnd(nameW)}  ${s.padEnd(statusW)}  ${d}`;
  console.log('');
  console.log(line('CHECK', 'STAT', 'DETAIL'));
  console.log('  ' + '-'.repeat(nameW + statusW + 40));
  for (const r of rows) console.log(line(r.name, r.status, r.detail));
  console.log('');
}

async function main() {
  const reasoner = createReasoner();
  const missing = missingEnv();
  const hasCreds = reasoner.available && missing.length === 0;

  const rows = [];
  let anyFail = false;
  let anySkip = false;

  const record = (name, fn) => {
    try {
      const { detail } = fn();
      rows.push({ name, status: 'PASS', detail });
    } catch (err) {
      anyFail = true;
      const msg = err instanceof Error ? err.message : String(err);
      rows.push({ name, status: 'FAIL', detail: msg });
    }
  };

  if (!hasCreds) {
    console.error('');
    console.error('=======================================================================');
    console.error(' LIVE CHECKS SKIPPED: no reasoning backend is configured.');
    if (missing.length > 0) {
      console.error(' Missing environment variables: ' + missing.join(', '));
    }
    if (!reasoner.available) {
      console.error(' No backend selected. Set REDLINE_REASONING_BACKEND=bedrock and');
      console.error(' REDLINE_BEDROCK_MODEL_ID, and make AWS credentials resolvable by the');
      console.error(' AWS SDK (AWS_ACCESS_KEY_ID / AWS_PROFILE / SSO).');
    }
    console.error(' A skip is NOT a pass. Checks 1 to 6 did not run.');
    console.error('=======================================================================');
    for (const name of [
      '1-bare-file',
      '2-generality',
      '3-real-ai',
      '4-out-of-scope',
      '5-no-fabrication',
      '6-claim-invariants',
    ]) {
      anySkip = true;
      rows.push({ name, status: 'SKIP', detail: 'no reasoning backend configured' });
    }
  } else {
    console.log('Reasoning backend available. Firing real extraction calls...');

    // Four live calls. Checks 1 and 3 share the marson bare extraction.
    let marsonClaims, ketamineClaims, proseClaims, caseCClaims, marsonLatency;
    const callErrors = {};

    const t0 = Date.now();
    try {
      marsonClaims = await reasoner.extractClaims(marsonBareRequest());
      marsonLatency = Date.now() - t0;
      console.log(`  marson bare extraction: ${marsonClaims.length} claims (${marsonLatency} ms)`);
    } catch (err) {
      callErrors.marson = err instanceof Error ? err.message : String(err);
    }
    try {
      ketamineClaims = await reasoner.extractClaims(ketamineRequest());
      console.log(`  ketamine extraction: ${ketamineClaims.length} claims`);
    } catch (err) {
      callErrors.ketamine = err instanceof Error ? err.message : String(err);
    }
    try {
      proseClaims = await reasoner.extractClaims(marsonProseRequest());
      console.log(`  marson + out-of-scope prose: ${proseClaims.length} claims`);
    } catch (err) {
      callErrors.prose = err instanceof Error ? err.message : String(err);
    }
    try {
      caseCClaims = await reasoner.extractClaims(caseCRequest());
      console.log(`  case C bare inventory: ${caseCClaims.length} claims`);
    } catch (err) {
      callErrors.caseC = err instanceof Error ? err.message : String(err);
    }

    record('1-bare-file', () => {
      if (callErrors.marson) throw new AssertionError('extraction call failed: ' + callErrors.marson);
      return checkBareFileWorks(marsonClaims);
    });
    record('2-generality', () => {
      if (callErrors.marson) throw new AssertionError('marson call failed: ' + callErrors.marson);
      if (callErrors.ketamine) throw new AssertionError('ketamine call failed: ' + callErrors.ketamine);
      return checkGenerality(marsonClaims, ketamineClaims);
    });
    record('3-real-ai', () => {
      if (callErrors.marson) throw new AssertionError('extraction call failed: ' + callErrors.marson);
      return checkRealAi(reasoner, marsonClaims, marsonLatency);
    });
    record('4-out-of-scope', () => {
      if (callErrors.prose) throw new AssertionError('extraction call failed: ' + callErrors.prose);
      return checkOutOfScope(proseClaims);
    });
    record('5-no-fabrication', () => {
      if (callErrors.caseC) throw new AssertionError('extraction call failed: ' + callErrors.caseC);
      return checkNoFabrication(caseCClaims);
    });
    record('6-claim-invariants', () => {
      // Runs over every extraction that returned (id-uniqueness and the no-silent
      // -zero-route invariant hold on each). A call that failed is excluded here
      // and already surfaces as its own check's failure above.
      const lists = [];
      if (!callErrors.marson) lists.push(['marson', marsonClaims]);
      if (!callErrors.ketamine) lists.push(['ketamine', ketamineClaims]);
      if (!callErrors.prose) lists.push(['prose', proseClaims]);
      if (!callErrors.caseC) lists.push(['caseC', caseCClaims]);
      if (lists.length === 0) {
        throw new AssertionError('every extraction call failed; no output to check invariants on');
      }
      return checkClaimInvariants(lists);
    });
  }

  // Check 7 always runs: it is pure and needs no backend.
  record('7-user-control', checkUserControl);

  printTable(rows);

  const passed = rows.filter((r) => r.status === 'PASS').length;
  const failed = rows.filter((r) => r.status === 'FAIL').length;
  const skipped = rows.filter((r) => r.status === 'SKIP').length;
  console.log(`Result: ${passed} passed, ${failed} failed, ${skipped} skipped, of ${rows.length}.`);

  if (anyFail) {
    console.log('FAILED. See the detail column above for the exact assertion.');
    process.exit(1);
  }
  if (anySkip) {
    console.log('INCOMPLETE. Live checks were skipped for missing credentials; this is not a pass.');
    process.exit(2);
  }
  console.log('All checks passed against real model calls.');
  process.exit(0);
}

await main();
