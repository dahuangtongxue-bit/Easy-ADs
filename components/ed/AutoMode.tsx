"use client";

// 版本号：每个交付包 +0.1，显示在顶栏——用来一眼确认「这版到底推上去没有」
export const ED_VERSION = "EA v0.2"; // Easy-ADs 工作台版本（基于 easy-director v66 引擎）

import { useEffect, useRef, useState } from "react";
import { generateStory, generateOutline, expandShot, autoCasting, generateImage, submitVideo, pollVideoUntilDone, rehostImage, translateLines, accountStatus, redeemCardApi, type StoryboardShot, type OutlineBeat } from "@/lib/maas";
import { CAST_PRESETS, type CastPreset } from "@/lib/castPresets";
import RealPersonAuth from "@/components/ed/RealPersonAuth";
import CAST_ANGLES from "@/lib/castAngles.json"; // assetId → [四分之三侧, 侧面]（scripts/gen-angles.mjs 生成）
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/models";
import { concatVideos } from "@/lib/concat";
import { buildScenePrompt, buildEditPrompt, buildExtendPrompt, buildFootagePrompt, sceneSec, filmTotalSec, cost, ratePerSec, parseCuts, checkCuts, frameKey, aspectPx, langName, LANGS, FOOTAGE_MAX_IMG, SCENE_MAX_SEC } from "@/lib/filmScript";

// 2.0 已于 2026-09-08 下线（只留 2.5：2.0 能做的 2.5 都能做，2.0 做不了的正是真人活体/多语言/长场景）。小马通道不稳时直连火山，不回退 2.0。
const VID_25 = "doubao-seedance-2-5-260628";

// 易导演 · 一键出片主流水线：①素材&变量 → ②故事骨架 → ③分镜&选角 → ④预览图 → ⑤视频 → ⑥合成。
// 音频由 Seedance 2.5 音视频联合生成直出（无后期配乐层）；合成走客户端 ffmpeg.wasm。

const GENRE_PRESETS: { key: string; label: string; v: string }[] = [
  { key: "auto", label: "自动", v: "" },
  { key: "ad", label: "广告种草", v: "广告/种草片" },
  { key: "drama", label: "剧情短片", v: "剧情短片" },
  { key: "suspense", label: "悬念反转", v: "悬念反转短片" },
  { key: "warm", label: "情感治愈", v: "情感治愈短片" },
  { key: "funny", label: "搞笑段子", v: "搞笑段子" },
];

const STYLE_PRESETS: { key: string; label: string; prefix: string }[] = [
  { key: "film", label: "电影写实", prefix: "电影质感，胶片颗粒，自然光影，浅景深（注意：写实真人脸做视频可能被平台拦）" },
  { key: "cg3d", label: "3D 动画", prefix: "3D 渲染动画电影质感，皮克斯 / 游戏 CG 风格，风格化非写实造型，明亮通透" },
  { key: "guofeng", label: "国风水墨", prefix: "中国风水墨意境，淡彩晕染，留白构图，古典雅致，工笔质感" },
  { key: "anime", label: "日系动画", prefix: "日系二维动画质感，赛璐璐上色，干净线条，清新色调" },
  { key: "tvc", label: "科技 TVC", prefix: "企业级科技 TVC 广告质感，电影级布光，深靛蓝主色调，暖金点光与青色数据流光效，未来科技感，3D CG 渲染" },
  { key: "cyber", label: "赛博朋克", prefix: "赛博朋克风格，霓虹紫与青蓝双色对撞，湿滑反光的街面与雨夜，全息广告牌，体积光与雾气，高对比暗调，机械义体与数据流光效，虚拟感强的非写实人物造型" },
  { key: "mecha", label: "机甲科幻", prefix: "硬核机甲科幻，工业金属质感与磨损细节，冷峻蓝白工业照明，巨物压迫感，火花与蒸汽，写实渲染但非真人质感" },
  { key: "vtuber", label: "虚拟偶像", prefix: "虚拟偶像 / 二次元 CG 角色质感，通透皮肤与高光眼神，鲜亮饱和配色，偶像舞台打光，风格化非写实造型" },
];

const SHOT_SIZE_SHORT: Record<string, string> = { 远景: "远", 全景: "全", 中景: "中", 近景: "近", 特写: "特" };

type FrameState = { status: "idle" | "gen" | "done" | "err"; url?: string; err?: string };

export default function AutoMode() {
  const [brief, setBrief] = useState("");
  const [styleKey, setStyleKey] = useState("auto"); // 默认由 AI 按故事挑风格——写死电影写实会让赛博朋克/机甲题材全跑偏
  const [autoStyle, setAutoStyle] = useState(""); // 场表按故事挑出来的风格 key
  const [genreKey, setGenreKey] = useState("ad"); // Easy-ADs：默认广告种草 // 题材：给故事编辑/分镜大脑的轻提示
  const [storyLine, setStoryLine] = useState(""); // 六要素故事骨架（第一步产物，展示在②）
  const [quirk, setQuirk] = useState(50); // 奇葩度：0老实本分 · 50正常 · 100放飞（只作用于故事编辑）
  const quirkLabel = quirk < 25 ? "老实本分" : quirk < 55 ? "正常发挥" : quirk < 80 ? "有点东西" : "放飞自我";
  const [stage, setStage] = useState(""); // 分镜前的阶段进度：选角/编故事/拆骨架

  const [storyErr, setStoryErr] = useState(""); // 故事骨架失败原因（清单里说人话）
  // 单镜重写（②的 ✎/↻）所需上下文：拆镜时存下，之后可逐镜返工而不必全部重拆
  const characterRef = useRef("");
  const olCompactRef = useRef<{ shotNo: string; title: string; beat: string }[]>([]);
  const beatByShotRef = useRef<Record<string, OutlineBeat>>({});
  const [reworkOpen, setReworkOpen] = useState(""); // 哪镜的 remix 框展开
  const [reworkNote, setReworkNote] = useState<Record<string, string>>({}); // 每镜的修改要求（持久挂镜）
  const [reworking, setReworking] = useState<Record<string, boolean>>({});
  const [plannedCount, setPlannedCount] = useState(0); // 骨架定下的总镜数（拆镜时"共N镜，已出X镜"）
  // 紧急停止（防误触烧钱）：停止 = 不再发起新的生成；已提交/进行中的那一单照常完成并计费（钱已花，保成果）
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);
  // 积分（CREDITS_ENABLED=1 时启用；关闭时整块 UI 隐藏、行为照旧）
  const [creditsOn, setCreditsOn] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [acctMaster, setAcctMaster] = useState(false);
  const [dailyNote, setDailyNote] = useState("");
  const [cardInput, setCardInput] = useState("");
  async function refreshBalance() {
    try {
      const st = await accountStatus();
      if ((st as any).disabled) {
        setCreditsOn(false);
        return;
      }
      setCreditsOn(true);
      if (st.master) {
        setAcctMaster(true);
        return;
      }
      if (typeof st.balance === "number") setBalance(st.balance);
      if (st.dailyGranted) setDailyNote("今日签到 +100 已到账");
    } catch (e: any) {
      setCreditsOn(true); // 积分开着但口令无效等：把原因亮出来
      setErr(String(e?.message || e));
    }
  }
  async function doRedeem() {
    const card = cardInput.trim();
    if (!card) return;
    try {
      const r = await redeemCardApi(card);
      setBalance(r.balance);
      setDailyNote(`充值成功 +${r.points}`);
      setCardInput("");
      setErr("");
    } catch (e: any) {
      setErr(`充值失败：${String(e?.message || e)}`);
    }
  }
  useEffect(() => {
    void refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestStop() {
    stopRef.current = true;
    setStopping(true);
  }
  // 全量重出视频 = 全站最贵的一个点击（N镜×¥5-8）：第一次点只武装警告，5秒内再点才开火
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmOne, setConfirmOne] = useState(""); // 单场重出的二次确认（场号）
  function confirmThenOne(shot: StoryboardShot) {
    if (confirmOne !== shot.shotNo) {
      setConfirmOne(shot.shotNo);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmOne(""), 5000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmOne("");
    void (async () => { if (await ensureCastFresh([shot])) await genOneVideo(shot); })();
  }
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function confirmThenRegenAll() {
    if (!confirmRegen) {
      setConfirmRegen(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmRegen(false), 5000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmRegen(false);
    void genAllVideos();
  }
  // 角色形象参考图：只给用户预览（绝不喂 Seedance——带脸生成图当参考会污染 asset 脸）；
  // ✎ 的修改会写进外观描述本身 → 参考图/定妆照/视频提示词三线同源，不说谎。
  const [previews, setPreviews] = useState<Record<string, string>>({}); // subjectId → 参考图URL
  const [previewBusy, setPreviewBusy] = useState<Record<string, boolean>>({});
  const previewCacheRef = useRef<Record<string, string>>({}); // "asset|desc" → URL
  const [pvOpen, setPvOpen] = useState("");
  const [pvNote, setPvNote] = useState<Record<string, string>>({});
  const [pvErrs, setPvErrs] = useState<Record<string, string>>({}); // 每张参考图的失败原因（卡片上可见）
  const [storyBusy, setStoryBusy] = useState(false); // ② 故事骨架单独重做/remix 中
  const [stOpen, setStOpen] = useState(false); // ② remix 框
  const [stNote, setStNote] = useState(""); // ② 修改要求

  const [castErr, setCastErr] = useState(""); // 选角失败/空手原因
  const [styleCustom, setStyleCustom] = useState("");
  const [shotCount, setShotCount] = useState<number | "">("");
  const [bandLo, setBandLo] = useState(20); // Easy-ADs：默认 20~30 秒，≤30 秒自动单场 // 片长区间下限；区间 = [bandLo, bandLo+10]
  const bandHi = bandLo + 10;
  const targetSec = bandLo + 5; // 片长档位：商业广告就是 15/30 秒两档，这才是"一键快速"的默认
  // 出片禁令：开放测试时把 NEXT_PUBLIC_VIDEO_LOCKED 设成 1，前端所有花钱入口变灰，
  // 服务端 submit 路由也会拒（前端可绕，闸必须在两头都有）。
  const VIDEO_LOCKED = process.env.NEXT_PUBLIC_VIDEO_LOCKED === "1";
  // 故事骨架默认关掉：它在用户原话和场表之间加了一道转述，转述必然漂移
  // （实测：一个具体段子被扩成一堆用户没写过的细节）。场表本来就会拆起因经过结局。
  // 想让 AI 先帮忙把想法扩成完整故事时，才在「调一调」里打开它。
  const [useStory, setUseStory] = useState(false);
  // 数字人送法：asset（原生锁脸，效果最好）/ image（送花名册形象图，绕开转接层的素材登记）
  // 2026-08-30：零克云转接层拒收所有 asset://（asset_classify_failed），上游直连却正常 →
  // 是转接层没把素材归属映射到我们的令牌。在他们修好之前，image 是唯一能出片的路。
  // 2.5 换了供应商，新供应商还没接真人活体素材（asset:// 一律 asset_classify_failed）；
  const VID_MODEL = VID_25;
  const maxSceneSec = SCENE_MAX_SEC;
  const presetImg = (assetId: string) => {
    const p = CAST_PRESETS.find((x) => x.assetId === assetId);
    if (!p?.img) return "";
    return /^https?:\/\//.test(p.img) ? p.img : (typeof window !== "undefined" ? window.location.origin : "") + p.img;
  };
  const [openTune, setOpenTune] = useState(true); // 题材/风格/画幅/清晰度是高频项，默认摊开；低频的参考类在里层「高级」里 // ①默认只留一句话+一颗按钮，其余全收进「调一调」
  const [openAdv, setOpenAdv] = useState(false); // 高级：参考片/参考音频/语种，低频可选，默认折叠
  const [rawOpen, setRawOpen] = useState<Record<string, boolean>>({}); // 场内原文：默认收起，切点列表才是主视图
  const [openBatch, setOpenBatch] = useState(false);
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("16:9"); // 画幅：横屏默认
  const [autoCast, setAutoCast] = useState(true); // 根据剧情自动选角（没手动选数字人时生效）
  // 一键连跑不再是选项：点生成就一路跑到场表（全程免费），出片仍要用户亲手确认。
  // 场表本来就是流式冒出来的，再给个开关+折叠反而让人以为已经看完了。
  const autoRun = true;
  const [envKit, setEnvKit] = useState<string[]>([]); // 场景库：续拍新一集时带来的环境锚点，拆镜自动沿用
  const [scriptMode, setScriptMode] = useState<"create" | "adapt">("create"); // 故事创作（编）/ 剧本改编（只拆不编）
  // 草稿模式：官方 metadata.draft，出片更快更便宜、质量略低。
  // 它在成本阶梯里补上了缺失的一档：文本免费 → 关键帧几分钱 → **草稿看一眼** → 正式出片。
  const [draftMode, setDraftMode] = useState(false);
  const [videoRes, setVideoRes] = useState("720p"); // 清晰度档位：720p = H.264 8bit（合成友好、便宜一半多），1080p = H.265 10bit
  // 1080p 是 H.265/HEVC，部分 Windows Chrome 与安卓机不解码——网页里会黑屏。
  // 提前探一次能力，放不了就直说并给下载路径，别让用户对着黑框以为片子废了。
  const [hevcOk, setHevcOk] = useState(true);
  useEffect(() => {
    try {
      const v = document.createElement("video");
      const ok = ["video/mp4; codecs=\"hvc1.1.6.L93.B0\"", "video/mp4; codecs=\"hev1.1.6.L93.B0\""]
        .some((t) => v.canPlayType(t) !== "");
      setHevcOk(ok);
    } catch { /* 探测失败就当能放，不平白吓人 */ }
  }, []);
  // ===== 出片语种 =====
  // Seedance 2.5 原生 11 语种有声生成、口型跟着译文走。同一场表可以一键出多语言版本：
  // 台词整片一次译好、回填到③可改（品牌名人名常需人工定夺），出片时按语种走。
  const [filmLang, setFilmLang] = useState("zh");
  // ===== 参考片：给我看你想要什么 =====
  // 2.5 支持从参考视频/图里单独学「运动」或「风格」。官方规则：分工要具体到参考哪一部分，
  // 且参考素材够精准时只做指代、别复述画面——所以这里让用户勾"学什么"，编译器据此写职责。
  const REF_USES = ["运镜节奏", "调色风格", "动作表演", "剪辑节奏"];
  const [refVideoUrl, setRefVideoUrl] = useState("");
  const [refStyleImg, setRefStyleImg] = useState("");
  const [refUses, setRefUses] = useState<string[]>([]);
  // 音频参考：2.5 支持纯音频。
  // 官方写法「图片1的角色使用音频1音色」——所以音色可以精确绑到某个角色头上。
  const [refAudioUrl, setRefAudioUrl] = useState("");
  const [refAudioUse, setRefAudioUse] = useState(""); // "" | "音色" | "配乐风格"
  const [refAudioCast, setRefAudioCast] = useState("");
  const [refUpBusy, setRefUpBusy] = useState(false);
  const refImgUpRef = useRef<HTMLInputElement | null>(null);

  async function onRefStyleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setRefUpBusy(true);
    setErr("");
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("图片读取失败"));
        r.readAsDataURL(f);
      });
      setRefStyleImg(await rehostImage(dataUrl.replace(/^data:[^,]+,/, "")));
    } catch (err: any) {
      setErr(`风格参考图上传失败：${String(err?.message || err)}`);
    }
    setRefUpBusy(false);
  }
  const [i18nLines, setI18nLines] = useState<Record<string, Record<string, string>>>({}); // lang → (场号#序号 → 译文)
  const [i18nBusy, setI18nBusy] = useState(false);

  function lineKey(shotNo: string, ix: number) { return `${shotNo}#${ix}`; }

  // ===== 批量出片 =====
  // 一份场表 × 多语种 × 多画幅，一次跑完。出海投放的真实需求从来不是"一个英语版"，
  // 而是"英西葡印尼四版、竖版横版都给我"。场表已经结构化，这里只是按变体循环复用出片链路。
  type BatchItem = { lang: string; aspect: string; status: "wait" | "gen" | "done" | "err"; done: number; total: number; urls: Record<string, string>; err?: string };
  const [batchLangs, setBatchLangs] = useState<string[]>([]);
  const [batchAspects, setBatchAspects] = useState<string[]>([]);
  const [batchOut, setBatchOut] = useState<Record<string, BatchItem>>({});
  const [batchBusy, setBatchBusy] = useState(false);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const batchKey = (lang: string, asp: string) => `${lang}|${asp}`;
  const batchVariants = batchLangs.flatMap((l) => batchAspects.map((a2) => ({ lang: l, aspect: a2 })));

  async function genBatch() {
    const list = shots || [];
    if (!list.length || !batchVariants.length) return;
    setBatchBusy(true);
    setErr("");
    // 先把要用到的语种一次性译好（每种一次调用，几分钱）
    for (const lg of Array.from(new Set(batchLangs))) {
      if (lg !== "zh" && !i18nLines[lg]) await runTranslate(lg);
      if (stopRef.current) break;
    }
    for (const vr of batchVariants) {
      if (stopRef.current) break;
      const k = batchKey(vr.lang, vr.aspect);
      setBatchOut((cur) => ({ ...cur, [k]: { ...vr, status: "gen", done: 0, total: list.length, urls: {} } }));
      try {
        for (const sh of list) {
          if (stopRef.current) break;
          await genOneVideo(sh, {
            lang: vr.lang,
            aspect: vr.aspect,
            sink: (url) =>
              setBatchOut((cur) => {
                const it = cur[k];
                if (!it) return cur;
                const urls = { ...it.urls, [sh.shotNo]: url };
                return { ...cur, [k]: { ...it, urls, done: Object.keys(urls).length } };
              }),
          });
        }
        setBatchOut((cur) => (cur[k] ? { ...cur, [k]: { ...cur[k], status: Object.keys(cur[k].urls).length ? "done" : "err", err: Object.keys(cur[k].urls).length ? undefined : "全部失败" } } : cur));
      } catch (e: any) {
        setBatchOut((cur) => (cur[k] ? { ...cur, [k]: { ...cur[k], status: "err", err: friendlyVideoErr(e) } } : cur));
      }
    }
    setBatchBusy(false);
  }

  function confirmThenBatch() {
    if (!confirmBatch) {
      setConfirmBatch(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmBatch(false), 6000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmBatch(false);
    void genBatch();
  }

  /** 取某场某句的出片用台词：非中文且有译文就用译文，否则回落原文（绝不空着） */
  function lineFor(shot: StoryboardShot, ix: number, raw: string): string {
    if (filmLang === "zh") return raw;
    return (i18nLines[filmLang]?.[lineKey(shot.shotNo, ix)] || "").trim() || raw;
  }

  /** 把整片台词译成目标语种（一次调用，几分钱都不到） */
  async function runTranslate(lang: string) {
    const list = shots || [];
    if (!list.length || lang === "zh") return;
    const items: { id: string; text: string }[] = [];
    for (const sh of list) {
      const duet = (sh.lines || []).filter((l) => (l.speaker || "").trim() && (l.line || "").trim());
      if (duet.length) duet.forEach((l, ix) => items.push({ id: lineKey(sh.shotNo, ix), text: l.line.trim() }));
      else if ((sh.line || "").trim()) items.push({ id: lineKey(sh.shotNo, 0), text: (sh.line || "").trim() });
    }
    if (!items.length) return;
    setI18nBusy(true);
    setErr("");
    try {
      const out = await translateLines(items, langName(lang));
      setI18nLines((cur) => ({ ...cur, [lang]: { ...(cur[lang] || {}), ...out } }));
    } catch (e: any) {
      setErr(`台词翻译失败：${String(e?.message || e)}（可先改语种再重试，或直接用中文出片）`);
    }
    setI18nBusy(false);
  }
  // ===== 第二个入口：素材成片 =====
  // 用户手上是素材不是故事时走这条：多张图按顺序进时间轴，跳过骨架/场表/关键帧，一次出片。
  const [entryMode, setEntryMode] = useState<"story" | "footage">("story");
  const [footage, setFootage] = useState<string[]>([]); // 已转存到图床的素材 URL，顺序即片中顺序
  const [footageBusy, setFootageBusy] = useState(false);
  const [footageSec, setFootageSec] = useState(15);
  const [footageKeep, setFootageKeep] = useState(true); // 原图不许改（live 图效果）
  const [confirmFootage, setConfirmFootage] = useState(false);
  const footageUpRef = useRef<HTMLInputElement | null>(null);
  const FOOTAGE_KEY = "__footage__"; // 成片存在 videos 表这个保留键下，断点续传/过期提示全部复用

  async function onFootageFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setFootageBusy(true);
    setErr("");
    try {
      const room = FOOTAGE_MAX_IMG - footage.length;
      for (const f of files.slice(0, Math.max(0, room))) {
        const dataUrl: string = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.onerror = () => rej(new Error("图片读取失败"));
          r.readAsDataURL(f);
        });
        const hosted = await rehostImage(dataUrl.replace(/^data:[^,]+,/, "")); // 转存拿公网 URL（参考图必须公网可达）
        setFootage((cur) => (cur.length >= FOOTAGE_MAX_IMG ? cur : [...cur, hosted]));
      }
    } catch (err: any) {
      setErr(`素材上传失败：${String(err?.message || err)}`);
    }
    setFootageBusy(false);
  }

  async function genFootageFilm() {
    if (!footage.length) return;
    const vp = buildFootagePrompt({
      count: footage.length,
      brief: brief.trim(),
      stylePrefix,
      aspect,
      sec: footageSec,
      keepOriginal: footageKeep,
    });
    const projAtStart = projIdRef.current;
    const sv = (fn: (v: Record<string, VidState>) => Record<string, VidState>) => { if (projIdRef.current === projAtStart) setVideos(fn); };
    setVideoBusy(true);
    setErr("");
    sv((v) => ({ ...v, [FOOTAGE_KEY]: { status: "gen", url: v[FOOTAGE_KEY]?.url, at: v[FOOTAGE_KEY]?.at } }));
    try {
      const taskId = await submitVideo({ referenceImageUrls: footage, prompt: vp, model: VID_MODEL, resolution: videoRes, draft: draftMode, duration: String(footageSec), ratio: aspect });
      sv((v) => ({ ...v, [FOOTAGE_KEY]: { status: "gen", taskId, url: v[FOOTAGE_KEY]?.url, at: v[FOOTAGE_KEY]?.at } }));
      const url = await pollVideoUntilDone(taskId, VID_MODEL, () => {}, () => false, { intervalMs: 5000, maxAttempts: 420 });
      sv((v) => ({ ...v, [FOOTAGE_KEY]: { status: "done", url, at: Date.now() } }));
    } catch (e: any) {
      sv((v) => {
        const keep = v[FOOTAGE_KEY]?.url;
        return keep
          ? { ...v, [FOOTAGE_KEY]: { status: "done", url: keep, at: v[FOOTAGE_KEY]?.at } }
          : { ...v, [FOOTAGE_KEY]: { status: "err", err: friendlyVideoErr(e) } };
      });
      setErr(`素材成片失败：${friendlyVideoErr(e)}`);
    } finally {
      setVideoBusy(false);
      if (creditsOn) void refreshBalance();
    }
  }

  function confirmThenFootage() {
    if (!confirmFootage) {
      setConfirmFootage(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmFootage(false), 5000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmFootage(false);
    void genFootageFilm();
  }
  const [editShot, setEditShot] = useState(""); // 正在修补哪一场（场号）
  const [editCut, setEditCut] = useState(-1); // 改哪一段：-1 = 整场
  const [editText, setEditText] = useState("");
  const [extShot, setExtShot] = useState(""); // 正在续接哪一场
  const [extSec, setExtSec] = useState(10);
  const [extText, setExtText] = useState("");

  // 续接：把这一场的成片当 reference_video，让模型接着往下演，产物插成紧随其后的新一场。
  // 比 ffmpeg 硬拼强一个数量级（官方：拿 2.5 自己生成的视频延长，衔接最无缝），
  // 而且能突破单次 30 秒的天花板——一场接一场，长片就出来了。
  async function genExtend(shot: StoryboardShot): Promise<void> {
    // 插入位置按场表里的真实下标算——⑤ 的循环下标是过滤后的，拿它插会插错位
    const idx = (shots || []).findIndex((x) => x.shotNo === shot.shotNo);
    if (idx < 0) return;
    const cur = videos[shot.shotNo];
    if (!cur || cur.status !== "done" || !cur.url) return;
    if (vidExpired(cur)) {
      setErr(`场 ${shot.shotNo} 的视频链接已过期（平台只存 24 小时），没法拿它当续接底片——先 ↻ 重出这场。`);
      return;
    }
    const subsNow = subjectsRef.current;
    const tags = castByShot[shot.shotNo] || [];
    const cast = subsNow.filter((x) => tags.includes(x.tag) && x.value.trim());
    const castDesc = cast.map((x) => { const d = (x.desc || "").trim(); return d ? `${x.tag}（${d}）` : x.tag; }).join("；");
    const vp = buildExtendPrompt(extText, extSec, { castDesc, stylePrefix, lang: filmLang });

    // 先把新一场插进场表（内容=续写要求），产物直接挂到它头上——⑥合成按场序拼，零改动
    const id = newShotNo();
    const fresh: StoryboardShot = {
      shotNo: id,
      title: `${(shot.title || "").trim() || "本场"}·续`,
      shotSize: shot.shotSize,
      cameraMove: shot.cameraMove,
      content: extText.trim() || "顺着上一场继续往下演",
      duration: String(extSec),
      env: shot.env,
    } as StoryboardShot;
    setShots((p) => { const arr = [...(p || [])]; arr.splice(idx + 1, 0, fresh); return arr; });
    setCastByShot((c) => ({ ...c, [id]: [...tags] }));

    const projAtStart = projIdRef.current;
    const sv = (fn: (v: Record<string, VidState>) => Record<string, VidState>) => { if (projIdRef.current === projAtStart) setVideos(fn); };
    setVideoBusy(true);
    setErr("");
    sv((v) => ({ ...v, [id]: { status: "gen" } }));
    try {
      const taskId = await submitVideo({ sourceVideoUrls: [cur.url], prompt: vp, model: VID_MODEL, resolution: videoRes, draft: draftMode, duration: String(extSec), extendMode: true });
      sv((v) => ({ ...v, [id]: { status: "gen", taskId } }));
      const url = await pollVideoUntilDone(taskId, VID_MODEL, () => {}, () => false, { intervalMs: 5000, maxAttempts: 420 });
      sv((v) => ({ ...v, [id]: { status: "done", url, at: Date.now() } }));
      setExtShot("");
      setExtText("");
    } catch (e: any) {
      sv((v) => ({ ...v, [id]: { status: "err", err: friendlyVideoErr(e) } }));
      setErr(`续接失败（${shot.title || shot.shotNo}，新场已保留可单独重出）：${friendlyVideoErr(e)}`);
    } finally {
      setVideoBusy(false);
      if (creditsOn) void refreshBalance();
    }
  }
  // assetId：真人活体认证后的平台素材 Id（2.5 原生锁脸，送 asset:// 而不是照片）；没有 = 普通照片角色
  type MyCast = { id: string; name: string; img: string; desc?: string; assetId?: string };
  const [myCast, setMyCast] = useState<MyCast[]>([]); // 我的角色库：上传照片固定人像，跨作品可用（localStorage）
  const [myUpBusy, setMyUpBusy] = useState(false);
  const myCastRef = useRef<MyCast[]>([]);
  useEffect(() => { myCastRef.current = myCast; }, [myCast]);
  const myUpRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    try { setMyCast(JSON.parse(localStorage.getItem("ez.mycast") || "[]")); } catch {}
  }, []);
  const saveMyCast = (next: MyCast[]) => {
    setMyCast(next);
    try { localStorage.setItem("ez.mycast", JSON.stringify(next)); } catch {}
  };
  async function onMyCastFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const name = (window.prompt("给这个固定角色起个名字（2~6字，如 张总/阿明）：") || "").trim().slice(0, 8);
    if (!name) return;
    setMyUpBusy(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("图片读取失败"));
        r.readAsDataURL(f);
      });
      const b64 = dataUrl.replace(/^data:[^,]+,/, "");
      const hosted = await rehostImage(b64); // 转存图床拿公网 URL（视频参考图必须公网可达）
      saveMyCast([...myCast, { id: Math.random().toString(36).slice(2, 8), name, img: hosted }]);
    } catch (err: any) {
      setErr(`角色照片上传失败：${String(err?.message || err)}（可改用「贴图片URL当角色」）`);
    }
    setMyUpBusy(false);
  }
  const [openBoard, setOpenBoard] = useState(true); // ③ 场表默认展开（流式冒出来的东西不该收起来）
  const [openFrames, setOpenFrames] = useState(false); // 连跑时 ③ 折叠
  const [openVideos, setOpenVideos] = useState(false); // 连跑时 ④ 折叠

  // 主角（0~5 个）：空=文生一切；有主角=按参考图生成（数字人 asset / 产品图），可同框
  type SubjectKind = "human" | "product";
  type Subject = { id: string; tag: string; kind: SubjectKind; value: string; desc: string; info?: string; auto?: boolean; assetId?: string }; // info=年龄+身份；auto=选角导演挑的（重拆时作废重选，手动加的保留）；assetId=真人活体素材（出片送 asset://，value 仍是照片供预览/关键帧）
  const SHOT_SIZES_C = ["远景", "全景", "中景", "近景", "特写"];
  const CAMERA_MOVES_C = ["固定镜头", "镜头缓慢推近", "镜头缓慢拉远", "镜头横向摇移", "镜头平移跟随", "镜头升降运动", "镜头环绕主体", "手持轻微晃动", "低角度仰拍", "航拍俯冲", "希区柯克变焦", "子弹时间环绕"];
  const DURATIONS_C = Array.from({ length: 27 }, (_, i) => String(i + 4)); // 场长 4~30 秒，1 秒粒度（2.5 的 duration 取值范围）
  const selChip: React.CSSProperties = { height: 22, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 11, padding: "0 4px", cursor: "pointer" };
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [productBusy, setProductBusy] = useState<string>(""); // 正在上传图片的主角 id
  const hasSubjects = subjects.length > 0;
  // 产品必须写外观+用法：留空的话场表大脑只知道有个「产品1」，编不进戏（9/8 实测：整片没出现产品）
  const productMissingDesc = subjects.filter((s) => s.kind === "product" && s.value.trim() && !(s.desc || "").trim()).map((s) => s.tag);
  const realMissingDesc = subjects.filter((s) => s.kind === "human" && s.assetId && !(s.desc || "").trim()).map((s) => s.tag); // 真人没写造型：不拦，但提醒（造型锁定靠这段描述）
  const MAX_SUBJECTS = 5;
  const subjectsRef = useRef(subjects);
  subjectsRef.current = subjects;
  // 定妆照（服装参考）：asset 只锁脸+发型，服装靠「正面无头定妆照」锁到款式级（cURL 三连验证过）
  const [wardrobes, setWardrobes] = useState<Record<string, string>>({}); // subjectId → URL（UI 缩略图）
  const wardrobeByIdRef = useRef<Record<string, string>>({}); // 异步链路同步读
  const wardrobeCacheRef = useRef<Record<string, string>>({}); // "asset|desc" → URL：同会话复用，重跑不重生、跨镜一致

  function addSubject(kind: SubjectKind) {
    if (subjects.length >= MAX_SUBJECTS) return;
    const n = subjects.length + 1;
    setSubjects((s) => [...s, { id: Math.random().toString(36).slice(2, 8), tag: kind === "human" ? `主角${n}` : `产品${n}`, kind, value: "", desc: "" }]);
  }
  function updateSubject(id: string, patch: Partial<Subject>) {
    setSubjects((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    // 我的角色库出身的角色：外观描述改了就回写进库（localStorage），下次加入本片/重拆自动带上，不用再填一遍
    if (typeof patch.desc === "string") {
      const sb = subjectsRef.current.find((x) => x.id === id);
      const lib = myCastRef.current;
      const hit = sb ? lib.find((m) => (sb.assetId && m.assetId === sb.assetId) || (!sb.assetId && m.img && m.img === sb.value.trim())) : null;
      if (hit && (hit.desc || "") !== patch.desc) saveMyCast(lib.map((m) => (m.id === hit.id ? { ...m, desc: patch.desc } : m)));
    }
  }
  function removeSubject(id: string) {
    setSubjects((s) => s.filter((x) => x.id !== id));
    setCastByShot((c) => {
      const removed = subjects.find((x) => x.id === id)?.tag;
      if (!removed) return c;
      const next: Record<string, string[]> = {};
      for (const k of Object.keys(c)) next[k] = c[k].filter((t) => t !== removed);
      return next;
    });
  }

  // 选角台：点头像一键加为主角（自动填 asset_id + 外观描述）；已选中再点=取消
  function togglePreset(p: CastPreset) {
    const existing = subjects.find((s) => s.kind === "human" && s.value.trim() === p.assetId);
    if (existing) {
      removeSubject(existing.id);
      return;
    }
    if (subjects.length >= MAX_SUBJECTS) return;
    const n = subjects.length + 1;
    setSubjects((s) => [...s, { id: Math.random().toString(36).slice(2, 8), tag: `主角${n}`, kind: "human", value: p.assetId, desc: p.desc }]);
  }

  // 每镜出现哪些主角（用 tag 引用）
  const [castByShot, setCastByShot] = useState<Record<string, string[]>>({});
  function toggleCast(shotNo: string, tag: string) {
    setCastByShot((c) => {
      const cur = c[shotNo] || [];
      return { ...c, [shotNo]: cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag] };
    });
  }

  const [shots, setShots] = useState<StoryboardShot[] | null>(null);
  const [boardBusy, setBoardBusy] = useState(false);
  const [frames, setFrames] = useState<Record<string, FrameState>>({});
  const [framesBusy, setFramesBusy] = useState(false);
  const [err, setErr] = useState("");

  const effStyleKey = styleKey === "auto" ? autoStyle || "film" : styleKey;
  const stylePrefix = (effStyleKey === "custom" ? styleCustom : STYLE_PRESETS.find((s) => s.key === effStyleKey)?.prefix || "").trim();

  async function handleProductFile(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProductBusy(id);
    setErr("");
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("读取失败"));
        r.readAsDataURL(file);
      });
      const url = await rehostImage(dataUrl);
      updateSubject(id, { value: url });
    } catch (e2: any) {
      setErr(`产品图上传失败：${String(e2?.message || e2)}`);
    } finally {
      setProductBusy("");
      e.target.value = "";
    }
  }

  async function genBoard() {
    // ② 的故事骨架是上游产物：本函数只负责 选角 → 拆镜（→ 连跑出片）
    const synopsis = scriptMode === "adapt" || !useStory ? brief.trim() : storyLine.trim() || brief.trim();
    if (!synopsis) {
      setErr(scriptMode === "adapt" ? "先把剧本粘进①的文本框。" : "先在②生成或填写故事骨架。");
      return;
    }
    stopRef.current = false;
    setStopping(false);
    setErr("");
    setBoardBusy(true);
    setFrames({});
    setVideos({});
    setShots([]); // 逐镜蹦出来，先清空占位
    setPlannedCount(0);
    setCastByShot({});
    setCastErr("");
    if (autoRun) {
      setOpenBoard(true); // 工作中的步骤展开可见，做完自动收起
      setOpenFrames(false);
      setOpenVideos(false);
    }
    try {
      const genreV = GENRE_PRESETS.find((g) => g.key === genreKey)?.v || "";

      // —— 自动选角（与故事编辑同时进行）——
      // 重拆分镜 = 新故事骨架：上一轮自动选的角色作废、按新故事重选（手动加的数字人/产品保留；
      // 同角色的参考图/定妆照有缓存，重选到同一位不重复扣费）
      let subs = subjects.filter((x) => !(x.kind === "human" && x.auto));
      if (subs.length !== subjects.length) setSubjects(subs);
      setStage("选角");
      if (autoCast && !subs.some((x) => x.kind === "human")) {
        // 钦定出演：故事里点名的"我的角色"直接锁定（照片即真身，不经选角导演之手）
      {
        const drafted: Subject[] = [];
        for (const m of myCastRef.current) {
          if (subs.length + drafted.length >= MAX_SUBJECTS) break;
          const nm = (m.name || "").trim();
          if (!nm || !synopsis.includes(nm)) continue;
          if (subs.some((x) => x.tag === nm) || drafted.some((x) => x.tag === nm)) continue;
          const sid = Math.random().toString(36).slice(2, 8);
          drafted.push({ id: sid, tag: nm, kind: "human" as SubjectKind, value: m.img, desc: (m.desc || "").trim(), auto: false, assetId: m.assetId || undefined }); // 角色库出身：重拆保留，别让用户重填
          setPreviews((pv) => ({ ...pv, [sid]: m.img }));
        }
        if (drafted.length) {
          subs = [...subs, ...drafted];
          setSubjects(subs);
          setStage(`钦定出演：${drafted.map((x) => x.tag).join("、")}（我的角色库·按名锁定）`);
        }
      }
      const slots = MAX_SUBJECTS - subs.length;
        if (slots > 0) {
          try {
            const picks = await autoCasting(
              synopsis,
              [...CAST_PRESETS.map((p) => ({ assetId: p.assetId, label: p.label, desc: p.desc })), ...myCastRef.current.map((m) => ({ assetId: `my-${m.id}`, label: `${m.name}（${m.assetId ? "真人活体·原生锁脸" : "用户自有角色·照片锁定"}${(m.desc || "").trim() ? "：" + (m.desc || "").trim().slice(0, 30) : ""}）`, desc: (m.desc || m.name) }))],
              Math.min(scriptMode === "adapt" ? slots : 3, slots),
              subs.filter((x) => x.kind === "human").map((x) => x.tag) // 已锁定演员：钦定+手动的都报备，导演只补缺
            );
            if (!picks.length) setCastErr("选角导演未选出合适角色（可从选角台手动点选后重跑）");
            if (picks.length) {
              const usedTags = new Set(subs.map((x) => x.tag));
              const added: Subject[] = [];
              for (let i = 0; i < picks.length; i++) {
                const pk = picks[i];
                const isGen = pk.assetId === "GEN";
                const myPick = !isGen && pk.assetId.startsWith("my-") ? myCastRef.current.find((x) => `my-${x.id}` === pk.assetId) : null;
                const preset = isGen || myPick ? null : CAST_PRESETS.find((x) => x.assetId === pk.assetId);
                if (!isGen && !myPick && !preset) continue;
                if (myPick && subs.some((x) => x.kind === "human" && ((myPick.assetId && x.assetId === myPick.assetId) || x.value.trim() === myPick.img))) continue; // 已在片中（重拆保留的），别重复加
                // 代号用角色名（陈默/老板娘），重名/缺名回退主角N；desc 用选角导演重写的（贴角色身份）
                let tag = (pk.role || "").trim() || `主角${subs.length + i + 1}`;
                while (usedTags.has(tag)) tag = tag + "²";
                usedTags.add(tag);
                if (myPick) {
                  const sid = Math.random().toString(36).slice(2, 8);
                  added.push({ id: sid, tag, kind: "human" as SubjectKind, value: myPick.img, desc: (myPick.desc || "").trim() || (pk.desc || "").trim(), info: (pk.info || "").trim() || undefined, auto: false, assetId: myPick.assetId || undefined }); // 库里的描述优先（用户写的是事实源）；重拆保留
                  setPreviews((pv) => ({ ...pv, [sid]: myPick.img })); // 照片锁定：原图即预览即参考
                } else if (isGen) {
                  // 花名册没有的角色（魔族/龙族/古代人）：文生图现场造，全身定妆照直接当视频参考图
                  try {
                    setStage(`选角导演造角色：${tag}…`);
                    const raw = await generateImage(
                      `角色定妆照：${(pk.genPrompt || pk.desc || "").trim()}，全身正面站立，面向镜头，纯浅灰色背景，摄影棚均匀布光，五官与服饰细节清晰，写实电影风格`,
                      IMAGE_MODELS[0]?.id || "doubao-seedream-5-0-260128",
                      "2K"
                    );
                    const hosted = await rehostImage(raw);
                    const sid = Math.random().toString(36).slice(2, 8);
                    added.push({ id: sid, tag, kind: "human" as SubjectKind, value: hosted, desc: (pk.desc || "").trim(), info: (pk.info || "").trim() || undefined, auto: true });
                    setPreviews((pv) => ({ ...pv, [sid]: hosted })); // 造出来的图直接当预览
                  } catch {
                    // 造脸失败（上游波动或图审拦截）：降级用花名册空闲脸顶替，绝不弃演
                    const usedIds = new Set([...subs, ...added].filter((x) => x.kind === "human").map((x) => x.value));
                    const fb = CAST_PRESETS.find((x) => !usedIds.has(x.assetId));
                    if (fb) {
                      added.push({ id: Math.random().toString(36).slice(2, 8), tag, kind: "human" as SubjectKind, value: fb.assetId, desc: (pk.desc || "").trim() || fb.desc, info: (pk.info || "").trim() || undefined, auto: true });
                      setCastErr(`角色「${tag}」文生图造脸失败，已用数字人顶替（服装已按角色重写）`);
                    } else {
                      setCastErr(`角色「${tag}」造脸失败，可手动补选`);
                    }
                  }
                } else {
                  added.push({ id: Math.random().toString(36).slice(2, 8), tag, kind: "human" as SubjectKind, value: pk.assetId, desc: (pk.desc || "").trim() || preset!.desc, info: (pk.info || "").trim() || undefined, auto: true });
                }
              }
              if (added.length) {
                subs = [...subs, ...added];
                setSubjects(subs);
              }
            }
          } catch (e: any) {
            setCastErr(`选角调用失败：${String(e?.message || e).slice(0, 50)}`);
            /* 不拦路：按现有主角（或无主角）继续 */
          }
        }
      }

      // 定妆照与拆分镜并行生成（几乎不增加总时长）；出视频前再等它就位
      const humanSubs = subs.filter((x) => x.kind === "human" && x.value.trim());
      const wardrobeJob = humanSubs.length ? genWardrobes(humanSubs) : Promise.resolve();
      if (humanSubs.length) genPreviews(humanSubs); // 角色参考图：只给用户看，不喂 Seedance，不阻塞流程

      const opts: any = {};
      if (envKit.length) opts.envHint = envKit.join("；"); // 续拍：场景锚点沿用，系列画面一致
      if (scriptMode === "adapt") opts.adapt = true; // 场记模式：只拆不编
      // 广告种草且片长 ≤30 秒：自动单场。场内硬切由 2.5 一次生成完成，没有任何跨场衔接/服装漂移问题（9/8 三场 30 秒实测头饰三场三样）。
      const autoSingle = genreKey === "ad" && targetSec <= 30 && !(typeof shotCount === "number" && shotCount > 0);
      if (typeof shotCount === "number" && shotCount > 0) opts.shotCount = shotCount;
      else if (autoSingle) {
        opts.shotCount = 1;
        opts.targetSec = targetSec; opts.targetMin = bandLo; opts.targetMax = bandHi; opts.maxSec = maxSceneSec; // 单场也要守片长
      } else {
        opts.targetSec = targetSec;
        opts.targetMin = bandLo;
        opts.maxSec = maxSceneSec;
        opts.targetMax = bandHi;
      }
      opts.quirk = quirk; // 奇葩度现在直接作用于拆场（骨架已不在默认路径）
      if (stylePrefix) opts.style = stylePrefix;
      if (genreV) opts.genre = genreV;
      opts.aspect = aspect;
      // 把所有主角的固定描述打包给分镜大脑，锁住身份、不许自己另编
      const allTags = subs.map((x) => x.tag);
      if (subs.length) {
        opts.character = subs.map((x) => `【${x.tag}${x.info ? `·${x.info}` : ""}】${x.desc || (x.kind === "human" ? "数字人" : "产品")}`).join("；");
        opts.castTags = allTags; // 让分镜大脑按剧情自动分配每镜出场主角
        const productTags = subs.filter((x) => x.kind === "product" && x.value.trim()).map((x) => x.tag);
        if (productTags.length) opts.productTags = productTags; // 产品：末场必出（前面按剧情合理决定）
      }

      // 逐镜生成：先一个小请求出「骨架」（秒回），再逐镜小请求扩写——每个请求都很小，不会 504；
      // 扩写时带上一镜成品，衔接比一把梭更强。镜头真·一张张蹦出来。
      setStage("拆骨架");
      const ol = await generateOutline(synopsis, opts);
      if (ol.style) setAutoStyle(ol.style); // 自动档：采纳场表按故事挑的风格
      setPlannedCount(ol.beats.length); // 总镜数此刻已定
      setStage("");
      const olCompact = ol.beats.map((x) => ({ shotNo: x.shotNo, title: x.title, beat: x.beat }));
      characterRef.current = opts.character || "";
      olCompactRef.current = olCompact;
      beatByShotRef.current = {};
      ol.beats.forEach((x) => {
        beatByShotRef.current[x.shotNo] = x;
      });
      const collected: StoryboardShot[] = [];
      const castMap: Record<string, string[]> = {};
      let prevContent = "";
      let prevEnvVar = "";
      let prevLineVar = "";
      for (const bt of ol.beats) {
        if (stopRef.current) break; // 停止：不再扩写后续镜头
        const envThis = bt.env || ol.env;
        const raw = await expandShot({ beat: bt, character: opts.character, env: envThis, style: stylePrefix, aspect, prevContent, prevEnv: prevEnvVar, outlineAll: olCompact, mustSpeak: bt.say || undefined, prevLine: prevLineVar || undefined, adapt: scriptMode === "adapt" || undefined, synopsis: scriptMode === "adapt" ? synopsis : undefined });
        prevContent = raw.content;
        prevEnvVar = envThis;
        prevLineVar = (raw.line || "").trim();
        const cast = allTags.length ? (bt.cast || []).filter((t) => allTags.includes(t)) : [];
        const shot: StoryboardShot = { ...raw, shotNo: bt.shotNo || raw.shotNo, cast, env: envThis };
        collected.push(shot);
        castMap[shot.shotNo] = cast.length ? cast : [...allTags];
        // 保底：末场必带产品——大脑漏了也不能让整片没有产品（9/8 实测整片无产品）
        if (bt === ol.beats[ol.beats.length - 1]) {
          for (const pt of subs.filter((x) => x.kind === "product" && x.value.trim()).map((x) => x.tag)) {
            if (!castMap[shot.shotNo].includes(pt)) castMap[shot.shotNo].push(pt);
          }
          shot.cast = castMap[shot.shotNo];
        }
        setShots((prev) => [...(prev || []), shot]);
        if (allTags.length) {
          setCastByShot((prev) => ({ ...prev, [shot.shotNo]: castMap[shot.shotNo] }));
        }
      }

      // —— 自动连跑：分镜完成直接出视频，出完自动按「视频原声」合成成片 ——
      if (!stopRef.current && autoRun && collected.length) {
        setBoardBusy(false);
        setOpenBoard(true); // 场表完成后保持展开：它是流式冒出来的，折叠会让人以为已经看完了
        await wardrobeJob; // 定妆照就位（与分镜并行跑，通常此刻早已完成）
        // 一键连跑到**场表**为止。关键帧改成可选：想先花几分钱看构图就点「先出关键帧」，
        // 不想等就直接出片——省掉一整轮出图的时间。出片按钮自带二次确认，不会替用户花钱。
      }
    } catch (e: any) {
      setErr(`分镜生成失败：${String(e?.message || e)}`);
      setShots((prev) => (prev && prev.length ? prev : null)); // 一镜都没出才清掉占位
    } finally {
      setBoardBusy(false);
      setStage("");
      if (creditsOn) void refreshBalance();
    }
  }

  function patchShot(i: number, patch: Partial<StoryboardShot>) {
    setShots((prev) => (prev ? prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) : prev));
  }

  // ===== 分镜手术刀：加/复制/调序/删（shotNo 是稳定内部键不重排；显示序号按位置算，视频/台词等挂件跟镜走）=====
  const newShotNo = () => "n" + Math.random().toString(36).slice(2, 7);
  function surgAdd(i: number) {
    const base = shots?.[i];
    const id = newShotNo();
    const blank = { shotNo: id, title: "", shotSize: base?.shotSize || "中景", cameraMove: base?.cameraMove || "固定镜头", content: "", duration: base?.duration || "8", env: base?.env || "" } as StoryboardShot;
    setShots((p) => { const arr = [...(p || [])]; arr.splice(i + 1, 0, blank); return arr; });
    if (base) setCastByShot((c) => ({ ...c, [id]: [...(c[base.shotNo] || [])] })); // 同场人物默认继承
  }
  function surgDup(i: number) {
    const src = shots?.[i];
    if (!src) return;
    const id = newShotNo();
    setShots((p) => { const arr = [...(p || [])]; arr.splice(i + 1, 0, { ...src, shotNo: id }); return arr; });
    setCastByShot((c) => ({ ...c, [id]: [...(c[src.shotNo] || [])] }));
    const bt = beatByShotRef.current[src.shotNo];
    if (bt) beatByShotRef.current[id] = { ...bt, shotNo: id };
  }
  function surgMove(i: number, dir: -1 | 1) {
    setShots((p) => {
      const arr = [...(p || [])];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return p;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }
  function surgDel(i: number) {
    const s0 = shots?.[i];
    if (!s0) return;
    if (videos[s0.shotNo]?.status === "done" && !window.confirm(`镜 ${i + 1} 已有生成好的视频（花过钱），删除后成片将不再包含它。确认删除？`)) return;
    setShots((p) => (p || []).filter((_, k) => k !== i));
  }

  // ② 故事骨架单独重做/remix：只花一次小请求，不动选角不动分镜
  async function genStoryOnly(note?: string) {
    const b = (brief || "").trim();
    if (!b) {
      setErr("先在①里描述故事/场景");
      return;
    }
    const genreV = GENRE_PRESETS.find((g) => g.key === genreKey)?.v || "";
    stopRef.current = false;
    setStopping(false);
    setStoryBusy(true);
    setStoryErr("");
    setErr("");
    try {
      const st = await generateStory(b, genreV, quirk, note);
      if (stopRef.current) return; // 已停止：丢弃结果
      setStoryLine(`时间：${st.time}；地点：${st.place}；人物：${st.characters}。起因：${st.cause} 经过：${st.process} 结局：${st.ending}`);
    } catch (e: any) {
      setStoryErr(String(e?.message || e).slice(0, 60));
      setErr(`故事骨架失败：${String(e?.message || e)}`);
    } finally {
      setStoryBusy(false);
      if (creditsOn) void refreshBalance();
    }
  }

  // 单镜重写：带原剧情点 + 上一镜现状 + 全片骨架 + 修改要求，只重写这一镜的文本
  async function reExpandShot(i: number) {
    const list = shots || [];
    const s0 = list[i];
    if (!s0) return;
    const bt = beatByShotRef.current[s0.shotNo] || { shotNo: s0.shotNo, title: s0.title, beat: (s0.content || "").slice(0, 40), cast: s0.cast || [] };
    const prev = i > 0 ? list[i - 1] : undefined;
    setReworking((r) => ({ ...r, [s0.shotNo]: true }));
    setErr("");
    try {
      const raw = await expandShot({
        beat: { ...bt, cast: s0.cast && s0.cast.length ? s0.cast : bt.cast || [] },
        character: characterRef.current || undefined,
        env: (s0.env || "").trim() || bt.env,
        style: stylePrefix,
        aspect,
        prevContent: prev?.content || "",
        prevEnv: prev?.env || "",
        outlineAll: olCompactRef.current.length ? olCompactRef.current : undefined,
        note: (reworkNote[s0.shotNo] || "").trim() || undefined,
        mustSpeak: (beatByShotRef.current[s0.shotNo]?.say || (s0.line ? s0.speaker : "") || "").trim() || undefined,
        prevLine: (prev?.line || "").trim() || undefined,
        adapt: scriptMode === "adapt" || undefined,
        synopsis: scriptMode === "adapt" ? brief.trim() : undefined,
      });
      setShots((cur) =>
        (cur || []).map((x, j) =>
          j === i ? { ...x, title: raw.title || x.title, shotSize: raw.shotSize || x.shotSize, cameraMove: raw.cameraMove || x.cameraMove, content: raw.content, duration: raw.duration || x.duration, speaker: raw.speaker, line: raw.line } : x
        )
      );
    } catch (e: any) {
      setErr(`重写失败（镜 ${s0.shotNo}）：${String(e?.message || e)}`);
    } finally {
      setReworking((r) => ({ ...r, [s0.shotNo]: false }));
    }
  }

  // 角色形象参考图（仅预览）：从外观描述生成正面半身像；同 desc 走缓存不重复扣费
  async function genOnePreview(id: string, descOverride?: string, sbOverride?: Subject, force = false) {
    // 自动选角后立即发车时，React 状态尚未提交、subjectsRef 里查无此人——必须允许直接传对象
    const sb = sbOverride || subjectsRef.current.find((x) => x.id === id);
    if (!sb) return;
    setPvErrs((m) => ({ ...m, [id]: "" }));
    if (sb.assetId) {
      // 真人活体角色：预览就是本人照片。文生图接口不认 asset://，按照片+描述画出来的是「另一个人」，会吓到用户；
      // 出片的脸由 asset 锁，预览不需要也不该再造一张脸。造型靠无头定妆照（genWardrobes）。
      setPreviews((pv) => ({ ...pv, [id]: sb.value.trim() }));
      return;
    }
    const desc = (descOverride ?? sb.desc ?? "").trim();
    if (!desc) {
      setErr(`先给「${sb.tag}」填外观描述，再生成参考图`);
      return;
    }
    const key = `${sb.value.trim()}|${desc}`;
    setPreviewBusy((b) => ({ ...b, [id]: true }));
    try {
      // force=用户点了 ↻，语义是「我不满意，换一张」——必须绕过缓存，否则原图又摆回来，看着像没反应
      let url = force ? "" : previewCacheRef.current[key] || "";
      if (!url) {
        // 角色像也喂真容照：③ 预览的脸与出片同源（不认参考图则回落纯文生）
        const pv = sb.value.trim();
        const prRefs: string[] = [];
        if (/^https?:/.test(pv)) prRefs.push(pv);
        else {
          const pr0 = CAST_PRESETS.find((x) => x.assetId === pv);
          if (pr0?.img) prRefs.push(new URL(pr0.img, location.origin).href);
        }
        const pPrompt = `角色形象参考照：正面半身人像，面向镜头，${desc}，姿态自然，纯浅灰色背景，摄影棚均匀布光，五官与服装细节清晰，写实摄影风格`;
        const pMdl = IMAGE_MODELS[0]?.id || "doubao-seedream-5-0-260128";
        if (prRefs.length) {
          try {
            url = await generateImage(pPrompt, pMdl, "2K", prRefs);
          } catch {
            url = await generateImage(pPrompt, pMdl, "2K");
          }
        } else {
          url = await generateImage(pPrompt, pMdl, "2K");
        }
        previewCacheRef.current[key] = url;
      }
      setPreviews((p) => ({ ...p, [id]: url }));
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 60);
      setPvErrs((m) => ({ ...m, [id]: msg }));
      setErr(`参考图失败（${sb.tag}）：${msg}`);
    } finally {
      setPreviewBusy((b) => ({ ...b, [id]: false }));
    }
  }
  function genPreviews(humans: Subject[]) {
    humans.forEach((h) => {
      void genOnePreview(h.id, undefined, h); // 直接传对象，绕开状态提交时差
    });
  }
  // ✎：把修改要求写进外观描述（事实源），再按新描述重生成参考图
  function applyPvNote(id: string) {
    const note = (pvNote[id] || "").trim();
    setPvOpen("");
    const sb = subjectsRef.current.find((x) => x.id === id);
    if (!sb) return;
    let newDesc = (sb.desc || "").trim();
    if (note) {
      newDesc = newDesc ? `${newDesc}，${note}` : note;
      updateSubject(id, { desc: newDesc });
      setPvNote((m) => ({ ...m, [id]: "" }));
    }
    void genOnePreview(id, newDesc);
  }

  // 为每个数字人生成「正面无头定妆照」：无头无发=不污染 asset 的脸和发型；正面=服装款式信息全给到
  async function genWardrobes(humans: Subject[]) {
    await Promise.all(
      humans.map(async (s) => {
        if (/^https?:\/\//.test(s.value.trim()) && !s.assetId) return; // 文生图角色：整图即定妆照，无需再出。真人活体角色 value 是证件照，不是定妆照，必须出
        const desc = (s.desc || "").trim();
        if (!desc) return;
        const key = `${s.value.trim()}|${desc}`;
        let url = wardrobeCacheRef.current[key] || "";
        if (!url) {
          try {
            url = await generateImage(
              `服装展示照，正面全身构图，画面顶部从肩膀开始裁切，绝不出现头部、面部和任何头发：${desc}。双手自然垂放身侧，纯浅灰色背景，摄影棚均匀布光，服装款式细节清晰，电商产品图风格`,
              IMAGE_MODELS[0]?.id || "doubao-seedream-5-0-260128",
              "2K"
            );
            wardrobeCacheRef.current[key] = url;
          } catch {
            return; // 失败静默：该角色本次退回单参考（只锁脸），不拦路
          }
        }
        wardrobeByIdRef.current[s.id] = url;
        setWardrobes((w) => ({ ...w, [s.id]: url }));
      })
    );
  }

  // 出片前人物校验：①镜里引用的代号必须在当前选角里（选角更新后旧镜引用会失效）；
  // ②描述改过而定妆照没跟上的，现场补拍（缓存键=资产|描述，改描述必产新键）。省的是"人物对不上白烧钱"。
  async function ensureCastFresh(targets: StoryboardShot[]): Promise<boolean> {
    const humans = subjectsRef.current.filter((x) => x.kind === "human");
    const known = new Set(humans.map((x) => x.tag));
    const missing: string[] = [];
    for (const s0 of targets) for (const t of s0.cast || []) if (t && !known.has(t) && !missing.includes(t)) missing.push(t);
    if (missing.length) {
      setErr(`出片前人物校验未通过：分镜里的「${missing.join("、")}」已不在当前选角名单（选角更新过）。请重拆分镜，或在各镜手改出场主角后再出片——没扣一分钱。`);
      return false;
    }
    const inShots = new Set<string>();
    for (const s0 of targets) for (const t of s0.cast || []) inShots.add(t);
    const stale = humans.filter((x) => {
      if (!inShots.has(x.tag)) return false;
      if (/^https?:\/\//.test(x.value.trim())) return false; // 文生图角色：整图即定妆照，永远新鲜
      const desc = (x.desc || "").trim();
      if (!desc) return false;
      const key = `${x.value.trim()}|${desc}`;
      const fresh = wardrobeCacheRef.current[key] || "";
      if (fresh) {
        if (wardrobeByIdRef.current[x.id] !== fresh) wardrobeByIdRef.current[x.id] = fresh; // 缓存有：直接换新
        return false;
      }
      return true; // 缓存无：描述改过，定妆照要补拍
    });
    if (stale.length) {
      setStage(`人物校验：${stale.map((x) => x.tag).join("、")} 的定妆照过期，按新形象补拍中…`);
      await genWardrobes(stale);
      setStage("");
    }
    return true;
  }

  // 一场有几个切点就出几张关键帧：这些图会按顺序喂回出片（官方「关键帧参考」），
  // 所以④确认的构图就是成片的构图——预览图从"看看而已"升级成"设计稿"。
  async function genOneFrame(shot: StoryboardShot, cutIdx = 0, cutText = ""): Promise<string | null> {
    const fkey = frameKey(shot.shotNo, cutIdx);
    // 并行防串台：切到别的作品后，本次分镜图不再写进当前画面（镜号跨作品撞键是事故源）
    const projAtStart = projIdRef.current;
    const sf = (fn: (f: Record<string, FrameState>) => Record<string, FrameState>) => {
      if (projIdRef.current === projAtStart) setFrames(fn);
    };
    // 真人活体角色的场不出关键帧：图片接口不认 asset://，关键帧里会画出别人的脸，
    // 再作为「关键帧对齐」喂回视频就和锁脸打架——宁可不预览，也不能把错脸送进出片。
    {
      const castNow = subjectsRef.current.filter((x) => (castByShot[shot.shotNo] || []).includes(x.tag));
      const rp = castNow.filter((x) => x.kind === "human" && x.assetId).map((x) => x.tag);
      if (rp.length) {
        sf((f) => ({ ...f, [fkey]: { status: "err", err: `本场有真人活体角色（${rp.join("、")}），关键帧会画出别人的脸并干扰锁脸，已跳过；直接出片即可` } }));
        return null;
      }
    }
    sf((f) => ({ ...f, [fkey]: { status: "gen" } }));
    // 与出片同一套提示词装配（人物外观绑定+场景锁定格式一致），预览图不再和成片"两套剧本"
    const subsNow0 = subjectsRef.current;
    const tags0 = castByShot[shot.shotNo] || [];
    const cast0 = subsNow0.filter((x) => tags0.includes(x.tag));
    const castDesc0 = cast0.map((x) => { const d = (x.desc || "").trim(); return d ? `${x.tag}（${d}）` : x.tag; }).join("；");
    const envLock0 = (shot.env || "").trim();
    const prompt = [stylePrefix, castDesc0, (cutText || "").trim() || shot.content, envLock0 ? `场景锁定：${envLock0}` : "", shot.shotSize].map((s) => (s || "").trim()).filter(Boolean).join("，");
    // 参考图并轨：预览也喂"脸+衣+产品"（与出片同一套输入源）。图片接口不认 asset://，数字人换花名册真容照
    const refImgs0: string[] = [];
    for (const cs of cast0) {
      const v = cs.value.trim();
      if (cs.kind === "product") {
        if (/^https?:/.test(v)) refImgs0.push(v);
        continue;
      }
      if (/^https?:/.test(v)) refImgs0.push(v); // 文生图造的角色：全身定妆照
      else {
        const pr = CAST_PRESETS.find((x) => x.assetId === v);
        if (pr?.img) refImgs0.push(new URL(pr.img, location.origin).href); // 数字人：花名册真容照
      }
      const w0 = wardrobeByIdRef.current[cs.id];
      if (w0) refImgs0.push(w0);
    }
    const refUse0 = refImgs0.slice(0, 4);
    try {
      let url = "";
      const mdl = IMAGE_MODELS[0]?.id || "doubao-seedream-5-0-260128";
      // 关键帧必须按目标画幅出：它会作为参考图喂回出片，方形关键帧会把成片按死在 1:1
      const px = aspectPx(aspect);
      const shoot = async (size: string) => {
        if (refUse0.length) {
          try {
            return await generateImage(prompt, mdl, size, refUse0);
          } catch {
            return await generateImage(prompt, mdl, size); // 上游不认参考图：回落纯文生（不劣于旧行为）
          }
        }
        return await generateImage(prompt, mdl, size);
      };
      try {
        url = await shoot(px);
      } catch (e) {
        if (px === "2048x2048") throw e;
        url = await shoot("2K"); // 上游不认这个尺寸：回落 2K 方图，至少出得来
      }
      sf((f) => ({ ...f, [fkey]: { status: "done", url } }));
      return url;
    } catch (e: any) {
      const msg = String(e?.message || e);
      sf((f) => ({ ...f, [fkey]: { status: "err", err: msg } }));
      setErr(`关键帧失败（场 ${shot.shotNo}${cutIdx ? " 第" + (cutIdx + 1) + "个切点" : ""}）：${msg}`);
      return null;
    }
  }

  async function genAllFrames(list?: StoryboardShot[]): Promise<Record<string, string>> {
    const targets = list ?? shots ?? [];
    const urls: Record<string, string> = {};
    if (!targets.length) return urls;
    stopRef.current = false;
    setStopping(false);
    setFramesBusy(true);
    if (autoRun) setOpenFrames(true);
    setErr("");
    // 批量侧同款防串台守卫
    const projAtBatch = projIdRef.current;
    const sfb = (fn: (f: Record<string, FrameState>) => Record<string, FrameState>) => {
      if (projIdRef.current === projAtBatch) setFrames(fn);
    };
    // 并发生成，谁先好谁先回填（总时长≈最慢一张）
    await Promise.all(
      targets.flatMap((shot) => {
        const content = (shot.content || "").trim();
        if (!content) {
          sfb((f) => ({ ...f, [shot.shotNo]: { status: "err", err: "无画面内容" } }));
          return [];
        }
        const cuts = parseCuts(content);
        const jobs = cuts.length >= 2 ? cuts.map((c, ci) => ({ ci, text: c.text })) : [{ ci: 0, text: "" }];
        return jobs.map(async ({ ci, text }) => {
          if (stopRef.current) return; // 停止：这张不再发起
          const u = await genOneFrame(shot, ci, text);
          if (u) urls[frameKey(shot.shotNo, ci)] = u;
        });
      })
    );
    setFramesBusy(false);
    if (autoRun) setOpenFrames(false);
    return urls;
  }

  // ④ 的槽位 = 每场每个切点一张关键帧（一镜到底的场只有一张）
  const frameSlots = (shots || []).flatMap((s) => {
    const cuts = parseCuts(s.content || "");
    return cuts.length >= 2
      ? cuts.map((c, ci) => ({ shot: s, ci, key: frameKey(s.shotNo, ci), label: `${c.start}-${c.end}s`, text: c.text }))
      : [{ shot: s, ci: 0, key: s.shotNo, label: `0-${sceneSec(s)}s`, text: (s.content || "").trim() }];
  });
  const doneCount = frameSlots.filter((x) => frames[x.key]?.status === "done").length;

  // ④ 视频
  type VidState = { status: "idle" | "gen" | "done" | "err"; url?: string; err?: string; taskId?: string; at?: number };
  const [videos, setVideos] = useState<Record<string, VidState>>({});
  const [videoBusy, setVideoBusy] = useState(false);
  // remix：每镜可挂一条「纠正要求」，重做时强拼进提示词（治"屏幕装反"这类模型系统性错误——纯重做提示词没变，错会原样再犯）
  const [fixByShot, setFixByShot] = useState<Record<string, string>>({});
  const [fixOpen, setFixOpen] = useState("");
  // ⑥ 成片
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [exportUrl, setExportUrl] = useState("");

  // ===== 作品持久化：自动保存 localStorage + 我的作品 + 视频断点续传 =====
  const PROJ_REG = "ez.projects";
  const PROJ_CUR = "ez.currentProject";
  const projIdRef = useRef("");
  const restoringRef = useRef(true); // 初始装载期间不触发保存
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projects, setProjects] = useState<{ id: string; title: string; updatedAt: number }[]>([]);
  const [projOpen, setProjOpen] = useState(false);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmtTime = () => {
    const d = new Date();
    return `作品 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const [renamingId, setRenamingId] = useState("");
  const [renameVal, setRenameVal] = useState("");
  const [lightbox, setLightbox] = useState(""); // 点击图片放大预览
  function renameProject(id: string, name: string) {
    const t = name.trim();
    setRenamingId("");
    if (!t) return;
    const reg = loadReg().map((x) => (x.id === id ? { ...x, title: t.slice(0, 24) } : x));
    saveReg(reg);
    setProjects(reg);
  }
  const loadReg = (): { id: string; title: string; updatedAt: number }[] => {
    try {
      return JSON.parse(localStorage.getItem(PROJ_REG) || "[]");
    } catch {
      return [];
    }
  };
  const saveReg = (r: { id: string; title: string; updatedAt: number }[]) => {
    try {
      localStorage.setItem(PROJ_REG, JSON.stringify(r.slice(0, 50)));
    } catch {}
  };
  function persistNow() {
    const id = projIdRef.current;
    if (!id || restoringRef.current) return;
    if (!(brief.trim() || storyLine.trim() || (shots && shots.length))) return;
    try {
      const snap = {
        v: 1, brief, genreKey, quirk, styleKey, autoStyle, styleCustom, shotCount, bandLo, useStory, aspect, scriptMode, videoRes, draftMode, filmLang, i18nLines, refVideoUrl, refStyleImg, refUses, refAudioUrl, refAudioUse, refAudioCast, entryMode, footage, footageSec, footageKeep,
        storyLine, subjects, previews, wardrobes, envKit,
        shots, plannedCount, frames, videos, castByShot,
        olCompact: olCompactRef.current, beatByShot: beatByShotRef.current, character: characterRef.current,
        wardrobeById: wardrobeByIdRef.current,
      };
      localStorage.setItem(`ez.proj.${id}`, JSON.stringify(snap));
      const prev0 = loadReg().find((x) => x.id === id);
      const title = prev0?.title || fmtTime(); // 默认=创建（首存）时间；用户改过的名字机器不碰
      const reg = loadReg().filter((x) => x.id !== id);
      reg.unshift({ id, title, updatedAt: Date.now() });
      saveReg(reg);
      setProjects(reg);
      localStorage.setItem(PROJ_CUR, id);
    } catch {}
  }
  function applySnapshot(p: any) {
    restoringRef.current = true;
    setBrief(p.brief || "");
    setGenreKey(p.genreKey || "auto");
    setQuirk(typeof p.quirk === "number" ? p.quirk : 50);
    setStyleKey(p.styleKey || "auto");
    setAutoStyle(typeof p.autoStyle === "string" ? p.autoStyle : "");
    setStyleCustom(p.styleCustom || "");
    setShotCount(typeof p.shotCount === "number" ? p.shotCount : "");
    setBandLo(Number(p.bandLo) >= 10 && Number(p.bandLo) <= 170 ? Math.round(Number(p.bandLo) / 10) * 10 : 30);
    setUseStory(!!p.useStory);
    setAspect(p.aspect === "9:16" || p.aspect === "1:1" ? p.aspect : "16:9");
    setEnvKit(Array.isArray(p.envKit) ? p.envKit : []);
    setScriptMode(p.scriptMode === "adapt" ? "adapt" : "create");
    setVideoRes(p.videoRes === "1080p" ? "1080p" : "720p");
    setDraftMode(!!p.draftMode);
    setRefVideoUrl(typeof p.refVideoUrl === "string" ? p.refVideoUrl : "");
    setRefStyleImg(typeof p.refStyleImg === "string" ? p.refStyleImg : "");
    setRefUses(Array.isArray(p.refUses) ? p.refUses.filter((x: any) => typeof x === "string") : []);
    setRefAudioUrl(typeof p.refAudioUrl === "string" ? p.refAudioUrl : "");
    setRefAudioUse(p.refAudioUse === "音色" || p.refAudioUse === "配乐风格" ? p.refAudioUse : "");
    setRefAudioCast(typeof p.refAudioCast === "string" ? p.refAudioCast : "");
    setFilmLang(typeof p.filmLang === "string" && LANGS.some((l) => l.code === p.filmLang) ? p.filmLang : "zh");
    setI18nLines(p.i18nLines && typeof p.i18nLines === "object" ? p.i18nLines : {});
    setEntryMode(p.entryMode === "footage" ? "footage" : "story");
    setFootage(Array.isArray(p.footage) ? p.footage.filter((x: any) => typeof x === "string") : []);
    setFootageSec([10, 15, 20, 30].includes(Number(p.footageSec)) ? Number(p.footageSec) : 15);
    setFootageKeep(p.footageKeep !== false);
    setStoryLine(p.storyLine || "");
    setSubjects(Array.isArray(p.subjects) ? p.subjects : []);
    setPreviews(p.previews || {});
    setWardrobes(p.wardrobes || {});
    setShots(Array.isArray(p.shots) && p.shots.length ? p.shots : null);
    setPlannedCount(p.plannedCount || 0);
    setFrames(p.frames || {});
    // 切换作品即清瞬态旗标与提示——上一作品在途任务的写入已被 projAtStart 守卫丢弃，busy 不许跨作品残留
    setFramesBusy(false);
    setVideoBusy(false);
    setStage("");
    setErr("");
    setCastByShot(p.castByShot || {});
    olCompactRef.current = Array.isArray(p.olCompact) ? p.olCompact : [];
    beatByShotRef.current = p.beatByShot || {};
    characterRef.current = p.character || "";
    wardrobeByIdRef.current = p.wardrobeById || {};
    setErr("");
    setExportUrl(""); // 成片是本地文件不跨会话；视频链接都在，重新合成免费且只要几秒
    // 视频：done 保留；gen+taskId 断点续传；gen 无 taskId 标错可↻
    const vids: Record<string, VidState> = {};
    const resume: { shotNo: string; taskId: string }[] = [];
    Object.entries((p.videos || {}) as Record<string, any>).forEach(([no, v]) => {
      if (v?.status === "done") vids[no] = v;
      else if (v?.status === "gen" && v?.taskId) {
        vids[no] = v;
        resume.push({ shotNo: no, taskId: v.taskId });
      } else if (v?.status === "gen" && v?.url) vids[no] = { status: "done", url: v.url, at: v.at }; // 重出中断：回滚旧片
      else if (v?.status === "gen") vids[no] = { status: "err", err: "生成被页面刷新打断，点↻重出" };
      else if (v) vids[no] = v;
    });
    setVideos(vids);
    setTimeout(() => {
      restoringRef.current = false;
    }, 0);
    // 断点续传：钱已花，把成果接回来
    const projAtLoad = projIdRef.current;
    resume.forEach(({ shotNo, taskId }) => {
      pollVideoUntilDone(taskId, VID_MODEL, () => {}, () => false, { maxAttempts: 420 })
        .then((url) => {
          if (projIdRef.current !== projAtLoad) return;
          setVideos((v) => ({ ...v, [shotNo]: { status: "done", url, at: Date.now() } }));
        })
        .catch((e: any) => {
          if (projIdRef.current !== projAtLoad) return;
          setVideos((v) => {
            const keep = v[shotNo]?.url;
            if (keep) return { ...v, [shotNo]: { status: "done", url: keep, at: v[shotNo]?.at } };
            return { ...v, [shotNo]: { status: "err", err: String(e?.message || e) } };
          });
        });
    });
  }
  function openProject(id: string) {
    persistNow();
    try {
      const raw = localStorage.getItem(`ez.proj.${id}`);
      if (!raw) return;
      projIdRef.current = id;
      localStorage.setItem(PROJ_CUR, id);
      applySnapshot(JSON.parse(raw));
      setProjOpen(false);
      setResumeHint(false);
    } catch {}
  }
  function sequelProject() {
    // 续拍新一集：人物（转手动，重拆不作废）、定妆/预览、场景库、风格设置全带走；正文清空
    persistNow();
    const keepEnvs = Array.from(new Set((shots || []).map((x) => (x.env || "").trim()).filter(Boolean))).slice(0, 6);
    const keep: any = {
      subjects: subjects.map((x) => ({ ...x, auto: false })),
      previews: { ...previews },
      wardrobes: { ...wardrobes },
      wardrobeById: { ...wardrobeByIdRef.current },
      envKit: keepEnvs,
      styleKey, styleCustom, aspect, genreKey, quirk,
    };
    projIdRef.current = newId();
    localStorage.setItem(PROJ_CUR, projIdRef.current);
    applySnapshot(keep);
    setProjOpen(false);
    setResumeHint(false);
  }
  function newProject() {
    persistNow();
    projIdRef.current = newId();
    localStorage.setItem(PROJ_CUR, projIdRef.current);
    applySnapshot({});
    setProjOpen(false);
  }
  function deleteProject(id: string) {
    try {
      localStorage.removeItem(`ez.proj.${id}`);
    } catch {}
    const reg = loadReg().filter((x) => x.id !== id);
    saveReg(reg);
    setProjects(reg);
    if (projIdRef.current === id) {
      projIdRef.current = newId();
      localStorage.setItem(PROJ_CUR, projIdRef.current);
      applySnapshot({});
    }
  }
  const [resumeHint, setResumeHint] = useState(false);
  useEffect(() => {
    // 交互哲学：工作台=画板，作品列表=仓库——刷新即清屏（先落盘再清），仓库兜底
    const reg = loadReg();
    setProjects(reg);
    if (reg.length) setResumeHint(true);
    projIdRef.current = newId();
    localStorage.setItem(PROJ_CUR, projIdRef.current);
    setTimeout(() => {
      restoringRef.current = false;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 离页前强制落盘：自动保存有 0.8s 防抖，改完立刻刷新也不许丢最后一笔
  useEffect(() => {
    const flush = () => persistNow();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });
  useEffect(() => {
    if (restoringRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(persistNow, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, genreKey, quirk, styleKey, autoStyle, styleCustom, shotCount, bandLo, useStory, aspect, envKit, scriptMode, videoRes, draftMode, filmLang, i18nLines, refVideoUrl, refStyleImg, refUses, refAudioUrl, refAudioUse, refAudioCast, entryMode, footage, footageSec, footageKeep, storyLine, subjects, previews, wardrobes, shots, plannedCount, frames, videos, castByShot]);


  // 平台错误翻译成可操作中文（写实人脸被安全策略拦下的 400）
  function friendlyVideoErr(e: any): string {
    // 平台给了原因就原样透传——替它猜原因害人（赛博朋克撸猫片被我们说成"内容审核"过一次）
    const s = String(e?.message || e || "");
    if (/AccountOverdue|overdue|insufficient|balance|欠费|余额|arrears/i.test(s)) return "账户余额不足，请充值后重试。";
    if (/Failed to fetch|NetworkError|Load failed|ERR_NETWORK/i.test(s)) return "请求没发出去（网络瞬断或服务刚重启），等几秒点 ↻ 重试这镜即可。";
    if (/SensitiveContent|PrivacyInformation|real person|sensitive|涉敏|违规/i.test(s)) return "这镜被平台安全策略拦下（图片或文案涉敏），换个说法或主体图再试。";
    // 上游网关抖动：零克云把它上游的 502 包成业务错误回来，整段 nginx HTML 糊在界面上没人看得懂
    // 素材未登记：这是永久性业务错误，跟网关无关——直接点名是哪个数字人坏了
    const badAsset = s.match(/asset-[0-9a-z-]+/i)?.[0];
    if (/asset_classify_failed|未登记|不属于当前令牌/.test(s)) {
      // 排查期：把服务端回传的真实请求结构一并显示，别再靠猜
      const shape = s.match(/实际请求=[\s\S]*/)?.[0] || (s.length > 120 ? "原始：" + s.slice(0, 500) : "");
      return `选中的数字人在当前账号下不可用${badAsset ? `（${badAsset}）` : ""}。换一个数字人，或用「+ 贴图片URL当角色」自备形象图。${shape ? "\n\n" + shape : ""}`;
    }
    if (/bad gateway|gateway time-?out|\b50[0-9]\b|<html/i.test(s) && !/\b4[0-9]{2}\b/.test(s)) {
      // 指纹（[参考图N张·…]）是排查反复失败的唯一线索，必须原样透出来，别被友好文案盖掉
      const fp = s.match(/\[[^\]]*(图源|参考图)[^\]]*\]/)?.[0] || "";
      if (!fp) return `上游通道暂时不通（网关 502）。原始信息：${s.slice(0, 220)}`; // 没抓到指纹就把原文透出来，别把线索吃掉
      return `上游通道暂时不通（网关 502，不是你的内容有问题），已自动退避重试 4 次。${fp ? " " + fp : ""} 等一两分钟点 ↻ 重出这场；若总是同一场挂，把方括号里这串发给开发。`;
    }
    if (/fail_to_fetch_task/i.test(s)) return "平台未能完成这镜。若多镜同时失败，多半是账户余额不足或上游繁忙——先查充值；单镜偶发则稍后重试。";
    return s.length > 120 ? s.slice(0, 120) + "…" : s;
  }

  async function genOneVideo(
    shot: StoryboardShot,
    o?: { castTags?: string[]; frameUrl?: string; lang?: string; aspect?: string; sink?: (url: string) => void }
  ): Promise<string | null> {
    // 变体出片（批量用）：换语种/画幅，结果交给 sink，不写主 videos 表也不动界面状态
    const useLang = o?.lang || filmLang;
    const useAspect = o?.aspect || aspect;
    const solo = !!o?.sink; // 变体模式
    // 这镜出现的主角 → 参考图（数字人=asset://，产品=图URL）+ 描述拼进 prompt
    const subsNow = subjectsRef.current;
    const tags = o?.castTags ?? (castByShot[shot.shotNo] || []);
    const cast = subsNow.filter((s) => tags.includes(s.tag) && s.value.trim());
    // 参考图三层：asset(锁脸+发型) > 产品图 > 定妆照(锁服装款式)；Seedance 2.5 参考图上限 30 张
    const assetRefs: string[] = [];
    const productRefs: string[] = [];
    const wardrobeRefs: string[] = [];
    // 带标签组装：URL 人物（上传/文生图角色）要在提示词里按图索引点名，否则模型会把几张脸调和成"平均人"
    const refItems: { url: string; label: string }[] = [];
    const wardrobeItems: { url: string; label: string }[] = [];
    const productItems: { url: string; label: string }[] = [];
    for (const cs of cast) {
      if (cs.kind === "human") {
        if (cs.assetId) {
          refItems.push({ url: "asset://" + cs.assetId, label: "" }); // 真人活体素材：平台原生锁脸，不送照片、无需提示词绑定
        }
        else if (/^https?:\/\//.test(cs.value.trim())) refItems.push({ url: cs.value.trim(), label: `${cs.tag}本人（五官、发型、体型必须与该图完全一致，不得改变或美化）` });
        else {
          const pimg = presetImg(cs.value.trim());
          if (pimg) {
            // 多角度参考：正脸 + 四分之三侧 + 侧面一起送。单张正脸会"正脸像、侧脸漂"，
            // 2.5 的主体参考吃多图，三个角度给足，转头和大动作时脸才稳。
            const angles: string[] = ((CAST_ANGLES as Record<string, string[]>)[cs.value.trim()] || []).map((u) =>
              /^https?:\/\//.test(u) ? u : (typeof window !== "undefined" ? window.location.origin : "") + u
            );
            refItems.push({ url: pimg, label: `${cs.tag}本人正面（五官、发型、体型必须与该图完全一致，不得改脸）` });
            if (angles[0]) refItems.push({ url: angles[0], label: `${cs.tag}本人四分之三侧面（同一个人，用于转头时对齐）` });
            if (angles[1]) refItems.push({ url: angles[1], label: `${cs.tag}本人侧面（同一个人，用于侧身时对齐）` });
          }
          else refItems.push({ url: "asset://" + cs.value.trim(), label: "" }); // 平台数字人：原生锁脸，无需提示词绑定
        }
        const w = wardrobeByIdRef.current[cs.id];
        if (w) wardrobeItems.push({ url: w, label: `${cs.tag}的服装定妆照（服装款式与颜色以此为准）` });
      } else {
        productItems.push({ url: cs.value.trim(), label: `产品「${cs.tag}」实物图（产品外观必须与图一致）` });
      }
    }
    // 关键帧参考：本场每个切点已出的预览图，按时间顺序排在参考图最前面——
    // 官方要求「以图片 1 至图片 N 的顺序作为关键帧」，编号必须与 refs 数组顺序严丝合缝。
    const myCuts = parseCuts(shot.content || "");
    const kfItems: { url: string; label: string }[] = [];
    if (myCuts.length >= 2) {
      for (let ci = 0; ci < myCuts.length; ci++) {
        const fu = frames[frameKey(shot.shotNo, ci)];
        if (fu?.status === "done" && fu.url) {
          kfItems.push({ url: fu.url, label: `第${ci + 1}个切点（${myCuts[ci].start}-${myCuts[ci].end}秒）的画面` });
        } else {
          kfItems.length = 0; // 缺一张就整套不用：顺序断了的关键帧比没有更糟
          break;
        }
      }
    }
    // 风格参考图排在最后：前面的编号（关键帧、人物、产品）保持稳定，@图片N 不会错位
    const styleItems = refStyleImg.trim() && refUses.length ? [{ url: refStyleImg.trim(), label: "" }] : [];
    const refItemsAll = [...kfItems, ...refItems, ...productItems, ...wardrobeItems, ...styleItems].slice(0, 30);
    const refs = refItemsAll.map((x) => x.url);
    const refMap = refItemsAll.map((x, ix) => (x.label ? `@图片${ix + 1}=${x.label}` : "")).filter(Boolean).join("；");
    const kfCount = kfItems.length;
    // 外观已逐出 content（那里只叫代号）——这里必须「代号（外观）」绑定注入，否则双人镜头分不清谁是谁
    const castDesc = cast
      .map((s) => {
        const d = (s.desc || "").trim();
        // 真人活体角色：脸由 asset 锁，头部造型/服装靠这句话 + 定妆照锁（每场独立生成，不点名必漂）
        if (s.assetId) return `${s.tag}（${d || "本人"}；头部造型、发型、头饰与服装全片锁定，每场必须与此描述及定妆照完全一致）`;
        return d ? `${s.tag}（${d}）` : s.tag;
      })
      .join("；");
    const envLock = (shot.env || "").trim();
    // 跨场是跨调用，模型看不见上一场——只把上一场结尾一句递过去接戏
    const allShots = shots || [];
    const myIdx = allShots.findIndex((x) => x.shotNo === shot.shotNo);
    const prevTail = myIdx > 0 ? (allShots[myIdx - 1].content || "").trim().slice(-60) : "";
    const dropped = (shot.lines || []).filter((l) => (l.speaker || "").trim() && (l.line || "").trim());
    // 一场 = 一次生成：场内时间轴由分镜大脑写进 content，这里只套头尾并把台词占位填实
    // 非中文出片：把台词换成译文再编译（原场对象不动，③里显示的仍是原文+译文两行）
    const shotForGen: StoryboardShot =
      useLang === "zh"
        ? shot
        : {
            ...shot,
            line: (shot.line || "").trim() ? lineFor(shot, 0, (shot.line || "").trim()) : shot.line,
            lines: (shot.lines || []).map((l, ix) => ({ ...l, line: lineFor(shot, ix, (l.line || "").trim()) })),
          };
    const { prompt: vp } = buildScenePrompt(shotForGen, {
      stylePrefix,
      castDesc,
      refMap,
      env: envLock,
      beat: (beatByShotRef.current[shot.shotNo]?.beat || "").trim(),
      fix: (fixByShot[shot.shotNo] || "").trim(),
      prevTail,
      aspect: useAspect,
      lang: useLang,
      refVideoUse: refVideoUrl.trim() && refUses.length ? refUses : undefined,
      refStyleImg: !!(refStyleImg.trim() && refUses.length),
      refAudioUse: refAudioUrl.trim() ? refAudioUse : undefined,
      refAudioCast: refAudioUse === "音色" ? refAudioCast : undefined,
      keyframeCount: kfCount,
    });
    // 并行防串台：切到别的作品后，本次任务的结果不再写进当前画面（回原作品时凭 taskId 断点续传接回）
    const projAtStart = projIdRef.current;
    const sv = (fn: (v: Record<string, VidState>) => Record<string, VidState>) => {
      if (!solo && projIdRef.current === projAtStart) setVideos(fn); // 变体出片不动主表
    };
    sv((v) => ({ ...v, [shot.shotNo]: { status: "gen", url: v[shot.shotNo]?.url } })); // 重出期间旧片随身携带，失败可回滚
    setErr((cur) => (cur.startsWith(`视频失败（镜 ${shot.shotNo}）`) ? "" : cur)); // 重做即清这镜的旧报错：再失败会重新报，成功了就不再纠缠
    try {
      let taskId: string;
      if (subsNow.length || kfCount >= 2) {
        // 有主角：用参考图生成（可多个同框），不用关键帧首帧（生成图当首帧会被判 real person）
        taskId = await submitVideo({ referenceImageUrls: refs, sourceVideoUrls: refVideoUrl.trim() && refUses.length ? [refVideoUrl.trim()] : undefined, referenceAudioUrls: refAudioUrl.trim() && refAudioUse ? [refAudioUrl.trim()] : undefined, prompt: vp, model: VID_MODEL, resolution: videoRes, draft: draftMode, duration: String(Math.min(maxSceneSec, Math.max(4, Math.round(parseFloat(String(shot.duration)) || 5)))), ratio: useAspect });
      } else {
        const frUrl = o?.frameUrl || frames[shot.shotNo]?.url;
        if (!frUrl) {
          sv((v) => ({ ...v, [shot.shotNo]: { status: "err", err: "无关键帧，先生成关键帧" } }));
          return null;
        }
        taskId = await submitVideo({ firstImageUrl: frUrl, prompt: vp, model: VID_MODEL, resolution: videoRes, draft: draftMode, duration: String(Math.min(maxSceneSec, Math.max(4, Math.round(parseFloat(String(shot.duration)) || 5)))), ratio: useAspect });
      }
      sv((v) => ({ ...v, [shot.shotNo]: { status: "gen", taskId, url: v[shot.shotNo]?.url } })); // 记 taskId：页面刷新后可断点续传（旧片继续携带）
      const url = await pollVideoUntilDone(taskId, VID_MODEL, () => {}, () => false, {
        intervalMs: 4000 + Math.floor(Math.random() * 2500), // 轮询抖动：并行任务错开节拍
        maxAttempts: (parseFloat(String(shot.duration)) || 5) >= 20 ? 420 : 220, // 20/30秒长镜生成慢+排队：预算放到约35分钟
      });
      sv((v) => ({ ...v, [shot.shotNo]: { status: "done", url, at: Date.now() } }));
      if (o?.sink) o.sink(url); // 变体出片：结果交给批量面板
      return url;
    } catch (e: any) {
      sv((v) => {
        const keep = v[shot.shotNo]?.url;
        if (keep) {
          setErr(`镜 ${shot.shotNo} 重出失败（已保留上一版成片）：${friendlyVideoErr(e)}`);
          return { ...v, [shot.shotNo]: { status: "done", url: keep, at: v[shot.shotNo]?.at } };
        }
        return { ...v, [shot.shotNo]: { status: "err", err: friendlyVideoErr(e) } };
      });
      setErr(`视频失败（镜 ${shot.shotNo}）：${friendlyVideoErr(e)}`);
      return null;
    }
  }

  // 局部修补：把这一场已出的成片当 reference_video 丢回去，只改指定时段的内容。
  // 官方编辑任务会锁定输出的画幅与时长（严格对齐待编辑视频），所以改完不会走形。
  async function genEditScene(shot: StoryboardShot): Promise<void> {
    const cur = videos[shot.shotNo];
    if (!cur || cur.status !== "done" || !cur.url) return;
    if (vidExpired(cur)) {
      setErr(`场 ${shot.shotNo} 的视频链接已过期（平台只存 24 小时），没法拿它当修补底片——先 ↻ 重出这场。`);
      return;
    }
    const cuts = parseCuts(shot.content || "");
    const cut = editCut >= 0 && cuts[editCut] ? cuts[editCut] : null;
    const vp = buildEditPrompt(editText, cut);
    if (!vp) return;

    const projAtStart = projIdRef.current;
    const sv = (fn: (v: Record<string, VidState>) => Record<string, VidState>) => { if (projIdRef.current === projAtStart) setVideos(fn); };
    setVideoBusy(true);
    setErr("");
    sv((v) => ({ ...v, [shot.shotNo]: { status: "gen", url: v[shot.shotNo]?.url, at: v[shot.shotNo]?.at } })); // 底片随身，失败可回滚
    try {
      const taskId = await submitVideo({ sourceVideoUrls: [cur.url], prompt: vp, model: VID_MODEL, resolution: videoRes, draft: draftMode, editMode: true });
      sv((v) => ({ ...v, [shot.shotNo]: { status: "gen", taskId, url: v[shot.shotNo]?.url, at: v[shot.shotNo]?.at } }));
      const url = await pollVideoUntilDone(taskId, VID_MODEL, () => {}, () => false, { intervalMs: 5000, maxAttempts: 420 });
      sv((v) => ({ ...v, [shot.shotNo]: { status: "done", url, at: Date.now() } }));
      setEditShot("");
      setEditText("");
    } catch (e: any) {
      sv((v) => {
        const keep = v[shot.shotNo]?.url;
        return keep
          ? { ...v, [shot.shotNo]: { status: "done", url: keep, at: v[shot.shotNo]?.at } } // 修补失败：原片原样留着
          : { ...v, [shot.shotNo]: { status: "err", err: friendlyVideoErr(e) } };
      });
      setErr(`修补失败（场 ${shot.shotNo}，原片已保留）：${friendlyVideoErr(e)}`);
    } finally {
      setVideoBusy(false);
      if (creditsOn) void refreshBalance();
    }
  }

  async function genAllVideos(list?: StoryboardShot[], castMap?: Record<string, string[]>, frameUrls?: Record<string, string>): Promise<Record<string, string>> {
    const urls: Record<string, string> = {};
    const base = list ?? shots ?? [];
    if (!base.length) return urls;
    stopRef.current = false;
    setStopping(false);
    setVideoBusy(true);
    if (autoRun) setOpenVideos(true);
    setErr("");
    // 有主角：全部镜头直接出片（不依赖关键帧）；文生：只对有关键帧的镜头
    const subsNow = subjectsRef.current;
    // 关键帧是可选的：有就当首帧/关键帧参考用，没有就纯文生视频直接出——不再拦路
    const targets = base;
    // 出片前人物校验：名单对不上或定妆照过期，先修正再花钱
    if (!(await ensureCastFresh(targets))) {
      setVideoBusy(false);
      if (autoRun) setOpenVideos(false);
      return urls;
    }
    // 保护性提醒：积分启用时先算总价，不够先充值——一分钱不花地拦下
    if (creditsOn && !acctMaster) {
      const need = targets.reduce((sum, x) => sum + Math.min(30, Math.max(4, parseFloat(String(x.duration)) || 5)) * 20, 0);
      try {
        const st = await accountStatus();
        const bal = typeof st.balance === "number" ? st.balance : -1;
        if (!st.master && bal >= 0) {
          setBalance(bal);
          if (bal < need) {
            setErr(`保护性提醒：本次出片共需 ${need} 积分（按秒×20），当前余额 ${bal}，还差 ${need - bal}。先在①顶部输入充值码充值，再出片。`);
            setVideoBusy(false);
            if (autoRun) setOpenVideos(false);
            return urls;
          }
        }
      } catch {}
    }
    // 并发出片，但设上限。502 单场提交时也出现过，所以它主要是网关瞬时抖动、不是并发撑爆
    // （治它的是 submit 路由那条 2s→8s→20s 的长退避）。上限是保险：官方限流个人档 3、企业档 10，
    // 零克云给 ED 的实际额度仍未谈定；Hugo 定为 6，撞额度时靠长退避兜住。
    const LANES = 5; // 官方建议单账号并发 ≤ 5
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(LANES, targets.length) }, async (_x, lane) => {
        if (lane) await new Promise((res) => setTimeout(res, lane * 600)); // 错峰起跑，别同一毫秒撞网关
        while (true) {
          const i2 = cursor++;
          if (i2 >= targets.length || stopRef.current) return;
          const s = targets[i2];
          const u = await genOneVideo(s, { castTags: castMap?.[s.shotNo], frameUrl: frameUrls?.[s.shotNo] });
          if (u) urls[s.shotNo] = u;
        }
      })
    );
    setVideoBusy(false);
    if (autoRun) setOpenVideos(false);
    if (creditsOn) void refreshBalance();
    return urls;
  }

  // 平台视频 URL 只存活 24 小时（官方：任务记录 7 天、视频 URL 24 小时、下载上限 100 次）。
  // 作品存在 localStorage 里，隔天回来链接就是 404——必须让用户在合成/播放之前就知道。
  const VIDEO_TTL_MS = 24 * 3600 * 1000;
  const vidExpired = (v?: VidState) => !!(v && v.status === "done" && v.at && Date.now() - v.at > VIDEO_TTL_MS);
  const vidHoursLeft = (v?: VidState) => (v?.at ? Math.max(0, (VIDEO_TTL_MS - (Date.now() - v.at)) / 3600000) : -1);
  const doneVideoCount = shots ? shots.filter((s) => videos[s.shotNo]?.status === "done").length : 0;
  const videoTargetCount = hasSubjects ? (shots?.length || 0) : doneCount; // ④ 进度分母
  const payBlocked = VIDEO_LOCKED;
  const busyAll = boardBusy || framesBusy || videoBusy || exporting; // 全流水线忙：连跑期间中间按钮统一置灰

  async function doExport(list?: StoryboardShot[], urlMap?: Record<string, string>) {
    const src = list ?? shots;
    if (!src) return;
    const doneShots = src.filter((s) => urlMap?.[s.shotNo] || (videos[s.shotNo]?.status === "done" && videos[s.shotNo]?.url));
    const ordered = doneShots.map((s) => urlMap?.[s.shotNo] || videos[s.shotNo]!.url!);
    if (!ordered.length) {
      setErr("还没有已生成的视频可拼。");
      return;
    }
    // 过期镜拦截：让它明确失败在这里，而不是让 ffmpeg 拉 404 之后神秘失败
    const staleNos = doneShots.filter((s) => !urlMap?.[s.shotNo] && vidExpired(videos[s.shotNo])).map((s) => s.shotNo);
    if (staleNos.length) {
      setErr(`镜 ${staleNos.join("、")} 的视频链接已过期（平台视频只存 24 小时），先点这几镜的 ↻ 重出，再合成。`);
      return;
    }

    const totalSec = doneShots.reduce((sum, s) => sum + (parseFloat(String(s.duration)) || 5), 0);
    setExporting(true);
    setExportUrl("");
    try {
      const blob = await concatVideos(ordered, { totalSec, onProgress: setExportMsg });
      setExportUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      setErr(`拼接失败：${String(e?.message || e)}`);
    } finally {
      setExporting(false);
      setExportMsg("");
    }
  }

  return (
    <div style={page} className="ezd">
      <style>{`
        .ezd { -webkit-text-size-adjust: 100%; }
        .ezd * { -webkit-tap-highlight-color: transparent; }
        @media (max-width: 640px) {
          .ezd input, .ezd select, .ezd textarea { font-size: 16px !important; } /* iOS：<16px 聚焦会自动放大页面 */
          .ezd select { height: auto !important; min-height: 30px; }
          .ezd .ezc { padding: 16px 12px 0 !important; }
          .ezd .ezshotrow { row-gap: 6px; }
          .ezd button { min-height: 30px; }
        }
      `}</style>
      {/* 顶栏 */}
      <header style={topbar}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontWeight: 800, fontSize: 17, color: "#16181d" }}>Easy-ADs</span>
          <span style={{ fontSize: 12, color: "#8b8f98" }}>丢素材，出广告 · 工作台</span>
            <span style={{ fontSize: 11, color: "#c3c7cf", marginLeft: 8, fontVariantNumeric: "tabular-nums" }}>{ED_VERSION}</span>
        </div>
        <div style={{ position: "relative" }}>
          <button onClick={() => setProjOpen((v) => !v)} style={{ height: 32, padding: "0 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            我的作品 ▾
          </button>
          {projOpen ? (
            <div style={{ position: "absolute", right: 0, top: 38, width: "min(300px, calc(100vw - 24px))", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)", padding: 8, zIndex: 50 }}>
              <button onClick={newProject} style={{ width: "100%", height: 34, borderRadius: 8, border: "1px dashed #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 6 }}>
                ＋ 新作品
              </button>
              <button onClick={sequelProject} style={{ width: "100%", height: 34, borderRadius: 8, border: "1px dashed #86efac", background: "#f0fdf4", color: "#059669", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 6 }} title="人物、场景锚点、风格全部带入新作品；本作品在途的视频照常在云端生成，回来打开自动接回">
                ⧉ 续拍新一集（带人物·场景·风格）
              </button>
              {projects.length ? (
                projects.map((pj) => (
                  <div key={pj.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 6px", borderRadius: 8, background: pj.id === projIdRef.current ? "#f5f3ff" : "transparent" }}>
                    {renamingId === pj.id ? (
                      <input
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !(e.nativeEvent as any)?.isComposing) renameProject(pj.id, renameVal);
                          if (e.key === "Escape") setRenamingId("");
                        }}
                        onBlur={() => renameProject(pj.id, renameVal)}
                        autoFocus
                        style={{ flex: 1, height: 26, padding: "0 8px", borderRadius: 6, border: "1px solid #c4b5fd", fontSize: 12, color: "#374151", outline: "none" }}
                      />
                    ) : (
                      <button onClick={() => openProject(pj.id)} style={{ flex: 1, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pj.title}
                        <span style={{ color: "#9ca3af", marginLeft: 6, fontSize: 11 }}>{new Date(pj.updatedAt).toLocaleDateString()}</span>
                      </button>
                    )}
                    <button onClick={() => { setRenamingId(pj.id); setRenameVal(pj.title); }} title="重命名" style={{ border: "none", background: "transparent", color: "#9ca3af", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>
                      ✎
                    </button>
                    <button onClick={() => deleteProject(pj.id)} title="删除该作品" style={{ border: "none", background: "transparent", color: "#9ca3af", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>
                      🗑
                    </button>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12, color: "#9ca3af", padding: 8 }}>暂无历史作品（生成过内容会自动保存到这里）</div>
              )}
            </div>
          ) : null}
        </div>
      </header>

      {lightbox ? (
        <div onClick={() => setLightbox("")} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.82)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
          <img src={lightbox} alt="" style={{ maxWidth: "92vw", maxHeight: "92vh", borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,.5)" }} />
        </div>
      ) : null}
      <div style={scroll}>
        <div style={container} className="ezc">
          {resumeHint ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", marginBottom: 12, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, fontSize: 13, color: "#6d28d9" }}>
              💾 上次的作品已自动保存——在右上角「我的作品」里点击即可继续（生成中的视频会自动接回）
              <div style={{ flex: 1 }} />
              <button onClick={() => setResumeHint(false)} style={{ border: "none", background: "transparent", color: "#8b5cf6", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>知道了</button>
            </div>
          ) : null}
          <h1 style={h1}>把素材和一句话，变成一条广告片</h1>
          <p style={sub}>传商品图、说一句要讲什么，自动拆场、选角、出片。每一步都能改，满意再往下走。</p>

          {/* ① 素材 & 变量 */}
          <section style={card}>
            <div style={cardHead}>
              <span style={stepNo}>1</span>
              <span style={cardTitle}>{entryMode === "footage" ? "素材成片" : "素材 & 变量"}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <button onClick={() => setEntryMode("story")} style={{ ...chip(entryMode === "story"), fontSize: 13, height: 40, padding: "0 16px" }}>💡 说个想法</button>
              <button onClick={() => setEntryMode("footage")} style={{ ...chip(entryMode === "footage"), fontSize: 13, height: 40, padding: "0 16px" }}>🖼 传素材</button>
            </div>
            {entryMode === "footage" ? (
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10, lineHeight: 1.7 }}>
                手上有产品图、门店照、作品图就走这条：素材按你排的顺序进片子，模型让它们动起来、接起来。不拆场、不出关键帧，一次成片。
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <button onClick={() => setScriptMode("create")} style={chip(scriptMode === "create")}>故事创作 · 一句话生成</button>
                <button onClick={() => setScriptMode("adapt")} style={chip(scriptMode === "adapt")}>剧本改编 · 已有完整剧本</button>
              </div>
            )}
            {entryMode === "footage" ? (
              <div style={{ marginBottom: 12 }}>
                <div style={fieldLabel}>素材（{footage.length}/{FOOTAGE_MAX_IMG} 张 · 顺序即片中顺序）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {footage.map((u, ix) => (
                    <div key={ix} style={{ position: "relative", width: 68, height: 68, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="" onClick={() => setLightbox(u)} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} />
                      <span style={{ position: "absolute", left: 2, top: 2, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 10, borderRadius: 4, padding: "0 4px" }}>{ix + 1}</span>
                      <button onClick={() => setFootage(footage.filter((_x, i2) => i2 !== ix))} style={{ position: "absolute", right: 2, top: 2, width: 16, height: 16, lineHeight: "14px", borderRadius: 8, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, cursor: "pointer" }} title="移除">×</button>
                      {ix ? <button onClick={() => { const n = footage.slice(); [n[ix - 1], n[ix]] = [n[ix], n[ix - 1]]; setFootage(n); }} style={{ position: "absolute", left: 2, bottom: 2, width: 16, height: 16, lineHeight: "14px", borderRadius: 8, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 11, cursor: "pointer" }} title="前移">‹</button> : null}
                    </div>
                  ))}
                  <button onClick={() => footageUpRef.current?.click()} disabled={footageBusy || footage.length >= FOOTAGE_MAX_IMG} style={{ width: 68, height: 68, borderRadius: 8, border: "1px dashed #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontSize: 11, cursor: footageBusy ? "wait" : "pointer" }}>
                    {footageBusy ? "上传中…" : "＋ 添加"}
                  </button>
                  <input ref={footageUpRef} type="file" accept="image/*" multiple onChange={(e) => void onFootageFiles(e)} style={{ display: "none" }} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>片长</span>
                  {[10, 15, 20, 30].map((n) => (
                    <button key={n} onClick={() => setFootageSec(n)} style={chip(footageSec === n)}>{n} 秒</button>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>素材处理</span>
                  <button onClick={() => setFootageKeep(true)} style={chip(footageKeep)}>忠于原图 · 只让它动起来</button>
                  <button onClick={() => setFootageKeep(false)} style={chip(!footageKeep)}>允许延展 · 画面可再创作</button>
                </div>
              </div>
            ) : null}
            {scriptMode === "adapt" ? (
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12, lineHeight: 1.6 }}>把整幕剧本（含场景、动作、台词）粘进下面文本框。系统当场记不当编剧：只拆解、不改编，**台词原样保留**，人物自动提取进选角。</div>
            ) : null}

            {/* 主角（0~5 个）：不加=文生一切；加数字人/产品=按参考图生成，可同框 */}
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={entryMode === "footage" ? "想要一条什么样的片子？例：一条门店探店 vlog，突出环境干净、菜品诱人，年轻有活力。（留空也能出，模型自己发挥）" : scriptMode === "adapt" ? "粘贴整幕剧本：场景标注（内景/外景·日/夜）、人物动作、台词都保留原格式即可。" : "贴一段故事 / 文案 / 广告脚本，或一句话描述（例：一支面向年轻人的国产新能源车广告，强调智能与自由）。"}
              rows={scriptMode === "adapt" ? 10 : 4}
              style={textarea}
            />
            <div style={{ marginTop: 14 }}>
              <div style={fieldLabel}>视频模型</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <span style={chip(true)}>Seedance 2.5（单场 30 秒 · 多语言 · 真人活体）</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
                角色锁脸两条路：选角台/自备形象图走**多角度形象图**（正脸、四分之三侧、侧面三张一起送，转头和大动作时脸也稳）；真人走**活体认证**后的平台素材，原生锁脸。自备图可用卡通/宠物/AI 生成的人物，真人照片会被平台拦下。
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", flexShrink: 0 }}>片长</span>
                <input
                  type="range"
                  min={10}
                  max={170}
                  step={10}
                  value={bandLo}
                  onChange={(e) => { setBandLo(parseInt(e.target.value, 10)); setShotCount(""); }}
                  style={{ flex: 1, accentColor: "#7c3aed" }}
                />
                <span style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed", flexShrink: 0, minWidth: 96, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {bandLo}~{bandHi} 秒
                </span>
                <span style={{ fontSize: 12, color: "#b45309", fontWeight: 700, flexShrink: 0, minWidth: 96, textAlign: "right" }}>≈ ¥{Math.round(bandLo * ratePerSec(videoRes))}~{Math.round(bandHi * ratePerSec(videoRes))}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
                给个 10 秒的区间，AI 在里面自由发挥（单场 4~30 秒逐秒可调，留点余地才不会为了凑数硬拆场）。<span style={{ color: "#b45309" }}>费用全由它决定，越长越贵。</span>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ ...fieldLabel, marginTop: 10 }}>清晰度（直接决定上面的价钱）</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={() => setVideoRes("720p")} style={chip(videoRes === "720p")}>720p（{ratePerSec("720p")} 元/秒）</button>
                <button onClick={() => setVideoRes("1080p")} style={chip(videoRes === "1080p")}>1080p（{ratePerSec("1080p")} 元/秒）</button>
              </div>
            <div style={{ marginTop: 12, display: "flex", alignItems: "flex-start", gap: 8 }}>
              <input type="checkbox" checked={draftMode} onChange={(e) => setDraftMode(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: "#7c3aed", flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: "#4b5563", lineHeight: 1.7 }}>
                <b>草稿模式</b>（更快更便宜 · 画质略低）——先花小钱看一眼片子的样子，满意了去掉勾选再出正式版。
              </div>
            </div>
              <div style={{ marginTop: 6, fontSize: 11, color: videoRes === "1080p" ? "#b45309" : "#94a3b8", lineHeight: 1.7 }}>
                {videoRes === "1080p"
                  ? "1080p 是 10bit H.265：交付质量首选。多场拼接走无损直拼、不重编码，长片也没问题。唯一注意：部分 Windows Chrome 与安卓机不解 H.265，网页里可能放不出来——下载到本地用系统播放器看即可。"
                  : "720p 是 8bit H.264：全平台浏览器都能直接播，价格约为 1080p 的四成。适合先试水。"}
              </div>
              {videoRes === "1080p" && !hevcOk ? (
                <div style={{ marginTop: 6, fontSize: 11, color: "#b45309", lineHeight: 1.7, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 8px" }}>
                  ⚠ 实测：<b>你这个浏览器不解 H.265</b>，1080p 成片在网页里会是黑屏（片子本身没问题）。点 ⬇ 下载后用系统播放器 / VLC 能正常看；想在网页里直接预览就选 720p。
              </div>
              ) : null}
            </div>
            <button onClick={() => setOpenTune(!openTune)} style={{ width: "100%", height: 38, marginTop: 10, borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", color: "#4b5563", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              {openTune ? "▾ 收起设置" : "▸ 展开设置"}（题材 · 风格 · 画幅 · 清晰度 · 角色 · 高级）
            </button>
            {openTune ? (
              <>
            <div style={{ marginBottom: 16, padding: 12, background: "#f8fafc", borderRadius: 10, border: "1px solid #eef2f7" }}>
              <div style={fieldLabel}>主角（可选 · 最多 {MAX_SUBJECTS} 个，可同框）</div>

              {subjects.map((s, i) => (
                <div key={s.id} style={{ marginBottom: 10, padding: 10, background: "#fff", borderRadius: 8, border: "1px solid #eef2f7" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <input value={s.tag} onChange={(e) => updateSubject(s.id, { tag: e.target.value })} style={{ ...input, width: 88, height: 28, fontWeight: 700 }} />
                    {s.kind === "human" && wardrobes[s.id] ? (
                      <img src={wardrobes[s.id]} alt="定妆照" title="定妆照（服装参考，已自动生成并将随每镜双参考）" style={{ width: 22, height: 30, objectFit: "cover", borderRadius: 4, border: "1px solid #e5e7eb" }} />
                    ) : null}
                    <button onClick={() => updateSubject(s.id, { kind: "human", value: "" })} style={{ ...chip(s.kind === "human"), height: 28, padding: "0 10px" }}>数字人</button>
                    <button onClick={() => updateSubject(s.id, { kind: "product", value: "" })} style={{ ...chip(s.kind === "product"), height: 28, padding: "0 10px" }}>产品</button>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => removeSubject(s.id)} style={{ ...reBtn, width: "auto", padding: "0 8px", height: 28 }}>删除</button>
                  </div>
                  {s.kind === "human" ? (
                    <div>
                      <input value={s.value} onChange={(e) => updateSubject(s.id, { value: e.target.value })} placeholder="数字人 asset_id（如 asset-20260310022434-wvg96）" style={input2} />
                      {!s.value.trim() ? (
                        <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                          还没有 ID？
                          <a href="https://console.volcengine.com/ark/region:cn-beijing/experience/gen_video?model=doubao-seedance-2-0-260128" target="_blank" rel="noreferrer" style={{ color: "#7c3aed", textDecoration: "none" }}>去火山虚拟人像库挑一个 ↗</a>
                          ，点「生成并复制 asset URI」，把 asset_id 粘到上面。
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input value={s.value} onChange={(e) => updateSubject(s.id, { value: e.target.value })} placeholder="产品图公网 URL（或点右侧上传）" style={{ ...input2, flex: 1 }} />
                      <label style={{ height: 30, lineHeight: "30px", padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#4b5563", fontSize: 12, cursor: productBusy === s.id ? "default" : "pointer", whiteSpace: "nowrap" }}>
                        {productBusy === s.id ? "上传中…" : "上传"}
                        <input type="file" accept="image/*" onChange={(e) => handleProductFile(s.id, e)} disabled={productBusy === s.id} style={{ display: "none" }} />
                      </label>
                      {s.value ? <img src={s.value} alt="" style={{ height: 30, borderRadius: 6, border: "1px solid #e5e7eb" }} /> : null}
                    </div>
                  )}
                  <input value={s.desc} onChange={(e) => updateSubject(s.id, { desc: e.target.value })} placeholder={s.kind === "human" ? "外观描述要闭环到款式：发型+内搭+外层都给颜色和款式（围裙注明半身/全身，没写的每镜乱变）例：长发披肩、白色T恤外穿明黄色开衫的年轻女子" : "外观 + 用法 例：蓝瓶喷雾香水，按压喷头对手腕/颈部喷洒（写清用法，AI 才不会乱演）"} style={{ ...input2, marginTop: 8 }} />
                  {s.kind === "human" && !s.desc.trim() ? (
                    <div style={{ marginTop: 6, fontSize: 11, color: "#d97706", lineHeight: 1.6 }}>⚠ 建议填外观描述（至少写性别/年龄/服装），否则分镜可能编出对不上的人。</div>
                  ) : null}
                </div>
              ))}

              {/* 选角台：预置数字人，点头像一键加为主角（再点取消）；更多去火山挑 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>选角台</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6 }}>点头像一键加为主角，再点取消</span>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 10, fontSize: 11, color: "#475569", cursor: "pointer", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={autoCast} onChange={(e) => setAutoCast(e.target.checked)} style={{ width: 13, height: 13, accentColor: "#7c3aed" }} />
                    根据剧情自动选角
                  </label>
                  <div style={{ flex: 1 }} />
                  <a href="https://console.volcengine.com/ark/region:cn-beijing/experience/gen_video?model=doubao-seedance-2-0-260128" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#7c3aed", textDecoration: "none" }}>去火山挑更多 ↗</a>
                </div>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                  {CAST_PRESETS.map((p) => {
                    const picked = subjects.some((s) => s.kind === "human" && s.value.trim() === p.assetId);
                    const full = !picked && subjects.length >= MAX_SUBJECTS;
                    return (
                      <div key={p.assetId} onClick={() => { if (full) return; togglePreset(p); }} style={{ width: 76, flex: "0 0 auto", cursor: full ? "default" : "pointer", opacity: full ? 0.4 : 1 }}>
                        <div style={{ position: "relative" }}>
                          <img src={p.img} alt={p.label} style={{ width: 76, height: 100, objectFit: "cover", borderRadius: 8, border: picked ? "2px solid #7c3aed" : "2px solid #e5e7eb", display: "block", boxSizing: "border-box" }} />
                          {picked ? <div style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9, background: "#7c3aed", color: "#fff", fontSize: 12, lineHeight: "18px", textAlign: "center" }}>✓</div> : null}
                        </div>
                        <div style={{ fontSize: 10, color: picked ? "#7c3aed" : "#6b7280", textAlign: "center", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => addSubject("product")} disabled={subjects.length >= MAX_SUBJECTS} style={{ ...chip(false), opacity: subjects.length >= MAX_SUBJECTS ? 0.4 : 1 }}>+ 产品主体</button>
                <button onClick={() => addSubject("human")} disabled={subjects.length >= MAX_SUBJECTS} style={{ ...chip(false), opacity: subjects.length >= MAX_SUBJECTS ? 0.4 : 1 }}>+ 更多数字人（手填 asset）</button>
                <button
                  onClick={() => {
                    const u = (window.prompt("粘贴角色图片 URL（正面清晰、最好全身/半身照——整图将作为该角色的参考图喂给视频）：") || "").trim();
                    if (!u) return;
                    if (!/^https?:\/\//.test(u)) { setErr("角色图片需要 http(s) 开头的公网 URL"); return; }
                    const tag = (window.prompt("给这个角色起个代号（2~6字，如 张总/阿明）：") || "").trim().slice(0, 8) || `主角${subjects.length + 1}`;
                    const sid = Math.random().toString(36).slice(2, 8);
                    setSubjects((p) => [...p, { id: sid, tag, kind: "human", value: u, desc: "", info: undefined, auto: false }]);
                    setPreviews((pv) => ({ ...pv, [sid]: u })); // 原图即预览
                  }}
                  disabled={subjects.length >= MAX_SUBJECTS}
                  style={{ ...chip(false), opacity: subjects.length >= MAX_SUBJECTS ? 0.4 : 1 }}
                  title="任何一张人物照片都能当角色：整图作参考图出片（和文生图造的角色同通道），无需 asset"
                >+ 贴图片URL当角色</button>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
                  我的角色库（上传形象图固定角色 · 跨作品常驻）：点名字加入本片；自动选角时TA也在候选名单里。
                  <span style={{ color: "#b45309" }}>照片角色请用卡通、宠物、AI 生成的人物——真人人脸照片会被平台拦下；<b>真人请走「活体认证真人数字人」</b>，认证后 2.5 原生锁脸。</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {myCast.map((m) => (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #e5e7eb", borderRadius: 999, padding: "3px 8px 3px 4px", background: "#fff" }}>
                      <img src={m.img} alt={m.name} onClick={() => setLightbox(m.img)} style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", cursor: "zoom-in", outline: m.assetId ? "2px solid #059669" : "none" }} title={m.assetId ? `活体认证真人 · 原生锁脸 · ${m.assetId}` : "点击放大"} />
                      {m.assetId && <span style={{ fontSize: 10, color: "#059669", fontWeight: 700 }} title="活体认证真人数字人：2.5 出片原生锁脸">🪪</span>}
                      <button onClick={() => { if (subjects.length >= MAX_SUBJECTS) return; const sid = Math.random().toString(36).slice(2, 8); setSubjects((p) => [...p, { id: sid, tag: m.name, kind: "human" as SubjectKind, value: m.img, desc: (m.desc || "").trim(), auto: false, assetId: m.assetId || undefined }]); setPreviews((pv) => ({ ...pv, [sid]: m.img })); }} style={{ border: "none", background: "transparent", fontSize: 12, fontWeight: 700, color: "#374151", cursor: "pointer", padding: 0 }} title="加入本片（照片锁定人像，重拆不作废）">{m.name}</button>
                      <button onClick={() => {
                        const nn = window.prompt(`给「${m.name}」改个名字（角色代号，会同步到已加入本片的同名角色）`, m.name);
                        const nv = (nn || "").trim();
                        if (!nv || nv === m.name) return;
                        saveMyCast(myCast.map((x) => (x.id === m.id ? { ...x, name: nv } : x)));
                        setSubjects((p) => p.map((x) => (x.tag === m.name ? { ...x, tag: nv } : x))); // 片中同名角色跟着改
                      }} style={{ ...reBtn, width: 22, height: 22, fontSize: 11 }} title="改名">✎</button>
                      <button onClick={() => {
                        const nd = window.prompt(`「${m.name}」的造型描述（服装、头饰、发型等，每场按它锁定；会同步到已加入本片的同名角色）`, m.desc || "");
                        if (nd === null) return;
                        const nv = nd.trim();
                        saveMyCast(myCast.map((x) => (x.id === m.id ? { ...x, desc: nv } : x)));
                        setSubjects((p) => p.map((x) => ((m.assetId && x.assetId === m.assetId) || (!m.assetId && x.value.trim() === m.img) ? { ...x, desc: nv } : x)));
                      }} style={{ ...reBtn, width: 22, height: 22, fontSize: 11, color: (m.desc || "").trim() ? "#047857" : "#b45309" }} title={(m.desc || "").trim() ? `造型：${m.desc}` : "还没写造型描述，点此填写"}>👔</button>
                      <button onClick={() => { if (window.confirm(`把「${m.name}」从我的角色库移除？（不影响已加入作品的角色）`)) saveMyCast(myCast.filter((x) => x.id !== m.id)); }} style={{ border: "none", background: "transparent", color: "#c4c9d4", cursor: "pointer", fontSize: 12, padding: 0 }} title="从库移除">✕</button>
                    </div>
                  ))}
                  <button onClick={() => myUpRef.current?.click()} disabled={myUpBusy} style={{ ...chip(false), opacity: myUpBusy ? 0.5 : 1 }}>{myUpBusy ? "上传中…" : "＋ 上传照片固定角色"}</button>
                  <input ref={myUpRef} type="file" accept="image/*" onChange={(e) => void onMyCastFile(e)} style={{ display: "none" }} />
                  <RealPersonAuth
                    onDone={(c) => saveMyCast([...myCastRef.current, { id: Math.random().toString(36).slice(2, 8), name: c.name, img: c.img, assetId: c.assetId }])}
                    onError={(m) => setErr(m)}
                  />
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
                {hasSubjects ? ((subjects.some((s) => s.assetId) ? "🪪 活体认证真人走平台原生锁脸（asset）；其余主角用三视图形象图锁脸。拆场后可在每场勾选出场的主角（含同框）。" : "主角用三视图形象图锁脸（正脸 · 四分之三侧 · 侧面一起送，转头时脸也稳）；拆场后可在每场勾选出场的主角（含同框）。")) : "不加主角 = 纯文生视频。加数字人可锁脸，加产品可锁产品外观，最多 5 个、可同框。"}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={fieldLabel}>题材（决定叙事公式）</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {GENRE_PRESETS.map((g) => (
                  <button key={g.key} onClick={() => setGenreKey(g.key)} style={chip(genreKey === g.key)}>
                    {g.label}
                  </button>
                ))}
              </div>
              {envKit.length ? (
                <div style={{ fontSize: 11, color: "#059669", marginTop: -6, marginBottom: 12 }}>
                  ⧉ 剧组已随身：{subjects.filter((x) => x.kind === "human").length} 位角色 · {envKit.length} 个场景锚点（拆镜自动沿用，保持系列一致）
                </div>
              ) : null}
              <div style={fieldLabel}>奇葩度（剧情脑洞）</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <input type="range" min={0} max={100} step={5} value={quirk} onChange={(e) => setQuirk(parseInt(e.target.value, 10))} style={{ flex: 1, accentColor: "#7c3aed" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed", width: 110, textAlign: "right" }}>{quirk}% · {quirkLabel}</span>
              </div>
              <div style={fieldLabel}>整体风格（贯穿全片，锁一致性）</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button onClick={() => setStyleKey("auto")} style={chip(styleKey === "auto")}>
                  自动{styleKey === "auto" && autoStyle ? `（AI 选了${STYLE_PRESETS.find((x) => x.key === autoStyle)?.label || autoStyle}）` : ""}
                </button>
                {STYLE_PRESETS.map((s) => (
                  <button key={s.key} onClick={() => setStyleKey(s.key)} style={chip(styleKey === s.key)}>
                    {s.label}
                  </button>
                ))}
                <button onClick={() => setStyleKey("custom")} style={chip(styleKey === "custom")}>
                  自定义
                </button>
              </div>
              {styleKey === "custom" ? (
                <input
                  value={styleCustom}
                  onChange={(e) => setStyleCustom(e.target.value)}
                  placeholder="自定义风格描述，如：胶片质感，暖黄昏光，复古颗粒"
                  style={{ ...input, marginTop: 10 }}
                />
              ) : (
                <div style={presetHint}>{STYLE_PRESETS.find((s) => s.key === styleKey)?.prefix}</div>
              )}
            </div>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={fieldLabel}>画幅</div>
              <button onClick={() => setAspect("16:9")} style={chip(aspect === "16:9")}>横屏 16:9</button>
              <button onClick={() => setAspect("9:16")} style={chip(aspect === "9:16")}>竖屏 9:16</button>
              <button onClick={() => setAspect("1:1")} style={chip(aspect === "1:1")}>方形 1:1</button>
            </div>
            <div style={{ marginTop: 14 }}>


            <div style={{ marginTop: 20 }}>
              <button onClick={() => setOpenAdv(!openAdv)} style={{ width: "100%", height: 34, borderRadius: 8, border: "none", borderTop: "1px dashed #e5e7eb", background: "transparent", color: "#94a3b8", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "left", paddingLeft: 2, paddingTop: 8 }}>
                {openAdv ? "▾" : "▸"} 高级（可选）：参考片 · 参考音频 · 出片语种
                {!openAdv && (refUses.length || refAudioUse || filmLang !== "zh") ? <span style={{ color: "#7c3aed", fontWeight: 600 }}>　· 已设置</span> : null}
              </button>
            </div>
            {openAdv ? (
              <>
            <div style={{ marginTop: 14 }}>
              <div style={fieldLabel}>参考片（可选 · 给我看你想要什么）</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                {REF_USES.map((u) => (
                  <button key={u} onClick={() => setRefUses((cur) => (cur.includes(u) ? cur.filter((x) => x !== u) : [...cur, u]))} style={{ ...chip(refUses.includes(u)), height: 30, padding: "0 10px", fontSize: 12 }}>{u}</button>
                ))}
              </div>
              <input
                value={refVideoUrl}
                onChange={(e) => setRefVideoUrl(e.target.value)}
                placeholder="参考视频链接（2~30 秒 · 也可以直接粘贴你之前出过的成片链接）"
                style={{ ...input2, height: 32, fontSize: 12, width: "100%", marginBottom: 6 }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => refImgUpRef.current?.click()} disabled={refUpBusy} style={{ height: 30, padding: "0 12px", borderRadius: 8, border: "1px dashed #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontSize: 12, fontWeight: 600, cursor: refUpBusy ? "wait" : "pointer" }}>
                  {refUpBusy ? "上传中…" : refStyleImg ? "✓ 已传风格参考图（点换）" : "＋ 传一张风格参考图"}
                </button>
                {refStyleImg ? (
                  <button onClick={() => setRefStyleImg("")} style={{ ...reBtn, width: "auto", padding: "0 8px", fontSize: 11 }}>移除</button>
                ) : null}
                <input ref={refImgUpRef} type="file" accept="image/*" onChange={(e) => void onRefStyleFile(e)} style={{ display: "none" }} />
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #e5e7eb" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>参考音频</span>
                  <button onClick={() => setRefAudioUse(refAudioUse === "音色" ? "" : "音色")} style={{ ...chip(refAudioUse === "音色"), height: 28, padding: "0 10px", fontSize: 12 }}>音色</button>
                  <button onClick={() => setRefAudioUse(refAudioUse === "配乐风格" ? "" : "配乐风格")} style={{ ...chip(refAudioUse === "配乐风格"), height: 28, padding: "0 10px", fontSize: 12 }}>配乐风格</button>
                </div>
                {refAudioUse ? (
                  <>
                    <input
                      value={refAudioUrl}
                      onChange={(e) => setRefAudioUrl(e.target.value)}
                      placeholder="音频链接（wav / mp3 · 2~30 秒 · 需公网可访问）"
                      style={{ ...input2, height: 32, fontSize: 12, width: "100%", marginBottom: 6 }}
                    />
                    {refAudioUse === "音色" && subjects.filter((x) => x.kind === "human" && x.tag.trim()).length ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>给谁用</span>
                        <button onClick={() => setRefAudioCast("")} style={{ ...reBtn, width: "auto", padding: "0 8px", fontSize: 11, ...(refAudioCast ? {} : { borderColor: "#7c3aed", color: "#7c3aed" }) }}>全片人声</button>
                        {subjects.filter((x) => x.kind === "human" && x.tag.trim()).map((x) => (
                          <button key={x.id} onClick={() => setRefAudioCast(x.tag)} style={{ ...reBtn, width: "auto", padding: "0 8px", fontSize: 11, ...(refAudioCast === x.tag ? { borderColor: "#7c3aed", color: "#7c3aed" } : {}) }}>{x.tag}</button>
                        ))}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 11, color: refAudioUse && !refAudioUrl.trim() ? "#b45309" : "#94a3b8", lineHeight: 1.7 }}>
                      {refAudioUse && !refAudioUrl.trim()
                        ? "选了用途但还没给音频链接——贴上才会生效。"
                        : refAudioUse === "音色"
                        ? `只学声线与说话质感${refAudioCast ? `，给「${refAudioCast}」用` : "，全片人声通用"}；台词仍按剧情走，不会念参考音频里的话。品牌代言人音色、固定旁白音色都能这么锁。`
                        : "只学曲风、配器与情绪，模型据此为本片配乐；不照搬旋律，也不会把参考音频里的人声带进来。"}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
                    有品牌音色或调性参考曲就贴进来（Seedance 2.5 支持纯音频参考）。
                  </div>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: refUses.length && !refVideoUrl.trim() && !refStyleImg ? "#b45309" : "#94a3b8", lineHeight: 1.7 }}>
                {refUses.length && !refVideoUrl.trim() && !refStyleImg
                  ? "勾了「学什么」但还没给参考素材——贴个视频链接或传张风格图才会生效。"
                  : refUses.length
                  ? `全片会照着参考素材学：${refUses.join("、")}；内容仍按你的剧情走，不会抄参考片的画面与人物。`
                  : "写不出提示词的时候，直接甩一条你喜欢的片子——勾上要学的部分，全片就照着那个调性来。"}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={fieldLabel}>出片语种（Seedance 2.5 原生有声生成 · 口型跟着译文走）</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {LANGS.map((l) => (
                  <button key={l.code} onClick={() => { setFilmLang(l.code); if (l.code !== "zh" && shots?.length && !i18nLines[l.code]) void runTranslate(l.code); }} style={{ ...chip(filmLang === l.code), height: 30, padding: "0 10px", fontSize: 12 }}>{l.label}</button>
                ))}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
                {i18nBusy
                  ? "台词翻译中…"
                  : filmLang === "zh"
                  ? "换个语种，同一份场表就能再出一版——台词自动译好、回填到③可改，人物用该语言开口并对口型。"
                  : `已切到${langName(filmLang)}：出片时用译文配音。③ 里能逐句改译文（品牌名、人名建议人工过一遍）。`}
              </div>
            </div>

              </>
            ) : null}
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
              出片单位是「场」：一场 = 同一地点、同一段连续时间里的一段完整事件，场内的镜头硬切由 Seedance 2.5 在一次生成里完成（单场上限 30 秒）。一场一次调用，多场自动拼接。
            </div>
              </>
            ) : null}
            {creditsOn ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed" }}>积分：{acctMaster ? "∞（管理员）" : balance ?? "—"}</span>
                {dailyNote ? <span style={{ fontSize: 12, color: "#059669" }}>{dailyNote}</span> : null}
                <div style={{ flex: 1 }} />
                <input value={cardInput} onChange={(e) => setCardInput(e.target.value)} placeholder="充值码" style={{ ...input2, height: 28, width: 150, fontSize: 12 }} />
                <button onClick={doRedeem} disabled={!cardInput.trim()} style={{ height: 28, padding: "0 12px", borderRadius: 8, border: "none", background: cardInput.trim() ? "#7c3aed" : "#c4b5fd", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>充值</button>
              </div>
            ) : null}
            {scriptMode === "adapt" ? (
              <>
                <div style={{ marginTop: 14 }}>
                  <div style={fieldLabel}>先扩写成完整故事？</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button onClick={() => setUseStory(false)} style={chip(!useStory)}>直接拆场（推荐 · 忠于原话）</button>
                    <button onClick={() => setUseStory(true)} style={chip(useStory)}>先出故事骨架（AI 帮你补细节）</button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8", lineHeight: 1.7 }}>
                    骨架会把你的想法扩成时间地点人物起因经过结局——补得多也就偏得多。写得已经很具体时别开它。
                  </div>
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={fieldLabel}>场数</div>
                  <input type="number" min={1} max={6} value={shotCount} onChange={(e) => setShotCount(e.target.value ? Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 0)) : "")} placeholder="自动" style={{ ...input, width: 90 }} />
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>留空 = 按上面的片长自动定</span>
                </div>
                <button onClick={genBoard} disabled={busyAll || !brief.trim()} style={primaryBtn(busyAll || !brief.trim())}>
                  {boardBusy ? (shots?.length || plannedCount ? `按剧本拆分镜中… 已出 ${shots?.length || 0}/${plannedCount || "?"} 镜` : `${stage || "选角"}中…`) : shots && shots.length ? (autoRun ? "↻ 按剧本重新一键出片" : "↻ 按剧本重新拆分镜") : autoRun ? "一键出片 →（按剧本）" : "选角并拆分镜 →（按剧本）"}
                </button>
                {boardBusy ? <button onClick={requestStop} style={stopBtn} title="停止后不再发起新的生成">{stopping ? "已请求停止…" : "⏹ 停止"}</button> : null}
              </>
            ) : entryMode === "footage" ? (
              <>
                <button onClick={confirmThenFootage} disabled={!footage.length || videoBusy || footageBusy || payBlocked} style={{ ...primaryBtn(!footage.length || videoBusy || footageBusy), ...(confirmFootage && !videoBusy ? { background: "#dc2626" } : {}) }}>
                  {videoBusy
                    ? "素材成片中…（别关页面）"
                    : confirmFootage
                    ? `⚠ 再点一次确认：${footage.length} 张素材 · ${footageSec} 秒 · ${cost(footageSec, videoRes)}`
                    : `🎬 素材成片（${footage.length} 张 · ${footageSec} 秒 · ${cost(footageSec, videoRes)}）`}
                </button>
                {(() => {
                  const fv = videos[FOOTAGE_KEY];
                  if (!fv || fv.status === "idle") return null;
                  return (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ ...videoThumb, aspectRatio: aspect === "16:9" ? "16 / 9" : aspect === "1:1" ? "1 / 1" : "9 / 16", maxWidth: 380, margin: "0 auto" }}>
                        {fv.status === "done" && fv.url && vidExpired(fv) ? (
                          <span style={{ ...frameMsg, color: "#b45309", padding: "0 8px", textAlign: "center", lineHeight: 1.5 }}>链接已过期<br />平台视频只存 24 小时<br />重新出一次</span>
                        ) : fv.status === "done" && fv.url ? (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <video src={fv.url} controls style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" }} />
                        ) : fv.status === "gen" ? (
                          <span style={{ ...frameMsg, padding: "0 12px", textAlign: "center", lineHeight: 1.6 }}>成片中…<br />通常 3~10 分钟，别关页面</span>
                        ) : (
                          <span style={{ ...frameMsg, color: "#ef4444", padding: "0 8px", textAlign: "center", lineHeight: 1.4 }}>{fv.err || "失败"}</span>
                        )}
                      </div>
                      {fv.status === "done" && fv.url && !vidExpired(fv) ? (
                        <div style={{ marginTop: 10, textAlign: "center" }}>
                          <a href={fv.url} target="_blank" rel="noreferrer" style={{ display: "inline-block", height: 36, lineHeight: "36px", padding: "0 18px", borderRadius: 8, background: "#059669", color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>⬇ 打开成片另存</a>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>平台链接 24 小时后失效，建议立刻另存。</div>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </>
            ) : (
              <>
                <button
                  onClick={() => (useStory ? genStoryOnly() : genBoard())}
                  disabled={storyBusy || busyAll || !brief.trim() || productMissingDesc.length > 0}
                  style={primaryBtn(storyBusy || busyAll || !brief.trim() || productMissingDesc.length > 0)}
                  title={productMissingDesc.length ? `先给产品「${productMissingDesc.join("、")}」写外观+用法` : ""}
                >
                  {storyBusy || boardBusy
                    ? (stage || "生成中…")
                    : shots?.length
                    ? "↻ 重新生成"
                    : `🎬 一键生成（${targetSec} 秒 · 免费出到场表）`}
                </button>
                {storyBusy ? (
                  <button onClick={requestStop} style={stopBtn} title="停止后不再发起新的生成">{stopping ? "已请求停止…" : "⏹ 停止"}</button>
                ) : null}
                {realMissingDesc.length > 0 && !storyBusy && productMissingDesc.length === 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#b45309" }}>真人「{realMissingDesc.join("、")}」还没写造型描述——会按本人日常形象出演；想要特定服装/头饰，先在主角区写清（每场都按它锁定，写好会记进角色库）。</div>
                )}
                {productMissingDesc.length > 0 && !storyBusy && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>产品「{productMissingDesc.join("、")}」还没写外观+用法——不写的话 AI 不知道它是什么，整片都不会出现它。去上面主角区补一句（如「蓝瓶喷雾香水，按压喷头对手腕/颈部喷洒」）。</div>
                )}
              </>
            )}

          </section>

          {/* ② 故事骨架：独立单元——决定后续一切走向，享受最便宜的返工入口 */}
          {useStory && scriptMode !== "adapt" && (storyLine || storyBusy) ? (
            <section style={card}>
              <div style={cardHead}>
                <span style={stepNo}>2</span>
                <span style={cardTitle}>故事骨架（可手改）</span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setStOpen((v) => !v)} disabled={storyBusy || busyAll} style={{ ...reBtn, ...(stNote.trim() || stOpen ? { borderColor: "#7c3aed", color: "#7c3aed" } : {}) }} title="填修改要求重编故事（remix）">✎</button>
                <button onClick={() => genStoryOnly(stNote.trim() || undefined)} disabled={storyBusy || busyAll} style={reBtn} title={stNote.trim() ? "按已填要求重编" : "重掷一个新故事"}>{storyBusy ? "…" : "↻"}</button>
              </div>
              {stOpen ? (
                <div style={{ marginBottom: 8, display: "flex", gap: 6 }}>
                  <input value={stNote} onChange={(e) => setStNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !(e.nativeEvent as any)?.isComposing) { setStOpen(false); genStoryOnly(stNote.trim() || undefined); } }} placeholder="修改要求（可选）：如 反转再狠一点 / 地点改成深夜码头" style={{ ...input2, height: 30, fontSize: 12, flex: 1 }} autoFocus />
                  <button onClick={() => { setStOpen(false); genStoryOnly(stNote.trim() || undefined); }} disabled={storyBusy || busyAll} style={{ height: 30, padding: "0 14px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>↻ 重编</button>
                </div>
              ) : null}
              <textarea value={storyLine} onChange={(e) => setStoryLine(e.target.value)} placeholder={storyBusy ? "故事编辑中…" : "六要素故事骨架"} rows={4} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 13, lineHeight: 1.8, color: "#334155", resize: "vertical", boxSizing: "border-box", background: storyBusy ? "#f8fafc" : "#fff" }} />
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>手改直接生效；满意后点下方按钮，按这份骨架选角与拆镜。</div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={fieldLabel}>镜头数</div>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={shotCount}
                  onChange={(e) => setShotCount(e.target.value ? Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 0)) : "")}
                  placeholder="自动"
                  style={{ ...input, width: 90 }}
                />
                <span style={{ fontSize: 12, color: "#9ca3af" }}>留空 = 让 AI 按故事定（1~6 场）</span>
              </div>
              <button onClick={genBoard} disabled={busyAll || storyBusy} style={{ ...primaryBtn(busyAll || storyBusy), marginTop: 10 }}>
                {boardBusy
                  ? shots?.length || plannedCount
                    ? `拆分镜中… 已出 ${shots?.length || 0}/${plannedCount || "?"} 镜`
                    : `${stage || "选角"}中…`
                  : shots && shots.length
                  ? autoRun
                    ? "↻ 按此骨架重新一键出片"
                    : "↻ 按此骨架重新生成分镜"
                  : autoRun
                  ? "一键出片 →（按此骨架）"
                  : "生成分镜 →（按此骨架）"}
              </button>
              {boardBusy ? (
                <button onClick={requestStop} style={stopBtn} title="停止后：不再扩写后续镜头、不进入出视频阶段；进行中的这一步照常收尾">{stopping ? "已请求停止…" : "⏹ 停止"}</button>
              ) : null}
            </section>
          ) : null}

          {/* ③ 分镜 */}
          {entryMode === "story" && shots && shots.length ? (
            <section style={card}>
              <div style={cardHead}>
                <span style={stepNo}>3</span>
                <span style={cardTitle}>{boardBusy && plannedCount > 0 ? `场表（共 ${plannedCount} 场，已出 ${shots.length} 场）` : `场表（${shots.length} 场 · ${filmTotalSec(shots)} 秒）`}</span>
                <div style={{ flex: 1 }} />
                {autoRun ? (
                  <button onClick={() => setOpenBoard((v) => !v)} style={{ height: 26, padding: "0 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 12, cursor: "pointer" }}>
                    {openBoard ? "收起" : "展开修改"}
                  </button>
                ) : null}
              </div>
              {!autoRun || openBoard ? (
                <>
              {subjects.length ? (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>主角与产品（主角：选角导演按故事挑的，重拆会重选、手动加的保留，参考图仅预览，出片由 asset 锁脸+定妆照锁衣；产品图：将作为参考图喂给视频）</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {subjects.map((sb) => (
                      <div key={sb.id} style={{ width: 92 }}>
                        <div style={{ width: 92, height: 122, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", background: "#fff" }}>
                          {sb.kind === "product" ? (
                            sb.value.trim() ? (
                              <img src={sb.value.trim()} alt={sb.tag} onClick={() => setLightbox(sb.value.trim())} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} title="点击放大" />
                            ) : (
                              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#94a3b8" }}>待传产品图</div>
                            )
                          ) : previews[sb.id] ? (
                            <img src={previews[sb.id]} alt={sb.tag} onClick={() => setLightbox(previews[sb.id])} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }} title="点击放大" />
                          ) : (
                            <div title={pvErrs[sb.id] || ""} style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 4, fontSize: 11, color: pvErrs[sb.id] ? "#dc2626" : "#94a3b8" }}>{previewBusy[sb.id] ? "生成中…" : pvErrs[sb.id] ? "失败·点↻重试" : "待生成"}</div>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                          <span style={{ fontSize: 11, color: "#475569", fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sb.info || ""}>
                            {sb.tag}
                            {sb.info ? <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 4 }}>{sb.info}</span> : null}
                          </span>
                          {sb.kind === "product" ? (
                            <span style={{ fontSize: 10, color: "#0369a1", background: "#e0f2fe", borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>产品图</span>
                          ) : sb.assetId ? (
                            <span style={{ fontSize: 10, color: "#047857", background: "#d1fae5", borderRadius: 5, padding: "1px 5px", flexShrink: 0 }} title="活体认证真人：出片由平台素材锁脸，预览即本人照片；服装/头饰按外观描述锁定">🪪 本人</span>
                          ) : (
                            <>
                          <button onClick={() => setPvOpen(pvOpen === sb.id ? "" : sb.id)} disabled={!!previewBusy[sb.id]} style={{ ...miniBtn, ...(pvNote[sb.id]?.trim() || pvOpen === sb.id ? { borderColor: "#7c3aed", color: "#7c3aed" } : {}) }} title="改形象（会写进外观描述，三线同源）">✎</button>
                          <button onClick={() => void genOnePreview(sb.id, undefined, undefined, true)} disabled={!!previewBusy[sb.id]} style={miniBtn} title="换一张参考图（不吃缓存）">↻</button>
                            </>
                          )}
                        </div>
                        {sb.kind === "human" && pvOpen === sb.id ? (
                          <div style={{ marginTop: 4 }}>
                            <input value={pvNote[sb.id] || ""} onChange={(e) => setPvNote((m) => ({ ...m, [sb.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" && !(e.nativeEvent as any)?.isComposing) applyPvNote(sb.id); }} placeholder="如：围裙改深灰" style={{ ...input2, height: 24, fontSize: 11 }} autoFocus />
                            <button onClick={() => applyPvNote(sb.id)} style={{ width: "100%", height: 22, marginTop: 3, borderRadius: 6, border: "none", background: "#7c3aed", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>改描述并重生成</button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {shots.map((s, i) => (
                  <div key={s.shotNo} style={shotRow}>
                    <div style={shotNoBadge}>{String(i + 1).padStart(2, "0")}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ezshotrow" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                        <input value={s.title || ""} onChange={(e) => patchShot(i, { title: e.target.value })} maxLength={12} placeholder={`镜 ${s.shotNo}`} style={{ fontWeight: 600, fontSize: 13, color: "#16181d", border: "1px solid transparent", borderRadius: 6, padding: "1px 4px", width: 110, background: "transparent", outline: "none" }} onFocus={(e) => (e.target.style.border = "1px solid #c4b5fd")} onBlur={(e) => (e.target.style.border = "1px solid transparent")} title="镜头标题（可改）" />
                        <select value={SHOT_SIZES_C.includes(s.shotSize) ? s.shotSize : ""} onChange={(e) => patchShot(i, { shotSize: e.target.value })} style={selChip} title="景别">
                          {!SHOT_SIZES_C.includes(s.shotSize) ? <option value="">—</option> : null}
                          {SHOT_SIZES_C.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </select>
                        <select value={CAMERA_MOVES_C.includes(s.cameraMove) ? s.cameraMove : ""} onChange={(e) => patchShot(i, { cameraMove: e.target.value })} style={selChip} title="运镜">
                          {!CAMERA_MOVES_C.includes(s.cameraMove) ? <option value="">—</option> : null}
                          {CAMERA_MOVES_C.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </select>
                        <select value={DURATIONS_C.includes(String(s.duration)) ? String(s.duration) : "15"} onChange={(e) => patchShot(i, { duration: e.target.value })} style={selChip} title="时长（视频按秒计费）">
                          {DURATIONS_C.map((x) => (
                            <option key={x} value={x}>
                              {x}s
                            </option>
                          ))}
                        </select>
                        <span style={metaChip}>{styleKey === "custom" ? "自定义风格" : STYLE_PRESETS.find((x) => x.key === styleKey)?.label || "默认"}</span>
                        <div style={{ flex: 1 }} />
                        <button onClick={() => setReworkOpen(reworkOpen === s.shotNo ? "" : s.shotNo)} disabled={!!reworking[s.shotNo]} style={{ ...reBtn, ...(reworkNote[s.shotNo]?.trim() || reworkOpen === s.shotNo ? { borderColor: "#7c3aed", color: "#7c3aed" } : {}) }} title="填修改要求重写这镜（remix）">✎</button>
                        <button onClick={() => reExpandShot(i)} disabled={!!reworking[s.shotNo]} style={reBtn} title={reworkNote[s.shotNo]?.trim() ? "按已填的修改要求重写" : "直接重写这镜"}>{reworking[s.shotNo] ? "…" : "↻"}</button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginBottom: 5 }}>
                        <span style={{ fontSize: 10, color: "#b6bcc8", marginRight: 2 }}>结构调整</span>
                        <button onClick={() => surgAdd(i)} disabled={busyAll} style={reBtn} title="在本镜后插入一个空白镜">➕</button>
                        <button onClick={() => surgDup(i)} disabled={busyAll} style={reBtn} title="复制本镜（含台词与出场人物）">⧉</button>
                        <button onClick={() => surgMove(i, -1)} disabled={busyAll || i === 0} style={reBtn} title="上移一位">↑</button>
                        <button onClick={() => surgMove(i, 1)} disabled={busyAll || i === (shots?.length || 0) - 1} style={reBtn} title="下移一位">↓</button>
                        <button onClick={() => surgDel(i)} disabled={busyAll} style={{ ...reBtn, color: "#dc2626", borderColor: "#fecaca" }} title="删除本镜">🗑</button>
                      </div>
                      {reworkOpen === s.shotNo ? (
                        <div style={{ marginBottom: 6, display: "flex", gap: 6 }}>
                          <input
                            value={reworkNote[s.shotNo] || ""}
                            onChange={(e) => setReworkNote((m) => ({ ...m, [s.shotNo]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter" && !(e.nativeEvent as any)?.isComposing) { setReworkOpen(""); reExpandShot(i); } }}
                            placeholder="修改要求（可选）：如 动作更克制、把打火机伏笔写进来"
                            style={{ ...input2, height: 28, fontSize: 12, flex: 1 }}
                            autoFocus
                          />
                          <button onClick={() => { setReworkOpen(""); reExpandShot(i); }} disabled={!!reworking[s.shotNo]} style={{ height: 28, padding: "0 12px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>↻ 重写</button>
                        </div>
                      ) : null}
                      {rawOpen[s.shotNo] || !parseCuts(s.content || "").length ? (
                        <textarea
                          value={s.content}
                          onChange={(e) => patchShot(i, { content: e.target.value })}
                          rows={3}
                          style={shotContent}
                        />
                      ) : null}
                      {(() => {
                        const cuts = parseCuts(s.content || "");
                        if (!cuts.length) return null;
                        const bad = checkCuts(cuts, sceneSec(s));
                        return (
                          <div style={{ marginTop: 4, marginBottom: 2 }}>
                            {cuts.map((c, ci) => (
                              <div key={ci} style={{ display: "flex", gap: 6, fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
                                <span style={{ flexShrink: 0, color: "#7c3aed", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{c.start}-{c.end}s</span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.text}</span>
                              </div>
                            ))}
                            {bad.length ? (
                              <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>⚠ 时间轴：{bad[0]}（出片前会自动掰正，也可以手改）</div>
                            ) : null}
                            <button onClick={() => setRawOpen((c) => ({ ...c, [s.shotNo]: !c[s.shotNo] }))} style={{ marginTop: 2, border: "none", background: "none", color: "#94a3b8", fontSize: 11, cursor: "pointer", padding: 0 }}>
                              {rawOpen[s.shotNo] ? "收起原文" : "✎ 改原文"}
                            </button>
                          </div>
                        );
                      })()}
                      {!(s.lines && s.lines.length) ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>台词</span>
                          <input value={s.speaker || ""} onChange={(e) => patchShot(i, { speaker: e.target.value })} placeholder="谁说" style={{ ...input2, height: 26, fontSize: 11, width: 76, flexShrink: 0 }} />
                          <input value={s.line || ""} onChange={(e) => patchShot(i, { line: e.target.value })} maxLength={40} placeholder={s.lineErr ? s.lineErr : beatByShotRef.current[s.shotNo]?.say ? `骨架已指派「${beatByShotRef.current[s.shotNo]?.say}」开口——为空说明扩写漏了，点↻重写` : "留空=本镜沉默（≤24/40/48字按时长）"} style={{ ...input2, height: 26, fontSize: 11 }} />
                        </div>
                      ) : null}
                      {filmLang !== "zh" && (s.line || "").trim() ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 11, color: "#7c3aed", flexShrink: 0 }}>{langName(filmLang)}</span>
                          <input
                            value={i18nLines[filmLang]?.[lineKey(s.shotNo, 0)] || ""}
                            onChange={(e) => setI18nLines((cur) => ({ ...cur, [filmLang]: { ...(cur[filmLang] || {}), [lineKey(s.shotNo, 0)]: e.target.value } }))}
                            placeholder={i18nBusy ? "翻译中…" : "译文（留空则用中文原文出片）"}
                            style={{ ...input2, height: 26, fontSize: 11, flex: 1 }}
                          />
                        </div>
                      ) : null}
                      {Array.isArray(s.lines) && s.lines.length ? (
                        <div style={{ marginTop: 2, marginBottom: 4 }}>
                          {s.lines.map((l, li) => (
                            <div key={li} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                              <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, flexShrink: 0 }}>对话{li + 1}</span>
                              <input value={l.speaker} onChange={(e) => { const nx = (s.lines || []).map((x, k) => (k === li ? { ...x, speaker: e.target.value } : x)); patchShot(i, { lines: nx }); }} placeholder="谁说" style={{ ...input2, height: 26, fontSize: 11, width: 76, flexShrink: 0 }} />
                              <input value={l.line} onChange={(e) => { const nx = (s.lines || []).map((x, k) => (k === li ? { ...x, line: e.target.value } : x)); patchShot(i, { lines: nx }); }} maxLength={24} placeholder="≤24字口语" style={{ ...input2, height: 26, fontSize: 11 }} />
                              <button onClick={() => { const nx = (s.lines || []).filter((_, k) => k !== li); patchShot(i, { lines: nx.length >= 2 ? nx : undefined }); }} style={reBtn} title="删这句">✕</button>
                            </div>
                          ))}
                          <button onClick={() => patchShot(i, { lines: [...(s.lines || []), { speaker: "", line: "" }] })} style={{ marginTop: 4, height: 24, padding: "0 10px", borderRadius: 6, border: "1px dashed #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontSize: 11, fontWeight: 700, cursor: "pointer" }} title="回合数不限——但要配平时长（每回合约4~6秒），塞太多会挤戏">＋加一句</button>
                        </div>
                      ) : (parseFloat(String(s.duration)) || 5) >= 12 ? (
                        <button onClick={() => patchShot(i, { lines: [{ speaker: (s.speaker || "").trim(), line: (s.line || "").trim() }, { speaker: "", line: "" }], speaker: undefined, line: undefined })} style={{ marginTop: 2, marginBottom: 4, height: 24, padding: "0 10px", borderRadius: 6, border: "1px dashed #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontSize: 11, fontWeight: 700, cursor: "pointer" }} title="20/30秒长镜专属：镜内两三句你来我往，口型反应同镜连贯">⇄ 转为对话回合</button>
                      ) : null}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                        <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0 }}>环境</span>
                        <input value={s.env || ""} onChange={(e) => patchShot(i, { env: e.target.value })} placeholder="本镜环境锚点（可改；改完到④点该镜 ↻ 重出）" style={{ ...input2, height: 26, fontSize: 11 }} />
                      </div>
                      {hasSubjects ? (
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: "#9ca3af" }}>出场主角：</span>
                          {subjects.map((sub) => {
                            const on = (castByShot[s.shotNo] || []).includes(sub.tag);
                            return (
                              <button key={sub.id} onClick={() => toggleCast(s.shotNo, sub.tag)} style={{ height: 24, padding: "0 10px", borderRadius: 12, border: on ? "1px solid #7c3aed" : "1px solid #e5e7eb", background: on ? "#7c3aed" : "#fff", color: on ? "#fff" : "#6b7280", fontSize: 11, cursor: "pointer" }}>
                                {sub.tag}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.7 }}>
                  {boardBusy ? (shots.length ? `拆场中… 已出 ${shots.length} 场` : `${stage || "准备"}中…`) : `共 ${shots.length} 场 · ${filmTotalSec(shots)} 秒 · 出片 ${cost(filmTotalSec(shots), videoRes)}`}
                  {shots.length ? " · " + shots.map((x) => x.title || x.shotNo).join(" / ") : ""}
                  {videoBusy ? " · 正在出视频…" : ""}
                </div>
              )}
              {/* 出片是主动线：不能藏在「展开修改」里 */}
              {hasSubjects ? (
                <>
                  <button onClick={confirmThenRegenAll} disabled={busyAll || payBlocked} style={{ ...primaryBtn(busyAll || payBlocked), ...(confirmRegen && !busyAll ? { background: "#dc2626" } : {}) }}>
                    {videoBusy
                      ? `出片中… ${doneVideoCount}/${shots.length} 场`
                      : confirmRegen
                      ? `⚠ 再点一次确认：${doneVideoCount > 0 ? "重出" : "出片"} ${shots.length} 场 · ${filmTotalSec(shots)} 秒 · ${cost(filmTotalSec(shots), videoRes)}`
                      : `🎬 出片（${shots.length} 场 · ${filmTotalSec(shots)} 秒 · ${cost(filmTotalSec(shots), videoRes)}）`}
                  </button>
                  <button onClick={() => void genAllFrames()} disabled={busyAll} style={{ width: "100%", height: 36, marginTop: 8, borderRadius: 10, border: "1px dashed #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontSize: 12, fontWeight: 700, cursor: busyAll ? "not-allowed" : "pointer" }}>
                    {framesBusy ? `出关键帧中… ${doneCount}/${frameSlots.length}` : `🎞 先出关键帧（${frameSlots.length} 张 · 每张几分钱 · 出全了成片就严格对齐这些构图）`}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={confirmThenRegenAll} disabled={busyAll || payBlocked} style={{ ...primaryBtn(busyAll || payBlocked), ...(confirmRegen && !busyAll ? { background: "#dc2626" } : {}) }}>
                    {videoBusy
                      ? `出片中… ${doneVideoCount}/${shots.length} 场`
                      : confirmRegen
                      ? `⚠ 再点一次确认：${doneVideoCount > 0 ? "重出" : "出片"} ${shots.length} 场 · ${filmTotalSec(shots)} 秒 · ${cost(filmTotalSec(shots), videoRes)}`
                      : `🎬 出片（${shots.length} 场 · ${filmTotalSec(shots)} 秒 · ${cost(filmTotalSec(shots), videoRes)}）`}
                  </button>
                  <button onClick={() => void genAllFrames()} disabled={busyAll} style={{ width: "100%", height: 36, marginTop: 8, borderRadius: 10, border: "1px dashed #c4b5fd", background: "#faf5ff", color: "#7c3aed", fontSize: 12, fontWeight: 700, cursor: busyAll ? "not-allowed" : "pointer" }}>
                    {framesBusy ? `出关键帧中… ${doneCount}/${frameSlots.length}` : `🎞 先出关键帧（${frameSlots.length} 张 · 每张几分钱 · 出全了成片就严格对齐这些构图）`}
                  </button>
                </>
              )}
              {framesBusy || videoBusy ? (
                <button onClick={requestStop} style={stopBtn} title="停止后：还没发起的场不再提交；已经提交的照常跑完并计费（钱已花，保成果）">{stopping ? "已请求停止…" : "⏹ 停止（未提交的场）"}</button>
              ) : null}
            </section>
          ) : null}

          {/* ③ 关键帧（数字人模式跳过） */}
          {entryMode === "story" && shots && Object.keys(frames).length ? (
            <section style={card}>
              <div style={cardHead}>
                <span style={stepNo}>4</span>
                <span style={cardTitle}>{`关键帧（${doneCount}/${frameSlots.length}）· 可选 · 出全了就按顺序喂进出片，成片严格对齐这些图`}</span>
                <div style={{ flex: 1 }} />
                {autoRun ? (
                  <button onClick={() => setOpenFrames((v) => !v)} style={{ height: 26, padding: "0 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 12, cursor: "pointer" }}>
                    {openFrames ? "收起" : "展开"}
                  </button>
                ) : null}
              </div>
              {!autoRun || openFrames ? (
              <div style={frameGrid}>
                {frameSlots.map((slot, fi) => {
                  const s = slot.shot;
                  const fr = frames[slot.key] || { status: "idle" as const };
                  return (
                    <div key={slot.key} style={frameCell}>
                      <div style={frameThumb}>
                        {fr.status === "done" && fr.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={fr.url} alt="" onClick={() => setLightbox(fr.url!)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", cursor: "zoom-in" }} draggable={false} title="点击放大" />
                        ) : fr.status === "gen" ? (
                          <span style={frameMsg}>生成中…</span>
                        ) : fr.status === "err" ? (
                          <span style={{ ...frameMsg, color: "#ef4444", padding: "0 8px", textAlign: "center", lineHeight: 1.4 }} title={fr.err || "失败"}>
                            {fr.err ? (fr.err.length > 46 ? fr.err.slice(0, 46) + "…" : fr.err) : "失败"}
                          </span>
                        ) : (
                          <span style={frameMsg}>待生成</span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>{s.title} · <span style={{ color: "#7c3aed", fontVariantNumeric: "tabular-nums" }}>{slot.label}</span></span>
                        <button onClick={() => { setErr(""); void genOneFrame(s, slot.ci, slot.text); }} disabled={fr.status === "gen"} style={reBtn} title="重做这张预览图">↻</button>
                        <button onClick={() => { setErr(""); void (async () => { if (await ensureCastFresh([s])) await genOneVideo(s); })(); }} disabled={fr.status === "gen" || videos[s.shotNo]?.status === "gen"} style={{ ...reBtn, color: "#7c3aed", borderColor: "#c4b5fd" }} title={`单出本镜视频（${Math.min(30, Math.max(4, parseFloat(String(s.duration)) || 5))}秒·只花这一镜的钱，低成本试效果）`}>{videos[s.shotNo]?.status === "gen" ? "…" : "🎬"}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              ) : (
                <div style={{ fontSize: 12, color: "#6b7280" }}>{framesBusy ? `生成中… ${doneCount}/${frameSlots.length}` : `${doneCount}/${frameSlots.length} 张关键帧`}</div>
              )}
            </section>
          ) : null}

          {/* ④ 生成视频 */}
          {payBlocked && shots ? (
            <div style={{ ...card, background: "#fffbeb", border: "1px solid #fde68a", color: "#b45309", fontSize: 13, lineHeight: 1.7 }}>
              出片功能暂时关闭（公测期间）。故事骨架、场表、关键帧都能照常用，出片开放后你现在这份场表可以直接接着跑。
            </div>
          ) : null}
          {entryMode === "story" && shots && Object.keys(videos).length > 0 ? (
            <section style={card}>
              <div style={cardHead}>
                <span style={stepNo}>5</span>
                <span style={cardTitle}>生成视频（{doneVideoCount}/{videoTargetCount}）</span>
                <div style={{ flex: 1 }} />
                {autoRun ? (
                  <button onClick={() => setOpenVideos((v) => !v)} style={collapseBtn}>{openVideos ? "收起" : "展开查看/重做"}</button>
                ) : null}
              </div>
              {!autoRun || openVideos ? (
                <>
              <div style={videoGrid}>
                {(hasSubjects ? shots : shots.filter((s) => frames[s.shotNo]?.status === "done")).map((s, vi) => {
                  const v = videos[s.shotNo] || { status: "idle" as const };
                  return (
                    <div key={s.shotNo} style={frameCell}>
                      <div style={{ ...videoThumb, aspectRatio: aspect === "16:9" ? "16 / 9" : aspect === "1:1" ? "1 / 1" : "9 / 16" }}>
                        {v.status === "done" && v.url && vidExpired(v) ? (
                          <span style={{ ...frameMsg, color: "#b45309", padding: "0 8px", textAlign: "center", lineHeight: 1.5 }}>
                            链接已过期<br />平台视频只存 24 小时<br />点 ↻ 重出这镜
                          </span>
                        ) : v.status === "done" && v.url ? (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <video src={v.url} controls style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" }} />
                        ) : v.status === "gen" ? (
                          <span style={frameMsg}>生成中…</span>
                        ) : v.status === "err" ? (
                          <span style={{ ...frameMsg, color: "#ef4444", padding: "0 8px", textAlign: "center", lineHeight: 1.4 }} title={v.err || "失败"}>
                            {v.err ? (v.err.length > 46 ? v.err.slice(0, 46) + "…" : v.err) : "失败"}
                          </span>
                        ) : (
                          <span style={frameMsg}>待生成</span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>
                          {String(vi + 1).padStart(2, "0")} · {s.title}
                          {v.status === "done" && v.url && !vidExpired(v) && vidHoursLeft(v) >= 0 && vidHoursLeft(v) < 6 ? (
                            <span style={{ color: "#b45309" }}> · 链接剩 {Math.ceil(vidHoursLeft(v))} 小时</span>
                          ) : null}
                        </span>
                        <div style={{ display: "flex", gap: 4 }}>
                          {v.status === "done" && v.url && !vidExpired(v) ? (
                            <a href={v.url} target="_blank" rel="noreferrer" style={{ ...reBtn, lineHeight: "24px", textDecoration: "none", textAlign: "center" }} title="打开原片另存（平台链接 24 小时后失效）">⬇</a>
                          ) : null}
                          {v.status === "done" && v.url && !vidExpired(v) ? (
                            <button onClick={() => { setEditShot(editShot === s.shotNo ? "" : s.shotNo); setEditCut(-1); setEditText(""); }} disabled={videoBusy} style={{ ...reBtn, ...(editShot === s.shotNo ? { borderColor: "#7c3aed", color: "#7c3aed" } : {}) }} title="局部修补：只改一段，不重出整场">✂</button>
                          ) : null}
                          {v.status === "done" && v.url && !vidExpired(v) ? (
                            <button onClick={() => { setExtShot(extShot === s.shotNo ? "" : s.shotNo); setExtText(""); }} disabled={videoBusy} style={{ ...reBtn, ...(extShot === s.shotNo ? { borderColor: "#0f766e", color: "#0f766e" } : {}) }} title="续接：让模型接着这一场往下演，产物成为下一场">⏵</button>
                          ) : null}
                          <button onClick={() => setFixOpen(fixOpen === s.shotNo ? "" : s.shotNo)} disabled={v.status === "gen"} style={{ ...reBtn, ...(fixByShot[s.shotNo]?.trim() || fixOpen === s.shotNo ? { borderColor: "#7c3aed", color: "#7c3aed" } : {}) }} title="填纠正要求（remix）">✎</button>
                          <button onClick={() => confirmThenOne(s)} disabled={v.status === "gen"} style={{ ...reBtn, ...(confirmOne === s.shotNo ? { borderColor: "#dc2626", color: "#dc2626" } : {}) }} title={confirmOne === s.shotNo ? `再点一次确认：重出这场 · ${cost(sceneSec(s), videoRes)}` : fixByShot[s.shotNo]?.trim() ? "按已填的纠正要求重做" : "直接重做这镜"}>↻</button>
                        </div>
                      </div>
                      {extShot === s.shotNo ? (
                        <div style={{ marginTop: 6, padding: 8, borderRadius: 8, background: "#f0fdfa", border: "1px solid #99f6e4" }}>
                          <div style={{ fontSize: 11, color: "#0f766e", fontWeight: 700, marginBottom: 6 }}>⏵ 续接（接着这一场往下演）</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                            {[6, 10, 15, 20, 30].map((n) => (
                              <button key={n} onClick={() => setExtSec(n)} style={{ ...reBtn, width: "auto", padding: "0 8px", fontSize: 11, ...(extSec === n ? { borderColor: "#0f766e", color: "#0f766e" } : {}) }}>{n}s</button>
                            ))}
                          </div>
                          <input
                            value={extText}
                            onChange={(e) => setExtText(e.target.value)}
                            placeholder="接下来发生什么？例：林北走出车间，抬头看见远处厂房的灯一排排亮起来"
                            style={{ ...shotContent, height: 32, marginBottom: 6 }}
                          />
                          <button onClick={() => void genExtend(s)} disabled={videoBusy} style={{ width: "100%", height: 32, borderRadius: 8, border: "none", background: videoBusy ? "#e5e7eb" : "#0f766e", color: videoBusy ? "#9ca3af" : "#fff", fontSize: 12, fontWeight: 700, cursor: videoBusy ? "not-allowed" : "pointer" }}>
                            {videoBusy ? "续接中…" : `续 ${extSec} 秒（${cost(extSec, videoRes)}，成为下一场）`}
                          </button>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, lineHeight: 1.6 }}>
                            模型接着这一场的画面往下演，人物与光线自动延续、无接缝——比合成时硬拼强得多。续出来的片段会插成紧随其后的新一场，可以继续再续，长片就这么接出来。
                          </div>
                        </div>
                      ) : null}
                      {editShot === s.shotNo ? (() => {
                        const cuts = parseCuts(s.content || "");
                        return (
                          <div style={{ marginTop: 6, padding: 8, borderRadius: 8, background: "#faf5ff", border: "1px solid #e9d5ff" }}>
                            <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, marginBottom: 6 }}>✂ 局部修补（改哪一段）</div>
                            {cuts.length >= 2 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                                <button onClick={() => setEditCut(-1)} style={{ ...reBtn, width: "auto", padding: "0 8px", fontSize: 11, ...(editCut === -1 ? { borderColor: "#7c3aed", color: "#7c3aed" } : {}) }}>整场</button>
                                {cuts.map((c, ci) => (
                                  <button key={ci} onClick={() => setEditCut(ci)} style={{ ...reBtn, width: "auto", padding: "0 8px", fontSize: 11, fontVariantNumeric: "tabular-nums", ...(editCut === ci ? { borderColor: "#7c3aed", color: "#7c3aed" } : {}) }}>{c.start}-{c.end}s</button>
                                ))}
                              </div>
                            ) : null}
                            <input
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              placeholder="要改什么？例：把护士长的白大褂改成粉色 / 去掉画面上的文字标签"
                              style={{ ...shotContent, height: 32, marginBottom: 6 }}
                            />
                            <button onClick={() => void genEditScene(s)} disabled={!editText.trim() || videoBusy} style={{ width: "100%", height: 32, borderRadius: 8, border: "none", background: editText.trim() && !videoBusy ? "#7c3aed" : "#e5e7eb", color: editText.trim() && !videoBusy ? "#fff" : "#9ca3af", fontSize: 12, fontWeight: 700, cursor: editText.trim() && !videoBusy ? "pointer" : "not-allowed" }}>
                              {videoBusy ? "修补中…" : `只改这${editCut >= 0 ? "一段" : "一场"}（${cost(sceneSec(s), videoRes)}，原片保留）`}
                            </button>
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, lineHeight: 1.6 }}>
                              拿这场成片当底片重绘，画幅与时长由平台锁定跟原片一致；改砸了原片还在，再点 ✂ 重来。
                            </div>
                          </div>
                        );
                      })() : null}
                      {fixOpen === s.shotNo ? (
                        <div style={{ marginTop: 6 }}>
                          <input
                            value={fixByShot[s.shotNo] || ""}
                            onChange={(e) => setFixByShot((f) => ({ ...f, [s.shotNo]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter" && !(e.nativeEvent as any)?.isComposing) { setFixOpen(""); void (async () => { if (await ensureCastFresh([s])) await genOneVideo(s); })(); } }}
                            placeholder="纠正要求（可选）：如 笔记本屏幕朝向使用者、logo 在瓶身正面"
                            style={{ ...input2, height: 30, fontSize: 12 }}
                            autoFocus
                          />
                          <button onClick={() => { setFixOpen(""); void (async () => { if (await ensureCastFresh([s])) await genOneVideo(s); })(); }} disabled={v.status === "gen"} style={{ width: "100%", height: 28, marginTop: 6, borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>↻ 按此重做这镜</button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <button onClick={confirmThenRegenAll} disabled={busyAll || payBlocked} style={{ ...primaryBtn(busyAll || payBlocked), ...(confirmRegen && !busyAll ? { background: "#dc2626" } : {}) }}>
                {videoBusy ? `生成视频中… ${doneVideoCount}/${videoTargetCount}` : confirmRegen ? `⚠ 再点一次确认：重出全部 ${videoTargetCount} 镜（旧视频覆盖，费用照计）` : "↻ 重新生成全部视频（可单独修改每镜）"}
              </button>
              {videoBusy ? (
                <button onClick={requestStop} style={stopBtn} title="停止后：未发起的镜头不再提交；已提交的照常完成并计费">{stopping ? "已请求停止…" : "⏹ 停止"}</button>
              ) : null}
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#6b7280" }}>{videoBusy ? `生成中… ${doneVideoCount}/${videoTargetCount}` : `${doneVideoCount}/${videoTargetCount} 段视频完成 · 展开可逐镜查看/重做`}</div>
              )}
            </section>
          ) : null}

          {/* ⑥ 合成成片 */}

          {entryMode === "story" && shots && doneVideoCount > 0 ? (
            <section style={card}>
              <div style={cardHead}>
                <span style={stepNo}>6</span>
                <span style={cardTitle}>合成成片</span>
              </div>
              <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 14px", lineHeight: 1.6 }}>
                把 {doneVideoCount} 段视频按场次无损拼成一条（原声直通、不重编码，画质零损失）。字幕留给剪映一类工具后期加。
              </p>
              <button onClick={() => doExport()} disabled={busyAll} style={primaryBtn(busyAll)}>
                {exporting ? exportMsg || "合成中…" : "🎬 拼接成片"}
              </button>
              {exportUrl ? (
                <div style={{ marginTop: 14 }}>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={exportUrl} controls style={{ width: "100%", borderRadius: 10, display: "block", marginBottom: 10, background: "#000" }} />
                  <a href={exportUrl} download="easy-ads.mp4" style={{ display: "inline-block", height: 38, lineHeight: "38px", padding: "0 18px", borderRadius: 8, background: "#059669", color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                    ⬇ 下载成片
                  </a>
                </div>
              ) : null}
            </section>
          ) : null}
          {entryMode === "story" && shots && doneVideoCount > 0 ? (
            <section style={card}>
              <div style={cardHead}>
                <span style={{ ...stepNo, background: "#0f766e" }}>⧉</span>
                <span style={cardTitle} onClick={() => setOpenBatch(!openBatch)} role="button">
                  {openBatch ? "▾" : "▸"} 再出几版（多语种 / 多画幅）
                </span>
              </div>
              {!openBatch ? (
                <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.7, cursor: "pointer" }} onClick={() => setOpenBatch(true)}>
                  这一版是「{langName(filmLang)} · {aspect}」。同一份场表还能换语种、换画幅再出几版，选角与关键帧都复用。
                </p>
              ) : null}
              {openBatch ? (
              <>
              <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 12px", lineHeight: 1.6 }}>
                同一份场表、同一批选角与关键帧，换语种和画幅各出一版。① 里选的语种和画幅是「当前版本」，这里勾的是「再额外出哪几版」。
              </p>
              <div style={{ marginBottom: 10 }}>
                <div style={fieldLabel}>语种（可多选）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {LANGS.map((l) => (
                    <button key={l.code} onClick={() => setBatchLangs((cur) => (cur.includes(l.code) ? cur.filter((x) => x !== l.code) : [...cur, l.code]))} style={{ ...chip(batchLangs.includes(l.code)), height: 30, padding: "0 10px", fontSize: 12 }}>{l.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={fieldLabel}>画幅（可多选）</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[{ v: "9:16", t: "竖屏 9:16" }, { v: "16:9", t: "横屏 16:9" }, { v: "1:1", t: "方形 1:1" }].map((a2) => (
                    <button key={a2.v} onClick={() => setBatchAspects((cur) => (cur.includes(a2.v) ? cur.filter((x) => x !== a2.v) : [...cur, a2.v]))} style={{ ...chip(batchAspects.includes(a2.v)), height: 30, padding: "0 10px", fontSize: 12 }}>{a2.t}</button>
                  ))}
                </div>
              </div>
              <button onClick={confirmThenBatch} disabled={!batchVariants.length || busyAll || batchBusy || payBlocked} style={{ ...primaryBtn(!batchVariants.length || busyAll || batchBusy), ...(confirmBatch && !batchBusy ? { background: "#dc2626" } : {}) }}>
                {batchBusy
                  ? `批量出片中… ${Object.values(batchOut).filter((x) => x.status === "done").length}/${batchVariants.length} 版`
                  : confirmBatch
                  ? `⚠ 再点一次确认：${batchVariants.length} 版 × ${filmTotalSec(shots)} 秒 · ${cost(filmTotalSec(shots) * batchVariants.length, videoRes)}`
                  : batchVariants.length
                  ? `⧉ 批量出片（${batchVariants.length} 版 · ${cost(filmTotalSec(shots) * batchVariants.length, videoRes)}）`
                  : "先选语种和画幅"}
              </button>
              {batchBusy ? (
                <button onClick={requestStop} style={stopBtn} title="停止后：还没发起的版本不再提交；已经提交的照常跑完并计费">{stopping ? "已请求停止…" : "⏹ 停止（未提交的版本）"}</button>
              ) : null}
              {Object.keys(batchOut).length ? (
                <div style={{ marginTop: 12 }}>
                  {Object.entries(batchOut).map(([k, it]) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #f1f5f9", fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: "#334155", minWidth: 130 }}>{langName(it.lang)} · {it.aspect}</span>
                      <span style={{ color: it.status === "err" ? "#ef4444" : it.status === "done" ? "#059669" : "#94a3b8", flex: 1 }}>
                        {it.status === "gen" ? `出片中 ${it.done}/${it.total} 场` : it.status === "done" ? `完成 ${it.done}/${it.total} 场` : it.status === "err" ? it.err || "失败" : "排队中"}
                      </span>
                      {Object.entries(it.urls).map(([no, u]) => (
                        <a key={no} href={u} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#7c3aed", textDecoration: "none" }}>场{no}↗</a>
                      ))}
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, lineHeight: 1.7 }}>
                    每版的成片按场分别给出链接，点开另存。平台链接 24 小时后失效，批量跑完请尽快下载。
                  </div>
                </div>
              ) : null}
              </>
              ) : null}
            </section>
          ) : null}

          {err ? <div style={errBox}>{err}</div> : null}
          <div style={{ height: 40 }} />
        </div>
      </div>
    </div>
  );
}

/* ---------- styles ---------- */
const page: React.CSSProperties = { position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#fafafa", fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif" };
const topbar: React.CSSProperties = { height: 52, flexShrink: 0, background: "#fff", borderBottom: "1px solid #ececec", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px" };
const scroll: React.CSSProperties = { flex: 1, overflowY: "auto" };
const container: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "32px 20px 0" };
const h1: React.CSSProperties = { fontSize: 26, fontWeight: 800, color: "#16181d", textAlign: "center", margin: "0 0 8px" };
const sub: React.CSSProperties = { fontSize: 14, color: "#8b8f98", textAlign: "center", margin: "0 0 28px" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #ececec", borderRadius: 16, padding: 20, marginBottom: 18, boxShadow: "0 1px 3px rgba(15,17,21,0.04)" };
const cardHead: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 };
const stepNo: React.CSSProperties = { width: 24, height: 24, borderRadius: "50%", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: "#16181d" };
const textarea: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px", fontSize: 14, lineHeight: 1.6, resize: "vertical", outline: "none", color: "#16181d" };
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8 };
const input: React.CSSProperties = { boxSizing: "border-box", height: 34, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 13, outline: "none", color: "#16181d" };
const input2: React.CSSProperties = { boxSizing: "border-box", width: "100%", height: 34, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 13, outline: "none", color: "#16181d" };
const presetHint: React.CSSProperties = { marginTop: 10, fontSize: 12, color: "#9ca3af", lineHeight: 1.5, background: "#f8fafc", borderRadius: 8, padding: "8px 10px" };
const primaryBtn = (disabled: boolean): React.CSSProperties => ({ width: "100%", height: 44, marginTop: 18, borderRadius: 10, border: "none", background: disabled ? "#e5e7eb" : "#7c3aed", color: disabled ? "#9ca3af" : "#fff", fontSize: 15, fontWeight: 700, cursor: disabled ? "default" : "pointer" });
const chip = (on: boolean): React.CSSProperties => ({ height: 32, padding: "0 14px", borderRadius: 999, border: `1px solid ${on ? "#7c3aed" : "#e5e7eb"}`, background: on ? "#7c3aed" : "#fff", color: on ? "#fff" : "#4b5563", fontSize: 13, fontWeight: 600, cursor: "pointer" });
const shotRow: React.CSSProperties = { display: "flex", gap: 12, padding: 12, borderRadius: 12, border: "1px solid #f0f0f0", background: "#fcfcfd" };
const shotNoBadge: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, background: "#eef2ff", color: "#4f46e5", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const metaChip: React.CSSProperties = { fontSize: 11, color: "#7c6f9b", background: "#f5f3ff", borderRadius: 6, padding: "2px 7px" };
const shotContent: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", fontSize: 13, lineHeight: 1.6, resize: "vertical", outline: "none", color: "#16181d", background: "#fff" };
const frameGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 };
const frameCell: React.CSSProperties = {};
const frameThumb: React.CSSProperties = { width: "100%", aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", background: "#f1f5f9", border: "1px solid #e4e4e7", display: "flex", alignItems: "center", justifyContent: "center" };
// ④ 视频预览：更大的格子 + 竖版比例，方便看清成片
const videoGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 };
const videoThumb: React.CSSProperties = { width: "100%", aspectRatio: "3 / 4", borderRadius: 10, overflow: "hidden", background: "#000", border: "1px solid #e4e4e7", display: "flex", alignItems: "center", justifyContent: "center" };
const frameMsg: React.CSSProperties = { fontSize: 12, color: "#94a3b8" };
const stopBtn: React.CSSProperties = { width: "100%", height: 36, marginTop: 8, borderRadius: 10, border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const miniBtn: React.CSSProperties = { height: 20, width: 24, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 11, cursor: "pointer", padding: 0, lineHeight: "18px" };
const collapseBtn: React.CSSProperties = { height: 26, padding: "0 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 12, cursor: "pointer" };
const reBtn: React.CSSProperties = { width: 24, height: 24, borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontSize: 12, cursor: "pointer", lineHeight: 1 };
const errBox: React.CSSProperties = { background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 18 };
