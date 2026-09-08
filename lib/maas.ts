// 前端调用封装。注意：这里只调自己的 /api 路由，绝不直接碰平台 key。
// 访问口令存在 localStorage，作为请求头带上。

const KEY_STORE = "ai-canvas-access-key";

export function getAccessKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEY_STORE) || "";
}

export function setAccessKey(v: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_STORE, v);
}

function authHeaders(): Record<string, string> {
  return { "x-access-key": getAccessKey() };
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || `请求失败 (${res.status})`;
  } catch {
    return `请求失败 (${res.status})`;
  }
}

// 带超时的 fetch：防止某一次请求卡死，把整个轮询循环冻住
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 20000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// 客户端重试（治 504 的正解）：Netlify 网关 ~26s 一到就替函数答 504，服务端函数内重试毫无意义。
// 重试必须发起新请求——每次都是全新的函数调用、全新的 26s 预算。只对网络/超时/网关类错误重试。
function retryable(e: any): boolean {
  const m = String(e?.message || e || "");
  return /504|502|503|超时|timeout|timed out|Failed to fetch|NetworkError|AbortError|aborted|网关|Gateway/i.test(m);
}
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!retryable(e) || i === tries - 1) throw e;
      await sleep(700 * (i + 1));
    }
  }
  throw last;
}

// 两类要「立即报错」的异常，与可重试的网络波动区分开：
class TaskFailedError extends Error {} // 云端明确说任务失败
class FatalPollError extends Error {} // 口令错误等，重试也没用

// 文生图：一次返回图片地址
// 文生图：走 Netlify 后台函数（15 分钟额度）+ 轮询取结果。
// 原因：Seedream 5.0 在 2K/4K 档的生成时长远超普通函数 10~26 秒上限，同步等待必 504。
// 把图片（base64 或 URL）转存到 ImgBB 拿永久公网 URL。
// 失败抛错，调用方自行决定是否降级。
export async function rehostImage(image: string): Promise<string> {
  const res = await fetchWithTimeout(
    "/api/rehost",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ image }),
    },
    60000
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  if (!data.url) throw new Error("转存未返回 URL");
  return data.url as string;
}

// 出图任务内核：触发后台 -background 函数（202），再轮询 image-result，返回完成结果。
// 同一通道支持 文生图 / 改图(image=单张) / 多图融合(image=数组) / 组图(sequential)。
async function runImageJob(payload: {
  prompt: string;
  model: string;
  size?: string;
  image?: string | string[];
  sequential?: boolean;
  maxImages?: number;
}): Promise<{ imageUrl?: string; imageUrls?: string[] }> {
  const jobId =
    (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
    `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  // 1) 触发后台任务（-background 函数立即回 202，函数体继续在后台跑）
  const kick = await fetchWithTimeout(
    "/.netlify/functions/image-gen-background",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ jobId, ...payload }),
    },
    20000
  );
  if (!(kick.ok || kick.status === 202)) throw new Error(await readError(kick));

  // 2) 轮询结果：每 3 秒一次，最多约 6 分钟；单次网络失败不致命，口令错快速失败。
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastBad = "";
  for (let i = 0; i < 120; i++) {
    await wait(3000);
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `/.netlify/functions/image-result?jobId=${encodeURIComponent(jobId)}&t=${Date.now()}`,
        { headers: { ...authHeaders() }, cache: "no-store" },
        15000
      );
    } catch {
      lastBad = "查询请求超时/断网";
      continue;
    }
    if (res.status === 401) throw new FatalPollError("访问口令错误");
    if (res.status === 404) {
      lastBad = "404：image-result 函数不存在（未部署或文件名不对）";
      continue;
    }
    if (!res.ok) {
      lastBad = `查询接口 HTTP ${res.status}`;
      continue;
    }
    const d: any = await res.json().catch(() => null);
    if (!d) {
      lastBad = "查询接口返回非 JSON";
      continue;
    }
    if (d.status === "done" && (d.imageUrl || (d.imageUrls && d.imageUrls.length)))
      return { imageUrl: d.imageUrl, imageUrls: d.imageUrls };
    if (d.status === "error") throw new Error(d.error || "生成失败");
    // running / pending → 继续等
  }
  throw new Error(
    lastBad
      ? `取结果失败（${lastBad}）。注意：图可能已在平台生成并计费，先修查询通道再重试`
      : "生成超时（约 6 分钟）：5.0 大图偏慢，可稍后重试或换 2K"
  );
}

// 文生图 / 改图(image=单张 URL) / 多图融合(image=URL 数组) —— 单图输出，返回首张 URL。
export async function generateImage(
  prompt: string,
  model: string,
  size?: string,
  image?: string | string[]
): Promise<string> {
  const r = await runImageJob({ prompt, model, size, image });
  const url = r.imageUrl || (r.imageUrls && r.imageUrls[0]) || "";
  if (!url) throw new Error("生成失败");
  return url;
}

// 台词本地化：整片台词一次译成目标语言（Seedance 2.5 原生 11 语种有声生成，口型会跟着译文走）
export async function translateLines(
  items: { id: string; text: string }[],
  langName: string
): Promise<Record<string, string>> {
  const res = await fetchWithTimeout(
    "/api/storyboard",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ mode: "i18n", items, langName }),
    },
    35000
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return (data?.lines || {}) as Record<string, string>;
}

// 分镜：一句故事 → 一组结构化镜头（镜号 / 景别 / 运镜 / 画面内容 / 时长）。
// 字段取值对齐镜头卡（ShotShape）旋钮，便于落卡后直接选中。
export interface StoryboardShot {
  shotNo: string;
  title: string;
  shotSize: string; // 景别：远景/全景/中景/近景/特写 或 ""
  cameraMove: string; // 运镜：固定镜头/…/手持轻微晃动 或 ""
  content: string; // 画面内容（核心提示词）
  duration: string; // 时长秒：5/6/8/10
  cast?: string[]; // 本镜出场主角代号（分镜大脑自动分配；无主角时为空）
  env?: string; // 本镜环境锚点（按地点分；用户可改，出视频时作为场景锁定）
  speaker?: string; // （可选）本镜说话人代号
  line?: string; // （可选）台词 ≤18字；Seedance 2.0 据此生成对白与口型
  lineErr?: string; // 台词编剧调用失败的原因（前端在台词框里明示，可↻重试）
  lines?: { speaker: string; line: string }[]; // 场内多轮对话（≥8 秒且两人以上时为必填）
}

// 账户：余额（含每日签到自动+100）与充值码
export async function accountStatus(): Promise<{ disabled?: boolean; master?: boolean; balance?: number; dailyGranted?: boolean }> {
  const res = await fetchWithTimeout("/api/account", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ op: "status" }) }, 15000);
  if (!res.ok) throw new Error(await readError(res));
  return await res.json();
}
export async function redeemCardApi(card: string): Promise<{ points: number; balance: number }> {
  const res = await fetchWithTimeout("/api/account", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ op: "redeem", card }) }, 15000);
  if (!res.ok) throw new Error(await readError(res));
  return await res.json();
}

// 故事骨架：把用户描述补全成六要素（时间/地点/人物/起因/经过/结果）——先有完整故事，再拆分镜
export type StorySkeleton = { time: string; place: string; characters: string; cause: string; process: string; ending: string };
export async function generateStory(brief: string, genre?: string, quirk?: number, note?: string): Promise<StorySkeleton> {
  const call = (fastModel: boolean) =>
    withRetry(async () => {
      const res = await fetchWithTimeout(
        "/api/storyboard",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ brief, genre: genre || undefined, quirk, note: note || undefined, mode: "story", fastModel: fastModel || undefined }),
        },
        30000
      );
      if (!res.ok) throw new Error(await readError(res));
      const d: any = await res.json();
      // 格式校验：服务端版本过旧（没有 story 模式）会落到别的路径、返回别的形状——这里兜住。
      if (!d || typeof d.time !== "string" || (!d.cause && !d.process)) {
        throw new Error("故事骨架格式不对（服务端可能是旧版本，需一起部署最新 route.ts）");
      }
      return d as StorySkeleton;
    }, fastModel ? 2 : 3);
  try {
    return await call(false); // 第一梯队：STORY_MODEL（如 glm-5.1）
  } catch {
    return await call(true); // 兜底梯队：CHAT_MODEL 快模型——骨架几乎不可能再空白
  }
}

// ===== 逐镜生成（治 504 的正解：每个请求都很小、几秒完成，不吃网关缓冲/超时）=====
export type OutlineBeat = { shotNo: string; title: string; beat: string; cast: string[]; env?: string; say?: string; sec?: number };

// 第一步：骨架——每镜一句剧情点 + 出场分配 + 环境锚点（输出极短，秒回）
export async function generateOutline(
  brief: string,
  opts?: { shotCount?: number; targetSec?: number; targetMin?: number; targetMax?: number; quirk?: number; maxSec?: number; genre?: string; style?: string; aspect?: string; character?: string; castTags?: string[]; productTags?: string[]; envHint?: string; adapt?: boolean; sceneMode?: boolean }
): Promise<{ env: string; beats: OutlineBeat[]; style?: string }> {
  return withRetry(async () => {
    const res = await fetchWithTimeout(
      "/api/storyboard",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ brief, ...(opts || {}), mode: "outline" }),
      },
      30000
    );
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    if (!Array.isArray(data.beats) || !data.beats.length) throw new Error("没拿到分镜骨架");
    return { env: (data.env || "").toString(), beats: data.beats as OutlineBeat[], style: (data.style || "").toString() };
  });
}

// 第二步：扩写单镜——带上骨架锚点 + 上一镜成品（衔接），只写这一镜（输出极短，秒回）
export async function expandShot(input: {
  beat: OutlineBeat;
  character?: string;
  env?: string;
  style?: string;
  aspect?: string;
  dur?: string;
  prevContent?: string;
  prevEnv?: string; // 上一镜环境（同场景锁站位；换场景清痕迹）
  outlineAll?: { shotNo: string; title: string; beat: string }[]; // 全片骨架：给扩写全局视野（伏笔/配速）
  note?: string; // 单镜重写的修改要求（remix）
  mustSpeak?: string; // 骨架层指派：本镜必须由该代号开口（无 = 本镜沉默）
  adapt?: boolean; // 剧本改编：忠实还原，台词只摘录不改写
  synopsis?: string; // 剧本改编：剧本原文（扩写取材母本）
  prevLine?: string; // 上一镜台词（跨镜"说—答"节奏）
}): Promise<StoryboardShot> {
  return withRetry(async () => {
    const res = await fetchWithTimeout(
      "/api/storyboard",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ brief: "expand", ...input, mode: "expand", castTags: undefined }),
      },
      30000
    );
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    if (!data?.shot?.content) throw new Error("没拿到这一镜");
    return data.shot as StoryboardShot;
  });
}

// 自动选角：先盘点故事里的贯穿角色，再只按脸配数字人、并为角色重写外观锚点。
// 返回 [{assetId, role(角色名), desc(重写后的外观锚点)}]
export type CastPick = { assetId: string; role: string; desc: string; info?: string; genPrompt?: string };
export async function autoCasting(
  brief: string,
  roster: { assetId: string; label: string; desc: string }[],
  maxPick = 3,
  lockedTags?: string[]
): Promise<CastPick[]> {
  return withRetry(async () => {
    const res = await fetchWithTimeout(
      "/api/storyboard",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ brief, mode: "casting", roster, maxPick, locked: lockedTags || [] }),
      },
      30000
    );
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    return Array.isArray(data.picks)
      ? data.picks
          .map((x: any) => ({ assetId: String(x?.assetId || ""), role: String(x?.role || ""), desc: String(x?.desc || "") }))
          .filter((x: CastPick) => x.assetId)
      : [];
  });
}

// 图生视频：提交任务，拿 taskId（提交是秒回的异步任务）
export async function submitVideo(input: {
  imageUrl?: string; // 首帧（兼容旧字段名）
  firstImageUrl?: string; // 首帧
  referenceImageUrl?: string; // 参考图（旧单字段，兼容）
  referenceImageUrls?: string[]; // 多参考图（角色/物体/场景一致性）
  sourceVideoUrl?: string; // 源视频（延续 / 编辑）
  sourceVideoUrls?: string[]; // 多源视频（轨道补全：多段接成一条）
  referenceAudioUrls?: string[];
  editMode?: boolean; // 局部修补：走 2.5 的视频编辑任务（ratio/duration 由平台锁定）
  extendMode?: boolean;
  draft?: boolean; // 草稿模式：更快更便宜、质量略低，用来先看一眼 // 续接：走 2.5 的视频延长任务（ratio 锁定，时长自定） // 参考音频（配音/配乐/对口型，公网 mp3/wav；需配视觉，不能纯文本+音频）
  prompt: string;
  model: string;
  resolution?: string;
  duration?: string;
  ratio?: string; // adaptive 时前端不传或传 adaptive，路由会忽略
}): Promise<string> {
  const res = await fetchWithTimeout(
    "/api/video/submit",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(input),
    },
    120000
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  if (!data.taskId) throw new Error("未拿到任务 ID");
  return data.taskId as string;
}

export interface PollResult {
  status: "pending" | "done" | "error";
  videoUrl?: string;
  progress?: number;
  error?: string;
}

// 查询一次任务状态（单次 20 秒超时；口令错直接致命）
export async function pollVideoOnce(taskId: string, model: string): Promise<PollResult> {
  const res = await fetchWithTimeout(
    `/api/video/poll?taskId=${encodeURIComponent(taskId)}&model=${encodeURIComponent(model)}`,
    { headers: authHeaders() },
    20000
  );
  if (res.status === 401 || res.status === 403) {
    throw new FatalPollError(await readError(res));
  }
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// 轮询直到完成 / 任务失败 / 预算用尽。
// 韧性设计：
//  - 预算按「实际查询次数」计，不按墙上时钟 —— 睡眠/切页/冻结不消耗预算，
//    醒来自动接着查；
//  - 每次查询自带 20s 超时，单次卡死会被斩断，循环不会被冻住；
//  - 网络层失败（断网、代理重连、Failed to fetch、5xx）永不判死：
//    指数退避放缓（4s→8s→16s→30s 封顶），网络一恢复自动回到正常节奏。
//    任务在云端独立进行，断网多久都不影响它；
//  - 口令错误立即报错；云端明确说任务失败也立即报错并显示原因。
export async function pollVideoUntilDone(
  taskId: string,
  model: string,
  onProgress: (p?: number) => void,
  isCancelled: () => boolean,
  opts: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<string> {
  const intervalMs = opts.intervalMs ?? 4000;
  const maxAttempts = opts.maxAttempts ?? 200; // ≈ 前台连续查 13 分钟的量
  let netFails = 0; // 连续网络失败次数：只用于退避节奏，绝不判死

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (isCancelled()) throw new Error("已取消");

    try {
      const r = await pollVideoOnce(taskId, model);
      netFails = 0;
      if (r.status === "done" && r.videoUrl) {
        return r.videoUrl;
      }
      if (r.status === "error") throw new TaskFailedError(r.error || "视频生成失败");
      if (typeof r.progress === "number") onProgress(r.progress);
    } catch (e: any) {
      if (e instanceof TaskFailedError || e instanceof FatalPollError) throw e;
      if (isCancelled()) throw new Error("已取消");
      // 网络波动 / 单次超时 / 函数偶发错误：一律不判死，退避后继续
      netFails++;
    }

    if (isCancelled()) throw new Error("已取消");
    const wait =
      netFails === 0 ? intervalMs : Math.min(intervalMs * 2 ** Math.min(netFails, 3), 30000);
    await sleep(wait);
  }

  throw new Error("查询次数用尽（任务可能仍在后台进行），可点「重试查询」继续");
}

// 访问口令相关
export async function isAccessRequired(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth");
    const data = await res.json();
    return !!data.required;
  } catch {
    return false;
  }
}

export async function verifyAccess(password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}

// ---- 真人活体数字人（Seedance 2.5 原生锁脸）----
// 三步：开会话（手机扫码活体）→ 登记本人照片 → 轮询到 Active。见 app/api/asset/realperson/route.ts。
async function rpCall<T>(payload: any, timeoutMs = 25000): Promise<T> {
  const res = await fetchWithTimeout(
    "/api/asset/realperson",
    { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(payload) },
    timeoutMs
  );
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}
export async function rpStartSession(): Promise<{ h5Link: string; token: string; expiresIn: number }> {
  return withRetry(() => rpCall({ action: "session" }));
}
export async function rpRegister(imageUrl: string, name: string, groupId?: string): Promise<{ assetId: string; groupId: string }> {
  return rpCall({ action: "register", imageUrl, name, groupId: groupId || "" });
}
export async function rpStatus(assetId: string): Promise<{ status: string; reason: string; url: string }> {
  return withRetry(() => rpCall({ action: "status", assetId }));
}
