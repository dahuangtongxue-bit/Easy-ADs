"use client";

import { useEffect, useRef } from "react";
import { publicUrl, type ShowcaseItem } from "@/lib/showcase";

export default function VideoCard({ item, onOpen }: { item: ShowcaseItem; onOpen: (item: ShowcaseItem) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const aspect = item.aspect || (item.ratio === "16:9" ? 16 / 9 : item.ratio === "1:1" ? 1 : 9 / 16);

  // On touch devices there is no hover: play while in view, muted.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const canHover = window.matchMedia("(hover: hover)").matches;
    if (canHover) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) v.play().catch(() => {});
          else v.pause();
        });
      },
      { threshold: 0.6 }
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  return (
    <button
      type="button"
      className="vcard w-full text-left"
      style={{ aspectRatio: String(aspect) }}
      onMouseEnter={() => ref.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const v = ref.current;
        if (!v) return;
        v.pause();
        v.currentTime = 0;
      }}
      onClick={() => onOpen(item)}
      aria-label={`播放：${item.title}`}
    >
      <video
        ref={ref}
        src={publicUrl(item.file)}
        poster={item.poster ? publicUrl(item.poster) : undefined}
        muted
        loop
        playsInline
        preload="metadata"
      />
      <div className="meta">
        <div className="text-[14px] font-bold leading-snug text-ink">{item.title}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {item.template && <span className="chip chip-accent">{item.template}</span>}
          {item.industry && <span className="chip">{item.industry}</span>}
          {item.duration ? <span className="chip">{item.duration}s</span> : null}
        </div>
      </div>
    </button>
  );
}
