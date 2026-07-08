import '@redline/ui/tokens.css';

// Self-hosted fonts (no external requests). "clinical precision" uses Inter for
// UI and JetBrains Mono for data/labels. No serif.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';

import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/state/session';

export const metadata: Metadata = {
  title: 'Redline',
  description: 'Break your own analysis before Reviewer 2 does.',
};

export const viewport: Viewport = {
  themeColor: '#F4F6F9',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
