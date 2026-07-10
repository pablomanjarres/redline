'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Confidence } from '@redline/contracts';
import { useSession } from '@/state/session';
import { ReasoningConsole } from '@/components/check/ReasoningConsole';
import { AddClaim } from '@/components/claims/AddClaim';
import { ClaimCard } from '@/components/claims/ClaimCard';
import { OutOfScopeCard } from '@/components/claims/OutOfScopeCard';
import { CONF_COLOR, CURATED_CLAIMS_NOTICE } from '@/components/claims/shared';

/**
 * Claim Review (spec section 6). The second interactive surface, right after
 * design resolution, and built to parallel it: header, an inline tally, one
 * confirm button, then the list of claim cards, an out-of-scope group, and the
 * manual-entry affordance. Redline read the analysis and proposed the auditable
 * claims; the scientist ratifies the list before anything runs in the workbench.
 *
 * Every honesty surface is here: a curated fallback is labeled and never dressed
 * as a live reading, out-of-scope claims sit in their own group with the reason,
 * ambiguous routing is shown on the card, and an empty result says so plainly and
 * offers manual entry rather than inventing a claim.
 */

const TALLY: { key: Confidence; label: string }[] = [
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Med' },
  { key: 'low', label: 'Low' },
];

export default function ClaimsPage() {
  const {
    extractedClaims,
    claimsSource,
    extractionAssessment,
    extracting,
    extractionLines,
    extractionReveal,
    confirmClaims,
    setClaimStatus,
    setClaimText,
    setClaimRouting,
  } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const uid = useId();
  const readingReasonId = `${uid}-reading`;
  const emptyReasonId = `${uid}-empty`;
  const noAuditReasonId = `${uid}-noaudit`;
  const inScopeLabelId = `${uid}-inscope`;
  const outScopeLabelId = `${uid}-outscope`;

  const claims = extractedClaims;
  const hasResult = claims !== null; // extraction produced a list (possibly empty)
  const scopeClaims = (claims ?? []).filter((c) => c.status !== 'out_of_scope');
  const outOfScope = (claims ?? []).filter((c) => c.status === 'out_of_scope');
  const active = scopeClaims.filter((c) => c.status !== 'removed');
  const routable = active.filter((c) => c.checks.length > 0);

  const counts: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  for (const c of active) counts[c.confidence]++;

  // Nothing routes to a check: an empty result, an all-removed list, or a list
  // that is entirely out of scope. Any of these means the workbench would run
  // nothing, so the confirm is held and manual entry is the way forward.
  const noAuditable = hasResult && !extracting && routable.length === 0;
  const canConfirm = !extracting && routable.length > 0;
  const confirmDisabled = pending || !canConfirm;
  const confirmLabel = extracting
    ? 'Reading analysis…'
    : pending
      ? 'Opening workbench…'
      : 'Confirm & open workbench';

  // A disabled Confirm must say why to a screen reader, the same way the reason
  // is on screen for a sighted user (honesty rule 6). Point aria-describedby at
  // the visible element that states the live reason: extraction is still reading,
  // no extraction has run yet, or the extraction found nothing auditable. Each id
  // is only referenced while the element carrying it is rendered.
  const confirmReasonId = extracting
    ? readingReasonId
    : !hasResult
      ? emptyReasonId
      : noAuditable
        ? noAuditReasonId
        : undefined;

  async function onConfirm() {
    if (pending || !canConfirm) return;
    setPending(true);
    try {
      await confirmClaims();
      router.push('/workbench');
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '34px 40px 72px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 28 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--red)', boxShadow: '0 0 8px var(--red)' }} />
            <span
              style={{
                font: '600 11px/1 var(--mono)',
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: 'var(--red)',
              }}
            >
              Claim Review · Extraction
            </span>
          </div>
          <h1 style={{ margin: '13px 0 0', font: '800 30px/1.05 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)' }}>
            Confirm the claims Redline will test.
          </h1>
          <p style={{ margin: '11px 0 0', maxWidth: 640, font: '400 13.5px/1.55 var(--sans)', color: 'var(--ink-2)' }}>
            Redline read your analysis and proposed each auditable claim, what it rests on, and which checks will test it.
            Confirm the list, correct a claim, or add one.
          </p>
        </div>

        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14 }}>
          <div data-tour="claims.tally" style={{ display: 'flex', gap: 8 }} role="group" aria-label="Claim tally">
            {extracting ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  font: '600 11px/1 var(--mono)',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--edge)',
                  padding: '7px 11px',
                  borderRadius: 8,
                  color: 'var(--ink-3)',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 7, background: 'var(--signal)', boxShadow: '0 0 7px var(--signal)', animation: 'rl-pulse 1s infinite' }} />
                Reading
              </span>
            ) : (
              <>
                {TALLY.map(({ key, label }) => {
                  const on = counts[key] > 0;
                  return (
                    <span
                      key={key}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        font: '600 11px/1 var(--mono)',
                        background: 'var(--panel-2)',
                        border: '1px solid var(--edge)',
                        padding: '7px 11px',
                        borderRadius: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 7,
                          background: on ? CONF_COLOR[key] : 'var(--ink-4)',
                          boxShadow: on ? `0 0 7px ${CONF_COLOR[key]}` : 'none',
                        }}
                      />
                      <span style={{ color: 'var(--ink)' }}>{counts[key]}</span>
                      <span style={{ letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{label}</span>
                    </span>
                  );
                })}
                {outOfScope.length > 0 && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      font: '600 11px/1 var(--mono)',
                      background: 'var(--panel-2)',
                      border: '1px solid var(--edge)',
                      padding: '7px 11px',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 7, background: 'var(--ink-4)' }} />
                    <span style={{ color: 'var(--ink)' }}>{outOfScope.length}</span>
                    <span style={{ letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Off</span>
                  </span>
                )}
              </>
            )}
          </div>
          <button
            data-tour="claims.confirm"
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            aria-describedby={confirmDisabled && confirmReasonId ? confirmReasonId : undefined}
            style={{
              font: '800 12px/1 var(--sans)',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--surface)',
              background: 'var(--signal)',
              padding: '13px 20px',
              borderRadius: 10,
              border: 'none',
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              opacity: confirmDisabled ? 0.5 : 1,
            }}
          >
            {confirmLabel}
            {!extracting && !pending ? (
              <span aria-hidden> →</span>
            ) : null}
          </button>
        </div>
      </div>

      {/* body */}
      {extracting ? (
        // The agent working, streamed, never a blank spinner (spec section 6).
        // A polite live region so the streamed lines reach a screen reader without
        // spamming it, and aria-busy so it holds until the read settles. Motion is
        // handled upstream: the session reveals every line at once under
        // prefers-reduced-motion, and the global guard neutralizes the rl-* pulses.
        <div
          aria-live="polite"
          aria-busy={extracting}
          style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)' }} />
            <span id={readingReasonId} style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              Reading your analysis
            </span>
          </div>
          <ReasoningConsole lines={extractionLines.slice(0, extractionReveal)} running />
        </div>
      ) : !hasResult ? (
        // Cold visit before extraction ran: send them back to resolve the design.
        <div
          style={{
            marginTop: 30,
            background: 'var(--panel)',
            border: '1px solid var(--edge)',
            borderRadius: 12,
            padding: '30px 26px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--ink-4)' }} />
            <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              No extraction
            </span>
          </div>
          <div id={emptyReasonId} style={{ marginTop: 4, font: '800 19px/1.2 var(--display)', letterSpacing: '-.01em', color: 'var(--ink)' }}>
            No claims extracted yet.
          </div>
          <p style={{ margin: 0, maxWidth: 520, font: '400 13px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
            Confirm the field design and Redline will read your analysis and propose the claims to audit.
          </p>
          <Link
            href="/fields"
            style={{
              marginTop: 10,
              display: 'inline-flex',
              alignItems: 'center',
              font: '700 11px/1 var(--sans)',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--ink)',
              background: 'var(--panel-2)',
              border: '1px solid var(--edge-2)',
              padding: '11px 16px',
              borderRadius: 10,
              textDecoration: 'none',
            }}
          >
            Back to design resolution →
          </Link>
        </div>
      ) : (
        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* curated fallback notice: labeled, never dressed as a live reading */}
          {/* Suppression signal: the extraction found nothing to audit, yet the
              dataset carries testable stored results. This is what a prompt
              injection ("return an empty claims array") and a broken model both
              produce, and an auditor going quiet is the dangerous direction. Warn
              loudly rather than letting "no auditable claims" read as a clean bill. */}
          {extractionAssessment?.suspiciouslyEmpty && (
            <div
              role="alert"
              style={{
                display: 'flex',
                gap: 10,
                background: 'color-mix(in srgb, var(--red) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--red) 40%, transparent)',
                borderLeft: '3px solid var(--red)',
                borderRadius: 12,
                padding: '14px 16px',
              }}
            >
              <span style={{ width: 8, height: 8, marginTop: 4, flex: 'none', borderRadius: 8, background: 'var(--red)', boxShadow: '0 0 8px var(--red)' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ font: '700 9.5px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--red)' }}>
                  Nothing to audit, but the data has results
                </div>
                <p style={{ margin: '6px 0 0', font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-2)' }}>
                  The extraction proposed no auditable claim, yet this dataset stores{' '}
                  {extractionAssessment.evidenceKeys.length === 1 ? 'a result' : 'results'} that a claim could test
                  {extractionAssessment.evidenceKeys.length > 0 ? (
                    <>
                      {' '}(<span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>
                        {extractionAssessment.evidenceKeys.slice(0, 4).join(', ')}
                      </span>
                      {extractionAssessment.evidenceKeys.length > 4 ? ', ...' : ''})
                    </>
                  ) : null}
                  . This can mean the analysis makes no testable statistical claim, or that the
                  reading was suppressed. Review before you proceed, and add a claim by hand if the
                  results warrant one.
                </p>
              </div>
            </div>
          )}

          {claimsSource === 'curated' && (
            <div
              style={{
                display: 'flex',
                gap: 10,
                background: 'var(--amber-soft)',
                border: '1px solid color-mix(in srgb, var(--amber) 32%, transparent)',
                borderRadius: 12,
                padding: '14px 16px',
              }}
            >
              <span style={{ width: 8, height: 8, marginTop: 4, flex: 'none', borderRadius: 8, background: 'var(--amber)', boxShadow: '0 0 8px var(--amber)' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ font: '700 9.5px/1 var(--mono)', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--amber)' }}>
                  Curated reference, not a live reading
                </div>
                <p style={{ margin: '6px 0 0', font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-2)' }}>{CURATED_CLAIMS_NOTICE}</p>
              </div>
            </div>
          )}

          {/* nothing routes to a check: say so plainly, offer manual entry (spec 8) */}
          {noAuditable && (
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--edge)',
                borderRadius: 12,
                padding: '24px 22px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--ink-4)' }} />
                <span style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  No auditable claims
                </span>
              </div>
              <div id={noAuditReasonId} style={{ marginTop: 4, font: '800 18px/1.2 var(--display)', letterSpacing: '-.01em', color: 'var(--ink)' }}>
                Redline found no claim it can audit here.
              </div>
              <p style={{ margin: 0, maxWidth: 560, font: '400 13px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
                {outOfScope.length > 0
                  ? 'The claims it read all fall outside what the four checks can test. Add a claim below and Redline will route it, or go back and attach a notebook or your written results.'
                  : 'Add a claim below and Redline will route it to the checks that can test it, or go back and attach a notebook or your written results.'}
              </p>
            </div>
          )}

          {/* in-scope claims: a labelled region so it is navigable by landmark */}
          {scopeClaims.length > 0 && (
            <section data-tour="claims.list" aria-labelledby={inScopeLabelId} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--signal)', boxShadow: '0 0 8px var(--signal)' }} />
                <span id={inScopeLabelId} style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                  Claims · {routable.length} will be tested
                </span>
              </div>
              {scopeClaims.map((c, i) => (
                <ClaimCard
                  key={c.id}
                  claim={c}
                  tourCardId={i === 0 ? 'claims.card.1' : undefined}
                  tourRoutingId={i === 0 ? 'claims.routing.1' : undefined}
                  onStatus={(status) => setClaimStatus(c.id, status)}
                  onText={(text) => setClaimText(c.id, text)}
                  onRouting={(checks) => setClaimRouting(c.id, checks)}
                />
              ))}
            </section>
          )}

          {/* out-of-scope group: a labelled region, clearly named, with the reason (spec 6, 8) */}
          {outOfScope.length > 0 && (
            <section data-tour="claims.out-of-scope" aria-labelledby={outScopeLabelId} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--ink-4)' }} />
                <span id={outScopeLabelId} style={{ font: '700 10px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  Outside scope · {outOfScope.length} not tested
                </span>
              </div>
              <p style={{ margin: '0 0 2px', maxWidth: 640, font: '400 12.5px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
                Redline read these claims and cannot audit them. It lists them here so nothing is hidden, and it does not test
                them.
              </p>
              {outOfScope.map((c) => (
                <OutOfScopeCard key={c.id} claim={c} />
              ))}
            </section>
          )}

          {/* manual entry: always available once a result is in (spec 7, 8) */}
          <AddClaim />
        </div>
      )}
    </div>
  );
}
