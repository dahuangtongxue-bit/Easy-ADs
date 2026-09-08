const STEPS = [
  { t: "丢素材", d: "商品图 · 实拍 · 老板活体 · logo", who: "商家 · 3 分钟" },
  { t: "认素材", d: "自动分类，挑主体图，绑定 @ 角色", who: "agent · 30 秒" },
  { t: "排节拍", d: "一句剧情 → 五段时间戳节拍表", who: "agent · 1 分钟" },
  { t: "单次生成", d: "Seedance 2.5 · 30 秒 · 尾帧锁商品", who: "5–20 分钟", hot: true },
  { t: "看片质检", d: "商品出现 · 保真 · 节拍 · 黑帧", who: "agent · 1 分钟" },
  { t: "叠加出片", d: "logo · 价格 · CTA · AI 标识 · 三尺寸", who: "商家审片 · 2 分钟" },
];

export default function Flow() {
  return (
    <section id="flow" className="border-b hairline">
      <div className="mx-auto max-w-site px-5 py-20 md:px-8 md:py-28">
        <div className="eyebrow">How it works · 一次请求，30 秒成片</div>
        <h2 className="display mt-4 text-[32px] md:text-[52px]">商家只碰头尾两步，中间交给 agent</h2>
        <p className="mt-5 max-w-[40em] text-[16px] leading-relaxed text-ink-2">
          所有素材装进一次 Seedance 2.5 请求：图片、视频、音频各自带 @ 角色，节拍表带时间戳，尾帧固定为真实商品图。生成之后先过质检，不过的片子不交给商家。
        </p>

        <div className="relative mt-12">
          <svg className="absolute left-0 top-[34px] hidden h-1 w-full md:block" aria-hidden="true" viewBox="0 0 1000 4" preserveAspectRatio="none">
            <line x1="0" y1="2" x2="1000" y2="2" stroke="var(--line-strong)" strokeWidth="2" />
            <line className="flow-line" x1="0" y1="2" x2="1000" y2="2" stroke="var(--accent)" strokeWidth="2" />
          </svg>
          <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-6">
            {STEPS.map((s, i) => (
              <li key={s.t} className="card p-5">
                <div className={`mb-4 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${s.hot ? "border-accent bg-accent flow-pulse" : "border-[var(--line-strong)] bg-bg"}`} aria-hidden="true" />
                <div className="font-mono text-[11px] tracking-[0.18em] text-ink-3">STEP {i + 1}</div>
                <h3 className={`mt-1 text-[18px] font-bold ${s.hot ? "text-accent" : ""}`}>{s.t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{s.d}</p>
                <p className="mt-3 font-mono text-[11.5px] text-ink-3">{s.who}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="card p-5">
            <div className="text-[13px] text-ink-3">一次请求装下</div>
            <div className="mt-1 text-[22px] font-bold">≤ 30 图 · ≤ 10 视频 · ≤ 10 音频</div>
            <div className="mt-1 text-[13px] text-ink-2">合计 50 份素材，@图片1 / @视频1 / @音频1 指定用途</div>
          </div>
          <div className="card p-5">
            <div className="text-[13px] text-ink-3">节拍怎么写</div>
            <div className="mt-1 text-[22px] font-bold">0–5s · 5–12s · 12–22s · 22–27s · 27–30s</div>
            <div className="mt-1 text-[13px] text-ink-2">每段一个主要状态变化，段末写可观察状态</div>
          </div>
          <div className="card p-5">
            <div className="text-[13px] text-ink-3">商品怎么保真</div>
            <div className="mt-1 text-[22px] font-bold">多视角参考 + 尾帧锚定</div>
            <div className="mt-1 text-[13px] text-ink-2">文字、logo、价格全部后期叠加，不让模型渲染</div>
          </div>
        </div>
      </div>
    </section>
  );
}
