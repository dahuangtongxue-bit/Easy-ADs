const ITEMS = [
  {
    t: "AI 生成标识内置",
    d: "按《人工智能生成合成内容标识办法》（2025-09-01 施行）在起始画面叠加显式标识、写入元数据，抖音、视频号、快手核验直接通过。",
  },
  {
    t: "真人出镜走活体认证",
    d: "老板、店员出镜只走火山真人活体认证，本人手机完成、只接受本人照片，授权留痕；不用普通照片合成真人。",
  },
  {
    t: "广告用语前置预筛",
    d: "绝对化用语按行业分级词库在脚本阶段拦截；医美、金融、教培的效果类承诺硬拦截；需前置审查的行业不接。",
  },
  {
    t: "素材与成片归商家",
    d: "Easy-ADs 只做出片，不做投放、不碰广告费；商家素材仅用于本次生成，成片可下载、可撤回授权。",
  },
];

export default function Compliance() {
  return (
    <section id="compliance" className="border-b hairline">
      <div className="mx-auto max-w-site px-5 py-20 md:px-8 md:py-28">
        <div className="eyebrow">Compliance · 合规内置</div>
        <h2 className="display mt-4 text-[32px] md:text-[52px]">合规做成产品功能，不写在免责条款里</h2>
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          {ITEMS.map((i) => (
            <div key={i.t} className="card p-6">
              <div className="mb-3 h-[3px] w-10 rounded-full bg-accent" aria-hidden="true" />
              <h3 className="text-[19px] font-bold">{i.t}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{i.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
