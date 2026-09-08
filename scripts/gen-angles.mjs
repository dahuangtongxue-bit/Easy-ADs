#!/usr/bin/env node
// 花名册多角度参考图：给每个数字人各出「四分之三侧面」和「侧面」两张，存进 public/cast/angles/。
//
// 为什么：2.5 拿不到平台原生锁脸，只能用形象图当参考。一张正脸 → 正脸像、侧脸漂。
// 2.5 的主体参考支持多图（官方：多图用于保持角色一致性），三个角度一起送，模型就有了三维参考。
//
// 用法（在 easy-director 仓库根目录）：
//   export K='你的 gpulink key'
//   node scripts/gen-angles.mjs            # 全部 48 个，已存在的自动跳过
//   node scripts/gen-angles.mjs 7pg5w      # 只跑某一个（按 assetId 尾缀）
// 跑完会生成 lib/castAngles.json（assetId → 两张图的路径），随代码一起提交。
// 一次性成本：48 × 2 张，每张几分钱，几块钱搞定；以后出片零成本。

import fs from "node:fs";
import path from "node:path";

const K = process.env.K || process.env.MAAS_API_KEY;
if (!K) { console.error("先 export K='你的key'"); process.exit(1); }
const BASE = "https://api-model.gpulink.cc";
const MODEL = "doubao-seedream-5-0-260128";
const SITE = "https://easy-director.netlify.app";
const OUT_DIR = path.join("public", "cast", "angles");
const MANIFEST = path.join("lib", "castAngles.json");
const only = process.argv[2] || "";

fs.mkdirSync(OUT_DIR, { recursive: true });
const src = fs.readFileSync(path.join("lib", "castPresets.ts"), "utf8");
const rows = [...src.matchAll(/assetId:\s*"([^"]+)"[^}]*?img:\s*"([^"]+)"[^}]*?label:\s*"([^"]+)"[^}]*?desc:\s*"([^"]*)"/g)]
  .map((m) => ({ id: m[1], img: m[2], label: m[3], desc: m[4] }));
console.log(`花名册 ${rows.length} 人`);

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};

// 两个角度。关键：五官/发型/服装必须与参考图一致，纯色背景，肩上肖像，别加戏。
const VIEWS = [
  { key: "34",   name: "四分之三侧面", prompt: "同一个人的四分之三侧面肖像（面部朝向镜头右前方约 45 度），肩部以上，纯浅灰色背景，柔和均匀的影棚光。五官、发型、发色、肤色、服装必须与参考图完全一致，不要改脸，不要加配饰，不要文字。" },
  { key: "side", name: "侧面",         prompt: "同一个人的正侧面肖像（面部完全朝向镜头右侧 90 度），肩部以上，纯浅灰色背景，柔和均匀的影棚光。五官轮廓、发型、发色、肤色、服装必须与参考图完全一致，不要改脸，不要加配饰，不要文字。" },
];

async function genOne(refUrl, prompt) {
  const r = await fetch(`${BASE}/v1/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${K}` },
    body: JSON.stringify({
      model: MODEL, prompt, image: refUrl, size: "2048x2048", // Seedream 5.0 要求 ≥ 3,686,400 像素
      response_format: "url", watermark: false, sequential_image_generation: "disabled",
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}`);
  const d = JSON.parse(text);
  const url = d?.data?.[0]?.url;
  if (!url) throw new Error(`没拿到图片 URL: ${text.slice(0, 160)}`);
  const img = await fetch(url);
  if (!img.ok) throw new Error(`下载失败 HTTP ${img.status}`);
  return Buffer.from(await img.arrayBuffer());
}

let ok = 0, skip = 0, bad = 0;
for (const p of rows) {
  const short = p.id.split("-").pop();
  if (only && short !== only) continue;
  const refUrl = p.img.startsWith("http") ? p.img : SITE + p.img;
  const files = {};
  let allExist = true;
  for (const v of VIEWS) {
    const f = path.join(OUT_DIR, `${short}-${v.key}.jpg`);
    files[v.key] = f;
    if (!fs.existsSync(f)) allExist = false;
  }
  if (allExist && manifest[p.id]) { skip++; continue; }

  process.stdout.write(`${p.label.padEnd(16)} `);
  const outPaths = [];
  try {
    for (const v of VIEWS) {
      const f = files[v.key];
      if (!fs.existsSync(f)) {
        const buf = await genOne(refUrl, `参考图是${p.desc || "这个人"}。${v.prompt}`);
        fs.writeFileSync(f, buf);
      }
      outPaths.push("/cast/angles/" + path.basename(f));
      process.stdout.write(`${v.name}✓ `);
    }
    manifest[p.id] = outPaths;
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    ok++; console.log("");
  } catch (e) {
    bad++; console.log(`\n   ✗ ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 800)); // 别把出图接口打成筛子
}
console.log(`\n完成：${ok} 人新出图，${skip} 人已有跳过，${bad} 人失败。清单：${MANIFEST}`);
console.log("下一步：git add public/cast/angles lib/castAngles.json && 提交推送。");
