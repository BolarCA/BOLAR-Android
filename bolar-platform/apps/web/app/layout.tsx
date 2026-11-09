import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '@/lib/auth';

export const metadata: Metadata = { title: { default: 'BOLAR', template: '%s · BOLAR' }, description: 'BOLAR AI property management platform' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b1f3a' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
