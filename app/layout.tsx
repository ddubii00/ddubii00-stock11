import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stock 11 — Real Time Stock Price',
  description: 'KOSPI와 KOSDAQ 실시간 시세 및 분봉 추세 대시보드',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
