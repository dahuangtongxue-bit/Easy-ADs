import { getStore } from "@netlify/blobs";

// 小媒体托管：参考视频 / 参考音频（≤ 5MB）存进 Netlify Blobs，返回可公网拉取的 URL。
// 图片走 /api/rehost（ImgBB）；这里只管视频与音频。同步函数的请求体上限约 6MB，超出让用户剪短或贴 URL。
const STORE = "media";
const MAX = 5.5 * 1024 * 1024;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const PASS = (process.env.ACCESS_PASSWORD || "").trim();
  const accessKey = req.headers.get("x-access-key") || "";
  if (PASS && accessKey !== PASS) return json({ error: "访问口令错误" }, 401);

  const type = (req.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
  const name = decodeURIComponent(req.headers.get("x-file-name") || "media");
  const ext = (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || (type.includes("audio") ? "mp3" : "mp4")).toLowerCase();
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return json({ error: "空文件" }, 400);
  if (buf.byteLength > MAX) return json({ error: `文件 ${(buf.byteLength / 1048576).toFixed(1)}MB，超过 5MB：请剪到 10 秒内或贴一个公网 URL` }, 413);

  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const store = getStore({ name: STORE, consistency: "strong" });
  await store.set(key, buf, { metadata: { type, name, at: Date.now() } });
  const origin = new URL(req.url).origin;
  return json({ url: `${origin}/.netlify/functions/media-get?k=${encodeURIComponent(key)}`, key, bytes: buf.byteLength });
};
