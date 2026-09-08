import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Easy-ADs · 丢素材，出广告",
  description:
    "素材 + 一句剧情 → 30 秒内广告成片。Easy-ADs 用 Seedance 2.5 单次生成连续叙事的广告片，商品对得上、节奏像广告、拿来就能投。",
  openGraph: {
    title: "Easy-ADs · 丢素材，出广告",
    description: "素材 + 一句剧情 → 30 秒内广告成片，Seedance 2.5 驱动。",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0c10",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">{children}</body>
    </html>
  );
}
