import type { TourStep } from './types';

/**
 * The guided tour script.
 *
 * Two readers at once. A scientist who opened Redline and does not know where to
 * start, and a judge clicking through with nobody presenting. `what` serves the
 * first: it says what the control does and what to put there. `why` serves the
 * second: it says why the check matters and what it costs to skip it.
 *
 * Every string here is user-facing English, so it is bound by the repo's voice
 * and honesty rules exactly like report copy. `steps.test.ts` enforces them: no
 * em dashes, no "not X, but Y" reframes, no AI-tell vocabulary, never a claim
 * that the dataset's authors erred, never an FDR claim on Check 2. Every number
 * below is quoted from the locked fixture in `packages/engine/src/fixtures/marson.ts`.
 *
 * `ensure` makes a step real before the reader looks at it. A reader who opens
 * the tour from a cold `/checks/3` still sees a figure, because the step runs the
 * same session action the UI would have run.
 *
 * `depth` is the reason this script is still two minutes long. Intake and claim
 * extraction added four steps, the correction layer added three more and a whole
 * route, and each branch was right to. Presenter mode plays the `spine` and skips
 * the `detail`, so the arc a judge needs stays inside its budget while a scientist
 * driving the tour still gets every mechanic. `steps.test.ts` holds the spine to a
 * two minute runtime, so the next feature cannot quietly spend it.
 *
 * The script names no check count. There are eight registered checks today and
 * there were four last week; a number written here goes stale the moment
 * `packages/contracts/src/registry.ts` grows a row. The gate forbids it.
 */
export const TOUR_STEPS: TourStep[] = [
  // ── Redline ───────────────────────────────────────────────────────────────
  {
    id: 'welcome',
    chapter: 'Redline',
    depth: 'spine',
    route: '/',
    target: null,
    headline: 'Break your own analysis first.',
    what: 'You are looking at a real single-cell dataset from Gladstone and the four conclusions a scientist drew from it. Redline re-runs the statistics behind that naive analysis and marks what does not hold up.',
    why: 'The authors of this dataset did their work rigorously. Redline audits the version a less-experienced hand would run, and helps everyone reach that same standard.',
    advance: 'next',
    dwellMs: 6000,
    ensure: { kind: 'loadScenario', scenarioId: 'marson' },
    primaryCta: 'Walk me through it',
    secondaryCta: 'Play it for me',
    tertiaryCta: 'Skip',
  },

  // ── The case ──────────────────────────────────────────────────────────────
  {
    id: 'dataset',
    chapter: 'The case',
    depth: 'spine',
    route: '/',
    target: 'intake.dataset',
    headline: 'The data, and the claims.',
    what: 'The .h5ad the scientist analyzed: CD4+ T cells, IL2RA knockdown versus non-targeting, about 52,000 cells across 4 donors. The notebook drew four load-bearing conclusions from it.',
    why: 'Hold two numbers side by side. About 52,000 cells, and 4 donors. The gap between them is where the first check starts.',
    advance: 'next',
    dwellMs: 5500,
  },
  {
    id: 'analysis',
    chapter: 'The case',
    depth: 'detail',
    route: '/',
    target: 'intake.analysis',
    headline: 'Two optional attach points.',
    what: 'Paste or upload your notebook or script, and your written results. Both are optional. New here? Load the example analysis and run the audit on a ready sample.',
    why: 'The dataset alone is enough. Anything you add sharpens the reading and matches the claims to how you would state them.',
    advance: 'next',
    dwellMs: 6000,
  },
  {
    id: 'begin',
    chapter: 'The case',
    depth: 'spine',
    route: '/',
    target: 'intake.begin',
    headline: 'Start the audit.',
    what: 'Press Begin audit. Redline reads every column, proposes what each one means, and opens the design step. Nothing is tested until you confirm that design.',
    why: 'The design of an experiment decides which statistics are valid. Redline settles that with you first, before it computes anything.',
    advance: 'click',
    dwellMs: 5000,
    ensure: { kind: 'resolveFields' },
  },

  // ── Foundation: design resolution ─────────────────────────────────────────
  {
    id: 'fields-matrix',
    chapter: 'Foundation',
    depth: 'spine',
    route: '/fields',
    target: 'fields.matrix',
    headline: 'The design, read by Claude.',
    what: 'Claude read all 9 columns and proposed a role for each: the biological replicate, the comparison, the technical nuisances. Every proposal carries a confidence and one line of reasoning.',
    why: 'Every check runs on a field role, never on a column name. Get a role wrong and every result downstream is wrong, so this gate comes first.',
    advance: 'next',
    dwellMs: 6500,
    ensure: { kind: 'resolveFields' },
  },
  {
    id: 'unit-row',
    chapter: 'Foundation',
    depth: 'detail',
    route: '/fields',
    target: 'fields.unit-row',
    headline: 'The replicate that counts.',
    what: 'This row is donor_id, proposed as the independent unit: 4 donors, the true biological replicate. The roughly 13,000 cells inside each donor are measurements that share it.',
    why: 'This one role drives the first check. Testing across 4 donors or across 51,842 cells is the difference between an honest p-value and an inflated one.',
    advance: 'next',
    dwellMs: 7000,
    ensure: { kind: 'resolveFields' },
  },
  {
    id: 'confirm',
    chapter: 'Foundation',
    depth: 'spine',
    route: '/fields',
    target: 'fields.confirm',
    headline: 'Confirm the design to continue.',
    what: 'Press Confirm. Redline locks these roles, inspects the file, and reads your analysis to propose the claims it can test. Until you confirm the design, the claim step and every check stay locked.',
    why: 'The scientist owns the experimental design. Redline owns the statistics that follow from it, and it computes nothing until the design is signed off.',
    advance: 'click',
    dwellMs: 5000,
    ensure: { kind: 'resolveFields' },
  },

  // ── Claim review: the claims Redline extracted ────────────────────────────
  {
    id: 'claims-card',
    chapter: 'Claim review',
    depth: 'spine',
    route: '/claims',
    target: 'claims.card.1',
    headline: 'The first extracted claim.',
    what: 'This card is one claim Redline read from your analysis: the sentence, what it rests on (the stored FOXP3 result), and how sure it is. You confirm it, edit it, or remove it.',
    why: 'Redline extracts the claims your analysis already makes and proposes them here. Nothing is added to pad the list, and you ratify each one before any check runs.',
    advance: 'next',
    dwellMs: 6500,
    ensure: { kind: 'confirmFields' },
  },
  {
    id: 'claims-routing',
    chapter: 'Claim review',
    depth: 'detail',
    route: '/claims',
    target: 'claims.routing.1',
    headline: 'Each claim, routed to its checks.',
    what: 'These chips show where this claim goes. The FOXP3 significance claim routes to Check 1, pseudoreplication, and Check 4, confounding. One claim can trigger several checks, or you can change the routing.',
    why: 'Routing is where the audit is aimed. A claim sent to the wrong check produces a confident wrong verdict, so Redline shows its routing and lets you correct it.',
    advance: 'next',
    dwellMs: 7000,
    ensure: { kind: 'confirmFields' },
  },
  {
    id: 'claims-scope',
    chapter: 'Claim review',
    depth: 'spine',
    route: '/claims',
    target: 'claims.out-of-scope',
    headline: 'Out of scope, and labeled.',
    what: 'Redline read a pseudotime trajectory claim it cannot test. Its checks do not cover trajectory validation, so it lists the claim here, marks it out of scope, and does not audit it.',
    why: 'A silent drop would hide what went untested. Redline shows the claims it set aside and why, so nothing looks audited that never was.',
    advance: 'next',
    dwellMs: 6000,
    ensure: { kind: 'confirmFields' },
  },
  {
    id: 'claims-confirm',
    chapter: 'Claim review',
    depth: 'detail',
    route: '/claims',
    target: 'claims.confirm',
    headline: 'Confirm the list. Now it runs.',
    what: 'Press Confirm and open workbench. Redline runs only the checks your confirmed claims route to. Until you confirm this list, the workbench and every check stay locked.',
    why: 'You own which claims are real. Redline owns the statistics that follow, and it audits only what you ratified, never a claim you struck.',
    advance: 'click',
    dwellMs: 6000,
    ensure: { kind: 'confirmFields' },
  },

  // ── The board ─────────────────────────────────────────────────────────────
  {
    id: 'board',
    chapter: 'The board',
    depth: 'spine',
    route: '/workbench',
    target: 'workbench.board',
    headline: 'One board, every check.',
    what: 'The audit board. Each check runs as its own module against the same interface, the founding pillars alongside the rigor checks, and each carries its own inputs, verdict, and method paper.',
    why: 'Ask a model to review an analysis in prose and it catches fewer than half of these errors. Redline executes the diagnostic instead of reading the code.',
    advance: 'next',
    dwellMs: 6500,
    ensure: { kind: 'confirmClaims' },
  },

  // ── Check 1: pseudoreplication, then its correction ───────────────────────
  {
    id: 'check1-figure',
    chapter: 'Check 1 · Pseudoreplication',
    depth: 'spine',
    route: '/checks/1',
    target: 'check.figure',
    headline: 'The p-value that deflates.',
    what: "The scientist's figure, re-tested. The naive cell-level test reads 6.2e-11 across 51,842 cells. Aggregate to one profile per donor, re-run, and the honest p-value is 0.21.",
    why: 'Cells from one donor track together, so counting them as independent inflates the result. Pseudobulk to the 4 donors and the effect is gone.',
    cite: 'Squair et al., 2021, Nature Communications',
    advance: 'next',
    dwellMs: 7500,
    ensure: { kind: 'runCheck', checkId: 1 },
  },
  {
    id: 'check1-verdict',
    chapter: 'Check 1 · Pseudoreplication',
    depth: 'spine',
    route: '/checks/1',
    target: 'check.verdict',
    headline: 'The claim, struck through.',
    what: 'Redline names the failure mode, strikes out the sentence the scientist wrote, and puts a defensible rewrite in its place, with the method paper that fixes it.',
    why: 'A flag on its own is homework. A rewrite you can paste into the manuscript is the thing a scientist actually needed.',
    cite: 'Squair et al., 2021, Nature Communications',
    advance: 'next',
    dwellMs: 7000,
    ensure: { kind: 'runCheck', checkId: 1 },
  },
  {
    id: 'check1-reasoning',
    chapter: 'Check 1 · Pseudoreplication',
    depth: 'detail',
    route: '/checks/1',
    target: 'check.reasoning',
    headline: 'The reasoning is the product.',
    what: 'This console streams Claude reasoning as it works: count the units under donor_id, note that cells within a donor track together (ICC 0.19), aggregate to donor means, re-test.',
    why: 'A verdict you cannot inspect is a verdict you cannot defend. Redline shows the argument step by step, so you can check its work before you trust it.',
    advance: 'next',
    dwellMs: 7000,
    ensure: { kind: 'runCheck', checkId: 1 },
  },
  {
    id: 'check1-recommend',
    chapter: 'Check 1 · The correction',
    depth: 'spine',
    route: '/checks/1',
    target: 'check.recommend',
    headline: 'What to do about it.',
    what: 'Each recommendation names the concrete step, why it follows from these numbers, and what it would change. A tag says whether you can fix it now, need more data, or cannot rescue the claim.',
    why: 'The feasibility tag is decided by the engine, never the model, so an honest dead end is never talked up into a fix that does not exist.',
    advance: 'next',
    dwellMs: 6500,
    ensure: { kind: 'runCheck', checkId: 1 },
  },
  {
    id: 'check1-code',
    chapter: 'Check 1 · The correction',
    depth: 'detail',
    route: '/checks/1',
    target: 'check.code',
    headline: 'The fix, as code you can run.',
    what: 'Redline hands back the corrected analysis as a script. It reads the h5ad, aggregates to the 4 donors, re-tests with PyDESeq2, and prints the honest p-value. Download it and it runs.',
    why: 'A flag tells you something broke. A script you can run tells you what the result should have been, and lets you check the work yourself.',
    cite: 'Squair et al., 2021, Nature Communications',
    advance: 'next',
    dwellMs: 8000,
    ensure: { kind: 'runCheck', checkId: 1 },
  },
  {
    id: 'check1-beforeafter',
    chapter: 'Check 1 · The correction',
    depth: 'spine',
    route: '/checks/1',
    target: 'check.beforeafter',
    headline: 'Before and after, one toggle.',
    what: 'Toggle between the result the scientist claimed and the analysis they should have had. The after figure is the true output of the corrected code, computed on the 4 donors.',
    why: 'When a claim cannot be rescued, the honest view shows the dead end in plain words and no fake figure, because inventing a clean result is the overclaim Redline exists to catch.',
    advance: 'next',
    dwellMs: 7500,
    ensure: { kind: 'runCheck', checkId: 1 },
  },

  // ── Check 2: double dipping ───────────────────────────────────────────────
  {
    id: 'check2-split',
    chapter: 'Check 2 · Double dipping',
    depth: 'spine',
    route: '/checks/2',
    target: 'check2.split',
    headline: 'The state that collapses.',
    what: 'The four markers, TNFRSF9, ICOS, TIGIT, and CTLA4, were chosen and tested on the same cells. This slider sets the held-out fraction, defines the state on the rest, and scores it on cells it never saw.',
    why: 'Discovery AUC 0.90 falls to 0.57 on held-out cells, near chance, and 0 of 4 markers hold. Redline reports this as evidence and names ClusterDE as the stronger method.',
    cite: 'Gao, Bien and Witten, 2022, J. Amer. Stat. Assoc.',
    advance: 'next',
    dwellMs: 7500,
    ensure: { kind: 'runCheck', checkId: 2 },
  },

  // ── Check 3: fragility, then the clean beat ───────────────────────────────
  {
    id: 'check3-scrub',
    chapter: 'Check 3 · Fragility',
    depth: 'spine',
    route: '/checks/3',
    target: 'check3.scrub',
    headline: 'Drag it. The state blinks.',
    what: 'Drag the Scrub slider across the resolution range. The Effector state the scientist reported appears only between 0.8 and 1.2, then vanishes. The slider moves the figure live and does not re-run the test.',
    why: 'The whole finding rides on one clustering setting the scientist never justified. A group that survives only inside a narrow window is a boundary of the algorithm.',
    cite: 'Luecken and Theis, 2019, Molecular Systems Biology',
    advance: 'click',
    advanceEvent: 'change',
    dwellMs: 7500,
    ensure: { kind: 'setCheck3Track', track: 'Effector' },
    sweepScrub: true,
  },
  {
    id: 'clean-beat',
    chapter: 'Check 3 · The clean beat',
    depth: 'spine',
    route: '/checks/3',
    target: 'check3.track',
    headline: 'Now watch it report clean.',
    what: 'Redline is now tracking the Naive state, a real T-cell group. It holds at all 10 of 10 resolution settings, 100% stable, and the badge reads Verified, in green.',
    why: 'A tool that always finds a problem is a tool nobody trusts. When a claim holds, Redline says so plainly, at the same confidence it gives a flag.',
    cite: 'Luecken and Theis, 2019, Molecular Systems Biology',
    advance: 'next',
    dwellMs: 7500,
    ensure: { kind: 'setCheck3Track', track: 'Naive' },
  },

  // ── Check 4: confounding ──────────────────────────────────────────────────
  {
    id: 'check4-confound',
    chapter: 'Check 4 · Confounding',
    depth: 'detail',
    route: '/checks/4',
    target: 'check4.nuisance',
    headline: "A confound you can't separate.",
    what: "These chips are the technical variables tested against the comparison. Every knockdown ran on Lane-A and every control on Lane-B. Cramér's V is 1.00, perfectly aligned, 0% overlap.",
    why: 'Take lane out of the set and Redline degrades to Could not verify. It declines to rule on a confound you told it to ignore, rather than guessing a number.',
    cite: 'Hicks et al., 2018, Biostatistics',
    advance: 'next',
    dwellMs: 7000,
    ensure: { kind: 'runCheck', checkId: 4 },
  },

  // ── The corrected analysis ────────────────────────────────────────────────
  {
    id: 'corrected-bundle',
    chapter: 'The corrected analysis',
    depth: 'spine',
    route: '/corrected',
    target: 'corrected.bundle',
    headline: 'The fixed pipeline, ready to run.',
    what: 'Every flagged finding, re-analyzed as a script that runs. Take one .py, the consolidated notebook, or the README that records what was wrong and how to run each fix.',
    why: 'A critique ends at the flag, and the scientist still has to do the work. This is the artifact that outlasts the week: the analysis they should have run.',
    advance: 'next',
    dwellMs: 7000,
    ensure: { kind: 'confirmClaims' },
  },

  // ── The report ────────────────────────────────────────────────────────────
  {
    id: 'report',
    chapter: 'The report',
    depth: 'spine',
    route: '/report',
    target: 'report.band',
    headline: 'Every claim, and where it stands.',
    what: 'The assembled report. Each confirmed claim carries its verdict, the numbers behind it, a citation for every call, and a rewrite in language that survives review.',
    why: 'Conclusions in, one plain report out: what is wrong, why it matters, the paper that fixes it, and a rewrite you can defend. Before it becomes a paper.',
    advance: 'next',
    dwellMs: 6500,
    ensure: { kind: 'confirmClaims' },
  },

  // ── One engine, every surface (the closer) ────────────────────────────────
  {
    id: 'engine-surfaces',
    chapter: 'One engine',
    depth: 'spine',
    route: '/environment',
    target: 'env.surfaces',
    headline: 'The same engine, everywhere.',
    what: "The same checks run headless: from redline import audit, and assert_clean() can fail a build. It also ships as an MCP server and a Claude Skill that drops into Claude Science and Claude Code, on a scientist's own data.",
    why: 'A scientist runs this on their own analysis tomorrow. Break your own analysis before Reviewer 2 does.',
    advance: 'next',
    dwellMs: 7500,
  },
];
