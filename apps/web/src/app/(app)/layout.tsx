'use client';

/**
 * The workbench shell: everything from field resolution onward. A full-height
 * column of the 58px top bar over a row of the 246px sidebar and the scrolling
 * main pane. Intake keeps its own chrome and lives outside this route group.
 */

import type { ReactNode } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { Sidebar } from '@/components/shell/Sidebar';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="rl-app-shell"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--desk)',
      }}
    >
      <TopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar />
        <main className="rl-scroll rl-app-main" style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
