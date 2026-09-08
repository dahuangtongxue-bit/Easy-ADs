import { publicUrl, TEMPLATES, type ShowcaseItem } from "@/lib/showcase";

export default function Templates({ items }: { items: ShowcaseItem[] }) {
  return (
    <section id="templates" className="border-b hairline">
      <div className="mx-auto max-w-site px-5 py-20 md:px-8 md:py-28">
        <div className="eyebrow">Templates · 剧情模板</div>
        <h2 className="display mt-4 text-[32px] md:text-[52px]">六个广告结构，一句话就落到节拍上</h2>
        <p className="mt-5 max-w-[40em] text-[16px] leading-relaxed text-ink-2">
          说一句「新品上市主打续航」，Easy-ADs 先判断落哪个结构，再把 30 秒切成五段填进去。橙色那一段是商品登场；剧情类结构商品只在最后一场出现，展示类全片可见。
        </p>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TEMPLATES.map((t, idx) => {
            const sample = items.find((i) => i.template === t.name);
            const hotIndex = t.key === "unbox" ? 1 : t.key === "before" ? 1 : t.key === "owner" ? 3 : t.key === "story" ? 2 : 2;
            return (
              <article key={t.key} className="card flex flex-col overflow-hidden">
                {sample ? (
                  <div className="relative aspect-video overflow-hidden bg-surface-2">
                    <video
                      className="h-full w-full object-cover"
                      src={publicUrl(sample.file)}
                      poster={sample.poster ? publicUrl(sample.poster) : undefined}
                      muted
                      loop
                      playsInline
                      autoPlay
                      aria-label={`${t.name} 样片：${sample.title}`}
                    />
                    <span className="chip chip-accent absolute left-3 top-3 bg-[rgba(10,12,16,0.7)]">样片</span>
                  </div>
                ) : (
                  <div className="relative aspect-video bg-surface-2 hero-grid">
                    <div className="absolute left-4 top-4 text-[13px] text-ink-3">结构 0{idx + 1}</div>
                    <div className="absolute bottom-4 left-4 right-4 text-[13px] text-ink-3">{t.fit}</div>
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-[19px] font-bold">{t.name}</h3>
                    <span className="text-[12px] text-ink-3">30s · 15s</span>
                  </div>
                  <div className="beats" aria-label="五段节拍">
                    {t.beats.map((b, i) => (
                      <span key={b} className={i === hotIndex ? "hot" : ""} title={b} />
                    ))}
                  </div>
                  <ol className="grid grid-cols-5 gap-1 text-[11px] leading-tight text-ink-3">
                    {t.beats.map((b, i) => (
                      <li key={b} className={i === hotIndex ? "text-accent" : ""}>{b}</li>
                    ))}
                  </ol>
                  <div className="mt-auto text-[13px] text-ink-2">适合：{t.fit}</div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
