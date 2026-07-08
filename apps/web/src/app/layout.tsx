import '@redline/ui/tokens.css';

// Self-hosted fonts (no external requests). Weights match the design source:
// IBM Plex Sans 400/500/600/700 (+italic), IBM Plex Mono 400/500/600,
// Source Serif 4 400/500/600 (+italic for prose emphasis).
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/source-serif-4/400-italic.css';

import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/state/session';

export const metadata: Metadata = {
  title: 'Redline',
  description: 'Break your own analysis before Reviewer 2 does.',
};

export const viewport: Viewport = {
  themeColor: '#EAE6DD',
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
