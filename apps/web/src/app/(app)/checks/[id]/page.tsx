'use client';

import { useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import type { CheckId } from '@redline/contracts';
import { useSession } from '@/state/session';
import { CheckStage } from '@/components/check/CheckStage';

function coerceCheckId(raw: string | string[] | undefined): CheckId {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(s ?? '1', 10);
  const clamped = Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 1;
  return clamped as CheckId;
}

/**
 * Check panel route. Reads the [id] param, clamps it to 1..4, and hands off to
 * <CheckPanel>. On arrival, if the check has not run yet (and is not already
 * running), it kicks off the run so opening a card runs its check.
 */
export default function CheckRoute() {
  const params = useParams();
  const checkId = coerceCheckId(params?.id as string | string[] | undefined);
  const { results, running, runCheck } = useSession();
  const triggered = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (triggered.current.has(checkId)) return;
    if (results[checkId] == null && !running[checkId]) {
      triggered.current.add(checkId);
      void runCheck(checkId);
    }
  }, [checkId, results, running, runCheck]);

  return <CheckStage checkId={checkId} />;
}
