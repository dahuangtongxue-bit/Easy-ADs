import { getStore } from "@netlify/blobs";

const STORE = "image-jobs";
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  const PASS = (process.env.ACCESS_PASSWORD || "").trim();
  const accessKey = req.headers.get("x-access-key") || "";
  if (PASS && accessKey !== PASS) return json({ error: "访问口令错误" }, 401);

  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return json({ error: "missing jobId" }, 400);

  const store = getStore({ name: STORE, consistency: "strong" }); // 强一致：写完立刻读得到
  const v = await store.get(jobId, { type: "json" });
  if (!v) return json({ status: "pending" }); // 后台函数可能还没来得及写首条记录
  return json(v);
};
