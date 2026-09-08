"use client";

import { useEffect, useMemo, useState } from "react";
import { publicUrl, type ShowcaseItem } from "@/lib/showcase";
import VideoCard from "./VideoCard";

export default function Gallery({ items }: { items: ShowcaseItem[] }) {
  const [filter, setFilter] = useState<string>("全部");
  const [open, setOpen] = useState<ShowcaseItem | null>(null);

  const filters = useMemo(() => {
    const t = new Set<string>();
    items.forEach((i) => i.template && t.add(i.template));
    return ["全部", ...Array.from(t)];
  }, [items]);

  const shown = filter === "全部" ? items : items.filter((i) => i.template === filter);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {filters.length > 2 && (
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="按模板筛选">
          {filters.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`chip !text-[12.5px] !py-1.5 !px-3 transition ${filter === f ? "chip-accent bg-[var(--accent-soft)]" : "hover:border-[var(--line-strong)] hover:text-ink"}`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      <div className="masonry">
        {shown.map((item) => (
          <VideoCard key={item.file} item={item} onOpen={setOpen} />
        ))}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.85)] p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={open.title}
          onClick={() => setOpen(null)}
        >
          <div className="relative max-h-[92vh] max-w-[min(96vw,1100px)]" onClick={(e) => e.stopPropagation()}>
            <video
              className="max-h-[84vh] w-auto max-w-full rounded-xl border hairline bg-black"
              src={publicUrl(open.file)}
              poster={open.poster ? publicUrl(open.poster) : undefined}
              controls
              autoPlay
              playsInline
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[16px] font-bold">{open.title}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {open.template && <span className="chip chip-accent">{open.template}</span>}
                  {open.industry && <span className="chip">{open.industry}</span>}
                  {open.ratio && <span className="chip">{open.ratio}</span>}
                  {open.duration ? <span className="chip">{open.duration}s</span> : null}
                  <span className="chip">Seedance 2.5 · 单次生成</span>
                </div>
              </div>
              <button className="btn btn-ghost !py-2 !px-4 text-[14px]" onClick={() => setOpen(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
