import '@redline/ui/tokens.css';

// Self-hosted fonts (no external requests). Archivo (bold grotesque) for UI and
// display, JetBrains Mono for data, readouts, and the reasoning console.
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/archivo/800.css';
import '@fontsource/archivo/900.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';

import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/state/session';
import { TourProvider } from '@/state/tour';
import { TourOverlay } from '@/components/tour/TourOverlay';

export const metadata: Metadata = {
  title: 'Redline',
  description: 'Break your own analysis before Reviewer 2 does.',
};

export const viewport: Viewport = {
  themeColor: '#0b0d12',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <TourProvider>
            {children}
            <TourOverlay />
          </TourProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
