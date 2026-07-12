import Link from 'next/link';
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
          <div className="lp-hero-art" aria-hidden="true" />
          <div className="lp-hero-scrim" aria-hidden="true" />
          <div className="lp-hero-in">
            <div className="lp-eyebrow lp-rise">
              <span className="lp-tick" aria-hidden="true" />
              Built with Claude · Life Sciences
            </div>
            <h1 className="lp-h1 lp-rise lp-d1">Break your own analysis before Reviewer 2 does.</h1>
            <p className="lp-sub lp-rise lp-d2">
              Redline is a statistical-rigor auditor for single-cell RNA-seq. Hand it your data and the
              analysis you ran. It re-runs the load-bearing statistics itself, then marks the false
              discoveries on your own figures, before they become a paper.
            </p>
            <div className="lp-hero-cta lp-rise lp-d3">
              <Link className="lp-btn lp-btn-primary" href="/start">
                Launch the workbench <span className="lp-arrow" aria-hidden="true">→</span>
              </Link>
              <a className="lp-btn lp-btn-ghost" href={REPO} target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </div>
            <div className="lp-hero-strip lp-rise lp-d4">
              <span>scanpy</span>
              <span>PyDESeq2</span>
              <span>MCP</span>
              <span>Claude</span>
              <span>Next.js</span>
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
                Catches everything. Cries wolf at nothing.
              </h2>
              <div className="lp-stat-row">
                <div className="lp-stat good">
                  <b>100%</b>
                  <span>of planted errors caught</span>
                </div>
                <div className="lp-stat good">
                  <b>0%</b>
                  <span>false-positive rate on clean controls</span>
                </div>
              </div>
              <div className="lp-vs">
                On a 46-case benchmark of planted statistical errors and clean controls, Redline catches
                every planted error and flags nothing clean. A single Claude call given the same analysis
                write-up also catches <strong>100%</strong>, at a <strong>74% false-positive rate</strong>.
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
            <Link className="lp-btn lp-btn-primary" href="/start">
              Launch the workbench <span className="lp-arrow" aria-hidden="true">→</span>
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
