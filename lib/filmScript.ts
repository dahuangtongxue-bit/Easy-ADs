// 场提示词编译器。
//
// Seedance 2.5 的生成单位是「场」——一段连续时空，单次上限 30 秒，场内的硬切由模型自己完成。
// 分镜大脑（storyboard/route.ts 的场编剧）已经把场内时间轴写进 content：
//   [0-4秒] 中景，固定机位。……  硬切 [4-9秒] 特写，镜头推近。……
// 所以这里不再排镜头，只负责给一场套上头尾：人物锚点、场景锚点、素材职责、技术规格，
// 并把 content 里的 {台词N} 占位替换成真实台词（单一事实源始终是 line/lines 字段，
// 用户在③改台词后不需要重写 content，位置信息由占位符携带）。
import type { StoryboardShot } from "@/lib/maas";

// Seedance 2.5 原生支持的有声生成语种（官方 11 种）
export const LANGS: { code: string; name: string; label: string }[] = [
  { code: "zh", name: "中文", label: "中文" },
  { code: "en", name: "英语", label: "English" },
  { code: "es", name: "西班牙语", label: "Español" },
  { code: "pt", name: "葡萄牙语", label: "Português" },
  { code: "id", name: "印度尼西亚语", label: "Indonesia" },
  { code: "ms", name: "马来语", label: "Melayu" },
  { code: "th", name: "泰语", label: "ไทย" },
  { code: "vi", name: "越南语", label: "Tiếng Việt" },
  { code: "ar", name: "阿拉伯语", label: "العربية" },
  { code: "ja", name: "日语", label: "日本語" },
  { code: "ko", name: "韩语", label: "한국어" },
];
export function langName(code: string): string {
  return LANGS.find((l) => l.code === code)?.name || "中文";
}

export const SCENE_MAX_SEC = 30; // 2.5 单次生成硬顶
export const SCENE_MIN_SEC = 4; // 平台下限
export const SCENE_DEFAULT_SEC = 15; // 默认场长：一场戏讲得完，单场约 ¥34，失败重来不肉疼
// 单价表（2026-08-30 零克云报价，元/秒）。只有 Seedance 2.5（2.0 于 2026-09-08 下线）。
// 一律用挂牌价，不按折扣价展示——报低了用户会被实际账单打脸。
export const YUAN_PER_SEC: Record<string, number> = { "720p": 1.51, "1080p": 3.74 };
export function ratePerSec(res: string): number {
  return YUAN_PER_SEC[(res || "720p").toLowerCase()] ?? YUAN_PER_SEC["720p"];
}

export function sceneSec(s: StoryboardShot): number {
  const n = Math.round(parseFloat(String(s.duration)) || SCENE_DEFAULT_SEC);
  return Math.min(SCENE_MAX_SEC, Math.max(SCENE_MIN_SEC, n));
}

export function filmTotalSec(shots: StoryboardShot[]): number {
  return (shots || []).reduce((sum, s) => sum + sceneSec(s), 0);
}

export function cost(sec: number, res = "720p"): string {
  const v = sec * ratePerSec(res);
  return `约 ¥${v < 10 ? v.toFixed(1) : Math.round(v)}`;
}

/** 把 content 里的 {台词1}{台词2} 占位换成真实台词；模型没留占位但有台词时补在末尾，绝不丢台词。 */
export function fillLines(content: string, s: StoryboardShot, lang = "zh"): string {
  const ln = lang && lang !== "zh" ? `用${langName(lang)}` : "";
  const duet = (s.lines || []).filter((l) => (l.speaker || "").trim() && (l.line || "").trim());
  const list = duet.length
    ? duet.map((l) => ({ speaker: l.speaker.trim(), line: l.line.trim() }))
    : (s.line || "").trim() && (s.speaker || "").trim()
    ? [{ speaker: (s.speaker || "").trim(), line: (s.line || "").trim() }]
    : [];
  const src = (content || "").trim();
  const used = new Set<number>();
  let out = src.replace(/\{台词(\d+)\}/g, (_m, n) => {
    const ix = Number(n) - 1;
    const it = list[ix];
    if (!it) return "";
    used.add(ix);
    return `${it.speaker}${ln}开口说（口型清晰、精准对口型）：{${it.line}}`;
  });
  // 模型少留了占位（或一个没留）时把剩下的台词补在末尾——宁可位置不精确，也绝不把台词丢掉
  const left = list.filter((_l, ix) => !used.has(ix));
  if (left.length) {
    out += `。${left.map((l, i) => `${l.speaker}${ln}${i || used.size ? "回" : "说"}：{${l.line}}`).join("；")}`;
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/。{2,}/g, "。").trim();
}

export type SceneCtx = {
  stylePrefix?: string;
  castDesc?: string; // 「代号（外观）」绑定，防止多人同框认错人
  refMap?: string; // @图片N=职责
  env?: string; // 本场环境锚点
  beat?: string; // 本场事件（场表给的一句话，用来拼「一句话概述」）
  fix?: string; // 用户对本场的纠正要求
  prevTail?: string; // 上一场结尾一句（跨场是跨调用，模型看不见上一场，只在这里给一句）
  aspect?: string; // 目标画幅，同时写进提示词——ratio 参数万一在适配层丢了，这句是保险
  lang?: string; // 出片语种；非中文时必须在台词前挑明语言（官方提示词规则）
  refVideoUse?: string[]; // 参考片：只学这几样（运镜节奏/调色风格/动作表演/剪辑节奏）
  refStyleImg?: boolean; // 是否附了风格参考图
  refAudioUse?: string; // 音频参考的用途：音色 / 配乐风格
  refAudioCast?: string; // 音色绑定到哪个角色代号（官方写法：图片1的角色使用音频1音色）
  keyframeCount?: number; // ≥2 时按官方「关键帧参考」写法开篇，生成画面会相对严格对齐这些图
};

function aspectWord(a: string): string {
  if (a === "16:9" || a === "21:9" || a === "4:3") return "横构图宽屏";
  if (a === "9:16" || a === "3:4") return "竖构图竖屏";
  if (a === "1:1") return "正方形";
  return "";
}

/** 一句话概述：主体 + 地点 + 事件 + 题材/风格。官方结构化 Prompt 的第二段。 */
function logline(scene: StoryboardShot, ctx: SceneCtx): string {
  const bits = [
    (ctx.stylePrefix || "").trim(),
    (ctx.env || "").trim(),
    (ctx.beat || "").trim() || (scene.title || "").trim(),
  ].filter(Boolean);
  return bits.join("，");
}

/** 编译一场 → 一条可直接提交的 2.5 提示词。顺序按官方基础公式：主体+动作/事件+场景与环境+视觉风格+运镜/切镜+声音。 */
export function buildScenePrompt(scene: StoryboardShot, ctx: SceneCtx = {}): { prompt: string; sec: number } {
  const sec = sceneSec(scene);

  // 关键帧参考：官方要求在第一句写明「以图片 x 至图片 y 的顺序作为关键帧」，生成画面会相对严格对齐输入图。
  // 这是「无锁定」任务，宽高比与时长仍由我们自己指定（不同于 first_frame 会锁死 ratio）。
  const kf = Math.max(0, Math.round(ctx.keyframeCount || 0));
  const lead = kf >= 2 ? `以图片 1 至图片 ${kf} 的顺序作为关键帧，画面严格对齐这些图，按顺序推进。` : "";

  // 第一段：素材指代。官方明确警告——映射关系不能只藏在图片里，必须在提示词开头逐一绑定。
  const bind: string[] = [];
  if ((ctx.refMap || "").trim()) bind.push(`素材绑定：${ctx.refMap!.trim()}`);
  const uses = (ctx.refVideoUse || []).filter(Boolean);
  if (uses.length) {
    // 官方规则：分工要具体到「参考哪一部分」；参考素材本身够精准时只做指代、别复述画面
    bind.push(
      `@视频1=**只参考${uses.join("、")}**，严格照它的节奏与质感来；` +
        `不参考它的内容、人物、场景与台词——画面内容一律以下面的剧情为准。`
    );
  }
  if (ctx.refStyleImg) bind.push(`风格参考图=只参考它的色调、光影与质感，不参考其中的物体与构图。`);
  const au = (ctx.refAudioUse || "").trim();
  if (au === "音色") {
    const who = (ctx.refAudioCast || "").trim();
    bind.push(
      `@音频1=**只参考音色**（音质、声线、口音、说话质感）${who ? `，${who}用这个音色说话` : "，片中人声用这个音色"}；` +
        `不参考它的台词内容与语句——台词一律以下面剧情里给出的为准。`
    );
  } else if (au === "配乐风格") {
    bind.push(`@音频1=**只参考音乐风格**（曲风、配器、情绪、节奏），据此为本片配乐；不照搬旋律，也不要把它的人声带进来。`);
  }
  if ((ctx.castDesc || "").trim()) bind.push(`出场人物：${ctx.castDesc!.trim()}`);

  // 第二段：一句话概述（主体+地点+事件+题材/风格）
  const brief = logline(scene, ctx);

  // 第三段：具体情节（场内时间轴，台词占位已填实）
  const shell = `这是一段 ${sec} 秒的连续场景，场内用硬切（HARD CUT）推进，不做叠化、不做转场特效。`;
  const carry = (ctx.prevTail || "").trim()
    ? `承接上一场结尾：${ctx.prevTail!.trim()}（只延续最后一拍，随即推进新剧情，不要复述）`
    : "";
  const body = [shell, carry, fillLines(scene.content || "", scene, ctx.lang)].filter(Boolean).join("\n");

  // 第四段：结尾——贯穿始终的机位/环境/声音/氛围 + 一致性约束
  const tail: string[] = [];
  if ((ctx.fix || "").trim()) tail.push(`特别要求（必须严格遵守）：${ctx.fix!.trim()}`);
  tail.push(
    `全片统一：${(ctx.stylePrefix || "").trim() ? ctx.stylePrefix!.trim() + "；" : ""}` +
      `人物的五官、发型、服装与场景光线全场严格一致，不得中途改变；场内切换只用硬切，` +
      `每次切换让景别与镜头类型同时改变。` +
      ((ctx.lang || "zh") !== "zh" ? `全片人物一律说${langName(ctx.lang || "zh")}，发音地道、口型与台词精准对位，不要中文配音。` : ``) +
      `不要字幕、不要文字叠加、不要重复人物。` +
      (aspectWord((ctx.aspect || "").trim()) ? `最终输出 ${ctx.aspect!.trim()} ${aspectWord((ctx.aspect || "").trim())}画幅视频，画面填满整个画幅、不留黑边。` : ``) +
      `总时长 ${sec} 秒。`
  );

  return { prompt: [lead, bind.join("\n"), brief, body, tail.join("\n")].filter(Boolean).join("\n\n"), sec };
}

// ============ 场内时间轴：解析 / 校验 / 归一 ============
// 场编剧把切点写成 [0-4秒] … 硬切 [4-9秒] … 的自由文本。这层把它解析成结构，
// 用来：①出片前校验（断档、末段不等于场长——官方明确说时间轴必须连续）；
// ②在③里把一场展开成可读的切点列表；③后续按切点出关键帧参考图。

export type Cut = { start: number; end: number; text: string };

const CUT_RE = /[[【]\s*(\d+)\s*(?:秒|s)?\s*[-–—~至]\s*(\d+)\s*(?:秒|s)?\s*[\]】]/g;

/** 解析场内时间轴。解析不出来返回空数组（= 整场一镜到底，合法）。 */
export function parseCuts(content: string): Cut[] {
  const src = (content || "").trim();
  if (!src) return [];
  const marks: { start: number; end: number; at: number; len: number }[] = [];
  CUT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CUT_RE.exec(src))) {
    marks.push({ start: Number(m[1]), end: Number(m[2]), at: m.index, len: m[0].length });
  }
  if (!marks.length) return [];
  return marks.map((mk, i) => {
    const from = mk.at + mk.len;
    const to = i + 1 < marks.length ? marks[i + 1].at : src.length;
    const text = src
      .slice(from, to)
      .replace(/^[\s，,。.:：]*(?:硬切|切|cut)?[\s，,。.:：]*/i, "")
      .replace(/[\s，,]*(?:硬切|切)\s*$/i, "")
      .trim();
    return { start: mk.start, end: mk.end, text };
  });
}

/** 时间轴体检：连续性、起点、终点是否等于场长。 */
export function checkCuts(cuts: Cut[], sec: number): string[] {
  if (!cuts.length) return [];
  const bad: string[] = [];
  if (cuts[0].start !== 0) bad.push(`第一段从 ${cuts[0].start} 秒开始，应从 0 开始`);
  for (let i = 0; i < cuts.length; i++) {
    if (cuts[i].end <= cuts[i].start) bad.push(`第 ${i + 1} 段时间倒挂（${cuts[i].start}-${cuts[i].end}）`);
    if (i && cuts[i].start !== cuts[i - 1].end) bad.push(`第 ${i} 段与第 ${i + 1} 段之间断档（${cuts[i - 1].end} → ${cuts[i].start}）`);
  }
  const last = cuts[cuts.length - 1].end;
  if (last !== sec) bad.push(`末段结束在 ${last} 秒，场长是 ${sec} 秒`);
  return bad;
}

/** 把跑偏的时间轴按各段原始占比重排到 [0, sec] 连续区间，并改写 content 里的时间标记。 */
export function normalizeTimeline(content: string, sec: number): { content: string; cuts: Cut[]; fixed: boolean } {
  const cuts = parseCuts(content);
  if (!cuts.length) return { content: (content || "").trim(), cuts: [], fixed: false };
  if (!checkCuts(cuts, sec).length) return { content: (content || "").trim(), cuts, fixed: false };

  const spans = cuts.map((c) => Math.max(1, c.end - c.start));
  const total = spans.reduce((a, b) => a + b, 0);
  let acc = 0;
  const secs = spans.map((v, i) => {
    if (i === spans.length - 1) return Math.max(1, sec - acc);
    const v2 = Math.max(1, Math.round((v / total) * sec));
    acc += v2;
    return v2;
  });
  // 前面取整可能把额度用超，从最长的段往回削
  let over = secs.reduce((a, b) => a + b, 0) - sec;
  while (over > 0) {
    const idx = secs.indexOf(Math.max(...secs));
    if (secs[idx] <= 1) break;
    secs[idx] -= 1;
    over -= 1;
  }
  let t = 0;
  const out: Cut[] = cuts.map((c, i) => {
    const cut = { start: t, end: t + secs[i], text: c.text };
    t += secs[i];
    return cut;
  });
  const rebuilt = out.map((c, i) => `${i ? "硬切 " : ""}[${c.start}-${c.end}秒] ${c.text}`).join(" ");
  return { content: rebuilt, cuts: out, fixed: true };
}

/** 关键帧在 frames 表里的键。第 0 个切点沿用场号本身，老作品的预览图不会失效。 */
export function frameKey(shotNo: string, cutIdx: number): string {
  return cutIdx ? `${shotNo}#${cutIdx}` : shotNo;
}

/** 目标画幅 → 关键帧出图像素。关键帧会作为参考图喂回出片，画幅必须一开始就对——
 *  正方形关键帧配 ratio=adaptive，模型会直接选 1:1，画幅全线跑偏。 */
export function aspectPx(aspect: string): string {
  const a = (aspect || "").trim();
  if (a === "16:9") return "2048x1152";
  if (a === "9:16") return "1152x2048";
  if (a === "4:3") return "2048x1536";
  if (a === "3:4") return "1536x2048";
  if (a === "21:9") return "2048x880";
  return "2048x2048"; // 1:1 及未知
}

// ============ 局部修补（Seedance 2.5 视频编辑任务）============
// 官方约束：omni_reference_task_type=edit、ratio 必须 adaptive、duration 必须 -1、
// 参考视频 4~30 秒，且提示词必须含触发关键词之一（编辑视频 / 增加·加上 / 删除·去掉 / 修改·替换·改成）。
// 支持时间戳指定编辑生效时段——这正好接上场内切点：能精确改「4-9 秒那一段」，不用整场重来。

/** 用户的修改要求里有没有官方触发关键词；没有就得由我们补上，否则会被判成别的任务类型。 */
export function hasEditKeyword(text: string): boolean {
  return /编辑视频|增加|加上|删除|去掉|修改|替换|改成/.test(text || "");
}

/**
 * 编译一条局部修补提示词。
 * cut 为 null = 整场修改；否则只改这一段（用绝对时间戳圈定生效时段）。
 */
export function buildEditPrompt(instruction: string, cut: Cut | null, keepRest = true): string {
  const want = (instruction || "").trim();
  if (!want) return "";
  const scope = cut ? `把 @视频1 的 ${cut.start}-${cut.end} 秒这一段` : `把 @视频1`;
  // 关键词兜底：用户写「衣服红一点」这类没有触发词的要求时，前缀补上官方关键词
  const head = hasEditKeyword(want) ? "编辑视频：" : "编辑视频：修改——";
  const tail = keepRest ? "其余画面、机位、光线、人物与声音全部保持不变，不要重新构图。" : "";
  return `${head}${scope}${want}。${tail}`;
}

// ============ 素材成片 ============
// 第二个入口：用户手上有的是素材（产品图、门店照、作品图），不是一个故事。
// 走官方的「一键成片 / 关键帧参考」路子——多张图按顺序进时间轴，模型负责让它们动起来、接起来。
// 与故事成片共用同一套出片通道（reference_image + 关键帧开篇），只是提示词的写法不同：
// 故事成片是「按剧本演」，素材成片是「把这些画面串成片，别改原图」。

export const FOOTAGE_MAX_IMG = 30; // 2.5 参考图上限

export type FootageInput = {
  count: number; // 素材张数
  brief?: string; // 想要一条什么样的片子
  stylePrefix?: string;
  aspect?: string;
  sec: number;
  keepOriginal?: boolean; // 原图不许改（live 图效果）；关掉则允许模型二次创作
};

export function buildFootagePrompt(f: FootageInput): string {
  const n = Math.max(1, Math.min(FOOTAGE_MAX_IMG, Math.round(f.count)));
  const head =
    n >= 2
      ? `以图片 1 至图片 ${n} 的顺序作为关键帧，把它们串成一条 ${f.sec} 秒的短片，按顺序推进、镜间硬切，节奏均匀。`
      : `以图片 1 作为画面基准，生成一条 ${f.sec} 秒的短片。`;
  const want = (f.brief || "").trim();
  const body = want ? `内容与调性：${want}` : `内容与调性：让画面自然流动，串成一条完整、有节奏的短片。`;
  const keep = f.keepOriginal
    ? `每张素材只做轻微动态（live 图的效果：光影浮动、轻微推拉、元素微动），**不要改变原图内容、构图与色彩**，保持与原图高度一致。`
    : `可以在素材的基础上延展画面与运动，但主体外观、产品外观必须与原图一致。`;
  const tail =
    `${(f.stylePrefix || "").trim() ? (f.stylePrefix || "").trim() + "；" : ""}` +
    `镜间只用硬切，不要叠化与转场特效；不要字幕、不要文字叠加。` +
    (aspectWord((f.aspect || "").trim())
      ? `最终输出 ${(f.aspect || "").trim()} ${aspectWord((f.aspect || "").trim())}画幅视频，画面填满整个画幅、不留黑边。`
      : "") +
    `总时长 ${f.sec} 秒。`;
  return [head, body, keep, tail].join("\n\n");
}

// ============ 视频延长（Seedance 2.5 extend 任务）============
// 官方约束：omni_reference_task_type=extend、ratio 必须 adaptive、duration 可自定义 [4,30]、
// 参考视频 2~30 秒，提示词必须含触发关键词之一（向前/向后延长、延续、续写）。
// 官方还点明：拿 2.5 自己生成的视频去延长，音量变化最小、衔接最无缝——ED 的场正好都是 2.5 出的。
// 对 ED 的意义：多场之间不再靠 ffmpeg 硬拼，而是让模型接着上一场往下演，且能突破 30 秒天花板。

export function hasExtendKeyword(text: string): boolean {
  return /延长|延续|续写|接着|继续/.test(text || "");
}

export function buildExtendPrompt(instruction: string, sec: number, ctx: SceneCtx = {}): string {
  const want = (instruction || "").trim();
  const head = `向后延长 @视频1，续写 ${sec} 秒：${want || "顺着上一段的动作与情绪自然往下演，推进剧情。"}`;
  const bits: string[] = [head];
  if ((ctx.castDesc || "").trim()) bits.push(`出场人物：${ctx.castDesc!.trim()}`);
  if ((ctx.refMap || "").trim()) bits.push(`素材绑定：${ctx.refMap!.trim()}`);
  bits.push(
    `与 @视频1 无缝衔接：人物外观、服装、场景与光线严格延续，不要重新构图、不要跳时空；` +
      `${(ctx.stylePrefix || "").trim() ? ctx.stylePrefix!.trim() + "；" : ""}` +
      ((ctx.lang || "zh") !== "zh" ? `人物一律说${langName(ctx.lang || "zh")}，精准对口型。` : ``) +
      `不要字幕、不要文字叠加。`
  );
  return bits.join("\n\n");
}
