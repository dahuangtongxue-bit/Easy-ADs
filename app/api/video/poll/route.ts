import { NextRequest, NextResponse } from "next/server";
import { CREDITS_ON, isMaster, getAccount, refund, takePending } from "@/lib/credits";
import { checkAuth, videoIsMock, videoKeyFor, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAMPLE_VIDEO =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

// ===== 备用真相通道：零克云控制台 API（new-api /api/task/self）=====
const CONSOLE_ACCESS_TOKEN = process.env.CONSOLE_ACCESS_TOKEN || "";
const CONSOLE_USER_ID = process.env.CONSOLE_USER_ID || "";

function isHttp(s: any): s is string {
  return typeof s === "string" && /^https?:\/\//i.test(s);
}
function looksLikeVideo(s: any): boolean {
  return isHttp(s) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s);
}

// 递归挖成片地址：兼容 fail_reason / result_url / data.content.video_url 等所有已知形态
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

// 失败原因不止 fail_reason 一处：平台还会把真话放在 task_status_msg / error.message / code 里。
// 只挖一个字段，就会把「平台其实说了原因」误报成「平台没给原因」，然后我们替它瞎猜。
function digFailReason(o: any): string {
  const seen = new Set<any>();
  const out: string[] = [];
  const walk = (x: any, d: number) => {
    if (!x || d > 6 || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    for (const k of ["fail_reason", "task_status_msg", "status_msg", "message", "msg", "detail", "reason", "code"]) {
      const v = (x as any)[k];
      if (typeof v === "string" && v.trim() && !/^https?:\/\//i.test(v) && v.trim().toLowerCase() !== "success") out.push(v.trim());
    }
    for (const v of Object.values(x)) walk(v, d + 1);
  };
  walk(o, 0);
  // 去重后取最长的一条：最长的通常信息量最大
  return Array.from(new Set(out)).sort((p, q) => q.length - p.length)[0] || "";
}

const FAIL_STATUSES = ["failed", "failure", "fail", "error", "cancelled", "canceled", "rejected"];

// 通道 B：按 task_id 精确查控制台任务记录
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
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => null);
    const items = j?.data?.items;
    if (!Array.isArray(items)) return null;
    return items.find((t: any) => t?.task_id === taskId) ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (CREDITS_ON()) {
    const k = (req.headers.get("x-access-key") || "").trim();
    if (!isMaster(k) && !(await getAccount(k))) return NextResponse.json({ error: "口令无效" }, { status: 401 });
  } else if (!checkAuth(req)) {
    return NextResponse.json({ error: "访问口令错误" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId") || "";
  const pollModel = searchParams.get("model") || ""; // 查询必须用提交时那把 key（2.5 独立分组）
  if (!taskId) return NextResponse.json({ status: "error", error: "缺少 taskId" });

  // ---------- MOCK ----------
  if (videoIsMock) {
    const readyAt = Number(taskId.replace("mock_", "")) || 0;
    const remain = readyAt - Date.now();
    if (remain <= 0) return NextResponse.json({ status: "done", videoUrl: SAMPLE_VIDEO });
    const progress = Math.max(5, Math.min(95, Math.round((1 - remain / 8000) * 100)));
    return NextResponse.json({ status: "pending", progress });
  }

  try {
    // ===== 通道 A：标准查询接口 =====
    const url = `${VIDEO_BASE_URL}/v1/video/generations/${encodeURIComponent(taskId)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${videoKeyFor(pollModel)}` },
      cache: "no-store",
    });
    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (!r.ok) {
      return NextResponse.json({
        status: "error",
        error: `平台返回错误(${r.status}): ${text.slice(0, 200)}`,
      });
    }

    // ① 通道 A 给出成片 → 完成（带上尾帧，供序列成片接续）
    const videoUrl = findVideoUrl(data);
    if (videoUrl) {
      if (CREDITS_ON()) await takePending(taskId); // 成片落地：清掉在途记录
      return NextResponse.json({ status: "done", videoUrl });
    }

    // ② 通道 A 明确说失败 → 报错
    const sA = String(
      data?.data?.data?.status ?? data?.data?.status ?? data?.status ?? ""
    ).toLowerCase();
    if (FAIL_STATUSES.includes(sA)) {
      const dug = digFailReason(data);
      const msg = dug || "平台判定失败但没给出原因。先直接重出一次（很多是上游瞬时抖动）；连着两次同样失败，再考虑是不是内容触审（亲密动作/擦边台词/真人形象数字人的组合最容易中）或参考图不合规。任务号 " + taskId;
      if (CREDITS_ON()) {
        const pd = await takePending(taskId);
        if (pd) await refund(pd.code, pd.amount); // 生成失败：积分自动退回
      }
      return NextResponse.json({ status: "error", error: msg + "（积分已退回）" });
    }

    // ===== 通道 B：通道 A 说「还没好」时，向控制台核实真相 =====
    const ct = await queryConsoleTask(taskId);
    let consoleSaysSuccess = false;
    if (ct) {
      const u2 = findVideoUrl(ct);
      if (u2) {
        if (CREDITS_ON()) await takePending(taskId);
        return NextResponse.json({ status: "done", videoUrl: u2 });
      }
      const sB = String(ct.status ?? "").toLowerCase();
      if (FAIL_STATUSES.includes(sB)) {
        const fr2 = digFailReason(ct);
        if (CREDITS_ON()) {
          const pd2 = await takePending(taskId);
          if (pd2) await refund(pd2.code, pd2.amount);
        }
        return NextResponse.json({ status: "error", error: (fr2 || "平台判定失败但没给出原因。先直接重出一次（很多是上游瞬时抖动）；连着两次同样失败，再考虑是不是内容触审（亲密动作/擦边台词/真人形象数字人的组合最容易中）或参考图不合规。任务号 " + taskId) + "（积分已退回）" });
      }
      consoleSaysSuccess = sB === "success";
    }

    // ③ 僵尸任务检测
    const submitTime = data?.data?.submit_time;
    const startTime = data?.data?.start_time;
    if (
      !consoleSaysSuccess &&
      typeof submitTime === "number" &&
      submitTime > 0 &&
      startTime === 0 &&
      Date.now() / 1000 - submitTime > 600
    ) {
      return NextResponse.json({
        status: "error",
        error: `平台超过10分钟未开始处理，疑似卡死。请删除卡片重新生成（如需反馈给零克云，任务ID：${taskId}）`,
      });
    }

    // ④ 仍在进行
    let progress: number | undefined;
    const rawProg = data?.data?.progress ?? data?.progress ?? data?.data?.data?.progress;
    if (typeof rawProg === "string") {
      const n = parseInt(rawProg, 10);
      if (!isNaN(n)) progress = n;
    } else if (typeof rawProg === "number") progress = rawProg;

    return NextResponse.json({ status: "pending", progress });
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: e?.message || "请求平台失败" });
  }
}
