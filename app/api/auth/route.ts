import { NextRequest, NextResponse } from "next/server";
import { ACCESS_PASSWORD } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth —— 告诉前端是否需要登录（设了 ACCESS_PASSWORD 就需要）
// 注意：绝不返回口令本身，只返回布尔值
export async function GET() {
  return NextResponse.json({ required: !!ACCESS_PASSWORD });
}

// POST /api/auth { password } —— 校验口令，对了返回 { ok: true }
export async function POST(req: NextRequest) {
  // 没设口令视为无门槛，任何输入都放行
  if (!ACCESS_PASSWORD) return NextResponse.json({ ok: true });

  const { password } = await req.json().catch(() => ({}));
  const ok = typeof password === "string" && password === ACCESS_PASSWORD;
  return NextResponse.json({ ok });
}
