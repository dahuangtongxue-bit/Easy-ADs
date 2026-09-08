import { NextRequest, NextResponse } from "next/server";
import { CREDITS_ON, PRICE, isMaster, getAccount, debit } from "@/lib/credits";
import { normalizeTimeline } from "@/lib/filmScript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cleanBase(b: string) {
  return (b || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

// 「分镜大脑」：一句故事 → 一组结构化镜头（镜号 / 景别 / 运镜 / 画面内容 / 时长）。
// 取值刻意对齐镜头卡（ShotShape）的旋钮，落卡后下拉能直接选中。
const SHOT_SIZES = ["远景", "全景", "中景", "近景", "特写"];
const CAMERA_MOVES = [
  "固定镜头",
  "镜头缓慢推近",
  "镜头缓慢拉远",
  "镜头横向摇移",
  "镜头平移跟随",
  "镜头升降运动",
  "镜头环绕主体",
  "手持轻微晃动",
  "低角度仰拍",
  "航拍俯冲",
  "希区柯克变焦",
  "子弹时间环绕",
];
const DURATIONS = ["5", "6", "8", "10", "12", "15", "20", "30"]; // Seedance 2.5 单段上限 30s

// 单镜规范化（流式 / 整包两条路共用）：白名单校验 + cast 过滤 + 时长覆盖
function normalizeShot(s: any, idx: number, allowedTags: string[], durOverride: string): any | null {
  const content = (s?.content || "").toString().trim().slice(0, 900); // 场内时间轴普遍 200+ 字，旧的 200 上限会把最后一段截掉
  if (!content) return null;
  const shotSize = SHOT_SIZES.includes(s?.shotSize) ? s.shotSize : "";
  const cameraMove = CAMERA_MOVES.includes(s?.cameraMove) ? s.cameraMove : "";
  const dRaw = Math.round(parseFloat(String(s?.duration)) || 0);
  let duration = dRaw >= 4 && dRaw <= 30 ? String(dRaw) : "15"; // 4~30 逐秒，别再卡回旧档位
  const dOv = Math.round(parseFloat(String(durOverride)) || 0);
  if (dOv >= 4 && dOv <= 30) duration = String(dOv);
  const title = (s?.title || "").toString().trim().slice(0, 16);
  const shotNo = (s?.shotNo || "").toString().trim() || String(idx + 1).padStart(2, "0");
  let cast: string[] = [];
  if (Array.isArray(s?.cast) && allowedTags.length) {
    cast = s.cast.map((t: any) => String(t).trim()).filter((t: string) => allowedTags.includes(t));
  }
  // lines 必须带出来——漏掉它，模型给的多轮对话在这一行就整段消失了
  const rawLines = Array.isArray(s?.lines) ? s.lines : [];
  return { shotNo, title, shotSize, cameraMove, content, duration, cast, speaker: (s?.speaker || "").toString(), line: (s?.line || "").toString(), lines: rawLines };
}

export async function POST(req: NextRequest) {
  const PASS = (process.env.ACCESS_PASSWORD || "").trim();
  const key = (req.headers.get("x-access-key") || "").trim();
  let payer = ""; // 积分启用时：非管理员的扣费账号
  if (CREDITS_ON()) {
    if (!isMaster(key)) {
      const acct0 = await getAccount(key);
      if (!acct0) return NextResponse.json({ error: "口令无效：请使用邀请口令" }, { status: 401 });
      payer = key;
    }
  } else {
    if (PASS && key !== PASS) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {}
  const brief = (body?.brief || "").toString().trim();
  if (!brief) return NextResponse.json({ error: "请先描述故事 / 场景" }, { status: 400 });

  // 期望场数：用户可指定；否则由片长档位（targetSec）决定拆几场
  let want = parseInt(body?.shotCount, 10);
  if (!Number.isFinite(want)) want = 0;
  const targetSec = Math.max(0, Math.min(180, Number(body?.targetSec) || 0));
    const bandLo = Math.max(0, Number(body?.targetMin) || 0);
    const capSec = Math.max(4, Math.min(30, Number(body?.maxSec) || 30)); // 单场上限：2.0 只有 10 秒
    const bandHi = Math.max(0, Number(body?.targetMax) || 0);
    // 奇葩度：以前只喂故事骨架，骨架从默认路径撤掉后它就成了死按钮——现在直接作用于拆场
    let qk = parseInt(body?.quirk, 10);
    if (!Number.isFinite(qk)) qk = 50;
    qk = Math.max(0, Math.min(100, qk));
    const qkLine =
      qk < 25
        ? `创意档位【老实本分·${qk}%】：平铺直叙，只写这件事最自然的发生方式，不加戏。`
        : qk < 55
        ? `创意档位【正常发挥·${qk}%】：自然叙事，可以有生活化的小波澜。`
        : qk < 80
        ? `创意档位【有点东西·${qk}%】：在现实逻辑内**恰好加一个**巧思——一次巧合、一个反差、一句点睛。`
        : `创意档位【放飞自我·${qk}%】：脑洞全开——强钩子、反转、身份错位、超现实设定都可以上。`;
  want = want ? Math.min(12, Math.max(2, want)) : 0;

  const BASE = cleanBase(process.env.MAAS_BASE_URL || "");
  const KEY = (process.env.MAAS_API_KEY || "").trim();
  const MODEL = (process.env.CHAT_MODEL || "").trim();
  // 关闭深思考模式：GLM-5.1 和 deepseek-v4-flash 都是思考型（flash 拆分镜的隐藏内心戏上千 token，是超时元凶）。
  // Netlify 设 CHAT_THINKING=off 生效；只对已验证支持该参数的模型（glm/deepseek）附带，其它模型不带（避免 400）。
  const THINK_OFF = /^(off|disabled|false|0)$/i.test((process.env.CHAT_THINKING || "").trim());
  // 模型分工：故事编辑可用更强的脑子（STORY_MODEL，如 glm-5.1），其余结构化步骤走 CHAT_MODEL 快车道
  const STORY_MODEL = (process.env.STORY_MODEL || "").trim() || MODEL;
  if (!BASE || !KEY)
    return NextResponse.json({ error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY" }, { status: 500 });
  if (!MODEL)
    return NextResponse.json(
      { error: "未配置 CHAT_MODEL（在 Netlify 环境变量里设成你平台的文本模型 id，全 ASCII）" },
      { status: 500 }
    );

  const genre = (body?.genre || "").toString().trim();
  const style = (body?.style || "").toString().trim();
  const dur = (body?.dur || "").toString().trim();
  const aspect = (body?.aspect || "").toString().trim();
  const character = (body?.character || "").toString().trim();
  const castTags: string[] = Array.isArray(body?.castTags) ? body.castTags.map((t: any) => String(t)).filter(Boolean) : [];
  // 连上游：28s 计时只罩「响应头到达」前；fetch 一返回就清掉，不影响后续流式读 body。
  async function callChat(stream: boolean, messages: any[], timeoutMs = 22000, temperature = 0.7, mdl = MODEL): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: mdl,
          messages,
          temperature,
          stream,
          ...(THINK_OFF && /glm|deepseek/i.test(mdl) ? { thinking: { type: "disabled" } } : {}),
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // 小请求通用：带 2 次自动重试地调一次模型，返回正文文本（非流式）。骨架/扩写都走这里。
  // 只打一枪：Netlify 网关 ~26s 就会替函数答 504，函数内重试毫无意义（浏览器永远看不到第二枪的结果）。
  // 重试职责在客户端（lib/maas 的 withRetry）——每次重试是全新的函数调用，拿全新的 26s 预算。
  async function smallCall(system: string, user: string, timeoutMs = 22000, temperature = 0.7, mdl = MODEL): Promise<{ ok: true; content: string } | { ok: false; err: string; status: number }> {
    try {
      const r = await callChat(
        false,
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        timeoutMs,
        temperature,
        mdl
      );
      const text = await r.text();
      if (!r.ok) {
        const err = `平台返回错误(${r.status}，模型 ${mdl}): ${text.slice(0, 200)}`;
        return { ok: false, err, status: r.status < 500 ? 502 : 504 };
      }
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {}
      const content: string = (data?.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      return { ok: true, content };
    } catch (e: any) {
      const err = e?.name === "AbortError" ? `模型响应超时（${mdl}）` : `${String(e?.message || e)}（模型 ${mdl}）`;
      return { ok: false, err, status: 504 };
    }
  }

  // ===== 模式〇：故事编辑 —— 把用户描述补全成六要素故事骨架（body.mode === "story"）=====
  if (body?.mode === "story") {
    if (payer) {
      const a = await getAccount(payer);
      if (!a || a.balance < PRICE.story) return NextResponse.json({ error: `积分不足：故事骨架需 ${PRICE.story} 积分（每日签到 +${PRICE.daily}）` }, { status: 402 });
    }
    const ST_SYS = `你是故事编辑。把用户的描述补全成一个要素完整、简洁具体的小故事骨架。六要素：时间、地点、人物、起因、经过、结果。
规则：用户已写明的信息（人名、地点、情节、产品）原样保留、绝不改动；缺的要素合理补上，具体不空泛（"傍晚的社区面包店"好过"某个地方"）；不堆形容词、不写画面描写；人物一栏写清每个人的身份（如"陈默（木雕师）、老板娘"）。
字数约定：时间/地点各≤15字，人物≤30字，起因≤50字，经过≤80字，结局≤60字——**务必在限内把话说完，尤其结局的反转要完整落地**，不许写到一半。
只输出一个 JSON，不要解释：{"time":"时间","place":"地点","characters":"人物及身份","cause":"起因","process":"经过","ending":"结果"}`;
    // 奇葩度：0~100，四档位（默认 50 正常发挥）；档位越高，创意指令越野、温度越高
    let quirk = parseInt(body?.quirk, 10);
    if (!Number.isFinite(quirk)) quirk = 50;
    quirk = Math.max(0, Math.min(100, quirk));
    // 约束式分档：低档靠"禁止清单"压住（许可式分档会被模型踩满油门，55% 和 100% 没区别）
    const quirkLine =
      quirk < 25
        ? `创意档位【老实本分·${quirk}%】：像纪录片一样平铺直叙，只写这件事最自然的发生过程。**禁止**任何反转、巧合、戏剧性意外、夸张或超现实设定。`
        : quirk < 55
        ? `创意档位【正常发挥·${quirk}%】：自然叙事，可以有生活化的小波澜（一次犹豫、一个小误会、一点小惊喜）。**禁止**反转结局、禁止身份揭秘、禁止用巧合推动剧情、禁止任何超现实设定。`
        : quirk < 80
        ? `创意档位【有点东西·${quirk}%】：在现实逻辑内**恰好加一个**巧思——一次巧合、或一个误会、或一处小反差，意料之外情理之中。**硬性约束：全片只许这一个巧思；结局必须是自然合理的结局，禁止反转结局、禁止身份揭秘式反转、禁止超现实/荒诞设定。**`
        : `创意档位【放飞自我·${quirk}%】：脑洞全开——强钩子、反转结局、身份错位、超现实设定（物件有灵/时空巧合/极致反差）都可以上，越有记忆点越好；但故事必须自洽，用户写明的人物、产品、关键情节一个字不许改。`;
    // 阶梯温度：按档位跳变，拉开真实差距（线性+封顶会把上半段压成一团）
    const temp = quirk >= 100 ? 1.0 : quirk < 25 ? 0.55 : quirk < 55 ? 0.65 : quirk < 80 ? 0.72 : 0.9; // 拉满=1.0 真·放飞（解析失败有重试+flash兜底）
    const stNote = (body?.note || "").toString().trim().slice(0, 80);
    const stUser = `描述：${brief}` + (genre ? `\n题材：${genre}` : "") + `\n${quirkLine}` + (stNote ? `\n修改要求（必须满足）：${stNote}` : "");
    const useFast = body?.fastModel === true; // 客户端兜底重试：强模型失败后用快模型再来（独立请求、独立预算）
    const r = await smallCall(ST_SYS, stUser, 22000, temp, useFast ? MODEL : STORY_MODEL);
    if (!r.ok) return NextResponse.json({ error: `故事骨架失败：${r.err}` }, { status: r.status });
    let obj: any = null;
    try {
      obj = JSON.parse(r.content);
    } catch {
      const m = r.content.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          obj = JSON.parse(m[0]);
        } catch {}
      }
    }
    const pick = (k: string, n: number) => (obj?.[k] || "").toString().trim().slice(0, n);
    // 长文要素：超限时在最近的句读处收刀，绝不拦腰斩句（护栏只防跑飞，不杀 punchline）
    const cutAtSentence = (k: string, n: number) => {
      const t = (obj?.[k] || "").toString().trim();
      if (t.length <= n) return t;
      const head = t.slice(0, n);
      const m = head.match(/^[\s\S]*[。；！？!?]/);
      return m ? m[0] : head;
    };
    const story = {
      time: pick("time", 30),
      place: pick("place", 40),
      characters: pick("characters", 80),
      cause: cutAtSentence("cause", 100),
      process: cutAtSentence("process", 160),
      ending: cutAtSentence("ending", 120),
    };
    if (!story.cause && !story.process)
      return NextResponse.json({ error: "没能生成故事骨架，换个说法重试", raw: r.content.slice(0, 300) }, { status: 502 });
    if (payer) await debit(payer, PRICE.story); // 成功才扣
    return NextResponse.json(story);
  }

  // ===== 模式一：骨架 —— 每镜一句剧情点，输出极短、秒回（body.mode === "outline"）=====
  if (body?.mode === "outline") {
    if (payer) {
      const a = await getAccount(payer);
      if (!a || a.balance < PRICE.board) return NextResponse.json({ error: `积分不足：生成分镜需 ${PRICE.board} 积分（含选角与角色图）` }, { status: 402 });
    }
    const olExtra: string[] = [];
    const envHint0 = (body?.envHint || "").toString().trim();
    if (envHint0) olExtra.push(`场景库（续拍系列：尽量沿用这些环境锚点，保持画面一致，按地点对号入座；确需新地点可新增）：${envHint0.slice(0, 300)}`);
    if (body?.adapt) olExtra.push(`剧本改编模式：输入是一幕完整剧本。你是场记不是编剧——**只提取，不发明**：剧情点、场景、人物、台词一律以剧本原文为准，不改情节、不加戏、不删关键动作。**按剧本时间顺序切分：每镜负责剧本中相邻的一小段，逐段推进，前后镜绝不重复同一动作或同一句台词**；对白密集处按"说—答"回合分镜。凡该镜有对白，把说话人填进 say，并在 beat 里**原样摘录**该句台词（格式 XX说："原句"，超长截前40字）；场景与时间（内/外景、日/夜）提炼进 env。`);
    if (character) olExtra.push(`主角已锁定：${character}。beat 里用对应代号指代。`);
    if (castTags.length)
      olExtra.push(`可出场代号：${castTags.join("、")}。每镜 cast 从中选真正出场的，别每镜全放：引入/情绪镜可只 1 个，互动/高潮才多个。`);
    const productTags: string[] = Array.isArray(body?.productTags) ? body.productTags.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim()) : [];
    if (productTags.length) olExtra.push(`产品【${productTags.join("】【")}】：**最后一场必须出场**（cast 里列上它，beat 里写清对它的物理动作——拿起、使用、展示、特写落版），这是硬要求；前面各场以剧情合理为准，需要就让它出现，不需要不硬塞。`);
    if (genre) olExtra.push(`题材：${genre}。`);
    if (style) olExtra.push(`风格基调：${style}。`);
    const SC_SYS = `你是资深编剧+分镜师。把给定的故事骨架拆成**场**（不是镜头）。
一场 = 同一地点、同一段连续时间里发生的一段完整事件；场内的镜头切换由后面的场编剧处理，你这一步只管"这一场发生什么"。
按 起因→经过→结果 的节奏拆场；**故事骨架里的每个关键剧情点都要有场，"结果/成果兑现"绝不许省**（如"工厂扭亏为盈"必须拍出来——设备重新轰鸣、灯光次第亮起，不能只拍"发现问题"就跳到结局）；场数跟着剧情走，宁多一场别砍剧情。
cast 必须把**这一场画面里真正出现的人全列上**——故事里提到几个人就该有几个人出场，别只派主角一个人独角戏（"带着三位员工"就该是四个人同框）；只有确实的独处戏才只写一人。
beat 写这一场的完整事件：**谁在哪里做了什么、发生了什么转折、此刻什么情绪**，30~60字。必须是**看得见的事件**，少用"盯着屏幕然后震惊"这类信息揭示（屏幕内容拍不出来，世界的变化才拍得出来）；**连续两场盯屏幕，禁止**。
**相邻两场必须推进剧情，绝不能是同一件事的两种拍法**；换场 = 换地点或换时间，同地点同时段的连续动作属于同一场，不要拆开。
sec 是本场时长（秒），**4~${capSec} 之间任意整数**，按这场戏实际需要多久就写多久：普通推进场用 10~15；冲突爆发、态度转折、完整对话回合这类主场用 20；只有整场一镜到底的重头戏才用 30。**总时长 = 各场之和**，别超出用户要的片长。
产品动作按现实常识（香水喷自己手腕/颈侧或喷向空中留香，严禁对着别人喷；"被香味吸引"=凑近轻嗅/循香回望）。
【环境锚点】每场一条 env（地点+光线+色调）——**同一地点的场 env 逐字相同，换了地点必须写全新的 env**（如 跳蚤市场→咖啡馆是两条完全不同的环境，咖啡馆绝不能沿用跳蚤市场的货架旧物）。
史诗/战争/奇幻大场面题材：至少安排 1 个宏观大场面的场（远景/全景的军阵、龙群、奇观），beat 里写出规模量级；不许全片都是人物近景戏。
只输出一个 JSON，不要解释：{"style":"从 film/cg3d/guofeng/anime/tvc/cyber/mecha/vtuber 里挑最贴故事调性的一个（film=电影写实真人质感；cg3d=皮克斯风3D动画；guofeng=国风水墨；anime=日系二维；tvc=科技广告；cyber=赛博朋克霓虹雨夜；mecha=硬核机甲科幻；vtuber=虚拟偶像二次元）","shots":[{"shotNo":"01","title":"4~8字场名","beat":"${body?.adapt ? "40~80字：本场关键动作+原句台词摘录" : "30~60字：本场完整事件+情绪"}","cast":["代号"],"env":"本场环境锚点(地点+光线+色调)","sec":"10/15/20/30","say":"（可选）本场开口说话的代号"}]}`;
    const olUser =
      `故事：${brief}\n` +
      (want
        ? `拆成 ${want} 场。${targetSec ? `**全片总时长必须落在 ${bandLo || targetSec}~${bandHi || targetSec} 秒之间**（各场 sec 之和，单场上限 ${capSec} 秒）。` : ""}${want === 1 ? "单场要把起因→经过→结果演完整，场内可以换机位、硬切，但地点和时间连续。" : ""}`
        : targetSec
        ? `**全片总时长必须落在 ${bandLo || targetSec}~${bandHi || targetSec} 秒之间**（各场 sec 之和，这是硬要求），据此决定拆几场：${targetSec <= 15 ? "就 1 场，把整个故事压进一场里演完" : targetSec <= 30 ? "1~2 场" : targetSec <= 60 ? "2~3 场" : targetSec <= 90 ? "3~4 场" : targetSec <= 120 ? "4~6 场" : "6~8 场"}（单场上限 ${capSec} 秒，所以场数至少要 ${Math.ceil(targetSec / capSec)} 场）。宁可少拆一场把戏演足，也不要为了凑剧情点把每场压得太短。`
        : `拆成 1~2 场、全片 15~30 秒——这是商业短片的常规长度。只有故事确实装不下才多拆。`) +
      `\n${qkLine}` +
      (`\n台词规划（必做）：**有人物的场基本都该有人开口**——给这些场标 say=本场开口的代号（必须在该场 cast 里，一场只标一人，其余人的回话由场编剧安排）；纯空镜、纯产品特写的场不带 say。\n**cast 里有两个及以上人物的场，尽量写成对手戏**（两人同框、一问一答），别让配角站着当背景板——10 秒以上的场就装得下一个完整对话回合。`) +
      (olExtra.length ? "\n" + olExtra.join("\n") : "");
    const r = await smallCall(SC_SYS, olUser);
    if (!r.ok) return NextResponse.json({ error: `分镜骨架失败：${r.err}` }, { status: r.status });
    let obj: any = null;
    try {
      obj = JSON.parse(r.content);
    } catch {
      const m = r.content.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          obj = JSON.parse(m[0]);
        } catch {}
      }
    }
    const arr: any[] = Array.isArray(obj?.shots) ? obj.shots : [];
    const beats = arr
      .slice(0, 12)
      .map((s: any, i: number) => {
        const beat = (s?.beat || "").toString().trim().slice(0, body?.adapt ? 160 : 120);
        if (!beat) return null;
        const shotNo = (s?.shotNo || "").toString().trim() || String(i + 1).padStart(2, "0");
        const title = (s?.title || "").toString().trim().slice(0, 16);
        const envShot = (s?.env || "").toString().trim().slice(0, 80);
        let cast: string[] = [];
        if (Array.isArray(s?.cast) && castTags.length) cast = s.cast.map((t: any) => String(t).trim()).filter((t: string) => castTags.includes(t));
        const sayRaw = (s?.say || "").toString().trim();
        const say = sayRaw && (cast.includes(sayRaw) || castTags.includes(sayRaw)) ? sayRaw : undefined;
        if (say && !cast.includes(say)) cast.push(say); // 说话的人必须在场
        const secN = Math.round(parseFloat(String(s?.sec || "")) || 0);
        const sec = secN >= 4 && secN <= 30 ? secN : 15; // 4~30 逐秒，按剧情该多长就多长
        return { shotNo, title, beat, sec, cast, env: envShot, say };
      })
      .filter(Boolean);
    if (!beats.length) return NextResponse.json({ error: "没能解析出分镜骨架，换个说法重试", raw: r.content.slice(0, 300) }, { status: 502 });
    const env = ((beats[0] as any)?.env || (obj?.env || "").toString().trim()).slice(0, 80);
    const STYLE_KEYS = ["film", "cg3d", "guofeng", "anime", "tvc", "cyber", "mecha", "vtuber"];
    const styleSuggest = STYLE_KEYS.includes(String(obj?.style || "").trim()) ? String(obj.style).trim() : "";
    // 台词兜底指派：模型没标 say 时，服务端按位置硬派 2 镜（转折段 + 结尾）——指派制不允许静默失败
    if (Array.isArray(beats)) {
      const bs = beats as any[];
      if (!bs.some((b) => b && b.say)) {
        const cand = bs.map((b, i) => ({ b, i })).filter((x) => Array.isArray(x.b?.cast) && x.b.cast.length);
        if (cand.length) {
          const turn = cand[Math.min(cand.length - 1, Math.floor(cand.length * 0.6))];
          const last = cand[cand.length - 1];
          turn.b.say = turn.b.cast[0];
          if (!last.b.say) last.b.say = last.b.cast.length > 1 && last.b !== turn.b ? last.b.cast[1] : last.b.cast[0];
        }
      }
    }
    if (payer) await debit(payer, PRICE.board); // 成功才扣
    // 片长硬闸：用户明确要了 targetSec，模型却常常超（实测要 40 秒给了 70 秒）。
    // 按比例把各场 sec 压回目标，单场夹在 [10, 30]，再把取整误差补到最长的一场上。
    if (targetSec) {
      const arr = beats as any[];
      const sum = arr.reduce((t, b2) => t + (Number(b2.sec) || 15), 0);
      const lo = bandLo || Math.round(targetSec * 0.9);
      const hi = bandHi || Math.round(targetSec * 1.1);
      // 落在区间里就不动——各场只能取 10/15/20/30，硬凑一个精确值反而会逼出别扭的场次划分
      if (sum < lo || sum > hi) {
        const k = targetSec / sum;
        arr.forEach((b2) => { b2.sec = Math.min(capSec, Math.max(4, Math.round((Number(b2.sec) || 15) * k))); });
        let diff = arr.reduce((t, b2) => t + b2.sec, 0) - targetSec;
        while (diff !== 0) {
          const idx = diff > 0
            ? arr.reduce((m, b2, i2) => (b2.sec > arr[m].sec ? i2 : m), 0)
            : arr.reduce((m, b2, i2) => (b2.sec < arr[m].sec ? i2 : m), 0);
          const step = diff > 0 ? -1 : 1;
          const nv = arr[idx].sec + step;
          if (nv < 4 || nv > capSec) break;
          arr[idx].sec = nv;
          diff += step;
        }
      }
    }
    return NextResponse.json({ env, beats, style: styleSuggest });
  }

  // ===== 模式二：扩写单镜 —— 输入骨架+上一镜成品，输出这一镜完整 content（body.mode === "expand"）=====
  if (body?.mode === "expand") {
    const beat: any = body?.beat || {};
    const beatTxt = (beat?.beat || "").toString().trim().slice(0, 60);
    if (!beatTxt) return NextResponse.json({ error: "缺少本镜剧情点" }, { status: 400 });
    const env = (body?.env || "").toString().trim().slice(0, 80);
    const prev = (body?.prevContent || "").toString().trim().slice(0, 200);
    const prevEnv = (body?.prevEnv || "").toString().trim().slice(0, 80);
    const castArr: string[] = Array.isArray(beat?.cast) ? beat.cast.map((t: any) => String(t).trim()).filter(Boolean) : [];
    const note = (body?.note || "").toString().trim().slice(0, 80); // 单镜重写时的修改要求
    const EX_SYS = `你是资深分镜师+视频提示词专家。把一场的事件写成**场内时间轴**——这一整场会由视频模型一次生成，场内的镜头切换由你在 content 里排好。
content 的格式（严格照此写，时间从 0 开始、单位秒）：
[0-4秒] 景别，运镜。这一拍发生的动作与表演。 硬切 [4-9秒] 景别，运镜。下一拍…… 硬切 [9-15秒] ……
切点数量按场长：10秒 2~3 段、15秒 3~4 段、20秒 4~5 段、30秒 5~7 段；**整场一镜到底的重头戏可以只写一段**（不写"硬切"）。每段 25~45 字。
【时间轴纪律】时间戳以**整数秒**为单位，**必须连续无断档**（✓"0-4秒…4-9秒…9-15秒" ✗"0-3秒…5-6秒"）；第一段从 0 开始，最后一段的结束时间必须**正好等于场长**；不要用时间戳控制频次（✗"一秒摇头3次"）。
【镜头语言】景别、运镜、机位这类通识词直接写。用到"希区柯克变焦""子弹时间环绕"这类小众名词时，**后面必须跟一句描述性解释**（如"希区柯克变焦——背景急速拉伸而主体大小不变"），否则模型认不出。
【硬切美学】每次硬切要**双重反差**——景别与镜头类型同时改变（中景固定 → 特写推近 → 远景拉远）。景别取 ${SHOT_SIZES.join("/")}，运镜取 ${CAMERA_MOVES.join("/")}。同一次生成里空间是连贯的，放开切，别拘着。
其余规矩：
①人物**只用代号称呼**（如 林北、厂长）。若下方给了「人物设定」，**绝不把外观描述复写进 content**——脸和服装已由选角参考图与独立描述在视频端锁定，复写只会挤占剧情篇幅（剧情需要的随身道具动作除外，如"从夹克内袋取出平板"）；若没给人物设定（纯文字模式），才自拟一句外观锚点写在第一段；
②【动作】**优先用概括性描述**（"连续做了几组高抬腿和空翻"、"两人展开近身搏斗"、"翻找抽屉找钥匙"），每段只挑**一个**有记忆点的动作写具体细节，其余带过；同一个动作不要反复换词重写。但**禁止只写一个静止姿态**——每段至少有一个明确发生的动作。**一段 4~6 秒装得下的内容有限，写太满会被过度剪切、剧情反而丢失**；
③【表情】用**描述性语句**，别用成语——✗"津津有味地吃饭" ✓"脸上带着满足的笑容，大口地吃饭"；表演优先动作化（攥紧文件、后退半步、钢笔脱手落地），微表情其次；**同一部片不重复用同一个表演词**；
④**不要把环境锚点整段抄进 content**——环境已由 env 字段独立注入，抄了纯属复读；只在动作里自然带一个属于当前场景的细节（咖啡馆=杯口热气，工厂=飞溅的火花），绝不把别的场景的道具带进来；
⑤**不写风格词**（电影质感/胶片颗粒/浅景深这类，风格由全局设置独立注入）；若给了全片场表：本场只写本场的事件、不剧透后面，但要**接住前面出现过的关键道具/细节**（伏笔要回收）；铺垫场表演克制，高潮场才放开；
⑥台词：完全服从下方的台词指令。**场长 ≥10 秒且本场有两人及以上时，必须写成 lines 多轮对话**，不许只给一句就交差——回合数按场长给足：10秒 2 回合、15秒 2~3 回合、20秒 3~4 回合、30秒 4~6 回合（一回合 = 一个人说一句），说—答—反应地推进剧情，每句 ≤24 字、不同人交替。只有独处戏、纯空镜、纯产品特写才写单句或不写。
【严禁把对话藏进叙述】content 里只写画面动作，**绝不允许出现"他回应她""两人交谈""笑着答道"这类把台词写成叙述的写法**——只要有人回话，那句话就必须作为一条 lines 落到字段里，并在 content 对应时间段留 {台词N} 占位。写进叙述的台词等于没有：视频端不会说出来，用户也改不了；台词**不写实际文字**进 content，而是在该说话的那一段里**直接写占位符本身**：{台词1}、{台词2}（按顺序，不要在占位符前后加「留」「说」这类字），实际台词放进 speaker+line 或 lines 字段——这样用户改台词时不用重写整场。**说话那一段的机位必须让说话人正面或侧面露脸**（禁背面机位/只拍后脑勺——没法对口型）；**网址、电话、价格等数字串禁入台词**（念不出口，交给画面）；沉默的场不留占位、两个字段都不输出。台词长度：单句≤24字，一场里多轮对话每句≤24字、每回合约 4~6 秒配平场长（15秒≈2~3回合、30秒≈4~6回合），不同人交替、说—答—反应；
⑦大场面：战争/灾难/奇观/群体镜头必须写出**规模数量级**（千军万马、漫天龙群、火海连天）、**空间纵深**（前景近身厮杀、中景阵线相撞、远景火光冲天——三层各有内容）、**能量事件**（爆炸、火焰倾泻、地面震颤）。宏大战争不许拍成两个人的特写戏；
⑧声音分层（Seedance 2.5 约定）：音效写进 <>（如 <玻璃碎裂声>）标在对应的那一段里，全场环境音乐写进 ()（如 (紧张的弦乐渐强)）标在最后一段。每段最多一个 <>，全场最多一个 ()，没有合适的就不写，绝不硬凑。
若给了上一场结尾，本场开头动作要接住它（动作/视线/物件）——**接住=只延续它的最后一拍，随后必须推进全新的剧情；绝不复述上一场已发生过的动作**（复述会让成片像时间循环）。产品动作写物理操作、符合常识（香水喷自己手腕/颈侧或空中，严禁对着别人喷）。
duration 原样返回下方给定的场长，不要自作主张改。shotSize / cameraMove 两个字段填**第一段**用的景别与运镜（供预览图与列表显示）。
只输出一个 JSON（注意 lines 是**真数组**，不是字符串）：{"shotNo":"01","title":"...","shotSize":"...","cameraMove":"...","content":"[0-4秒] …… 硬切 [4-9秒] ……","duration":"本场场长","lines":[{"speaker":"代号","line":"≤24字"},{"speaker":"另一个代号","line":"≤24字"}]}\n多轮对话就填 lines 数组（按回合配平场长）；确实只有一个人说一句时，改用 "speaker" + "line" 两个字段，此时不要输出 lines。`;
    const outlineAll: any[] = Array.isArray(body?.outlineAll) ? body.outlineAll.slice(0, 12) : [];
    const olLines = outlineAll
      .map((o: any) => `${String(o?.shotNo || "")} ${String(o?.title || "").slice(0, 16)}｜${String(o?.beat || "").slice(0, 60)}`)
      .join("\n");
    const pos = outlineAll.findIndex((o: any) => String(o?.shotNo || "") === (beat?.shotNo || "").toString()) + 1;
    const synIn = (body?.synopsis || "").toString().trim();
    const exUser = [
      olLines ? `全片骨架（共 ${outlineAll.length} 镜，本镜是第 ${pos > 0 ? pos : "?"} 镜）：\n${olLines}` : "",
      body?.adapt && synIn ? `剧本原文（改编母本——本镜的动作、调度、台词只从其中取材）：\n${synIn.slice(0, 2500)}` : "",
      character ? `人物设定（仅供理解身份与随身道具，不要把外观复写进 content）：${character}` : "",
      env ? `环境锚点：${env}` : "",
      style ? `整体风格（仅供把握基调与光影用词，不要把这些词原样写进 content）：${style}` : "",
      aspect ? `画幅 ${aspect}。` : "",
      prev ? `上一镜结尾：${prev}` : "本片第一镜。",
      prevEnv && env ? (prevEnv === env ? "与上一镜同一场景：人物的位置与朝向必须和上一镜一致（谁在左谁在右、面向哪边都别变）。" : "本镜换到新地点：开头用一拍交代进入（推门/迈入/门铃），绝不带上一场景的道具与痕迹（包括人物身上的木屑、灰尘）。") : "",
      `本镜（${(beat?.shotNo || "").toString()}·${(beat?.title || "").toString().slice(0, 16)}）剧情点：${beatTxt}`,
      note ? `本镜修改要求（必须满足）：${note}` : "",
      (body?.mustSpeak || "").toString().trim()
        ? `本场是台词场：**必须**让「${(body?.mustSpeak || "").toString().trim()}」先开口。${(() => { const d = Math.round(parseFloat(String((body?.beat as any)?.sec || "")) || 0); const many = ((body?.beat as any)?.cast || []).length >= 2; const turns = d >= 25 ? "4~6" : d >= 18 ? "3~4" : d >= 10 ? "2~3" : "1"; return many && d >= 10 ? `本场 ${d} 秒、场上有 ${((body?.beat as any)?.cast || []).length} 个人，**必须写成 lines 多轮对话，共 ${turns} 个回合**（一回合=一个人说一句，不同人交替、说—答—反应），不许只给一句就交差；每句 ≤24 字、口语化。` : `让他说一句（≤24字，口语化）。`; })()}${(body?.prevLine || "").toString().trim() ? `上一场刚说过：「${(body?.prevLine || "").toString().trim().slice(0, 24)}」，别重复。` : ""}`
        : "本镜沉默：不输出 speaker/line。",
      body?.adapt ? `剧本改编：在剧本原文中找到本镜剧情点对应的段落，把该段的动作、调度、表演**写足**（content 60~110字的镜头语言——机位里看得见的动作细节都要，只翻译不发明，不新增剧情不改变发生的事，也不把前后镜的段落抢过来拍）；若该段有台词，line 必须**原样摘录**（可截≤40字），禁止改写用词与语气。` : "",
      castArr.length ? `本镜出场：${castArr.join("、")}（只描写这些主体）` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const prevFull = (body?.prevContent || "").toString().trim().slice(0, 400);
    const normTxt = (t: string) => t.replace(/[\s，。、！？；：""''·,.!?;:'"()（）]/g, "");
    const idx = Math.max(0, (parseInt((beat?.shotNo || "").toString(), 10) || 1) - 1);
    const t0 = Date.now();
    let shot: any = null;
    let extraNote = "";
    for (let t = 0; t < 2; t++) {
      if (t === 1 && Date.now() - t0 > 8000) break; // 首枪太慢：不补枪，留预算干净返回，重试交给客户端
      const r = await smallCall(EX_SYS, exUser + extraNote, t === 0 ? 22000 : 14000);
      if (!r.ok) return NextResponse.json({ error: `扩写失败：${r.err}` }, { status: r.status });
      let obj: any = null;
      try {
        obj = JSON.parse(r.content);
      } catch {
        const m = r.content.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            obj = JSON.parse(m[0]);
          } catch {}
        }
      }
      shot = normalizeShot(obj, idx, [], dur);
      if (!shot) {
        if (t === 0) {
          extraNote = "\n【警告】上次输出无法解析。只输出一个合法 JSON 对象，别加任何解释。";
          continue;
        }
        return NextResponse.json({ error: "没能解析出这一镜，重试一下", raw: r.content.slice(0, 300) }, { status: 502 });
      }
      // 防抄写闸：本镜内容与上一镜高度雷同（原样复述）→ 带警告重写一次
      if (prevFull && t === 0) {
        const a = normTxt(shot.content);
        const b = normTxt(prevFull);
        if (a && b && (a === b || a.includes(b) || b.includes(a))) {
          extraNote = "\n【警告】你把上一镜的内容原样复述了一遍——这会让成片出现时间循环。重写本镜：开头只延续上一镜的最后一拍（动作/视线/物件），之后必须是全新推进的动作链，任何一句都不得与上一镜相同。本镜的剧情点是新发生的事，写它。";
          shot = null;
          continue;
        }
      }
      break;
    }
    if (!shot) return NextResponse.json({ error: "没能解析出这一镜，重试一下" }, { status: 502 });
    // 专职台词编剧：本镜被指派开口而扩写没给 line → 追加一次微型调用（比"重写整镜"快且可靠：
    // flash 关思考后有 schema 惯性，大 schema 里的可选字段基本不输出；单一任务+必填字段则从不失手）
    const mustSpeakIn = (body?.mustSpeak || "").toString().trim();
    if (mustSpeakIn && !(shot.line || "").toString().trim() && Date.now() - t0 < 14000) {
      const durN1 = parseFloat(String(shot.duration)) || 5;
      const lnCap = durN1 >= 20 ? 48 : durN1 >= 12 ? 40 : 24;
      const LN_SYS = `你是短视频台词编剧。为一镜画面写**一句**台词。要求：≤${lnCap}字、口语化像人话（禁旁白解说、禁书面语、禁喊口号；禁网址/电话/价格数字串——念不出口的交给字幕）。只输出一个 JSON，不要解释：{"line":"台词"}`;
      const lnUser = [
        `说话人：${mustSpeakIn}`,
        `本镜画面：${(shot.content || "").toString().slice(0, 120)}`,
        beatTxt ? `本镜剧情点：${beatTxt}` : "",
        (body?.prevLine || "").toString().trim() ? `上一镜刚说过：「${(body?.prevLine || "").toString().trim().slice(0, 24)}」——这句可以是对它的回应。` : "",
      ].filter(Boolean).join("\n");
      // 上游偶发 fetch failed——全链路其它调用都有客户端重试自愈，这里必须自己带重试，且失败不许沉默
      for (let a = 0; a < 2 && Date.now() - t0 < 18000; a++) {
        const lr = await smallCall(LN_SYS, lnUser, 7000, 0.7);
        if (lr.ok) {
          try {
            const lo = JSON.parse((lr.content.match(/\{[\s\S]*\}/) || [lr.content])[0]);
            const ln = (lo?.line || "").toString().trim();
            if (ln) {
              shot.speaker = mustSpeakIn;
              shot.line = ln;
              break;
            }
          } catch {}
        }
      }
      if (!(shot.line || "").toString().trim()) {
        shot.lineErr = `台词未生成（上游波动，说话人应为「${mustSpeakIn}」）——点本镜↻重试或手填`;
      }
    }
    // 台词硬闸：说话人必须在本镜出场名单里；≤24 字超长句读收刀；未开启则一律剥除
    {
      const rawSpeaker = (shot.speaker || "").toString().trim();
      let rawLine = (shot.line || "").toString().trim().replace(/^[「"『'"]+|[」"』'"]+$/g, "");
      const okSpeaker = rawSpeaker && castArr.length ? castArr.includes(rawSpeaker) : !!rawSpeaker;
      if (!okSpeaker || !rawLine) {
        delete shot.speaker;
        delete shot.line;
      } else {
        const durN0 = parseFloat(String(shot.duration)) || 5;
        const lineCap = durN0 >= 20 ? 48 : durN0 >= 12 ? 40 : 24;
        if (rawLine.length > lineCap) {
          const head = rawLine.slice(0, lineCap);
          const m = head.match(/^[\s\S]*[，。！？!?]/);
          rawLine = (m ? m[0] : head).replace(/[，,]$/, "");
        }
        shot.speaker = rawSpeaker;
        shot.line = rawLine;
      }
    }
    // 场长执法：场表已经定了 sec，场编剧只许照办（模型跑偏就掰回来）
    {
      const want = Math.round(parseFloat(String((body?.beat as any)?.sec || "")) || 0);
      if (want >= 4 && want <= 30) shot.duration = String(want);
      else {
        const dN = Math.round(parseFloat(String(shot.duration)) || 15);
        shot.duration = String(Math.min(30, Math.max(4, dN)));
      }
    }
    // 时间轴硬闸：官方要求时间戳连续、以整数秒为单位。场编剧写断档或末段对不上场长时，
    // 按各段原始占比重排到 [0, 场长] 并改写 content——出片前就掰正，别拿几十块的生成去赌。
    {
      const secN = Math.round(parseFloat(String(shot.duration)) || 15);
      const norm = normalizeTimeline(String(shot.content || ""), secN);
      shot.content = norm.content;
      (shot as any).cutCount = norm.cuts.length;
      if (norm.fixed) (shot as any).timelineFixed = true;
    }
    // 镜内多轮对话硬闸（20/30秒超长镜专属）：说话人必须在场、每句≤24字句读收刀、30秒≤3回合/20秒≤2回合；不成立退回单句制
    {
      const durNL = parseFloat(String(shot.duration)) || 5;
      // 容错：模型有时把 lines 写成 JSON 字符串而不是数组——就地解析，绝不静默丢弃
      let rawLines: any[] = Array.isArray((shot as any).lines) ? ((shot as any).lines as any[]) : [];
      if (!rawLines.length && typeof (shot as any).lines === "string") {
        const m3 = String((shot as any).lines).match(/\[[\s\S]*\]/);
        if (m3) { try { const p3 = JSON.parse(m3[0]); if (Array.isArray(p3)) rawLines = p3; } catch {} }
      }
      const maxTurns = durNL >= 8 ? 99 : 0; // 场制下 8 秒就装得下两句一来一回（原来卡 12 秒，10 秒的场全被丢）
      const cleaned: { speaker: string; line: string }[] = [];
      if (maxTurns > 0) {
        for (const it of rawLines) {
          let sp = (it?.speaker || "").toString().trim();
          let ln = (it?.line || "").toString().trim().replace(/^[「"『'"]+|[」"』'"]+$/g, "");
          if (!sp || !ln) continue;
          if (castArr.length && !castArr.includes(sp)) {
            // 名字对不上就找最接近的在场角色，再不行按顺序轮着归——绝不因为对不上名字就丢掉整句台词
            const near = castArr.find((c: string) => c.includes(sp) || sp.includes(c));
            sp = near || castArr[cleaned.length % castArr.length];
          }
          if (ln.length > 24) {
            const head = ln.slice(0, 24);
            const m2 = head.match(/^[\s\S]*[，。！？!?]/);
            ln = (m2 ? m2[0] : head).replace(/[，,]$/, "");
          }
          cleaned.push({ speaker: sp, line: ln });
          if (cleaned.length >= maxTurns) break;
        }
      }
      if (cleaned.length >= 2) {
        (shot as any).lines = cleaned;
        delete shot.speaker;
        delete shot.line;
        delete (shot as any).lineErr;
      } else {
        delete (shot as any).lines;
      }
    }
    // 风格词剥离兜底：整体风格由视频端统一注入，content 结尾若复读风格词，逐个剥掉（规则管嘴，这里管手）
    if (style) {
      const toks = style
        .replace(/（[^）]*）/g, "")
        .split(/[，,、]/)
        .map((x: string) => x.trim())
        .filter((x: string) => x.length >= 2);
      let c = (shot.content || "").trim();
      let changed = true;
      while (changed && c) {
        changed = false;
        c = c.replace(/[。！？!?，,\s]+$/, "");
        for (const tk of toks) {
          if (tk && c.endsWith(tk)) {
            c = c.slice(0, c.length - tk.length);
            changed = true;
          }
        }
      }
      c = c.replace(/[，,\s]+$/, "");
      if (c) shot.content = /[。！？!?]$/.test(c) ? c : c + "。";
    }
    shot.shotNo = (beat?.shotNo || shot.shotNo).toString();
    shot.cast = castTags.length ? castArr.filter((t) => castTags.includes(t)) : [];
    return NextResponse.json({ shot });
  }

  // ===== 模式三：自动选角 —— 按剧情从选角台名单里挑最合适的主角（body.mode === "casting"）=====
  // ===== 模式四：台词翻译 —— 整片台词一次译成目标语言（body.mode === "i18n"）=====
  // Seedance 2.5 原生支持 11 种语言的有声生成并能精准对口型，但台词得由我们给出目标语言原文，
  // 而不是指望它自己翻——译文还要回填到③让用户能改（品牌名、人名常需要人工定夺）。
  if (body?.mode === "i18n") {
    const items: { id: string; text: string }[] = Array.isArray(body?.items)
      ? body.items.map((x: any) => ({ id: String(x?.id || ""), text: String(x?.text || "").trim() })).filter((x: any) => x.id && x.text).slice(0, 60)
      : [];
    const langName = (body?.langName || "").toString().trim();
    if (!items.length || !langName) return NextResponse.json({ error: "没有可翻译的台词" }, { status: 400 });
    const I18N_SYS = `你是影视本地化译者。把给定的台词译成${langName}，用于 AI 视频的口型配音。
规则：①**只译台词本身**，不加解释、不加引号、不加说话人；②口语化、上口、适合演员说出来，不要书面直译；
③长度尽量与原文相当（配音时长要对得上），单句不超过原文字数的 1.3 倍；④人名、品牌名、产品型号**保持原样不译**；
⑤数字读得出口（"43万"译成该语言里自然的口语说法）；⑥保持原台词的语气（质问就是质问，寒暄就是寒暄）。
只输出一个 JSON，不要解释：{"lines":[{"id":"原样回填","text":"${langName}译文"}]}`;
    const user = items.map((x) => `${x.id} ||| ${x.text}`).join("\n");
    const r = await smallCall(I18N_SYS, user, 24000, 0.3);
    if (!r.ok) return NextResponse.json({ error: r.err }, { status: r.status || 502 });
    let obj: any = null;
    try {
      obj = JSON.parse(r.content.replace(/```json|```/g, "").trim());
    } catch {
      const m = r.content.match(/\{[\s\S]*\}/);
      if (m) { try { obj = JSON.parse(m[0]); } catch {} }
    }
    const out: Record<string, string> = {};
    for (const l of Array.isArray(obj?.lines) ? obj.lines : []) {
      const id = String(l?.id || "").trim();
      const text = String(l?.text || "").trim();
      if (id && text) out[id] = text;
    }
    if (!Object.keys(out).length) return NextResponse.json({ error: "翻译没解析出来，重试一下", raw: r.content.slice(0, 200) }, { status: 502 });
    return NextResponse.json({ lines: out });
  }

  if (body?.mode === "casting") {
    const roster: any[] = Array.isArray(body?.roster) ? body.roster.slice(0, 40) : [];
    if (!roster.length) return NextResponse.json({ picks: [] });
    const maxPick = Math.max(1, Math.min(6, parseInt(body?.maxPick, 10) || 3)); // 剧本改编的大剧组最多 6 位
    const CA_SYS = `你是选角导演。分三步：
第一步·盘点角色：从故事里找出需要贯穿全片、反复出场的主要角色（含次主角，如"老板娘"），通常 1~3 个，一个都别漏。
第二步·配对或造人：名单有几十人，先按性别+年龄段圈出候选，再在圈内按下面的优先级精挑：
⓪**最高优先**：标注"用户自有角色·照片锁定"的候选是用户亲自上传的**钦定演员**——故事角色与其名字相同或明显对应时**必须选用**（此条压倒下面所有规则）；自有角色即使没写年龄职业也**不得淘汰**（照片即真身，无需审核信息）；
①**性别与年龄段是硬约束**——中年老板绝不用二十岁的脸，年龄差一档以上直接淘汰；
②**身份/职业贴近者优先**——名单里有现成的科技CEO、工程师、设计师、产品经理、投行精英、律师、古装官员武将，角色是什么身份就优先让专业对口的人出演（TA照片里自带的服装与气质都是白赚的戏）。别让快递员演老板，别让学生脸演总监；
③职业不对口时才退而求其次，选**外观气质**最贴的（服装稍后由你重写补齐——名单里没有木雕师，不代表不能演木雕师）；
④古装/年代角色优先用带"(古装)"标记的候选（已穿戏服）。
不同角色不要用同一张脸。**如果名单里没有任何人能演这个角色**（奇幻种族、特殊形象——如魔族武将、龙族化身），就造一个新角色：assetId 填 "GEN"，并额外输出 genPrompt=该角色的文生图形象描述（种族特征/铠甲服饰/发型/气质/年代感，15~40字）。能用名单的脸就优先用（跨镜一致性更稳），造人是名单覆盖不了时的正当手段。
第三步·重写外观锚点 desc：保留所选数字人的发型与体貌特征（发型/发色/长短/体型），**服装必须与角色的职业身份匹配**——工程师=工装夹克/衬衫+休闲长裤，企业老板=西装或商务装，医生=白大褂，厨师/店员才可能是围裙；**古代/奇幻角色同理**：步兵队长=铠甲战袍、魔族武将=黑曜风格甲胄、法师=长袍——绝不给他们现代服装或围裙；**候选照片里的原始服装与角色身份不符时必须整套换掉，严禁保留**。且必须**从头到脚闭环**：内搭（颜色+款式）+外层/围裙+配饰全写明——没写到的部位模型每镜会乱变（只写"深蓝围裙"不写内搭→内搭一镜一个样）。**闭环要写到款式级**：有歧义的单品必须注明具体款式——围裙注明「半身系腰式」或「全身挂脖式」、衬衫注明袖口挽起或放下、裙注明长短；只写"围裙"两个字，模型会半身全身来回换。**锚点只写稳定不变的特征，绝不写场景性痕迹**（袖口沾木屑/面粉/油漆渍——锚点每镜重复，痕迹会跟着人物进咖啡馆等一切场景；这类痕迹交给分镜只在对应场景写）。例：木雕师→"黑色短发的年轻中国男性，米色亚麻衬衫袖口挽起，外系灰色半身工装围裙（系腰式）"；FDE工程师→"黑色短发的年轻中国男性，深灰色工装夹克内搭白色圆领T恤，深蓝色直筒工装裤，黑色运动鞋"（原照片若穿围裙，必须整套换掉）。
宁缺毋滥：故事确实没有真人主角（纯产品/风景/动画角色）才返回空数组。只输出一个 JSON，不要解释：{"picks":[{"assetId":"...或GEN","role":"角色名(2~6字，如 陈默/老板娘)","info":"年龄段+身份(6~14字，如 五十多岁，制造厂老板)","desc":"重写后的外观锚点(15~40字)","genPrompt":"（仅assetId=GEN时）文生图形象描述"}]}`;
    const lines = roster.map((r: any) => `${String(r.assetId)}｜${String(r.label || "")}｜${String(r.desc || "")}`).join("\n");
    const lockedArr: string[] = Array.isArray(body?.locked) ? (body.locked as any[]).map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : [];
    const lockedLine = lockedArr.length ? `已锁定演员（这些角色已经有人演了——**绝不**再为他们挑人，也不要挑替身）：${lockedArr.join("、")}。只为故事里【尚未有人演的】其他重要角色挑人；没有其他重要角色就输出 {"picks":[]}。\n` : "";
    const r = await smallCall(CA_SYS, `故事：${brief}\n${lockedLine}候选名单：\n${lines}\n最多选 ${maxPick} 个角色（可以少选或不选）。`);
    if (!r.ok) return NextResponse.json({ error: `自动选角失败：${r.err}` }, { status: r.status });
    let obj: any = null;
    try {
      obj = JSON.parse(r.content);
    } catch {
      const m = r.content.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          obj = JSON.parse(m[0]);
        } catch {}
      }
    }
    const byId = new Map(roster.map((x: any) => [String(x.assetId), x]));
    const seen = new Set<string>();
    const picks = (Array.isArray(obj?.picks) ? obj.picks : [])
      .map((x: any) => {
        const assetId = String(x?.assetId || "").trim();
        const isGen = assetId === "GEN";
        if (!isGen && (!byId.has(assetId) || seen.has(assetId))) return null;
        if (!isGen) seen.add(assetId);
        const role = String(x?.role || "").trim().slice(0, 8);
        const info = String(x?.info || "").trim().slice(0, 24);
        const genPrompt = isGen ? String(x?.genPrompt || "").trim().slice(0, 120) : "";
        if (isGen && !genPrompt) return null;
        const desc = String(x?.desc || "").trim().slice(0, 60) || (isGen ? genPrompt.slice(0, 60) : String(byId.get(assetId)?.desc || ""));
        return { assetId, role, info, desc, genPrompt: genPrompt || undefined };
      })
      .filter(Boolean)
      .slice(0, maxPick);
    return NextResponse.json({ picks });
  }

  // 走到这里说明 mode 不在受支持的四种之内（story / outline / expand / casting）
  return NextResponse.json({ error: `未知的 mode：${String(body?.mode || "")}` }, { status: 400 });
}
