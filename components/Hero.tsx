import { publicUrl, type ShowcaseItem } from "@/lib/showcase";

const CHIPS = ["30 秒单次连续生成", "50 份素材一次装下", "原生音画同出", "真人活体出镜", "AI 标识内置"];

export default function Hero({ hero, hasShowcase }: { hero?: ShowcaseItem; hasShowcase: boolean }) {
  return (
    <section className="relative overflow-hidden border-b hairline">
      {hero ? (
        <video
          className="absolute inset-0 h-full w-full object-cover opacity-60"
          src={publicUrl(hero.file)}
          poster={hero.poster ? publicUrl(hero.poster) : undefined}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
      ) : (
        <>
          <div className="hero-grid absolute inset-0" aria-hidden="true" />
          <div className="hero-sweep absolute inset-0" aria-hidden="true" />
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(10,12,16,0.2)] via-[rgba(10,12,16,0.55)] to-bg" aria-hidden="true" />

      <div className="relative mx-auto max-w-site px-5 pb-16 pt-20 md:px-8 md:pb-24 md:pt-28">
        <div className="eyebrow mb-5">Seedance 2.5 · One-take ad generation</div>
        <h1 className="display text-[44px] md:text-[84px]">
          丢素材，<span className="text-accent">出广告。</span>
        </h1>
        <p className="mt-6 max-w-[38em] text-[17px] leading-relaxed text-ink-2 md:text-[20px]">
          把商品图、实拍片段、老板照片和一句要讲的话丢进来，Easy-ADs 用 Seedance 2.5 单次生成 30 秒内的广告成片——
          <span className="text-ink">商品对得上，节奏像广告，拿来就能投。</span>
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a href="/app" className="btn btn-accent">开始出片</a>
          {hasShowcase && <a href="#showcase" className="btn btn-ghost">看成片</a>}
          <a href="#early-access" className="btn btn-ghost">申请内测</a>
        </div>
        <ul className="mt-10 flex flex-wrap gap-2" aria-label="核心能力">
          {CHIPS.map((c) => (
            <li key={c} className="chip">{c}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
