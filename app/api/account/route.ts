// 账户接口：余额查询（含每日签到自动 +100）、充值码入账；管理员铸口令/铸充值卡。
// CREDITS_ENABLED != "1" 时返回 disabled，前端隐藏积分 UI，全站保持旧行为。
import { NextRequest, NextResponse } from "next/server";
import { CREDITS_ON, PRICE, isMaster, getAccount, grantDaily, mintAccount, mintCard, redeemCard } from "@/lib/credits";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {}
  const op = (body?.op || "").toString();

  if (!CREDITS_ON()) return NextResponse.json({ disabled: true });

  // ---- 管理员操作（x-admin-key 必须匹配 ADMIN_KEY 环境变量）----
  const adminKey = (process.env.ADMIN_KEY || "").trim();
  const gotAdmin = (req.headers.get("x-admin-key") || "").trim();
  if (op.startsWith("mint") || op === "peek" || op === "grant") {
    if (!adminKey || gotAdmin !== adminKey) return NextResponse.json({ error: "无管理员权限" }, { status: 403 });
    if (op === "mint-account") {
      const code = (body?.code || "").toString().trim();
      if (!code || code.length < 4) return NextResponse.json({ error: "口令至少 4 位" }, { status: 400 });
      const a = await mintAccount(code, Math.max(0, parseInt(body?.initial, 10) || 0));
      return NextResponse.json({ ok: true, code, account: a });
    }
    if (op === "mint-cards") {
      const points = Math.max(1, parseInt(body?.points, 10) || 0);
      const count = Math.max(1, Math.min(50, parseInt(body?.count, 10) || 1));
      const cards: string[] = [];
      for (let i = 0; i < count; i++) cards.push(await mintCard(points));
      return NextResponse.json({ ok: true, points, cards });
    }
    if (op === "peek") {
      const a = await getAccount((body?.code || "").toString().trim());
      return NextResponse.json({ account: a });
    }
    return NextResponse.json({ error: "未知管理操作" }, { status: 400 });
  }

  // ---- 用户操作（x-access-key = 邀请口令）----
  const key = (req.headers.get("x-access-key") || "").trim();
  if (isMaster(key)) return NextResponse.json({ master: true, balance: -1 });

  if (op === "status") {
    const { granted, account } = await grantDaily(key);
    if (!account) return NextResponse.json({ error: "口令无效：请使用邀请口令" }, { status: 401 });
    return NextResponse.json({ balance: account.balance, dailyGranted: granted, daily: PRICE.daily, price: PRICE });
  }
  if (op === "redeem") {
    const r = await redeemCard(key, (body?.card || "").toString());
    if (!r.ok) return NextResponse.json({ error: r.error || "充值失败" }, { status: 400 });
    return NextResponse.json({ ok: true, points: r.points, balance: r.balance });
  }
  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
