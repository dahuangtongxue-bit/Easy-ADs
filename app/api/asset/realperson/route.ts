import { NextRequest, NextResponse } from "next/server";
import { checkAuth, VIDEO25_API_KEY, VIDEO_BASE_URL } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 26;

// 真人活体数字人（Seedance 2.5 原生锁脸）。整条链（2026-09-07 实测跑通）：
//   1. session  → CreateRealPersonAuthSession（空体）→ h5Link，手机扫码 120 秒内做活体，绑到本账号
//   2. register → CreateAsset（真人组 + 本人照片公网 URL）→ assetId
//   3. status   → GetAsset 轮询：Active = 本人匹配成功；Failed = 没做活体 / 照片不是本人
//   之后视频请求送 asset://{assetId}，2.5 轮询到 SUCCESS（8/30 以来第一次）。
// 真人组：活体做完后零克云结果页会自动生成一个真人组（group-YYYYMMDDHHMMSS-xxxxx），用户复制过来；
// 没填时回落到 ED 常驻的普通组（2.5 认不认普通组里的素材未验证）。
// 注意：素材按「账号 + 令牌分组」隔离，换 key/分组后老素材看不见（会报「不属于当前用户或当前 token 分组」）。
const RP_GROUP_ID = (process.env.MAAS_RP_GROUP_ID || "").trim() || "355234441996914688"; // 「易导演真人数字人」组，2026-09-07 建

type Unwrapped = { ok: true; data: any } | { ok: false; error: string; permanent: boolean };

// 零克云素材接口有三种信封，全部认：
//   新适配器（火山原生透传）：{ ResponseMetadata, Result:{...} }
//   活体会话：{ code:0, data:{...}, message }
//   老适配器：{ state:1, data:{...}, error:null }
//   网关错误：{ error:{ message, code } }（HTTP 常常仍是 200）
function unwrap(status: number, text: string): Unwrapped {
  let d: any = null;
  try { d = JSON.parse(text); } catch {
    return { ok: false, error: `非 JSON 响应 (${status}): ${text.slice(0, 160)}`, permanent: status >= 400 && status < 500 };
  }
  if (d?.error) {
    const e = d.error;
    const msg = String(e?.message || e?.Message || e?.code || JSON.stringify(e));
    return { ok: false, error: msg, permanent: true };
  }
  if (d?.ResponseMetadata) {
    if (d.ResponseMetadata.Error) {
      const e = d.ResponseMetadata.Error;
      return { ok: false, error: String(e?.Message || e?.Code || JSON.stringify(e)), permanent: true };
    }
    return { ok: true, data: d.Result ?? {} };
  }
  if (typeof d?.code === "number") {
    if (d.code !== 0) return { ok: false, error: String(d.message || `code ${d.code}`), permanent: true };
    return { ok: true, data: d.data ?? {} };
  }
  if (d?.data !== undefined) {
    if (d.data?.Error) {
      const e = d.data.Error;
      return { ok: false, error: String(e?.Message || e?.Code || JSON.stringify(e)), permanent: true };
    }
    return { ok: true, data: d.data ?? {} };
  }
  if (status >= 400) return { ok: false, error: `HTTP ${status}: ${text.slice(0, 160)}`, permanent: status < 500 };
  return { ok: true, data: d };
}

async function callAsset(action: string, payload: any): Promise<Unwrapped> {
  const url = `${VIDEO_BASE_URL}/v1/seedance/asset/${action}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VIDEO25_API_KEY}` }, // 活体/素材适配器挂在 2.5 分组
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    return unwrap(r.status, await r.text());
  } catch (e: any) {
    return { ok: false, error: `网络错误：${String(e?.message || e)}`, permanent: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });
  if (!VIDEO_BASE_URL || !VIDEO25_API_KEY) return NextResponse.json({ error: "服务端未配置 MAAS_BASE_URL / MAAS_VIDEO_25_API_KEY" }, { status: 500 });

  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action || "");

  if (action === "session") {
    const r = await callAsset("CreateRealPersonAuthSession", {});
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.permanent ? 400 : 502 });
    const h5Link = String(r.data?.h5Link || r.data?.H5Link || "");
    if (!h5Link) return NextResponse.json({ error: `活体会话未返回 h5Link：${JSON.stringify(r.data).slice(0, 200)}` }, { status: 502 });
    return NextResponse.json({
      h5Link,
      token: String(r.data?.bytedToken || ""),
      expiresIn: Number(r.data?.expiresIn) || 120,
    });
  }

  if (action === "register") {
    const imageUrl = String(body?.imageUrl || "").trim();
    const name = String(body?.name || "").trim().slice(0, 30) || "真人数字人";
    const groupId = String(body?.groupId || "").trim() || RP_GROUP_ID;
    if (!/^https?:\/\//.test(imageUrl)) return NextResponse.json({ error: "照片必须是公网 URL（先转存图床）" }, { status: 400 });
    const r = await callAsset("CreateAsset", { GroupId: groupId, URL: imageUrl, AssetType: "Image", Name: name });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.permanent ? 400 : 502 });
    const assetId = String(r.data?.Id || r.data?.id || "");
    if (!assetId) return NextResponse.json({ error: `登记未返回素材 Id：${JSON.stringify(r.data).slice(0, 200)}` }, { status: 502 });
    return NextResponse.json({ assetId, groupId });
  }

  if (action === "status") {
    const assetId = String(body?.assetId || "").trim();
    if (!assetId) return NextResponse.json({ error: "缺少 assetId" }, { status: 400 });
    const r = await callAsset("GetAsset", { Id: assetId });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.permanent ? 400 : 502 });
    const st = String(r.data?.Status || r.data?.status || "");
    // 失败原因在哪个字段没有文档，全挖一遍
    const err = r.data?.Error ?? r.data?.error ?? r.data?.FailReason ?? r.data?.Reason ?? r.data?.Message ?? null;
    const reason = err ? (typeof err === "string" ? err : String(err?.Message || err?.message || err?.Code || JSON.stringify(err))) : "";
    return NextResponse.json({ status: st, reason, url: String(r.data?.URL || ""), raw: r.data });
  }

  return NextResponse.json({ error: "未知 action（session / register / status）" }, { status: 400 });
}
