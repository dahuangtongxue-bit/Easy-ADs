import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 视频拼接代理：浏览器内 ffmpeg.wasm 需要 fetch 视频字节，但平台视频 CDN（volces 等）
// 没开 CORS，前端直接 fetch 会被浏览器拦。这里由服务端代为拉取（服务端不受 CORS 限制），
// 前端走同源 /api/proxy?url=... 取回即可。
// 注意：Netlify 函数响应有大小上限（约 6MB），单段短视频通常 1~4MB 没问题；过大可能失败。
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url") || "";

  // 基本校验 + 轻量 SSRF 防护：只允许 http(s) 公网地址，挡掉本地/内网
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol)) {
    return NextResponse.json({ error: "only http(s)" }, { status: 400 });
  }
  const host = target.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    !host.includes(".");
  if (blocked) {
    return NextResponse.json({ error: "blocked host" }, { status: 400 });
  }

  try {
    const r = await fetch(target.toString(), { cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
    }
    const buf = await r.arrayBuffer();
    const ct = r.headers.get("content-type") || "video/mp4";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "no-store",
        // 同源即可读，这里再放开一道以防万一
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "fetch failed" }, { status: 502 });
  }
}
