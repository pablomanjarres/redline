'use client';

import { useEffect, useRef } from 'react';
import { notFound, useParams } from 'next/navigation';
import { isCheckId } from '@redline/contracts';
import { useSession } from '@/state/session';
import { CheckStage } from '@/components/check/CheckStage';

/**
 * Check panel route. Reads the [id] param and validates it against the check
 * registry with `isCheckId`. An unregistered id is a real 404, not a silent
 * clamp to check 4, so a bad link fails loudly instead of showing the wrong
 * check. On arrival, if the check has not run yet (and is not already running),
 * it kicks off the run so opening a card runs its check.
 */
export default function CheckRoute() {
  const params = useParams();
  const raw = params?.id;
  const parsed = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''), 10);
  const checkId = isCheckId(parsed) ? parsed : null;

  const { results, running, runCheck } = useSession();
  const triggered = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (checkId === null) return;
    if (triggered.current.has(checkId)) return;
    if (results[checkId] == null && !running[checkId]) {
      triggered.current.add(checkId);
      void runCheck(checkId);
    }
  }, [checkId, results, running, runCheck]);

  if (checkId === null) notFound();

  return <CheckStage checkId={checkId} />;
}
