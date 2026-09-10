// Easy-ADs 广告大脑：素材（带角色）+ 人物 + 一句主题 → 一次 Seedance 2.5 请求的完整提示词。
// 写法全部对齐官方提示词指南：@图片N/@视频N/@音频N 指定用途 + 排除语、同一商品多视角声明、
// 时间戳节拍（叙事预算，每段一个主要状态变化、段末写可观察状态）、() 音乐 <> 音效 {} 台词、台词语言声明。
// 商品保真三件事在这里落地：多视角参考 + 尾段镜头推向商品正面（与 @图片1 一致）+ 画面中不出现任何文字。

import { langName } from "./filmScript";

export type ImageRole = "product" | "detail" | "scene" | "style" | "logo";
export type VideoRole = "motion" | "camera" | "rhythm" | "style";
export type AudioRole = "voice" | "music";

export type AdAsset =
  | { id: string; kind: "image"; url: string; role: ImageRole; name: string }
  | { id: string; kind: "video"; url: string; role: VideoRole; name: string; uses?: VideoRole[] }
  | { id: string; kind: "audio"; url: string; role: AudioRole; name: string };

export type AdPerson =
  | { type: "none" }
  | { type: "real"; name: string; img: string; assetId: string; desc: string } // 真人活体：asset:// 原生锁脸
  | { type: "roster"; name: string; img: string; assetId: string; desc: string; angles: string[] } // 演员库：三视图
  | { type: "photo"; name: string; img: string; desc: string }; // 上传照片：单图锁脸

export type Beat = { t0: number; t1: number; action: string; endState: string; line?: string; sfx?: string };

export type AdTemplateKey = "pain" | "story" | "owner" | "unbox" | "before" | "review";

export const AD_TEMPLATES: { key: AdTemplateKey; name: string; fit: string; hint: string }[] = [
  { key: "pain", name: "痛点–解决", fit: "功能型商品 · 本地服务", hint: "先让人看见没有它有多难受，再让商品登场解决" },
  { key: "story", name: "剧情植入", fit: "品牌型商品 · 情绪向", hint: "讲一个生活小故事，商品在最后一段自然出现" },
  { key: "owner", name: "老板口播种草", fit: "本地店 · 信任型消费", hint: "人物对镜头说三个卖点，最后落在商品特写" },
  { key: "unbox", name: "开箱 / 展示", fit: "电商 · 3C · 美妆", hint: "到手、多角度展示、细节、使用一瞬" },
  { key: "before", name: "使用前后对比", fit: "清洁 · 美业 · 家居", hint: "前 → 商品转场 → 后，对比要一眼看得出" },
  { key: "review", name: "证言 / 评价", fit: "服务 · 课程 · 体验类", hint: "用户开口说为什么选它，场景里带出商品" },
];

// 五段节拍的时长比例（总和 1）：钩子短、商品段最长、尾段固定留给商品
const BEAT_RATIO: Record<AdTemplateKey, number[]> = {
  pain: [0.17, 0.23, 0.33, 0.17, 0.1],
  story: [0.25, 0.25, 0.2, 0.2, 0.1],
  owner: [0.1, 0.3, 0.3, 0.2, 0.1],
  unbox: [0.15, 0.3, 0.25, 0.2, 0.1],
  before: [0.27, 0.13, 0.27, 0.23, 0.1],
  review: [0.17, 0.23, 0.27, 0.23, 0.1],
};

// 兜底节拍（大脑不可用时也能出片）：{product} 会替换成商品名
const BEAT_FALLBACK: Record<AdTemplateKey, { action: string; endState: string }[]> = {
  pain: [
    { action: "一个人在日常场景里遇到不顺手的小麻烦，动作停顿，表情懊恼", endState: "人物皱眉停下，画面停在困扰的物件上" },
    { action: "麻烦被放大：再试一次还是不行，周围人投来目光", endState: "人物无奈摊手" },
    { action: "{product}登场：人物拿起它，自然地使用，动作干脆", endState: "商品完整清晰可见，正在被使用" },
    { action: "问题解决后的松弛：人物露出满意的表情，环境变得明亮", endState: "人物微笑看向商品" },
    { action: "镜头缓慢推向商品正面，商品居中、完整、清晰", endState: "商品正面居中定格" },
  ],
  story: [
    { action: "一个安静的生活片段开始：人物做着自己的事，环境有生活感", endState: "人物在场景中安顿下来" },
    { action: "一个小转折：一件让人心情变好的小事发生", endState: "人物表情转为放松" },
    { action: "{product}自然出现在人物手边或桌面，人物拿起它", endState: "商品在画面中清晰可见" },
    { action: "人物与商品共处的舒适时刻，光线柔和", endState: "人物微笑，商品在旁" },
    { action: "镜头缓慢推向商品正面，商品居中、完整、清晰", endState: "商品正面居中定格" },
  ],
  owner: [
    { action: "人物正对镜头，一个抓人的开场动作或一句钩子", endState: "人物直视镜头" },
    { action: "人物边说边展示第一个卖点，手势自然", endState: "人物指向商品" },
    { action: "人物说第二、第三个卖点，镜头轻微推近", endState: "人物手持商品" },
    { action: "商品特写：人物把商品递向镜头", endState: "商品占据画面中心" },
    { action: "镜头缓慢推向商品正面，商品居中、完整、清晰", endState: "商品正面居中定格" },
  ],
  unbox: [
    { action: "包裹到手，人物拆开包装，露出{product}", endState: "商品从包装中露出" },
    { action: "商品被拿起，缓慢转动，展示正面与侧面", endState: "商品侧面完整可见" },
    { action: "细节特写：材质、按键或接缝，光线掠过表面", endState: "细节清晰定格" },
    { action: "使用一瞬：人物自然地用起来", endState: "商品处于使用状态" },
    { action: "镜头缓慢推向商品正面，商品居中、完整、清晰", endState: "商品正面居中定格" },
  ],
  before: [
    { action: "使用前的状态：问题一眼可见，人物面露难色", endState: "问题区域定格" },
    { action: "{product}登场并开始使用，一个干脆的动作", endState: "商品正在作用于问题区域" },
    { action: "使用后的状态：同一机位，问题消失，画面明亮", endState: "对比结果定格" },
    { action: "人物满意地检查结果", endState: "人物点头微笑" },
    { action: "镜头缓慢推向商品正面，商品居中、完整、清晰", endState: "商品正面居中定格" },
  ],
  review: [
    { action: "人物在真实场景里对镜头开口，语气像在聊天", endState: "人物直视镜头" },
    { action: "切到人物使用{product}的场景，动作自然", endState: "商品在使用中清晰可见" },
    { action: "人物说出最打动自己的一点，镜头轻推", endState: "人物微笑" },
    { action: "人物把商品拿到镜头前", endState: "商品占据画面中心" },
    { action: "镜头缓慢推向商品正面，商品居中、完整、清晰", endState: "商品正面居中定格" },
  ],
};

export function scaleBeats(total: number, key: AdTemplateKey, base?: Beat[]): Beat[] {
  const ratios = BEAT_RATIO[key];
  const raw = ratios.map((r) => r * total);
  // 逐秒取整，并保证最后一段至少 3 秒、总和精确等于 total
  const secs = raw.map((x) => Math.max(2, Math.round(x)));
  let diff = total - secs.reduce((a, b) => a + b, 0);
  let i = 2;
  while (diff !== 0) {
    const k = i % 5;
    if (diff > 0) { secs[k]++; diff--; } else if (secs[k] > 2) { secs[k]--; diff++; }
    i++;
    if (i > 60) break;
  }
  let t = 0;
  return secs.map((s, idx) => {
    const b = base?.[idx];
    const beat: Beat = { t0: t, t1: t + s, action: b?.action || "", endState: b?.endState || "", line: b?.line, sfx: b?.sfx };
    t += s;
    return beat;
  });
}

export function fallbackBeats(total: number, key: AdTemplateKey, productName: string): Beat[] {
  const p = productName.trim() || "商品";
  const base = BEAT_FALLBACK[key].map((b) => ({ t0: 0, t1: 0, action: b.action.replace(/\{product\}/g, p), endState: b.endState }));
  return scaleBeats(total, key, base);
}

export type RefItem = { url: string; label: string };

/** 把素材 + 人物整理成「参考图列表 + @ 映射说明」。顺序即 @图片N 的编号，必须与提交的 URL 顺序严丝合缝。 */
export function assembleRefs(assets: AdAsset[], person: AdPerson, opts: { origin: string }): {
  images: RefItem[];
  videos: { url: string; uses: VideoRole[] }[];
  audios: { url: string; role: AudioRole }[];
  productCount: number;
} {
  const abs = (u: string) => (/^https?:\/\//.test(u) || u.startsWith("asset://") ? u : opts.origin + u);
  const imgs = assets.filter((a): a is Extract<AdAsset, { kind: "image" }> => a.kind === "image" && a.role !== "logo");
  const products = imgs.filter((a) => a.role === "product").slice(0, 3);
  const details = imgs.filter((a) => a.role === "detail").slice(0, 3);
  const scenes = imgs.filter((a) => a.role === "scene").slice(0, 2);
  const styles = imgs.filter((a) => a.role === "style").slice(0, 1);

  const images: RefItem[] = [];
  const productAll = [...products, ...details];
  productAll.forEach((a, i) => {
    const view = i === 0 ? "正面" : i === 1 ? "侧面" : i === 2 ? "另一角度" : `细节 ${i - 2}`;
    images.push({ url: a.url, label: `定义同一件商品的${view}` });
  });

  if (person.type === "real") {
    images.push({ url: "asset://" + person.assetId, label: "" }); // 真人活体：平台原生锁脸，不需要提示词绑定
  } else if (person.type === "roster") {
    images.push({ url: abs(person.img), label: `为人物「${person.name}」的正面（五官、发型、体型必须与该图完全一致，不得改脸）` });
    if (person.angles[0]) images.push({ url: abs(person.angles[0]), label: `为同一人物「${person.name}」的四分之三侧面（转头时对齐）` });
    if (person.angles[1]) images.push({ url: abs(person.angles[1]), label: `为同一人物「${person.name}」的侧面（侧身时对齐）` });
  } else if (person.type === "photo") {
    images.push({ url: person.img, label: `为人物「${person.name}」本人（五官、发型、体型必须与该图完全一致，不得改变或美化）` });
  }

  scenes.forEach((a) => images.push({ url: a.url, label: "用于场景的环境、陈设与光线，不采用图片中的人物与文字" }));
  styles.forEach((a) => images.push({ url: a.url, label: "只用于画面风格、色调与质感，不采用其中的商品、人物与文字" }));

  const videos = assets
    .filter((a): a is Extract<AdAsset, { kind: "video" }> => a.kind === "video")
    .slice(0, 3)
    .map((a) => ({ url: a.url, uses: a.uses && a.uses.length ? a.uses : [a.role] }));
  const audios = assets
    .filter((a): a is Extract<AdAsset, { kind: "audio" }> => a.kind === "audio")
    .slice(0, 2)
    .map((a) => ({ url: a.url, role: a.role }));

  return { images: images.slice(0, 30), videos, audios, productCount: productAll.length };
}

const VIDEO_USE_WORD: Record<VideoRole, string> = { motion: "人物或手部的动作", camera: "运镜方式", rhythm: "剪辑节奏", style: "画面风格与光线" };

export type AdPromptInput = {
  brief: string;
  productName: string;
  productDesc: string;
  template: AdTemplateKey;
  sec: number;
  aspect: string;
  lang: string;
  beats: Beat[];
  person: AdPerson;
  refs: ReturnType<typeof assembleRefs>;
};

function aspectSentence(a: string): string {
  if (a === "9:16") return "最终输出 9:16 竖构图竖屏视频，画面填满整个画幅、不留黑边。";
  if (a === "1:1") return "最终输出 1:1 正方形视频，画面填满整个画幅、不留黑边。";
  return "最终输出 16:9 横构图宽屏视频，画面填满整个画幅、不留黑边。";
}

export function buildAdPrompt(inp: AdPromptInput): string {
  const p = inp.productName.trim() || "商品";
  const lines: string[] = [];

  // ① @ 映射：商品多视角 + 人物 + 场景 + 风格
  const bind: string[] = [];
  inp.refs.images.forEach((r, i) => {
    if (r.label) bind.push(`@图片${i + 1} ${r.label}`);
  });
  if (inp.refs.productCount > 0) {
    bind.push(`成片中始终只有一件该商品「${p}」，外观、颜色、比例、材质严格与参考图一致，不采用参考图的背景`);
  }
  if (inp.productDesc.trim()) bind.push(`商品外观：${inp.productDesc.trim()}`);
  inp.refs.videos.forEach((v, i) => {
    const uses = v.uses.map((u) => VIDEO_USE_WORD[u]).join("、");
    bind.push(`@视频${i + 1} 只用于${uses}，不采用视频中的人物、商品与背景`);
  });
  inp.refs.audios.forEach((a, i) => {
    bind.push(a.role === "voice" ? `@音频${i + 1} 用于人物说话的音色` : `@音频${i + 1} 用于背景音乐的风格与情绪，音量低于人声`);
  });
  if (bind.length) lines.push(bind.join("。") + "。");

  // ② 人物锁定
  if (inp.person.type === "real") {
    lines.push(`人物「${inp.person.name}」为真人本人，全片同一人；${inp.person.desc.trim() ? `造型：${inp.person.desc.trim()}；` : ""}头部造型、发型、头饰与服装全片锁定，不得变化。`);
  } else if (inp.person.type === "roster" || inp.person.type === "photo") {
    lines.push(`人物「${inp.person.name}」全片同一人；${inp.person.desc.trim() ? `外观：${inp.person.desc.trim()}；` : ""}发型与服装全片锁定，不得变化。`);
  }

  // ③ 主题与结构
  const tpl = AD_TEMPLATES.find((t) => t.key === inp.template);
  lines.push(`这是一条 ${inp.sec} 秒的广告短片，结构为「${tpl?.name || "广告"}」。主题：${inp.brief.trim() || `介绍${p}`}。`);

  // ④ 时间戳节拍：每段一个主要状态变化，段末写可观察状态；台词用 {}，音效用 <>
  const beatLines = inp.beats.map((b) => {
    const parts = [`${b.t0}-${b.t1}秒：${b.action.trim()}`];
    if (b.endState.trim()) parts.push(`结束时${b.endState.trim()}`);
    let s = parts.join("；") + "。";
    if (b.line && b.line.trim()) s += `{${b.line.trim()}}`;
    if (b.sfx && b.sfx.trim()) s += `<${b.sfx.trim()}>`;
    return s;
  });
  lines.push(beatLines.join("\n"));

  // ⑤ 硬约束：无文字、无字幕、镜间硬切、画幅、语言
  lines.push(`画面中不出现任何文字、标牌、字幕或水印；logo、价格与文案由后期叠加。段落之间用硬切或自然的镜头运动衔接，不要叠化和花哨转场。(背景音乐：贴合主题，无歌词，音量低于人声)`);
  lines.push(aspectSentence(inp.aspect));
  lines.push(`台词语言：${langName(inp.lang)}。`);

  return lines.join("\n\n");
}
