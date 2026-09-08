import type { Metadata } from "next";
import "./ed.css";

export const metadata: Metadata = {
  title: "Easy-ADs 工作台",
  description: "丢素材，出广告 —— Seedance 2.5 一键成片工作台",
};

// 工作台沿用 easy-director 引擎的浅色 UI；这里把色彩空间和文字颜色收回浅色，
// 避免展示站的深色 token 继承进去（AutoMode 根节点是 position:fixed，仍然继承颜色）。
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ed-scope" style={{ color: "#16181d", colorScheme: "light", background: "#fafafa", minHeight: "100vh" }}>
      {children}
    </div>
  );
}
