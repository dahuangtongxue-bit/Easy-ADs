import { NextRequest, NextResponse } from "next/server";
import { checkAuth, videoIsMock, videoKeyFor, VIDEO_BASE_URL } from "@/lib/serverAuth";
import { CREDITS_ON, PRICE, isMaster, getAccount, debit, refund, recordPending } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOO_BIG = 4_000_000;

export async function POST(req: NextRequest) {
  const accessKey = (req.headers.get("x-access-key") || "").trim();
  let payer = "";
  if (CREDITS_ON()) {
    if (!isMaster(accessKey)) {
      const acct0 = await getAccount(accessKey);
      if (!acct0) return NextResponse.json({ error: "口令无效：请使用邀请口令" }, { status: 401 });
      payer = accessKey;
    }
  } else {
    if (!checkAuth(req)) return NextResponse.json({ error: "访问口令错误" }, { status: 401 });
  }

  const {
    imageUrl,
    firstImageUrl,
    referenceImageUrl,
    referenceImageUrls,
    sourceVideoUrl,
    sourceVideoUrls,
    prompt,
    model: modelIn,
    resolution,
    duration,
    ratio,
    referenceAudioUrls,
    editMode,
    extendMode,
    draft,
  } = await req.json().catch(() => ({} as any));

  // 出片禁令（公测期用）：VIDEO_LOCKED=1 时一律拒绝。前端的灰按钮能绕过，这道不能。
  if (process.env.VIDEO_LOCKED === "1") {
    return NextResponse.json({ error: "出片功能暂时关闭（公测期间）。分镜与关键帧不受影响。" }, { status: 403 });
  }

  // 视频模型：环境变量 VIDEO_MODEL 最高优先（上游改名只需改变量+重部署）；否则用客户端传的；兜底新版型号
  const model = (process.env.VIDEO_MODEL || "").trim() || (modelIn || "").toString().trim() || "doubao-seedance-2-5-260628"; // 2.0 已下线，默认 2.5

  const firstUrl = firstImageUrl || imageUrl || "";
  // 多参考图：优先用数组，兼容旧单字段
  const refImgs: string[] = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter((u: any) => typeof u === "string" && u)
    : referenceImageUrl
    ? [referenceImageUrl]
    : [];
  // 多源视频（轨道补全）：优先用数组，兼容旧单字段。每段都作为 reference_video，
  // 配合提示词「视频1…接视频2…接视频3」把多段接成一条。
  const srcVideos: string[] = Array.isArray(sourceVideoUrls)
    ? sourceVideoUrls.filter((u: any) => typeof u === "string" && u)
    : sourceVideoUrl
    ? [sourceVideoUrl]
    : [];
  // 参考音频（配音/配乐/对口型）：公网 mp3/wav，最多 3 段。需配视觉，不能纯文本+音频。
  const refAudios: string[] = Array.isArray(referenceAudioUrls)
    ? referenceAudioUrls.filter((u: any) => typeof u === "string" && u).slice(0, 10) // 2.5 上限 10 段（2.0 是 3 段）
    : [];

  // 文生视频：无任何图/视频输入时，只要有提示词就放行（content 仅含 text）。
  const hasMedia = Boolean(firstUrl || refImgs.length || srcVideos.length);
  if (!hasMedia && !(prompt && prompt.trim())) {
    return NextResponse.json({ error: "文生视频至少要有提示词" }, { status: 400 });
  }

  // 混用规则（文档：reference_image 不能与 first_frame 同时）
  if (refImgs.length && firstUrl) {
    return NextResponse.json({ error: "参考图不能与首帧同时使用" }, { status: 400 });
  }

  // base64 防线：零克云只接受公网 URL / asset://，base64 会被丢弃退化成文生视频。
  for (const u of [firstUrl, ...refImgs]) {
    if (typeof u === "string" && u.startsWith("data:") && u.length > TOO_BIG) {
      return NextResponse.json(
        { error: "图片过大。请删除后重新上传（会自动压缩）" },
        { status: 400 }
      );
    }
  }

  // 官方时长范围：Seedance 2.0 = [4,15]，2.5 = [4,30]。超范围会被 400 打回。
  const isLegacy = /seedance-2(?!-5)/.test(String(model || ""));
  const dur = Math.min(isLegacy ? 15 : 30, Math.max(4, Number(duration) || 5));
  const ratioVal = typeof ratio === "string" && ratio && ratio !== "adaptive" ? ratio : "";
  const res = (resolution || "720p").toString().toLowerCase();
  let promptText =
    prompt && prompt.trim() ? prompt.trim() : "让画面自然地动起来，保持主体稳定、镜头平滑";
  // 画幅：Seedance 用提示词后缀 --ratio 9:16 指定，而不是 body 顶层字段
  if (ratioVal) promptText += ` --ratio ${ratioVal}`;

  if (videoIsMock) {
    const readyAt = Date.now() + 8000;
    return NextResponse.json({ taskId: `mock_${readyAt}` });
  }

  // 积分：按秒预扣（视频 = 唯一贵动作）。提交失败当场退；任务失败由轮询凭在途记录退。
  const price = payer ? dur * PRICE.videoPerSec : 0;
  if (payer) {
    const d = await debit(payer, price);
    if (!d.ok) return NextResponse.json({ error: `积分不足：本镜需 ${price} 积分（${dur}秒×${PRICE.videoPerSec}），余额 ${d.balance}。请先充值再出片。` }, { status: 402 });
  }

  try {
    // 路径必须带 /v1（VIDEO_BASE_URL 已被 cleanBase 去掉 /v1）
    const url = `${VIDEO_BASE_URL}/v1/video/generations`;

    // content: text 在前，媒体元素(带 role)在后
    const content: any[] = [{ type: "text", text: promptText }];
    // 多段源视频：逐段 reference_video（顺序即提示词里的「视频1、视频2…」）
    for (const v of srcVideos) {
      content.push({ type: "video_url", video_url: { url: v }, role: "reference_video" });
    }
    if (refImgs.length) {
      for (const u of refImgs) {
        content.push({ type: "image_url", image_url: { url: u }, role: "reference_image" });
      }
    }
    if (firstUrl) {
      content.push({ type: "image_url", image_url: { url: firstUrl }, role: "first_frame" });
    }
    // 参考音频：配音/配乐/对口型（顺序即提示词里的「音频1、音频2…」）。需配视觉。
    for (const a of refAudios) {
      content.push({ type: "audio_url", audio_url: { url: a }, role: "reference_audio" });
    }

    // 双写兼容：老通道从顶层读参数，新通道（方澜/new-api 适配层）从 metadata 读——两份都给，谁读谁的。
    // 声音失踪案结案：新通道只认 metadata.generate_audio，顶层那份它看不见。
    const body: any = {
      model,
      content,
      resolution: res,
      duration: dur, // 数字，平台最小 4~5 秒
      generate_audio: true,
      watermark: false,
      metadata: {
        duration: dur,
        resolution: res,
        generate_audio: true,
        watermark: false,
        ...(typeof ratio === "string" && ratio ? { ratio } : {}),
      },
    };
    if (typeof ratio === "string" && ratio) (body as any).ratio = ratio; // 顶层 ratio：方澜契约是顶层字段（metadata 那份兼容旧适配层）——1:1 方形事故的解药
    // 画幅历史上顶层会被老平台拒，故写进 promptText 的 --ratio；新通道 顶层+metadata 双写

    // ===== 2.5 通道契约对齐（比例案终审结论）=====
    // 实锤：顶层参数+metadata 混发会让适配器走"不认 ratio 的老路径"（全线 1:1 的病根）；
    // 官方契约 = 参数只走 metadata。
    const is25 = /-2-5\b|-2-5-/.test(model);
    if (is25) {
      // 清晰度：2.5 官方支持 480p / 720p / 1080p，默认 720p。
      // （旧结论"只收 1080P、720p 被拒"已于 2026-08-28 实测证伪：720p 提交正常、如实回报 720P、
      //   计费 108,900 tok 正好是 1080P 的 1/2.25，且输出是 avc1 H.264 而非 1080p 的 hvc1 H.265。）
      body.metadata.resolution = res === "1080p" ? "1080P" : res === "480p" ? "480P" : "720P";
      if (draft) body.metadata.draft = true; // 草稿：出片更快更便宜，质量略低，用于先看一眼
      // 官方任务类型约束：首帧/首尾帧生视频 ratio 只能是 adaptive（指定具体比例会异步报错
      // InvalidParameter.TaskTypeConstraint——提交成功、跑几分钟才失败）。输出画幅跟首帧图片走，
      // 而首帧就是按目标画幅出的关键帧，所以交给 adaptive 反而比硬指定更准。
      if (extendMode && srcVideos.length) {
        body.metadata.ratio = "adaptive"; // 延长：输出对齐源视频画幅
      } else if (editMode && srcVideos.length) {
        body.metadata.ratio = "adaptive"; // 编辑：画幅与时长都严格对齐源视频
        body.metadata.duration = -1;
      } else if (firstUrl) {
        body.metadata.ratio = "adaptive"; // 首帧/首尾帧：ratio 只能 adaptive，指定具体比例会异步报错
      }
      // 参考生视频不再显式声明任务类型：官方文档没有 omni_reference_task_type 这个字段，
      // 由平台按 content 里的 role 自动判定即可。
      // 剥 --ratio 提示词尾缀（老机制，混在文本里徒增噪音）
      for (const c of body.content) {
        if (c?.type === "text" && typeof c.text === "string") c.text = c.text.replace(/\s*--ratio\s+\S+/g, "");
      }
      // 只留官方契约三件套：model + content + metadata（顶层杂音全部剥除）
      for (const k of Object.keys(body)) {
        if (k !== "model" && k !== "content" && k !== "metadata") delete body[k];
      }
    }

    // 抗突发：并行齐射时网关限流会掐连接（fetch failed/429/5xx）——指数退避重试 3 发，业务性 4xx 不重试
    let r: Response | null = null;
    let lastNetErr: any = null;
    // 请求指纹：反复挂同一场时，各场的差别就在这些数字里。两条失败路径共用它。
    // 参考图来源也要报：网关拉不到某个域名的图就会 502，光看张数看不出是哪一张有问题
    const refHosts = (() => {
      const m = new Map<string, number>();
      for (const u of [...refImgs, firstUrl].filter(Boolean)) {
        let h = "其他";
        const s2 = String(u);
        if (s2.startsWith("asset://")) h = "asset";
        else if (s2.startsWith("data:")) h = "base64";
        else { try { h = new URL(s2).host; } catch {} }
        m.set(h, (m.get(h) || 0) + 1);
      }
      return Array.from(m).map(([h, n]) => `${h}×${n}`).join(",") || "无";
    })();
    const fp = `[图源 ${refHosts}·视频${srcVideos.length}段·音频${refAudios.length}段·提示词${String(promptText || "").length}字·${dur}秒·体积${Math.round(JSON.stringify(body).length / 1024)}KB]`;
    // 到这一步说明素材类错误又出现了。把真正发出去的 body 结构原样带回来——
    // 七次假设全错，是因为我们从没看过 ED 实际拼出的请求长什么样。
          const shape = (() => {
            try {
              const b: any = JSON.parse(JSON.stringify(body));
              if (Array.isArray(b?.content)) {
                b.content = b.content.map((c: any) =>
                  c?.type === "text"
                    ? { type: "text", text: String(c.text || "").slice(0, 60) + "…" }
                    : { type: c?.type, role: c?.role, url: String(c?.image_url?.url || c?.video_url?.url || c?.audio_url?.url || "").slice(0, 90) }
                );
              }
              return JSON.stringify(b).slice(0, 700);
            } catch { return "(无法序列化)"; }
          })();
    // 退避拉长：原来三次加起来才 4 秒，网关 502 / 并发满根本缓不过来。
    // 现在 2s → 8s → 20s，总共约半分钟，覆盖住上游的短时抖动。
    for (let att = 0; att < 4; att++) {
      if (att) await new Promise((res) => setTimeout(res, [0, 2000, 8000, 20000][att] + Math.random() * 1500));
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${videoKeyFor(String(model || ""))}` }, // 按模型分 key（2.5 独立分组）
          body: JSON.stringify(body),
        });
        if (r.status === 429 || r.status >= 500) { lastNetErr = new Error(`上游 HTTP ${r.status}`); r = null; continue; } // r 必须清空：留着它会让重试耗尽后落到下面的 !r.ok 分支（那条没有指纹）
        // 零克云会把它自己上游的 5xx 包成 200 + 错误体回来（实测："task submission failed -
        // API returned 502: <html>…nginx…"）。这类瞬时网关故障最该重试，但状态码是 200，
        // 上面那条判据抓不住——所以这里按错误体内容再拦一道。
        if (r.ok) {
          const peek = await r.clone().text();
          const permanent = /\b4[0-9]{2}\b/.test(peek) || /asset_classify_failed|not_found|invalid|forbidden|denied|未登记|不属于|拒绝/i.test(peek);
          if (!/["']?task_id/.test(peek) && !permanent && /\b(50[0-9])\b|bad gateway|gateway time-?out|submission failed/i.test(peek)) {
            lastNetErr = new Error(`上游网关错误：${peek.slice(0, 120)}`);
            r = null;
            continue;
          }
          if (permanent && !/["']?task_id/.test(peek)) {
            // 永久性业务错误（如素材未登记）：重试毫无意义，当场把平台原话抛出去
            if (payer) await refund(payer, price);
            return NextResponse.json({ error: `${peek.slice(0, 200)} ${fp} 实际请求=${shape}` }, { status: 400 });
          }
        }
        break;
      } catch (e: any) {
        lastNetErr = e; r = null;
      }
    }
    if (!r) {
      if (payer) await refund(payer, price);
      return NextResponse.json({ error: `上游提交失败，已自动重试 4 次、等了约半分钟仍不通。${fp} 末次错误：${String(lastNetErr?.message || lastNetErr || "fetch failed").slice(0, 200)}` }, { status: 502 });
    }

    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {}

    if (!r.ok) {
      if (payer) await refund(payer, price); // 提交失败：当场退
      return NextResponse.json(
        { error: `平台返回错误(${r.status}) ${fp}：${text.slice(0, 200)} 实际请求=${shape}` },
        { status: 502 }
      );
    }

    const taskId: string | undefined =
      data?.task_id || data?.data?.task_id || data?.id || data?.data?.id;
    if (!taskId) {
      if (payer) await refund(payer, price);
      return NextResponse.json(
        { error: `未解析到 task_id，平台返回: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    if (payer) await recordPending(taskId, payer, price); // 在途记录：任务失败凭它退款
    return NextResponse.json({ taskId });
  } catch (e: any) {
    if (payer) await refund(payer, price);
    return NextResponse.json({ error: e?.message || "请求平台失败" }, { status: 500 });
  }
}
