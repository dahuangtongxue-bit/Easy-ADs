// 积分账本（服务端专用）：Netlify Blobs 存储。
// 总闸：CREDITS_ENABLED=1 才启用；默认关闭时所有路由保持旧行为（口令=ACCESS_PASSWORD 等值校验）。
// 价格表：骨架 10 / 分镜 80 / 视频 20积分·秒 / 关键帧 10；单镜文本重写免费。每日签到 +100。
import { getStore } from "@netlify/blobs";

export type Account = { balance: number; lastDaily: string; created: number };

export const CREDITS_ON = () => process.env.CREDITS_ENABLED === "1";
export const PRICE = { story: 10, board: 80, videoPerSec: 20, frame: 10, daily: 100 } as const;

function store() {
  return getStore({ name: "ez-credits", consistency: "strong" });
}

// 北京时间的日期串（每日签到按此翻篇）
export function todayCN(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function isMaster(key: string): boolean {
  const master = (process.env.ACCESS_PASSWORD || "").trim();
  return !!master && key === master;
}

export async function getAccount(code: string): Promise<Account | null> {
  if (!code) return null;
  const raw = (await store().get(`acct:${code}`, { type: "json" })) as Account | null;
  return raw || null;
}

export async function saveAccount(code: string, a: Account): Promise<void> {
  await store().setJSON(`acct:${code}`, a);
}

export async function mintAccount(code: string, initial = 0): Promise<Account> {
  const a: Account = { balance: initial, lastDaily: "", created: Date.now() };
  await saveAccount(code, a);
  return a;
}

// 每日签到：新的一天首次访问自动 +100
export async function grantDaily(code: string): Promise<{ granted: boolean; account: Account | null }> {
  const a = await getAccount(code);
  if (!a) return { granted: false, account: null };
  const t = todayCN();
  if (a.lastDaily === t) return { granted: false, account: a };
  a.lastDaily = t;
  a.balance += PRICE.daily;
  await saveAccount(code, a);
  return { granted: true, account: a };
}

// 扣费：余额不足返回 ok:false（调用方决定拦截话术）
export async function debit(code: string, amount: number): Promise<{ ok: boolean; balance: number }> {
  const a = await getAccount(code);
  if (!a) return { ok: false, balance: 0 };
  if (a.balance < amount) return { ok: false, balance: a.balance };
  a.balance -= amount;
  await saveAccount(code, a);
  return { ok: true, balance: a.balance };
}

export async function refund(code: string, amount: number): Promise<void> {
  const a = await getAccount(code);
  if (!a) return;
  a.balance += amount;
  await saveAccount(code, a);
}

// 视频在途扣费记录：任务失败时凭它退款（谁的钱、扣了多少）
export async function recordPending(taskId: string, code: string, amount: number): Promise<void> {
  await store().setJSON(`task:${taskId}`, { code, amount, at: Date.now() });
}
export async function takePending(taskId: string): Promise<{ code: string; amount: number } | null> {
  const key = `task:${taskId}`;
  const p = (await store().get(key, { type: "json" })) as { code: string; amount: number } | null;
  if (!p) return null;
  await store().delete(key);
  return p;
}

// 充值卡：铸卡 → 用户输码入账（一次性）
function randCode(len = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
export async function mintCard(points: number): Promise<string> {
  const code = randCode();
  await store().setJSON(`card:${code}`, { points, minted: Date.now() });
  return code;
}
export async function redeemCard(acctCode: string, cardCode: string): Promise<{ ok: boolean; points?: number; balance?: number; error?: string }> {
  const key = `card:${cardCode.trim().toUpperCase()}`;
  const card = (await store().get(key, { type: "json" })) as { points: number; usedBy?: string } | null;
  if (!card) return { ok: false, error: "充值码不存在" };
  if (card.usedBy) return { ok: false, error: "充值码已被使用" };
  const a = await getAccount(acctCode);
  if (!a) return { ok: false, error: "口令无效" };
  await store().setJSON(key, { ...card, usedBy: acctCode, usedAt: Date.now() });
  a.balance += card.points;
  await saveAccount(acctCode, a);
  return { ok: true, points: card.points, balance: a.balance };
}
