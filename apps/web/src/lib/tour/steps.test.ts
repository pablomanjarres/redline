import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { THREADED_ANCHORS, TOUR_ANCHORS, type TourAnchor } from './anchors';
import { TOUR_STEPS } from './steps';
import { INITIAL_TOUR_STATE, nextSpineIndex, tourReducer, type TourState } from './types';

/**
 * The tour is prose that ships in the product, so it is bound by the repo's
 * voice and honesty rules exactly like the report copy. These tests are the
 * enforcement. They also prove, statically, that every control the tour promises
 * to spotlight really carries its `data-tour` attribute, so a typo fails here
 * instead of showing an empty spotlight on stage.
 */

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const ALL_SOURCE = sourceFiles(SRC)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Every user-facing string the tour renders. */
function copyOf(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const s of TOUR_STEPS) {
    out.push({ where: `${s.id}.headline`, text: s.headline });
    out.push({ where: `${s.id}.chapter`, text: s.chapter });
    out.push({ where: `${s.id}.what`, text: s.what });
    if (s.why) out.push({ where: `${s.id}.why`, text: s.why });
    if (s.cite) out.push({ where: `${s.id}.cite`, text: s.cite });
    if (s.primaryCta) out.push({ where: `${s.id}.primaryCta`, text: s.primaryCta });
    if (s.secondaryCta) out.push({ where: `${s.id}.secondaryCta`, text: s.secondaryCta });
    if (s.tertiaryCta) out.push({ where: `${s.id}.tertiaryCta`, text: s.tertiaryCta });
  }
  return out;
}

const COPY = copyOf();
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

describe('tour copy obeys the repo voice rules', () => {
  it('contains no em dash', () => {
    const bad = COPY.filter((c) => c.text.includes('—'));
    expect(bad.map((b) => `${b.where}: ${b.text}`)).toEqual([]);
  });

  it('uses an en dash only inside a numeric range', () => {
    const bad = COPY.filter((c) => {
      const i = c.text.indexOf('–');
      if (i === -1) return false;
      return !/\d–\d/.test(c.text);
    });
    expect(bad.map((b) => `${b.where}: ${b.text}`)).toEqual([]);
  });

  it('contains no AI-tell vocabulary', () => {
    const banned = [
      'delve',
      'leverage',
      'seamless',
      'unlock',
      'in today',
      'revolutionary',
      'game-changing',
      'game changing',
      'cutting-edge',
      'harness the power',
      'powerful',
      'robust solution',
      'elevate',
      'supercharge',
    ];
    const bad: string[] = [];
    for (const c of COPY) {
      const lower = c.text.toLowerCase();
      for (const b of banned) if (lower.includes(b)) bad.push(`${c.where}: "${b}" in ${c.text}`);
    }
    expect(bad).toEqual([]);
  });

  it('contains no "not X, but Y" reframe', () => {
    const patterns = [
      /\bis not\s+[^.;]{1,50},\s*(but|it)\b/i,
      /\bisn't just\b/i,
      /\bis not just\b/i,
      /\bnot only\b[^.;]{1,60}\bbut also\b/i,
    ];
    const bad: string[] = [];
    for (const c of COPY) for (const p of patterns) if (p.test(c.text)) bad.push(`${c.where}: ${c.text}`);
    expect(bad).toEqual([]);
  });

  it('never implies the dataset authors erred', () => {
    // The tour audits a naive foil. It may name the authors, and it may not
    // attach a mistake to them.
    const bad = COPY.filter((c) =>
      /(authors|Marson|Pritchard|published)[^.]{0,60}\b(erred|error|mistake|wrong|got it wrong|failed)\b/i.test(c.text),
    );
    expect(bad.map((b) => `${b.where}: ${b.text}`)).toEqual([]);
  });

  it('names the naive foil in the opening step', () => {
    const opener = `${TOUR_STEPS[0]!.what} ${TOUR_STEPS[0]!.why ?? ''}`.toLowerCase();
    expect(opener).toMatch(/naive/);
  });

  it('never calls Check 2 an FDR correction', () => {
    const bad = COPY.filter((c) => /fdr[- ]?(correct|controlled)/i.test(c.text));
    expect(bad.map((b) => `${b.where}: ${b.text}`)).toEqual([]);
  });

  it('names ClusterDE wherever it describes the double-dipping check', () => {
    const doubleDip = TOUR_STEPS.filter((s) => s.route === '/checks/2');
    expect(doubleDip.length).toBeGreaterThan(0);
    const joined = doubleDip.map((s) => `${s.what} ${s.why ?? ''} ${s.cite ?? ''}`).join(' ');
    expect(joined).toMatch(/ClusterDE/i);
  });

  it('never presents the disabled upload control as live', () => {
    const upload = TOUR_STEPS.filter((s) => s.target === 'intake.upload');
    for (const s of upload) {
      const text = `${s.what} ${s.why ?? ''}`.toLowerCase();
      expect(text).toMatch(/compute target|disabled|wired|connect/);
    }
  });

  it('never says Redline wrote or invented a claim', () => {
    // The Claim Review screen rests on one honesty invariant (spec section 11):
    // Redline EXTRACTS the claims the analysis already makes. It reads, proposes,
    // and routes them; it never authors one to fill the list. A step that said it
    // did would sell the exact fabrication the product exists to catch.
    const bad = COPY.filter(
      (c) =>
        /\b(invent(s|ed)?|fabricat(e|es|ed)|conjure[sd]?|made up|make up|dream(s|t|ed)? up)\b[^.?!]{0,40}\bclaims?\b/i.test(
          c.text,
        ) ||
        /\bclaims?\b[^.?!]{0,40}\b(invent(s|ed)?|fabricat(e|es|ed)|made up|conjured)\b/i.test(c.text) ||
        /\bredline\b[^.?!]{0,30}\b(wrote|writes|authored)\b[^.?!]{0,20}\bclaims?\b/i.test(c.text),
    );
    expect(bad.map((b) => `${b.where}: ${b.text}`)).toEqual([]);
  });

  it('shows the out-of-scope group as claims it does not audit', () => {
    // Spec sections 6, 8, and 11: an out-of-scope claim is labeled and left
    // untested, never silently audited. A step must cover that group and say so.
    const scope = TOUR_STEPS.filter((s) => s.target === 'claims.out-of-scope');
    expect(scope.length, 'a step must cover the out-of-scope group').toBeGreaterThan(0);
    for (const s of scope) {
      const text = `${s.what} ${s.why ?? ''}`.toLowerCase();
      expect(text).toMatch(/out of scope|not (tested|audited|audit|checked|run)|set aside/);
    }
  });
});

describe('tour copy stays inside its layout budget', () => {
  it('keeps headlines short enough for the card', () => {
    const bad = TOUR_STEPS.filter((s) => s.headline.length > 46).map((s) => `${s.id}: ${s.headline.length}`);
    expect(bad).toEqual([]);
  });

  it('keeps "what" under 40 words and "why" under 34', () => {
    const bad: string[] = [];
    for (const s of TOUR_STEPS) {
      if (words(s.what) > 40) bad.push(`${s.id}.what has ${words(s.what)} words`);
      if (s.why && words(s.why) > 34) bad.push(`${s.id}.why has ${words(s.why)} words`);
    }
    expect(bad).toEqual([]);
  });
});

describe('the tour script is structurally sound', () => {
  it('has a workable length', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(13);
    // Intake and claim review added four steps, the correction layer three more
    // and the /corrected bundle. The full guided script is capped here; the
    // presenter spine has its own, tighter budget (see the depth suite below),
    // which is what actually keeps a hands-free run inside two minutes.
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(27);
  });

  it('every step declares a depth', () => {
    const bad = TOUR_STEPS.filter((s) => s.depth !== 'spine' && s.depth !== 'detail');
    expect(bad.map((s) => s.id)).toEqual([]);
  });

  it('has unique step ids', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('opens on a centered welcome card with three doors', () => {
    const first = TOUR_STEPS[0]!;
    expect(first.target).toBeNull();
    expect(first.primaryCta).toBeTruthy();
    expect(first.secondaryCta).toBeTruthy();
  });

  it('only targets registered anchors', () => {
    const known = new Set<string>(TOUR_ANCHORS);
    const bad = TOUR_STEPS.filter((s) => s.target !== null && !known.has(s.target));
    expect(bad.map((s) => `${s.id} -> ${s.target}`)).toEqual([]);
  });

  it('only routes to real app routes', () => {
    // `/claims` is the claim-review screen (intake and claim extraction).
    // `/corrected` is the corrected-analysis bundle (the correction layer).
    // `checks/[1-8]` because the rigor checks took the registry from four to eight.
    const routes = /^\/(fields|claims|workbench|report|corrected|environment|checks\/[1-8])?$/;
    const bad = TOUR_STEPS.filter((s) => !routes.test(s.route));
    expect(bad.map((s) => `${s.id} -> ${s.route}`)).toEqual([]);
  });

  it('gives presenter mode a sane dwell on every step', () => {
    const bad = TOUR_STEPS.filter((s) => s.dwellMs < 3000 || s.dwellMs > 12000);
    expect(bad.map((s) => `${s.id}: ${s.dwellMs}`)).toEqual([]);
  });

  it('never asks the reader to click a card with no target', () => {
    const bad = TOUR_STEPS.filter((s) => s.advance === 'click' && s.target === null);
    expect(bad.map((s) => s.id)).toEqual([]);
  });

  it('runs the check that owns every result-gated anchor before spotlighting it', () => {
    const resultGated = new Set(['check.stats', 'check.verdict', 'check.badge', 'report.row.1']);
    const bad: string[] = [];
    for (const s of TOUR_STEPS) {
      if (s.target && resultGated.has(s.target) && !s.ensure) bad.push(s.id);
    }
    expect(bad).toEqual([]);
  });

  it('keeps the clean beat, and points it at the stable group', () => {
    // Two of the three drafts wired the clean beat to `Effector`, the spurious
    // group, which would have flagged red while the copy promised green. The
    // clean beat must track the group that holds.
    const cleanBeat = TOUR_STEPS.find((s) => s.id === 'clean-beat');
    expect(cleanBeat, 'a step must track a stable group and report clean').toBeTruthy();
    expect(cleanBeat!.ensure).toEqual({ kind: 'setCheck3Track', track: 'Naive' });
    expect(`${cleanBeat!.what} ${cleanBeat!.why}`).toMatch(/verified|clean|holds/i);
  });

  it('closes on the engine surface', () => {
    const closer = TOUR_STEPS[TOUR_STEPS.length - 1]!;
    expect(closer.route).toBe('/environment');
    expect(`${closer.what} ${closer.why ?? ''}`).toMatch(/MCP|Skill/);
  });

  it('states the naive-foil framing before it shows a single number', () => {
    const opener = TOUR_STEPS[0]!;
    expect(`${opener.what} ${opener.why ?? ''}`).toMatch(/rigorous/i);
  });

  it('walks the corrected-analysis bundle', () => {
    // The correction layer's whole thesis is that Redline hands back a fixed
    // pipeline, not only a critique. A tour that flagged errors and never
    // showed the artifact would undersell the feature it is demoing.
    const corrected = TOUR_STEPS.find((s) => s.route === '/corrected');
    expect(corrected, 'a step must visit /corrected').toBeTruthy();
    expect(`${corrected!.what} ${corrected!.why ?? ''}`).toMatch(/run|script|pipeline|notebook/i);
  });

  it('never hard-codes a check count that the registry can outgrow', () => {
    // "four load-bearing checks" was true at four checks and false at eight.
    // The registry is the only place that counts checks; the tour describes
    // them without numbering them, so a new rigor check cannot make it lie.
    const countWord = /\b(four|five|six|seven|eight)\b[^.]{0,24}\bcheck/i;
    const bad = COPY.filter((c) => countWord.test(c.text));
    expect(bad.map((b) => `${b.where}: ${b.text}`)).toEqual([]);
  });
});

describe('the presenter spine stays inside its budget', () => {
  // Presenter mode plays the `spine` and skips the `detail`, so the arc a judge
  // watches hands-free is the spine, not the whole script. This is the budget
  // the last three feature branches each spent a little of; it is enforced here
  // so the next one has to make room rather than quietly run long.
  const spine = TOUR_STEPS.filter((s) => s.depth === 'spine');

  it('covers the whole arc: welcome, a flag, the clean beat, the correction, the report, the engine', () => {
    const routes = new Set(spine.map((s) => s.route));
    expect(spine[0]!.id).toBe('welcome');
    for (const r of ['/checks/1', '/checks/3', '/corrected', '/report', '/environment']) {
      expect(routes.has(r), `spine must visit ${r}`).toBe(true);
    }
    // The clean beat is the trust-building moment; it must be on the spine.
    expect(spine.some((s) => s.id === 'clean-beat')).toBe(true);
  });

  it('runs under two minutes at its per-step dwell', () => {
    const ms = spine.reduce((t, s) => t + s.dwellMs, 0);
    expect(ms).toBeLessThanOrEqual(120_000);
  });

  it('closes on the engine surface even with detail steps hidden', () => {
    expect(spine[spine.length - 1]!.route).toBe('/environment');
  });
});

describe('every spotlight target exists in the markup', () => {
  /**
   * An id reaches the DOM three ways: as a literal attribute, as a template
   * literal keyed by check id, or threaded through a prop into a mapped child.
   * A threaded id must still appear verbatim somewhere in source, so a typo
   * still fails here.
   */
  function isAttached(id: TourAnchor): boolean {
    if (ALL_SOURCE.includes(`data-tour="${id}"`)) return true;
    if (!THREADED_ANCHORS.includes(id)) return false;
    const stem = id.replace(/\.\d+$/, '.');
    if (stem !== id && ALL_SOURCE.includes(`data-tour={\`${stem}$`)) return true;
    return ALL_SOURCE.includes(`'${id}'`) && ALL_SOURCE.includes('data-tour={');
  }

  it('attaches a data-tour attribute for each anchor a step uses', () => {
    const missing = [...new Set(TOUR_STEPS.map((s) => s.target).filter((t): t is TourAnchor => t !== null))].filter(
      (t) => !isAttached(t),
    );
    expect(missing).toEqual([]);
  });

  it('attaches every anchor in the registry, including the ones no step uses yet', () => {
    expect(TOUR_ANCHORS.filter((a) => !isAttached(a))).toEqual([]);
  });

  it('registers every anchor the markup actually emits', () => {
    const emitted = [...ALL_SOURCE.matchAll(/data-tour="([\w.-]+)"/g)].map((m) => m[1]!);
    const known = new Set<string>(TOUR_ANCHORS);
    const unregistered = emitted.filter((id) => !known.has(id));
    expect([...new Set(unregistered)]).toEqual([]);
  });
});

describe('the tour reducer', () => {
  const N = 5;
  const run = (s: TourState, a: Parameters<typeof tourReducer>[1]) => tourReducer(s, a, N);
  const active: TourState = { active: true, mode: 'guided', index: 0, paused: false };

  it('starts inactive', () => {
    expect(INITIAL_TOUR_STATE.active).toBe(false);
  });

  it('advances and clamps back at zero', () => {
    expect(run(active, { type: 'next' }).index).toBe(1);
    expect(run(active, { type: 'back' }).index).toBe(0);
  });

  it('ends the tour when advancing past the last step', () => {
    const last: TourState = { ...active, index: N - 1 };
    expect(run(last, { type: 'next' }).active).toBe(false);
  });

  it('clamps a goto into range', () => {
    expect(run(active, { type: 'goto', index: 99 }).index).toBe(N - 1);
    expect(run(active, { type: 'goto', index: -4 }).index).toBe(0);
  });

  it('toggles presenter pause', () => {
    const presenting: TourState = { ...active, mode: 'presenter' };
    expect(run(presenting, { type: 'togglePause' }).paused).toBe(true);
  });

  it('resumes on any navigation', () => {
    const paused: TourState = { ...active, mode: 'presenter', paused: true };
    expect(run(paused, { type: 'next' }).paused).toBe(false);
  });

  it('stop clears the tour but remembers the mode', () => {
    const presenting: TourState = { ...active, mode: 'presenter', index: 3 };
    const stopped = run(presenting, { type: 'stop' });
    expect(stopped.active).toBe(false);
    expect(stopped.index).toBe(0);
    expect(stopped.mode).toBe('presenter');
  });
});

describe('nextSpineIndex (the presenter skip)', () => {
  const d = ['spine', 'detail', 'detail', 'spine', 'detail'] as const;

  it('returns the index itself when it is already a spine step', () => {
    expect(nextSpineIndex(d, 0)).toBe(0);
    expect(nextSpineIndex(d, 3)).toBe(3);
  });

  it('skips forward over detail steps', () => {
    expect(nextSpineIndex(d, 1)).toBe(3);
    expect(nextSpineIndex(d, 2)).toBe(3);
  });

  it('returns length past the end when nothing ahead is spine', () => {
    expect(nextSpineIndex(d, 4)).toBe(d.length);
    expect(nextSpineIndex(d, 99)).toBe(d.length);
  });

  it('drives the real script from welcome through the whole spine to the engine', () => {
    // Walk the way presenter does: land on 0, then jump by nextSpineIndex(i+1).
    const depths = TOUR_STEPS.map((s) => s.depth);
    const visited: number[] = [];
    let i = nextSpineIndex(depths, 0);
    while (i < TOUR_STEPS.length) {
      visited.push(i);
      i = nextSpineIndex(depths, i + 1);
    }
    const ids = visited.map((n) => TOUR_STEPS[n]!.id);
    expect(ids[0]).toBe('welcome');
    expect(ids).toContain('clean-beat');
    expect(ids).toContain('corrected-bundle');
    expect(TOUR_STEPS[visited[visited.length - 1]!]!.route).toBe('/environment');
    // Presenter never rests on a detail step.
    expect(visited.every((n) => TOUR_STEPS[n]!.depth === 'spine')).toBe(true);
  });
});
