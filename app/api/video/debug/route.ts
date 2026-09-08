import { NextRequest, NextResponse } from "next/server";
import { VIDEO_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONSOLE_ACCESS_TOKEN = process.env.CONSOLE_ACCESS_TOKEN || "";
const CONSOLE_USER_ID = process.env.CONSOLE_USER_ID || "";

function isHttp(s: any): s is string {
  return typeof s === "string" && /^https?:\/\//i.test(s);
}
function looksLikeVideo(s: any): boolean {
  return isHttp(s) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s);
}
function findVideoUrl(obj: any, depth = 0): string | undefined {
  if (obj == null || depth > 8) return undefined;
  if (typeof obj === "string") return looksLikeVideo(obj) ? obj : undefined;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const u = findVideoUrl(x, depth + 1);
      if (u) return u;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    if (isHttp(obj.video_url)) return obj.video_url;
    if (isHttp(obj.videoUrl)) return obj.videoUrl;
    if (isHttp(obj.result_url)) return obj.result_url;
    if (obj.content && isHttp(obj.content.video_url)) return obj.content.video_url;
    if (looksLikeVideo(obj.fail_reason)) return obj.fail_reason;
    if (looksLikeVideo(obj.url)) return obj.url;
    for (const k of Object.keys(obj)) {
      const u = findVideoUrl(obj[k], depth + 1);
      if (u) return u;
    }
  }
  return undefined;
}

async function queryConsoleTask(taskId: string): Promise<any | null> {
  if (!CONSOLE_ACCESS_TOKEN || !CONSOLE_USER_ID) return null;
  try {
    const u = `${VIDEO_BASE_URL}/api/task/self?p=1&page_size=10&task_id=${encodeURIComponent(taskId)}`;
    const r = await fetch(u, {
      headers: {
        Authorization: CONSOLE_ACCESS_TOKEN,
        "New-Api-User": CONSOLE_USER_ID,
      },
      cache: "no-store",
    });
    if (!r.ok) return { __error: `控制台通道 HTTP ${r.status}` };
    const j: any = await r.json().catch(() => null);
    const items = j?.data?.items;
    if (!Array.isArray(items)) return { __error: "控制台通道返回结构异常", __raw: j };
    return items.find((t: any) => t?.task_id === taskId) ?? { __error: "控制台通道未找到该任务" };
  } catch (e: any) {
    return { __error: e?.message || "控制台通道请求失败" };
  }
}

// 调试用：浏览器打开 /api/video/debug?taskId=cgt-xxxx
// 同时透视两条通道：A=标准查询接口，B=控制台任务库
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId") || "";
  if (!taskId) {
    return NextResponse.json({ hint: "网址后面加 ?taskId=xxx（从零克云任务日志复制 任务ID）" });
  }

  const queriedUrl = `${VIDEO_BASE_URL}/v1/video/generations/${encodeURIComponent(taskId)}`;
  let channelA: any = null;
  try {
    const r = await fetch(queriedUrl, {
      headers: { Authorization: `Bearer ${VIDEO_API_KEY}` },
      cache: "no-store",
    });
    const text = await r.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    channelA = {
      queriedUrl,
      httpStatus: r.status,
      extractedVideoUrl: findVideoUrl(parsed ?? {}) ?? null,
      parsed: parsed ?? text.slice(0, 2000),
    };
  } catch (e: any) {
    channelA = { queriedUrl, error: e?.message || "请求失败" };
  }

  const consoleRecord = await queryConsoleTask(taskId);
  const channelB = {
    configured: !!(CONSOLE_ACCESS_TOKEN && CONSOLE_USER_ID),
    extractedVideoUrl: consoleRecord ? findVideoUrl(consoleRecord) ?? null : null,
    record: consoleRecord,
  };

  return NextResponse.json({ channelA, channelB });
}
