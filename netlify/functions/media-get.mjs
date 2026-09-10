import { getStore } from "@netlify/blobs";

// 公网读取 media-put 存的文件（视频模型的上游要能直接拉到）。key 不可猜测，无需口令。
const STORE = "media";

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("k") || "";
  if (!/^[a-z0-9-]+\.[a-z0-9]{2,5}$/i.test(key)) return new Response("bad key", { status: 400 });
  const store = getStore({ name: STORE, consistency: "strong" });
  const r = await store.getWithMetadata(key, { type: "arrayBuffer" });
  if (!r || !r.data) return new Response("not found", { status: 404 });
  const type = (r.metadata && r.metadata.type) || "application/octet-stream";
  return new Response(r.data, {
    status: 200,
    headers: {
      "content-type": String(type),
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
      "content-length": String(r.data.byteLength),
    },
  });
};
