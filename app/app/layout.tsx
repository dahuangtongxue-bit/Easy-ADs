import type { Metadata } from "next";
import "./ed.css";

export const metadata: Metadata = {
  title: "Easy-ADs 工作台",
  description: "丢素材，出广告 —— Seedance 2.5 素材直出工作台",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
