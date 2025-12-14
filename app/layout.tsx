import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LogSense AI',
  description: 'Hackathon-ready AI log insights powered by synthetic data'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
