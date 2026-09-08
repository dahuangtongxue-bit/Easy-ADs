import { getStore } from "@netlify/blobs";

const STORE = "image-jobs";

function cleanBase(b) {
  let s = (b || "").trim().replace(/\/+$/, "");
  s = s.replace(/\/v1$/, "");
  return s;
}

// 把图片（火山临时 URL 或 base64）转存到 ImgBB，拿永久公网 URL。
// 火山 TOS 的签名 URL 24 小时过期，转存后永不过期，后续参考图/首尾帧/remix 才不会 403。
async function rehostToImgbb(imageUrlOrB64) {
  const KEY = (process.env.IMGBB_API_KEY || "").trim();
  if (!KEY) return { url: imageUrlOrB64, diag: "no_key" };
  try {
    let base64 = "";
    const m = /^data:image\/[^;]+;base64,(.+)$/.exec(imageUrlOrB64 || "");
    if (m) {
      base64 = m[1];
    } else if (/^https?:\/\//.test(imageUrlOrB64 || "")) {
      const imgResp = await fetch(imageUrlOrB64);
      if (!imgResp.ok) {
        return { url: imageUrlOrB64, diag: `fetch_src_failed_${imgResp.status}` };
      }
      const buf = await imgResp.arrayBuffer();
      base64 = Buffer.from(buf).toString("base64");
    } else {
      return { url: imageUrlOrB64, diag: "unknown_input" };
    }

    if (!base64) return { url: imageUrlOrB64, diag: "empty_base64" };

    const form = new URLSearchParams();
    form.append("image", base64);
    const resp = await fetch(`https://api.imgbb.com/1/upload?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const txt = await resp.text();
    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {}
    const permanent = j && j.data && (j.data.url || j.data.display_url);
    if (resp.ok && permanent) {
      return { url: permanent, diag: "ok" };
    }
    return {
      url: imageUrlOrB64,
      diag: `imgbb_${resp.status}: ${txt.slice(0, 200)}`,
    };
  } catch (e) {
    return { url: imageUrlOrB64, diag: `exception: ${String((e && e.message) || e)}` };
  }
}

// 文件名以 -background 结尾 → Netlify 后台函数：调用方立刻收到 202，函数体在后台最多跑 15 分钟。
// 支持四种玩法（同一接口）：
//   文生图：仅 prompt
//   改图  ：prompt + image(单张 URL)
//   多图融合：prompt + image(URL 数组) → 单图输出
//   组图  ：sequential=true（+ maxImages）→ 多图输出（imageUrls）
export default async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let body = null;
  try {
    body = await req.json();
  } catch {}
  const { jobId, prompt, model, size, image, sequential, maxImages } = body || {};
  const accessKey = req.headers.get("x-access-key") || (body && body.accessKey) || "";

  const PASS = (process.env.ACCESS_PASSWORD || "").trim();
  if (PASS && accessKey !== PASS) return new Response("unauthorized", { status: 401 });
  if (!jobId || !prompt) return new Response("missing jobId/prompt", { status: 400 });

  const store = getStore({ name: STORE, consistency: "strong" });
  const write = (obj) => store.setJSON(String(jobId), { ...obj, at: Date.now() });

  await write({ status: "running" });

  const BASE =
    cleanBase(process.env.MAAS_IMAGE_BASE_URL || "") || cleanBase(process.env.MAAS_BASE_URL || "");
  const KEY =
    (process.env.MAAS_IMAGE_API_KEY || "").trim() || (process.env.MAAS_API_KEY || "").trim();
  if (!BASE || !KEY) {
    await write({ status: "error", error: "服务端未配置 MAAS_BASE_URL / MAAS_API_KEY" });
    return new Response("ok");
  }

  const SIZE_MAP = { "2K": "2048x2048", "4K": "4096x4096" };
  const sizeRaw = String(size || "").trim();
  // 显式像素（如 2048x1152）直接透传：关键帧必须按目标画幅出，否则方形关键帧会把成片按死在 1:1
  const px = /^\d{3,5}x\d{3,5}$/i.test(sizeRaw) ? sizeRaw.toLowerCase() : SIZE_MAP[sizeRaw.toUpperCase()] || "2048x2048";

  // 组装请求体
  const reqBody = {
    model,
    prompt,
    size: px,
    response_format: "url",
    watermark: false,
  };
  // 输入参考图：改图=单张 string；多图融合=数组。空值不带。
  const hasImage =
    image && (typeof image === "string" ? image.trim() : Array.isArray(image) && image.length);
  if (hasImage) reqBody.image = image;
  // 组图（多图输出）：auto + max_images；改图/融合按文档显式 disabled；纯文生图不带该字段（保持原行为）。
  if (sequential) {
    reqBody.sequential_image_generation = "auto";
    reqBody.sequential_image_generation_options = {
      max_images: Math.min(6, Math.max(1, Number(maxImages) || 4)),
    };
  } else if (hasImage) {
    reqBody.sequential_image_generation = "disabled";
  }

  try {
    const r = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(reqBody),
    });
    const text = await r.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!r.ok) {
      await write({ status: "error", error: `平台返回错误(${r.status}): ${text.slice(0, 300)}` });
      return new Response("ok");
    }
    // data.data 是数组（组图多张、单图一张）。逐张取 url/b64 → 转存 ImgBB。
    const arr = data && Array.isArray(data.data) ? data.data : [];
    if (!arr.length) {
      await write({ status: "error", error: `未从响应解析到图片: ${text.slice(0, 200)}` });
      return new Response("ok");
    }
    const urls = [];
    for (const item of arr) {
      const raw = item && (item.url || item.b64_json);
      if (!raw) continue;
      const imageUrl = String(raw).startsWith("http") ? raw : `data:image/png;base64,${raw}`;
      const { url: permanentUrl } = await rehostToImgbb(imageUrl);
      urls.push(permanentUrl);
    }
    if (!urls.length) {
      await write({ status: "error", error: `图片转存失败: ${text.slice(0, 200)}` });
      return new Response("ok");
    }
    // imageUrl 兼容旧调用方（取首张）；imageUrls 给组图。
    await write({ status: "done", imageUrl: urls[0], imageUrls: urls });
  } catch (e) {
    await write({ status: "error", error: String((e && e.message) || e) });
  }
  return new Response("ok");
};
