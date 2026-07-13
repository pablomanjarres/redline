import Link from 'next/link';
import type { CSSProperties } from 'react';
import './landing.css';

/**
 * The front door. A static, plots-quiet landing that says what Redline is, what
 * it catches, how it works, and what it exposes, then hands off to the workbench
 * at /start. Server component, no client JS. Copy follows the honesty voice
 * rules: no em dashes, no "not X but Y", direct and concrete.
 */

const REPO = 'https://github.com/pablomanjarres/redline';
const DOCS = `${REPO}/tree/main/docs`;

const PILLARS = [
  {
    n: 'Pillar 01',
    name: 'Pseudoreplication',
    what: 'Cells from one donor are not independent samples. Testing 40,000 cells as 40,000 observations when they came from four donors inflates the p-value massively.',
    fix: 'Aggregate to one profile per replicate and re-test with pseudobulk. PyDESeq2, Squair 2021.',
  },
  {
    n: 'Pillar 02',
    name: 'Double dipping',
    what: 'Clusters defined on the data and then tested for their own marker genes on that same data manufacture false positives. It is the default in standard pipelines.',
    fix: 'Split the counts by Poisson thinning, define on one half, test on the other. ClusterDE named as the stronger method.',
  },
  {
    n: 'Pillar 03',
    name: 'Clustering fragility',
    what: 'The biological story often rides on an arbitrary clustering resolution the scientist never justified. Move the knob and the cell state can vanish.',
    fix: 'Sweep the resolution, measure agreement with the adjusted Rand index, track whether a named cluster survives.',
  },
  {
    n: 'Pillar 04',
    name: 'Confounding',
    what: 'The comparison of interest can be inseparable from a technical variable, for instance when treated and control samples ran on different days.',
    fix: 'Build the design matrix, check for collinearity, re-fit with the technical variable included to see if the effect survives.',
  },
];

const RIGOR = [
  {
    n: 'Check 05',
    name: 'Multiple testing',
    what: 'Calling genes significant on raw p-values across thousands of tests inflates false discoveries.',
    fix: 'Benjamini-Hochberg control at the chosen q. Reports how many raw hits survive.',
  },
  {
    n: 'Check 06',
    name: 'Unmodeled covariate',
    what: 'A batch or covariate that is separable from the effect but omitted from the model can carry a spurious result.',
    fix: 'Re-fit with the covariate term added and show the claimed statistic beside the corrected one.',
  },
  {
    n: 'Check 07',
    name: 'Resolution choice',
    what: 'A cluster count chosen without a stability criterion is a story built on a default nobody justified.',
    fix: 'Sweep the resolution and score each setting by silhouette or the adjusted Rand index.',
  },
  {
    n: 'Check 08',
    name: 'Test assumptions',
    what: 'A test whose assumptions the data violate reports a number that does not mean what it claims.',
    fix: 'Re-run with the assumption-appropriate test and show the corrected p beside the claimed one.',
  },
];

const FLOW = [
  {
    n: 'Step 00',
    h: 'Foundation',
    p: 'Redline reads your obs columns and proposes the design: which is the biological replicate, which is the comparison, which are technical nuisances. Nothing runs until you confirm it.',
  },
  {
    n: 'Step 01',
    h: 'Claims',
    p: 'An agent inspects your stored results and proposes each auditable claim, already routed to the checks that can test it. You confirm, edit, or remove the list.',
  },
  {
    n: 'Step 02',
    h: 'Checks',
    p: 'Each confirmed claim runs its checks. Every finding is numbers, a named failure mode, a citation, and a conclusion rewritten in defensible language.',
  },
  {
    n: 'Step 03',
    h: 'Report and bundle',
    p: 'A plain-English report with a citation behind every call, plus a downloadable bundle of runnable Python that reproduces the honest re-analysis.',
  },
];

const TARGETS = [
  { b: 'fixture', s: 'Locked deterministic demo, always available.', def: true },
  { b: 'local', s: 'Spawn the Python engine locally on real data.' },
  { b: 'cloudrun', s: 'Dispatch a GCP Cloud Run job for heavy work.' },
  { b: 'endpoint', s: 'A runner you control, your cluster or cloud.' },
];

const SURFACES = [
  {
    tag: 'Next.js · Vercel',
    h: 'Web workbench',
    p: 'A plots-first workbench that renders your figures and marks each finding on them. One panel per check, every knob exposed, the corrected result shown beside the claim.',
    foot: <Link href="/start">Launch the workbench →</Link>,
  },
  {
    tag: 'Model Context Protocol',
    h: 'MCP server',
    p: 'Every check is an independent MCP tool behind one return contract. The same rigor drops into any agent or your own pipeline without touching the driver.',
    foot: 'services/rigor',
  },
  {
    tag: 'Claude Science',
    h: 'Claude Skill',
    p: 'The same engine packaged as a Claude Skill, so it loads natively into Claude Science and runs on a scientist’s own data the day the hackathon ends.',
    foot: 'services/skill',
  },
  {
    tag: 'Downloadable',
    h: 'Correction bundle',
    p: 'For every flagged check you download runnable Python that reproduces the honest re-analysis: a README, a consolidated notebook, one script per finding. What you saw is the output of that code.',
    foot: (
      <a href={`${DOCS}/correction-layer.md`} target="_blank" rel="noreferrer">
        docs/correction-layer.md
      </a>
    ),
  },
];

const RULES = [
  {
    h: 'Correct, and show your work',
    p: 'Everything Redline asserts is shown, reproducible, and cited. The corrected code is downloadable and runs, and the preview is its output.',
  },
  {
    h: 'No fabricated fixes',
    p: 'When a design is unsalvageable, Redline says so plainly and shows no corrected result anywhere. The contract refuses to carry a fix that cannot exist.',
  },
  {
    h: 'Never cry wolf',
    p: 'A clean analysis is a real answer. A passed check renders as Verified in green, stated with the same confidence Redline gives a flag.',
  },
];

/* ── hero instrument: the signature beat, recreated in inline SVG + CSS ───────
   A compact volcano that deflates from fireworks to nearly empty, beside the
   struck claim and its corrected verdict. Every number is the locked Marson
   fixture (packages/engine/src/fixtures/marson.ts, check 01): five genes read
   significant on the naive per-cell test, one (IL2RA) survives the donor-level
   re-test, and the claimed gene FOXP3 collapses from p = 6.2e-11 to p = 0.21.
   Static, no data fetch. The resting state is the deflated answer, so the
   reduced-motion path shows the truth with no motion. Colors are tokens via
   inline CSS (SVG presentation attributes do not resolve var()). */
const ALPHA = 0.05;
const ALPHA_Y_VAL = -Math.log10(ALPHA); // ≈ 1.30
const FIG = { W: 336, H: 208, left: 34, right: 312, top: 20, bottom: 166, maxAbsFc: 2, maxY: 11 };
const figX = (fc: number): number =>
  FIG.left + ((fc + FIG.maxAbsFc) / (2 * FIG.maxAbsFc)) * (FIG.right - FIG.left);
const figY = (v: number): number =>
  FIG.bottom - (Math.min(v, FIG.maxY) / FIG.maxY) * (FIG.bottom - FIG.top);
const FIG_ALPHA_Y = figY(ALPHA_Y_VAL);

type FigGene = { g: string; fc: number; before: number; after: number; claimed?: boolean; survives?: boolean; label?: boolean };
const FIG_GENES: FigGene[] = [
  { g: 'FOXP3', fc: 0.9, before: 10.21, after: 0.68, claimed: true, label: true },
  { g: 'IL2RA', fc: -1.4, before: 8.1, after: 2.0, survives: true, label: true },
  { g: 'CTLA4', fc: 0.7, before: 6.4, after: 0.5 },
  { g: 'IKZF2', fc: 0.5, before: 4.2, after: 0.3 },
  { g: 'TNFRSF18', fc: 0.3, before: 3.1, after: 0.2 },
  { g: 'SELL', fc: -0.2, before: 1.2, after: 0.4 },
];

/** CSS custom props for the per-gene fall (start offset + shared delay). Cast
 *  through unknown so the custom-property keys pass the CSSProperties type. */
function figVars(delay: number, fromY: number): CSSProperties {
  return { '--d': `${delay}s`, '--fromY': `${fromY}px` } as unknown as CSSProperties;
}

function HeroFigure() {
  const tMono: CSSProperties = { font: '500 9px/1 var(--mono)', letterSpacing: '0.02em' };
  return (
    <svg
      className="lp-fig-svg"
      viewBox={`0 0 ${FIG.W} ${FIG.H}`}
      role="img"
      aria-label="Volcano plot. Five genes read significant on the naive per-cell test. After the donor-level re-test only IL2RA stays above the significance line, and the claimed gene FOXP3 collapses below it."
    >
      {/* baseline and zero-fold rule */}
      <line x1={FIG.left} y1={FIG.bottom} x2={FIG.right} y2={FIG.bottom} style={{ stroke: 'var(--plate-line)' }} strokeWidth={1} />
      <line x1={figX(0)} y1={FIG.top} x2={figX(0)} y2={FIG.bottom} style={{ stroke: 'var(--plate-line)' }} strokeWidth={1} />
      {/* significance threshold */}
      <line x1={FIG.left} y1={FIG_ALPHA_Y} x2={FIG.right} y2={FIG_ALPHA_Y} style={{ stroke: 'var(--edge-2)' }} strokeWidth={1} strokeDasharray="4 4" />
      <text x={FIG.right} y={FIG_ALPHA_Y - 5} textAnchor="end" style={{ ...tMono, fill: 'var(--ink-3)' }}>α = .05</text>
      <text x={FIG.left} y={FIG.top - 6} style={{ ...tMono, fill: 'var(--ink-4)' }}>−log₁₀ p</text>

      {/* ghosts: where each firework sat before the honest re-test */}
      {FIG_GENES.filter((g) => g.before > ALPHA_Y_VAL).map((g) => (
        <g key={`gh-${g.g}`}>
          <line
            x1={figX(g.fc)} y1={figY(g.before) + 6} x2={figX(g.fc)} y2={figY(g.after) - 6}
            style={{ stroke: 'var(--edge-2)' }} strokeWidth={1} strokeDasharray="2 4" strokeOpacity={0.7}
          />
          <circle cx={figX(g.fc)} cy={figY(g.before)} r={4.4} fill="none" style={{ stroke: 'var(--red)' }} strokeOpacity={0.34} strokeWidth={1.3} />
        </g>
      ))}

      {/* the deflated dots: each falls from its ghost, red cooling to quiet */}
      {FIG_GENES.map((g, i) => {
        const xa = figX(g.fc);
        const ya = figY(g.after);
        const fromY = figY(g.before) - ya;
        const restFill = g.survives ? 'var(--red)' : 'var(--ink-4)';
        return (
          <g key={g.g} className="lp-fig-fall" style={figVars(0.18 + i * 0.1, fromY)}>
            {g.claimed && <circle cx={xa} cy={ya} r={6.8} fill="none" style={{ stroke: 'var(--ink-3)' }} strokeWidth={1.4} />}
            <circle className="lp-fig-cool" cx={xa} cy={ya} r={4.2} style={{ fill: restFill }} />
            {g.label && (
              <text
                x={xa + 10} y={ya + 3.4}
                style={{ font: '600 9.5px/1 var(--mono)', fill: g.survives ? 'var(--red-deep)' : 'var(--ink-3)' }}
              >
                {g.g}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function HeroInstrument() {
  return (
    <figure className="lp-instrument">
      <figcaption className="lp-fig-head">
        <span className="lp-fig-tag">Check 01 · Pseudoreplication</span>
        <span className="lp-fig-flag">Finding</span>
      </figcaption>

      <div className="lp-fig-plate">
        <HeroFigure />
        <div className="lp-fig-count">
          <b>5</b> genes read significant <span aria-hidden="true">·</span> <b>1</b> survives the honest re-test
        </div>
      </div>

      <div className="lp-fig-readout">
        <p className="lp-fig-claim">
          <span className="lp-sr">Claim, struck through: </span>
          IL2RA knockdown significantly increased FOXP3 expression (p &lt; 0.001, n = 51,842).
        </p>
        <p className="lp-fig-corrected lp-fx-drop">
          <span className="lp-sr">Corrected: </span>
          <span className="lp-fig-caret" aria-hidden="true">▸</span>
          <span>
            IL2RA knockdown did not significantly change FOXP3 expression at the donor level
            (Welch’s t, p = 0.21, n = 4 donors).
          </span>
        </p>
      </div>

      <div className="lp-fig-bench">
        <span className="lp-fig-bench-k">False positives on clean controls</span>
        <div className="lp-fig-bench-row">
          <div className="lp-fig-bench-cell">
            <b className="good">0%</b>
            <span>Redline</span>
          </div>
          <div className="lp-fig-bench-cell">
            <b>74%</b>
            <span>single AI pass</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

function Checks({ items }: { items: typeof PILLARS }) {
  return (
    <div className="lp-checks">
      {items.map((c) => (
        <article key={c.name} className="lp-check">
          <div className="lp-check-n">{c.n}</div>
          <h3 className="lp-check-name">{c.name}</h3>
          <p className="lp-check-what">{c.what}</p>
          <div className="lp-check-fix">{c.fix}</div>
        </article>
      ))}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="lp">
      {/* ── nav ─────────────────────────────────────────────────────── */}
      <nav className="lp-nav" aria-label="Primary">
        <div className="lp-nav-in">
          <Link href="/" className="lp-mark" aria-label="Redline home">
            <b>REDLINE</b>
            <i aria-hidden="true" />
          </Link>
          <span className="lp-chip">Statistical auditor</span>
          <div className="lp-nav-links">
            <a href="#catches">What it catches</a>
            <a href="#how">How it works</a>
            <a href="#exposes">What it exposes</a>
            <a href="#proof">Benchmark</a>
          </div>
          <div className="lp-nav-cta">
            <a className="lp-btn lp-btn-ghost lp-btn-sm" href={REPO} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
            <Link className="lp-btn lp-btn-primary lp-btn-sm" href="/start">
              Launch the workbench <span className="lp-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </nav>

      <main>
        {/* ── hero ──────────────────────────────────────────────────── */}
        <header className="lp-hero">
          <div className="lp-hero-grid" aria-hidden="true" />
          <div className="lp-hero-in">
            <div className="lp-hero-copy">
              <div className="lp-eyebrow lp-rise">
                <span className="lp-tick" aria-hidden="true" />
                Built with Claude · Life Sciences
              </div>
              <h1 className="lp-h1 lp-rise lp-d1">Break your own analysis before Reviewer 2 does.</h1>
              <p className="lp-sub lp-rise lp-d2">
                Point a general-purpose AI at your single-cell analysis and it cries wolf on <b>74%</b> of
                clean results. Redline re-runs the load-bearing statistics on your own data and cries wolf
                on <b>none</b> of them, then marks the real false discoveries on the figures you already made.
              </p>
              <div className="lp-hero-cta lp-rise lp-d3">
                <Link className="lp-btn lp-btn-primary lp-btn-hero" href="/start?tour=1">
                  Take the guided tour <span className="lp-arrow" aria-hidden="true">→</span>
                </Link>
                <a className="lp-btn lp-btn-ghost" href={REPO} target="_blank" rel="noreferrer">
                  View on GitHub
                </a>
              </div>
              <p className="lp-hero-note lp-rise lp-d3">
                Live demo. It runs on a locked fixture with zero API keys.{' '}
                <Link href="/start" className="lp-hero-skip">Skip to the workbench →</Link>
              </p>
              <div className="lp-hero-strip lp-rise lp-d4">
                <span>scanpy</span>
                <span>PyDESeq2</span>
                <span>MCP</span>
                <span>Claude</span>
                <span>Next.js</span>
              </div>
            </div>

            <div className="lp-hero-panel lp-rise lp-d2">
              <HeroInstrument />
              <div className="lp-hero-sign">
                <img
                  className="lp-hero-critter"
                  src="/lab-critter-walk.gif"
                  alt="Redline's lab-critter mascot, Reviewer 2 in a lab coat holding a red pen"
                  width={960}
                  height={300}
                />
                <span className="lp-hero-sign-cap">Your Reviewer 2, on the bench.</span>
              </div>
            </div>
          </div>
        </header>

        {/* ── positioning ───────────────────────────────────────────── */}
        <section className="lp-position" aria-label="Where Redline sits">
          <div className="lp-wrap lp-position-in">
            QC is solved and commoditized. A generic reviewer reads a finished paper.{' '}
            <span className="lp-em">
              Redline works one level in from both, on your own data and your own code, on the
              statistical reasoning, before any of it is published.
            </span>
          </div>
        </section>

        {/* ── what it catches ───────────────────────────────────────── */}
        <section id="catches" className="lp-section" aria-labelledby="catches-h">
          <div className="lp-wrap">
            <span className="lp-kicker">What it catches</span>
            <h2 id="catches-h" className="lp-h2">
              Eight ways an analysis fools its own author.
            </h2>
            <p className="lp-lead">
              Four founding pillars and four rigor checks, every one on the same module interface. Each
              finding names the failure mode, cites the method paper that fixes it, and shows the
              corrected result beside the claim.
            </p>

            <div className="lp-group-label">Founding pillars</div>
            <Checks items={PILLARS} />

            <div className="lp-group-label">Rigor checks</div>
            <Checks items={RIGOR} />
          </div>
        </section>

        {/* ── proof / benchmark ─────────────────────────────────────── */}
        <section id="proof" className="lp-proof lp-section" aria-labelledby="proof-h">
          <div className="lp-wrap lp-proof-grid">
            <div>
              <span className="lp-kicker">Measured, not asserted</span>
              <h2 id="proof-h" className="lp-h2">
                Zero false positives, where a general-purpose AI hits 74%.
              </h2>
              <div className="lp-stat-row">
                <div className="lp-stat good">
                  <b>0%</b>
                  <span>Redline false-positive rate on clean controls</span>
                </div>
                <div className="lp-stat">
                  <b>74%</b>
                  <span>false-positive rate, one general-purpose AI call</span>
                </div>
              </div>
              <div className="lp-vs">
                On a 46-case benchmark of planted statistical errors and clean controls, both Redline
                and a single Claude call catch essentially all of the planted errors, so detection is
                near-definitional. The load-bearing result is the false-positive gap. Redline flags
                nothing clean. The general-purpose call flags <strong>74%</strong>.
                See <code>services/rigor/bench</code>.
              </div>
            </div>
            <div>
              <span className="lp-kicker">The rules it never breaks</span>
              <div className="lp-rules" style={{ marginTop: 20 }}>
                {RULES.map((r) => (
                  <div key={r.h} className="lp-rule">
                    <span className="lp-dot" aria-hidden="true" />
                    <div>
                      <h4>{r.h}</h4>
                      <p>{r.p}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── how it works ──────────────────────────────────────────── */}
        <section id="how" className="lp-section" aria-labelledby="how-h">
          <div className="lp-wrap">
            <span className="lp-kicker">How it works</span>
            <h2 id="how-h" className="lp-h2">
              One engine, every surface.
            </h2>
            <p className="lp-lead">
              A foundation step resolves the design, an agent proposes the claims, and the registered
              checks run on the roles you confirmed. A ComputeTarget seam decides where the statistics
              actually run, behind one return contract, so the interface never changes.
            </p>

            <div className="lp-flow">
              {FLOW.map((s) => (
                <div key={s.h} className="lp-step">
                  <div className="lp-step-n">{s.n}</div>
                  <h4>{s.h}</h4>
                  <p>{s.p}</p>
                </div>
              ))}
            </div>

            <div className="lp-targets" role="list" aria-label="Compute targets">
              {TARGETS.map((t) => (
                <div key={t.b} className={`lp-target${t.def ? ' def' : ''}`} role="listitem">
                  <b>{t.b}</b>
                  <span>{t.s}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── what it exposes ───────────────────────────────────────── */}
        <section id="exposes" className="lp-section" aria-labelledby="exposes-h">
          <div className="lp-wrap">
            <span className="lp-kicker">What it exposes</span>
            <h2 id="exposes-h" className="lp-h2">
              The same rigor, on four surfaces.
            </h2>
            <p className="lp-lead">
              Everything is open and configurable through env vars, with no hidden paths. The core drops
              into a browser, an agent, Claude Science, or a downloadable script that runs on your laptop.
            </p>

            <div className="lp-surfaces">
              {SURFACES.map((s) => (
                <article key={s.h} className="lp-surface">
                  <span className="lp-surface-tag">{s.tag}</span>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                  <div className="lp-surface-foot">{s.foot}</div>
                </article>
              ))}
            </div>

            <div className="lp-contract">
              <b style={{ color: 'var(--ink)' }}>One shape underneath.</b>{' '}
              <code>@redline/contracts</code> holds the Zod shapes every surface speaks. The fixture, the
              Python engine, the reasoning layer, and the UI all agree on one contract, so a finding means
              the same thing everywhere it lands.
            </div>
          </div>
        </section>

        {/* ── dataset note ──────────────────────────────────────────── */}
        <section
          className="lp-section"
          aria-labelledby="data-h"
          style={{ paddingBlock: 'clamp(48px,7vw,96px)' }}
        >
          <div className="lp-wrap lp-note">
            <div className="lp-note-badge">
              Reference
              <br />
              dataset
            </div>
            <div>
              <h2 id="data-h" className="lp-h2" style={{ marginTop: 0 }}>
                Built against a real one.
              </h2>
              <p style={{ marginTop: 16 }}>
                Redline is dataset-agnostic, but it is validated against the Marson and Pritchard
                genome-scale CD4+ T-cell Perturb-seq data, Gladstone’s flagship single-cell resource,
                with raw counts so the re-runs are real.
              </p>
              <p>
                <b>One hard rule.</b> The authors did their analysis rigorously, and there is no error in
                their published work to catch. Redline audits a naive foil instead, the standard
                cluster-then-annotate-then-DE workflow a less-experienced scientist would run on the same
                data. Pointed at a clean analysis, Redline reports clean.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ── closing CTA ─────────────────────────────────────────────── */}
      <section className="lp-close" aria-labelledby="close-h">
        <div className="lp-close-art" aria-hidden="true" />
        <div className="lp-close-scrim" aria-hidden="true" />
        <div className="lp-wrap lp-close-in">
          <span className="lp-eyebrow" style={{ color: 'var(--ink-3)' }}>
            <span
              className="lp-tick"
              aria-hidden="true"
              style={{ background: 'var(--ink-3)', boxShadow: 'none' }}
            />
            Run it on your own h5ad
          </span>
          <h2 id="close-h">Break it before Reviewer 2 does.</h2>
          <p>
            Drop in the data you analyzed and the analysis you ran. The demo runs on a locked fixture with
            zero cloud credentials, then point it at the Python engine to run the real statistics on your
            own data.
          </p>
          <div className="lp-close-cta">
            <Link className="lp-btn lp-btn-primary lp-btn-hero" href="/start?tour=1">
              Take the guided tour <span className="lp-arrow" aria-hidden="true">→</span>
            </Link>
            <a className="lp-btn lp-btn-ghost" href={DOCS} target="_blank" rel="noreferrer">
              Read the docs
            </a>
          </div>
        </div>
      </section>

      {/* ── footer ──────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <Link href="/" className="lp-mark" aria-label="Redline home">
            <b>REDLINE</b>
            <i aria-hidden="true" />
          </Link>
          <div className="lp-footer-meta">
            MIT licensed · Built by <b>Pablo Manjarres</b>
            <br />
            Built with Claude: Life Sciences (Anthropic × Gladstone Institutes)
          </div>
          <div className="lp-footer-links">
            <Link href="/start">Workbench</Link>
            <a href={DOCS} target="_blank" rel="noreferrer">
              Docs
            </a>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
          <div className="lp-tech">
            TypeScript · Node 22 · pnpm · turbo · React 19 · Next.js · Zod · Python · scanpy · decoupler ·
            PyDESeq2 · numpy · MCP · GCP Cloud Run · Vercel · Claude
          </div>
        </div>
      </footer>
    </div>
  );
}
