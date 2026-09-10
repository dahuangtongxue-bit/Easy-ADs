import type { Metadata } from "next";

export const metadata: Metadata = { title: "Easy-ADs 导演模式" };

// 导演模式沿用 easy-director 的浅色 UI：把色彩空间和文字颜色收回浅色（AutoMode 根节点 position:fixed，仍继承颜色）。
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ed-scope" style={{ color: "#16181d", colorScheme: "light", background: "#fafafa", minHeight: "100vh" }}>
      {children}
    </div>
  );
}
