import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { GradientField } from '@/components/brand/GradientField';
import { SiteHeader } from '@/components/brand/SiteHeader';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });

export const metadata: Metadata = {
  title: 'Bchu Misoo Photobooth',
  description:
    'Take a four-frame photo strip in your browser, alone or with a friend on another device.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable}>
      <body className="min-h-dvh font-sans tracking-[-0.05em] antialiased">
        <GradientField />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
