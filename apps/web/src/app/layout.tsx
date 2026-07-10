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

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3002');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Redline: statistical-rigor auditor for single-cell RNA-seq',
  description:
    'Break your own analysis before Reviewer 2 does. Redline re-runs the load-bearing statistics on your single-cell RNA-seq data and marks the false discoveries on your own figures, before they become a paper.',
  openGraph: {
    type: 'website',
    title: 'Redline: statistical-rigor auditor for single-cell RNA-seq',
    description: 'Break your own analysis before Reviewer 2 does.',
    images: ['/hero.webp'],
  },
  twitter: { card: 'summary_large_image' },
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
