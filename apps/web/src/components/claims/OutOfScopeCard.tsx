import type { ExtractedClaim } from '@redline/contracts';

/**
 * An out-of-scope claim (spec sections 6, 8): a statement Redline cannot audit.
 * It is shown, clearly labeled, with the reason, and it carries no check chips,
 * because its checks array is empty by contract. Redline states plainly that it
 * is not testing this claim and why, so nothing is silently dropped or
 * fabricated-audited (honesty invariant b).
 */
export function OutOfScopeCard({ claim }: { claim: ExtractedClaim }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--edge)', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 7, height: 7, flex: 'none', borderRadius: 2, background: 'var(--ink-4)' }} />
        <span style={{ font: '700 9.5px/1 var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          Not tested
        </span>
      </div>
      <p style={{ margin: '10px 0 0', font: '500 14px/1.45 var(--sans)', color: 'var(--ink-2)' }}>{claim.text}</p>
      <p style={{ margin: '8px 0 0', font: '400 12px/1.55 var(--sans)', color: 'var(--ink-3)' }}>
        {claim.outOfScopeReason ?? 'Redline has no check that can test this claim, so it stays out of the audit.'}
      </p>
    </div>
  );
}
