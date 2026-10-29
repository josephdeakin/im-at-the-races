import type { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import './globals.css';

export const metadata: Metadata = {
  title: "I'm at the Races",
  description: 'Local developer tool for investigating race conditions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
