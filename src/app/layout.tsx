import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

// 숫자·금액·문서번호용 모노 폰트 (셀프호스팅)
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "경비 보고서 결재 · 내부 보고 시스템",
  description: "사내 경비 보고서 결재 승인 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${jetbrainsMono.variable} h-full`}>
      <head>
        {/* Pretendard — README Assets */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
