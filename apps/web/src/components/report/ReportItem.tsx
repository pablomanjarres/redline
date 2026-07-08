import type { CheckResult } from '@redline/contracts';
import { Badge, Panel } from '@redline/ui';
import { MiniChart } from '@/components/charts';

/**
 * The four pillars' display names, keyed by check id. These are the failure
 * modes Redline tests for and are the same across every dataset, so they live
 * here as a constant rather than travelling on each CheckResult (which carries
 * only numbers + narrative). Mirrors the engine's check meta.
 */
const CHECK_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: 'Fake significance',
  2: 'Fake groups',
  3: 'Fragile conclusions',
  4: 'Confounded comparison',
};

/**
 * One finding in the printable report: the check number and name, the verdict
 * badge, a 230px mini figure, the named failure mode, the scientist's claim
 * struck through, the defensible rewrite, and the method citation.
 */
export function ReportItem({ result }: { result: CheckResult }) {
  const { checkId, state, error, original, corrected, citation } = result;
  return (
    <Panel style={{ padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ font: '600 12px/1 var(--mono)', color: 'var(--ink3)' }}>{`0${checkId}`}</span>
        <span style={{ font: '600 16px/1.1 var(--sans)', color: 'var(--ink)' }}>
          {CHECK_NAMES[checkId]}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <Badge state={state} />
        </span>
      </div>

      <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
        <div
          style={{
            width: 230,
            flex: 'none',
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            height: 132,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MiniChart checkId={checkId} result={result} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {error ? (
            <div style={{ font: '600 13px/1.3 var(--sans)', color: 'var(--red-deep)' }}>{error}</div>
          ) : null}

          {original ? (
            <p
              style={{
                margin: '10px 0 0',
                font: '400 15px/1.5 var(--serif)',
                color: 'var(--ink3)',
                textDecoration: 'line-through',
                textDecorationColor: 'var(--red)',
                textDecorationThickness: '1.5px',
              }}
            >
              {original}
            </p>
          ) : null}

          <p
            style={{
              margin: '9px 0 0',
              font: '400 15px/1.55 var(--serif)',
              color: 'var(--ink)',
              display: 'flex',
              gap: 8,
            }}
          >
            <span style={{ color: 'var(--red)', fontWeight: 600, flex: 'none' }}>‸</span>
            <span>{corrected}</span>
          </p>

          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid var(--line)',
              font: '400 12px/1.4 var(--sans)',
              color: 'var(--ink3)',
            }}
          >
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink2)' }}>
              {`${citation.authors} (${citation.year}) · ${citation.venue}`}
            </span>
            {` · ${citation.note}`}
          </div>
        </div>
      </div>
    </Panel>
  );
}
