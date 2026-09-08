// 浏览器内 ffmpeg.wasm 拼接（单线程 core-st，无需跨源隔离）。供自动模式「合成成片」用。
// 音频：各段视频原声直通（2.5 音视频联合生成后，后期配乐系统已整体退役）。
// 转场两模式：cut=硬切(快，能走 -c copy)；xfade=交叉淡化(必须重编码，慢但衔接柔和)。
// 关键点：
//  1) 单线程内核 run 一次后即退出、不能复用 → 每次拼接、每种尝试都用全新实例。
//  2) ST 内核成功后也常抛 "exit(0)" → 不直接当失败，先看有没有产出 out.mp4。
//  3) -c copy 对编码/分辨率一致性敏感 → 硬切失败自动回落到重编码。

// 三路 CDN 容灾：npmmirror（国内快）→ jsdelivr → unpkg。谁先活用谁。
const WRAPPER_SRCS = [
  "https://registry.npmmirror.com/@ffmpeg/ffmpeg/0.11.6/files/dist/ffmpeg.min.js",
  "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js",
  "https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js",
];
const CORE_SRCS = [
  "https://registry.npmmirror.com/@ffmpeg/core-st/0.11.1/files/dist/ffmpeg-core.js",
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js",
  "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js",
];

function loadScriptOnce(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error(`脚本加载失败：${src}`));
    };
    document.head.appendChild(s);
  });
}

async function ensureScript(): Promise<void> {
  if ((window as any).FFmpeg) return;
  let lastErr: any = null;
  for (const src of WRAPPER_SRCS) {
    try {
      await loadScriptOnce(src);
      if ((window as any).FFmpeg) return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`拼接内核脚本加载失败（三个 CDN 均不可达，检查网络后重试）：${String(lastErr?.message || lastErr || "")}`);
}

let workingCore = ""; // 记住本会话第一个能用的内核源，后续实例免试错

async function freshFF(logs: string[]): Promise<any> {
  const createFFmpeg = (window as any).FFmpeg?.createFFmpeg;
  if (!createFFmpeg) throw new Error("拼接内核不可用");
  const cores = workingCore ? [workingCore, ...CORE_SRCS.filter((c) => c !== workingCore)] : CORE_SRCS;
  let lastErr: any = null;
  for (const corePath of cores) {
    try {
      const ff = createFFmpeg({
        log: false,
        mainName: "main",
        corePath,
        logger: (p: any) => {
          const m = p && p.message;
          if (m) {
            logs.push(String(m));
            if (logs.length > 120) logs.shift();
          }
        },
      });
      await ff.load();
      workingCore = corePath;
      return ff;
    } catch (e) {
      lastErr = e;
      logs.push(`内核源不可达，换下一路：${corePath}`);
    }
  }
  throw new Error(`拼接内核加载失败（三个 CDN 均不可达，检查网络后重试）：${String(lastErr?.message || lastErr || "")}`);
}

// 浏览器侧探测一段视频的时长（xfade 需要每段的精确时长来算 offset）
function probeDuration(bytes: any): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        const d = isFinite(v.duration) ? v.duration : 0;
        URL.revokeObjectURL(url);
        resolve(d > 0 ? d : 5);
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(5);
      };
      v.src = url;
    } catch {
      resolve(5);
    }
  });
}

type Transition = "cut" | "xfade";

// 字幕字符消毒：ed-sub.otf 是思源黑体子集，只覆盖 ASCII、CJK 统一汉字、CJK 标点、全角形式，
// 外加 — ' ' " " … · 这几个。范围之外的字符 drawtext 会烧成豆腐块，而且是永久烧进画面、事后无法补救。
// 策略：能等价替换的替换（¥→￥、℃→度、①→1.），换不掉的直接剔除——宁可少一个符号，也不要一块黑方块。
const SUB_FIX: Record<string, string> = {
  "\u00a5": "\uffe5", // ¥ → ￥（半角日元号字体里没有，全角有）
  "\u00d7": "x",       // ×
  "\u00f7": "/",       // ÷
  "\u00b1": "+/-",     // ±
  "\u00b0": "\u5ea6",  // ° → 度
  "\u2103": "\u5ea6",  // ℃ → 度
  "\u2030": "/1000",   // ‰ —— 不能写成 %，那是 10 倍的错
  "\u2236": "\uff1a",  // ∶ → ：
  "\u2192": "->", "\u2190": "<-", "\u2191": "^", "\u2193": "v",
  "\u2605": "*", "\u2606": "*",
  "\u25cf": "\u00b7", "\u25cb": "\u00b7", "\u25c6": "\u00b7", "\u25a0": "\u00b7",
  "\u2016": "|", "\u2116": "No.", "\u00a0": " ",
};
// 字体里确实存在、但落在上面几个区段之外的散字
const SUB_KEEP = "\u2014\u2018\u2019\u201c\u201d\u2026\u00b7\n";

function sanitizeSub(t: string): string {
  let out = "";
  for (const ch of t) {
    const cp = ch.codePointAt(0) || 0;
    if (cp >= 0x2460 && cp <= 0x2469) { out += String(cp - 0x245f) + "."; continue; } // ①~⑩ → 1.~10.
    const fix = SUB_FIX[ch];
    if (fix !== undefined) { out += fix; continue; }
    const ok =
      (cp >= 0x20 && cp <= 0x7e) ||       // ASCII
      (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK 统一汉字
      (cp >= 0x3000 && cp <= 0x303f) ||   // CJK 标点
      (cp >= 0xff00 && cp <= 0xffef) ||   // 全角形式
      SUB_KEEP.includes(ch);
    if (ok) out += ch; // 其余（假名、扩展区生僻字、emoji…）字体里没有，丢弃
  }
  return out;
}

// 字幕换行：drawtext 不会自动折行，超过每行 15 字手动折
function wrapSub(t: string): string {
  const w = 15;
  const out: string[] = [];
  let s0 = sanitizeSub(t).trim();
  while (s0.length > w) {
    out.push(s0.slice(0, w));
    s0 = s0.slice(w);
  }
  if (s0) out.push(s0);
  return out.join("\n");
}

const XFADE_D = 0.5; // 交叉淡化时长（秒）

function buildCutArgs(mode: "copy" | "reencode", vf?: string): string[] {
  const a = ["-f", "concat", "-safe", "0", "-i", "list.txt"];
  if (mode === "copy") a.push("-c", "copy");
  else a.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac");
  if (vf && mode !== "copy") a.push("-vf", vf); // 硬字幕滤镜链（仅重编码路径）
  a.push("out.mp4");
  return a;
}

// 交叉淡化：filter_complex 串 xfade（视频）+（keep 时）acrossfade（音频）。必须重编码。
function buildXfadeArgs(n: number, durs: number[]): string[] {
  const a: string[] = [];
  for (let i = 0; i < n; i++) a.push("-i", `c${i}.mp4`);
  const parts: string[] = [];
  let vPrev = "[0:v]";
  let offset = 0;
  for (let i = 1; i < n; i++) {
    offset += Math.max(0.6, durs[i - 1] - XFADE_D);
    const out = i === n - 1 ? "[vout]" : `[v${i}]`;
    parts.push(`${vPrev}[${i}:v]xfade=transition=fade:duration=${XFADE_D}:offset=${offset.toFixed(2)}${out}`);
    vPrev = out;
  }
  let aPrev = "[0:a]";
  for (let i = 1; i < n; i++) {
    const out = i === n - 1 ? "[aout]" : `[a${i}]`;
    parts.push(`${aPrev}[${i}:a]acrossfade=d=${XFADE_D}${out}`);
    aPrev = out;
  }
  a.push("-filter_complex", parts.join(";"));
  a.push("-map", "[vout]", "-map", "[aout]", "-c:a", "aac");
  a.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "out.mp4");
  return a;
}

export async function concatVideos(
  urls: string[],
  opts: {
    transition?: Transition;
    totalSec?: number;
    onProgress?: (msg: string) => void;
    subs?: (string | null)[]; // 与 urls 对齐的台词（null=该段无字幕）；有值时烧录进画面
    subFontSize?: number;
  } = {}
): Promise<Blob> {
  const onP = opts.onProgress || (() => {});
  const transition: Transition = opts.transition || "cut";
  if (!urls.length) throw new Error("没有可拼接的视频");

  onP("加载拼接内核…");
  await ensureScript();
  const fetchFile = (window as any).FFmpeg.fetchFile as (u: string) => Promise<Uint8Array>;

  const clips: Uint8Array[] = [];
  for (let i = 0; i < urls.length; i++) {
    onP(`拉取片段 ${i + 1}/${urls.length}…`);
    const proxied = `${location.origin}/api/proxy?url=${encodeURIComponent(urls[i])}`;
    let bytes: Uint8Array;
    try {
      bytes = await fetchFile(proxied);
    } catch (e: any) {
      throw new Error(`片段 ${i + 1} 拉取失败：${String(e?.message || e)}`);
    }
    if (!bytes || bytes.length < 10000) {
      throw new Error(`片段 ${i + 1} 拉取异常（仅 ${bytes ? bytes.length : 0} 字节，可能超代理 6MB 上限或源失效）`);
    }
    clips.push(bytes);
  }
  const totalSec = opts.totalSec || 0;
  const subsIn: (string | null)[] = Array.isArray(opts.subs) ? opts.subs : [];
  let hasSubs = subsIn.some((x) => !!(x && x.trim()));
  const useXfade = transition === "xfade" && clips.length > 1 && !hasSubs; // 字幕模式走硬切（时间轴不被交叉淡化位移）

  // xfade 需要每段时长（算 offset）
  let durs: number[] = [];
  if (useXfade) {
    onP("分析片段时长…");
    durs = [];
    for (const c of clips) durs.push(await probeDuration(c));
  }

  // 硬字幕准备：字体（wasm 无系统字体，取站内子集字体）+ 按各段实测时长排时间轴
  let fontBytes: Uint8Array | null = null;
  let vfSubs = "";
  if (hasSubs) {
    try {
      fontBytes = await fetchFile("/fonts/ed-sub.otf");
      if (!fontBytes || fontBytes.length < 10000) throw new Error("字体文件异常");
    } catch {
      fontBytes = null;
      hasSubs = false;
      onP("字幕字体缺失，本次不烧字幕…");
    }
  }
  if (hasSubs) {
    onP("分析片段时长（字幕对轴）…");
    const sd: number[] = [];
    for (const c of clips) sd.push(await probeDuration(c));
    const fsz = Math.max(20, Math.round(opts.subFontSize || 40));
    const chain: string[] = [];
    let t0 = 0;
    for (let i = 0; i < clips.length; i++) {
      const d = sd[i] || 5;
      if ((subsIn[i] || "").trim()) {
        chain.push(`drawtext=fontfile=font.ttf:textfile=s${i}.txt:fontcolor=white:fontsize=${fsz}:line_spacing=8:box=1:boxcolor=black@0.45:boxborderw=14:x=(w-text_w)/2:y=h-text_h-h/14:enable='between(t,${t0.toFixed(2)},${(t0 + d).toFixed(2)})'`);
      }
      t0 += d;
    }
    vfSubs = chain.join(",");
  }

  // 尝试序列：字幕烧录（若开）→ xfade（若选）→ 硬切 copy → 硬切重编码。每次尝试全新实例；字幕失败自动回落无字幕成片。
  const attempts: Array<{ label: string; args: () => string[] }> = [];
  if (hasSubs && vfSubs) attempts.push({ label: "烧录台词字幕中（重编码，较慢请耐心）…", args: () => buildCutArgs("reencode", vfSubs) });
  if (useXfade) attempts.push({ label: "交叉淡化拼接中（重编码，较慢请耐心）…", args: () => buildXfadeArgs(clips.length, durs) });
  attempts.push({ label: "拼接中…", args: () => buildCutArgs("copy") });
  attempts.push({ label: "重编码拼接中（较慢，请耐心）…", args: () => buildCutArgs("reencode") });

  let lastLog: string[] = [];
  for (const at of attempts) {
    const logs: string[] = [];
    try {
      const ff = await freshFF(logs);
      clips.forEach((b, i) => ff.FS("writeFile", `c${i}.mp4`, b));
      ff.FS("writeFile", "list.txt", new TextEncoder().encode(clips.map((_, i) => `file 'c${i}.mp4'`).join("\n")));
      if (fontBytes) ff.FS("writeFile", "font.ttf", fontBytes);
      if (hasSubs) subsIn.forEach((t, i) => { if (t && t.trim()) ff.FS("writeFile", `s${i}.txt`, new TextEncoder().encode(wrapSub(t))); });
      onP(at.label);
      try {
        await ff.run(...at.args());
      } catch {
        // ST 内核成功也常抛 exit(0)：看产出再定
      }
      let data: any = null;
      try {
        data = ff.FS("readFile", "out.mp4");
      } catch {
        data = null;
      }
      if (data && data.length > 10000) return new Blob([data], { type: "video/mp4" });
      lastLog = logs;
    } catch (e: any) {
      lastLog = logs.length ? logs : [String(e?.message || e)];
    }
  }

  throw new Error(`拼接没有产出。ffmpeg 末尾日志：${lastLog.slice(-10).join(" | ") || "无"}`);
}
