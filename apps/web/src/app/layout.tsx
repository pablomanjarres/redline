import '@redline/ui/tokens.css';

// Self-hosted fonts (no runtime requests). Archivo for body and UI text,
// JetBrains Mono for data, readouts, and the reasoning console. The display face
// (wordmark and headlines) is Red Hat Display, wired up below.
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

import { Red_Hat_Display } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/state/session';
import { TourProvider } from '@/state/tour';
import { TourOverlay } from '@/components/tour/TourOverlay';

// Display face for the wordmark, hero H1s, and check titles: a sharp technical
// grotesque that reads like an instrument dial next to Archivo body and JetBrains
// Mono data. Loaded at the exact weights the display slot uses (400/500/800/900),
// so headlines render at true 800/900 with no synthetic bold. Next inlines it
// into the build, so there is no runtime request. Exposed as --font-display and
// consumed by --display in tokens.css.
const display = Red_Hat_Display({
  subsets: ['latin'],
  weight: ['400', '500', '800', '900'],
  variable: '--font-display',
  display: 'swap',
});

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
  themeColor: '#f3f5f9',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
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
