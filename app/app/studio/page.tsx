"use client";

import dynamic from "next/dynamic";
import Gate from "@/components/ed/Gate";

// 导演模式：easy-director 引擎的完整工作台（拆场 / 选角 / 关键帧 / 多场拼接），给需要精细控制的人。
const AutoMode = dynamic(() => import("@/components/ed/AutoMode"), { ssr: false });

export default function StudioPage() {
  return (
    <Gate>
      <AutoMode />
    </Gate>
  );
}
