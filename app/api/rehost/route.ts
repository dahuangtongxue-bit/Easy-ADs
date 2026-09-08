import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 把图片（base64 或 http URL）转存到 ImgBB，返回永久公网 URL。
// 用途：上传图(base64)、或任何火山 24h 临时 URL，转存后永不过期，
// 才能稳定用于参考图 / 首尾帧 / 素材库（否则平台拉取会 403）。
export async function POST(req: NextRequest) {
  if (!checkAuth(req))
    return NextResponse.json({ error: "访问口令错误" }, { status: 401 });

  const KEY = (process.env.IMGBB_API_KEY || "").trim();
  if (!KEY) {
    return NextResponse.json(
      { error: "服务端未配置 IMGBB_API_KEY" },
      { status: 500 }
    );
  }

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const input = String(payload?.image || "").trim();
  if (!input) return NextResponse.json({ error: "缺少 image" }, { status: 400 });

  // ImgBB 的 image 参数：纯 base64（去掉 data 前缀）或图片 URL 都可以
  let imageParam = input;
  const m = /^data:image\/[^;]+;base64,(.+)$/.exec(input);
  if (m) imageParam = m[1];

  try {
    const form = new URLSearchParams();
    form.append("image", imageParam);
    const resp = await fetch(`https://api.imgbb.com/1/upload?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const j: any = await resp.json().catch(() => null);
    const url = j && j.data && (j.data.url || j.data.display_url);
    if (!resp.ok || !url) {
      const msg =
        (j && j.error && (j.error.message || JSON.stringify(j.error))) ||
        `ImgBB 返回 ${resp.status}`;
      return NextResponse.json({ error: `转存失败：${msg}` }, { status: 502 });
    }
    return NextResponse.json({ url });
  } catch (e: any) {
    return NextResponse.json(
      { error: `转存异常：${String(e?.message || e)}` },
      { status: 502 }
    );
  }
}
