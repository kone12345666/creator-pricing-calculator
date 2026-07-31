import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "达人报价测算器",
  description:
    "输入达人采买成本、卖价和客户 CPM，自动反推 KPI 播放量并核算真实毛利。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
