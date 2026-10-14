import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OUTSIDE — Less scrolling. More salt air.',
  description: 'A map you can talk to. Find your next coastal escape with real camera imagery, local forecasts, and a gear bag that fits your day.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
