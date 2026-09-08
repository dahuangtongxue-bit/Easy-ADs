"use client";

import dynamic from "next/dynamic";
import Gate from "@/components/ed/Gate";

// AutoMode 用到 localStorage / ffmpeg.wasm 等浏览器 API，只在客户端渲染（同 easy-director）
const AutoMode = dynamic(() => import("@/components/ed/AutoMode"), { ssr: false });

export default function WorkbenchPage() {
  return (
    <Gate>
      <AutoMode />
    </Gate>
  );
}
