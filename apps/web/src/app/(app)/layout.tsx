/**
 * The audit stage shell: everything from design resolution onward. A full-height
 * column — masthead, the pipeline rail, then the full-bleed dark stage. No
 * sidebar. Intake keeps its own chrome and lives outside this route group.
 */

import type { ReactNode } from 'react';
import { Masthead } from '@/components/shell/Masthead';
import { Pipeline } from '@/components/shell/Pipeline';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Masthead />
      <Pipeline />
      <main className="rl-scroll" style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
