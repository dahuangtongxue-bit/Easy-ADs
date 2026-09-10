import { NextRequest, NextResponse } from "next/server";
import { CREDITS_ON, isMaster, getAccount } from "@/lib/credits";
import { AD_TEMPLATES, fallbackBeats, scaleBeats, type AdTemplateKey, type Beat } from "@/lib/adBrain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cleanBase(b: string) {
  return (b || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

const TEMPLATE_KEYS = AD_TEMPLATES.map((t) => t.key);

// 广告编剧：一句主题 + 素材情况 → 五段带时间戳的节拍表（动作 / 段末可观察状态 / 台词 / 音效）。
// 失败不拦路：拿不到模型就用模板兜底节拍，工作台照样能出片。
export async function POST(req: NextRequest) {
  const PASS = (process.env.ACCESS_PASSWORD || "").trim();
  const key = (req.headers.get("x-access-key") || "").trim();
  if (CREDITS_ON()) {
    if (!isMaster(key)) {
      const acct = await getAccount(key);
      if (!acct) return NextResponse.json({ error: "口令无效：请使用邀请口令" }, { status: 401 });
    }
  } else if (PASS && key !== PASS) {
    return NextResponse.json({ error: "访问口令错误" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {}
  const brief = String(body?.brief || "").trim().slice(0, 400);
  const productName = String(body?.productName || "").trim().slice(0, 40);
  const productDesc = String(body?.productDesc || "").trim().slice(0, 200);
  const template: AdTemplateKey = TEMPLATE_KEYS.includes(body?.template) ? body.template : "pain";
  const sec = Math.max(10, Math.min(30, Math.round(Number(body?.sec) || 30)));
  const lang = String(body?.lang || "zh");
  const personName = String(body?.personName || "").trim().slice(0, 20);
  const personKind = String(body?.personKind || "none");
  const assetNote = String(body?.assetNote || "").trim().slice(0, 300);

  const shell = scaleBeats(sec, template);
  const fallback = fallbackBeats(sec, template, productName);

  const BASE = cleanBase(process.env.MAAS_BASE_URL || "");
  const KEY = (process.env.MAAS_API_KEY || "").trim();
  const MODEL = (process.env.CHAT_MODEL || "").trim();
  const THINK_OFF = /^(off|disabled|false|0)$/i.test((process.env.CHAT_THINKING || "").trim());
  if (!BASE || !KEY || !MODEL) {
    return NextResponse.json({ beats: fallback, source: "fallback", note: "未配置文本模型，使用模板节拍" });
  }

  const tpl = AD_TEMPLATES.find((t) => t.key === template)!;
  const slots = shell.map((b, i) => `第${i + 1}段 ${b.t0}-${b.t1}秒`).join("、");
  const personLine =
    personKind === "none"
      ? "没有固定人物；如需要人物，只写「一个人」，不要起名字。"
      : `固定人物叫「${personName || "代言人"}」（${personKind === "real" ? "真人本人出镜" : "数字人"}），可以说台词、对镜头说话。`;

  const SYS = `你是短视频广告编剧，给 Seedance 视频模型写「时间戳节拍表」。
结构固定为「${tpl.name}」：${tpl.hint}。
硬规则：
1. 只写五段，时间段固定为：${slots}。每段只发生一个主要状态变化。
2. 每段写 action（画面里发生什么，具体动作与镜头，40 字内）和 endState（这一段结束时画面停在什么可观察状态，20 字内）。
3. 商品「${productName || "商品"}」${template === "story" ? "只在第三段之后出现" : "在第三段登场"}，第五段固定是「镜头缓慢推向商品正面，商品居中、完整、清晰」，endState 写「商品正面居中定格」。
4. line 是这一段的台词，一句、15 字内、口语化、能说出卖点；没有人物时可以写旁白；最多三段有台词，第五段不写台词。
5. sfx 是环境音或音效，5 字内，可省略。
6. 不写任何文字、字幕、标牌、价格；不用绝对化用语（最、第一、唯一、国家级）。
7. 台词语言：${lang === "zh" ? "中文" : lang}。
只输出 JSON：{"beats":[{"action":"","endState":"","line":"","sfx":""},…5 项]}，不要解释。`;

  const USER =
    `主题：${brief || `介绍${productName || "商品"}`}` +
    (productName ? `\n商品：${productName}` : "") +
    (productDesc ? `\n商品外观：${productDesc}` : "") +
    `\n${personLine}` +
    (assetNote ? `\n手头素材：${assetNote}` : "") +
    `\n总时长 ${sec} 秒。`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22000);
  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: USER },
        ],
        temperature: 0.7,
        stream: false,
        ...(THINK_OFF && /glm|deepseek/i.test(MODEL) ? { thinking: { type: "disabled" } } : {}),
      }),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) return NextResponse.json({ beats: fallback, source: "fallback", note: `模型返回 ${r.status}，已用模板节拍` });
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}
    const content: string = (data?.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const m = content.match(/\{[\s\S]*\}/);
    let parsed: any = null;
    try {
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {}
    const arr: any[] = Array.isArray(parsed?.beats) ? parsed.beats : [];
    if (arr.length < 5) return NextResponse.json({ beats: fallback, source: "fallback", note: "模型输出不完整，已用模板节拍" });
    const beats: Beat[] = shell.map((b, i) => {
      const s = arr[i] || {};
      const fb = fallback[i];
      return {
        t0: b.t0,
        t1: b.t1,
        action: String(s.action || fb.action).trim().slice(0, 120),
        endState: String(s.endState || fb.endState).trim().slice(0, 60),
        line: i === 4 ? "" : String(s.line || "").trim().slice(0, 40),
        sfx: String(s.sfx || "").trim().slice(0, 20),
      };
    });
    // 第五段固定是商品定格，不给模型改的机会
    beats[4].action = fallback[4].action;
    beats[4].endState = fallback[4].endState;
    return NextResponse.json({ beats, source: "model" });
  } catch (e: any) {
    const note = e?.name === "AbortError" ? "模型响应超时，已用模板节拍" : `模型异常：${String(e?.message || e).slice(0, 80)}，已用模板节拍`;
    return NextResponse.json({ beats: fallback, source: "fallback", note });
  } finally {
    clearTimeout(timer);
  }
}
