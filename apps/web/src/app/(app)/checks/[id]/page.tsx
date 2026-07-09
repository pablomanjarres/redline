'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from '@/state/session';
import { CheckStage } from '@/components/check/CheckStage';

/** The [id] segment is a RunKey (`${claimId}::${checkId}`). Next has already URL-
 *  decoded the param, so read the first value straight through. */
function paramValue(raw: string | string[] | undefined): string {
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
}

/**
 * Check panel route. The [id] param is one run's RunKey, not a check number
 * (several claims can route to one check, so the unit of work is the run). Reads
 * the key and finds the run in the session. As a convenience, a bare canonical
 * check number (1..4) resolves to that check's FIRST run: a real RunKey always
 * contains "::", so a bare digit can never collide with one, and this keeps the
 * canonical `/checks/3` links (the pipeline, the guided tour) landing on a real
 * run. On arrival it kicks the run if it has not produced a result yet, so
 * opening a card runs its check. A key that matches no current run renders an
 * honest "no such run" state rather than a fabricated verdict.
 */
export default function CheckRoute() {
  const params = useParams();
  const rawKey = paramValue(params?.id as string | string[] | undefined);
  const { runs, results, running, runOne } = useSession();
  const run =
    runs.find((r) => r.key === rawKey) ??
    (/^[1-4]$/.test(rawKey) ? runs.find((r) => String(r.checkId) === rawKey) : undefined);
  const triggered = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!run) return;
    if (triggered.current.has(run.key)) return;
    if (results[run.key] == null && !running[run.key]) {
      triggered.current.add(run.key);
      void runOne(run.key);
    }
  }, [run, results, running, runOne]);

  if (!run) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '80px 40px', textAlign: 'center' }}>
        <div style={{ font: '600 12px/1 var(--mono)', letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          No such run
        </div>
        <h1 style={{ margin: '14px 0 0', font: '800 26px/1.1 var(--display)', letterSpacing: '-.02em', color: 'var(--ink)' }}>
          This run is not on the board.
        </h1>
        <p style={{ margin: '12px auto 0', maxWidth: 460, font: '400 13.5px/1.6 var(--sans)', color: 'var(--ink-3)' }}>
          Redline only audits the claims you ratified. This run no longer exists, likely because its claim was removed or re-routed. Head back to the board to see the current runs.
        </p>
        <Link
          href="/workbench"
          style={{
            display: 'inline-block',
            marginTop: 22,
            font: '700 11px/1 var(--sans)',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--surface)',
            background: 'var(--signal)',
            padding: '11px 18px',
            borderRadius: 8,
            textDecoration: 'none',
          }}
        >
          Back to the board
        </Link>
      </div>
    );
  }

  return <CheckStage runKey={run.key} />;
}
