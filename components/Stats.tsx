const STATS = [
  { n: "30", u: "秒", k: "单次连续生成", d: "一镜到底或多镜头叙事，不做模板拼贴" },
  { n: "50", u: "份", k: "素材一次装下", d: "30 张图 · 10 段视频 · 10 段音频" },
  { n: "5", u: "段", k: "时间戳节拍", d: "叙事预算按秒排，边界漂移小于 1 秒" },
  { n: "3", u: "个尺寸", k: "一键切版", d: "9:16 抖音 / 视频号 · 1:1 · 16:9" },
];

export default function Stats() {
  return (
    <section className="border-b hairline bg-surface">
      <div className="mx-auto grid max-w-site grid-cols-2 gap-px px-5 py-14 md:grid-cols-4 md:px-8">
        {STATS.map((s) => (
          <div key={s.k} className="p-5 md:p-7">
            <div className="wordmark text-[48px] md:text-[64px]">
              {s.n}
              <span className="ml-1 text-[18px] font-bold text-ink-3 md:text-[22px]">{s.u}</span>
            </div>
            <div className="mt-1 text-[16px] font-bold">{s.k}</div>
            <div className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.d}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
