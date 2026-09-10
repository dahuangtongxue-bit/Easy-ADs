"use client";

import dynamic from "next/dynamic";
import Gate from "@/components/ed/Gate";

// 素材直出工作台：丢素材 → 补个人 → 一句主题 → 一次 Seedance 2.5 生成。浏览器 API 较多，只在客户端渲染。
const AdMode = dynamic(() => import("@/components/AdMode"), { ssr: false });

export default function WorkbenchPage() {
  return (
    <Gate>
      <AdMode />
    </Gate>
  );
}
