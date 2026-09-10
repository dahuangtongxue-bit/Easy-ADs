"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { rehostImage, submitVideo, pollVideoUntilDone, getAccessKey } from "@/lib/maas";
import { LANGS, ratePerSec } from "@/lib/filmScript";
import { CAST_PRESETS } from "@/lib/castPresets";
import CAST_ANGLES from "@/lib/castAngles.json";
import RealPersonAuth from "@/components/ed/RealPersonAuth";
import { APP_VERSION } from "@/lib/version";
import {
  AD_TEMPLATES,
  assembleRefs,
  buildAdPrompt,
  fallbackBeats,
  type AdAsset,
  type AdPerson,
  type AdTemplateKey,
  type AudioRole,
  type Beat,
  type ImageRole,
  type VideoRole,
} from "@/lib/adBrain";

const VID_MODEL = "doubao-seedance-2-5-260628";

type Asset = AdAsset & { preview: string; status: "uploading" | "ready" | "error"; err?: string; sizeMB: number };

type Work = {
  id: string;
  at: number;
  url: string;
  sec: number;
  aspect: string;
  res: string;
  template: AdTemplateKey;
  brief: string;
  productName: string;
  prompt: string;
  taskId: string;
};

const IMAGE_ROLES: { key: ImageRole; label: string; hint: string }[] = [
  { key: "product", label: "商品", hint: "主体，@参考 + 尾段定格" },
  { key: "detail", label: "商品细节", hint: "同一件商品的其他角度" },
  { key: "scene", label: "场景", hint: "店面 / 使用环境" },
  { key: "style", label: "风格", hint: "只取色调与质感" },
  { key: "logo", label: "logo", hint: "不进生成，留给叠加" },
];
const VIDEO_USES: { key: VideoRole; label: string }[] = [
  { key: "motion", label: "动作" },
  { key: "camera", label: "运镜" },
  { key: "rhythm", label: "节奏" },
  { key: "style", label: "风格" },
];
const AUDIO_ROLES: { key: AudioRole; label: string }[] = [
  { key: "music", label: "配乐风格" },
  { key: "voice", label: "人物音色" },
];

const WORKS_KEY = "easyads-works";
const DRAFT_KEY = "easyads-draft";

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 图片先在浏览器里压到长边 ≤ 2048、JPEG 0.9，再转存图床——避免 6MB 函数上限，也更快。 */
async function fileToJpegBase64(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("图片读取失败"));
      im.src = url;
    });
    const max = 2048;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.9).replace(/^data:[^,]+,/, "");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadMedia(file: File): Promise<string> {
  const res = await fetch("/.netlify/functions/media-put", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name), "x-access-key": getAccessKey() },
    body: file,
  });
  const j: any = await res.json().catch(() => null);
  if (!res.ok || !j?.url) throw new Error(j?.error || `上传失败（${res.status}）`);
  return j.url as string;
}

export default function AdMode() {
  // ---------- ① 素材 ----------
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ---------- ② 人物 ----------
  const [person, setPerson] = useState<AdPerson>({ type: "none" });
  const [personTab, setPersonTab] = useState<"none" | "real" | "roster" | "photo">("none");
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement | null>(null);

  // ---------- ③ 主题 ----------
  const [brief, setBrief] = useState("");
  const [productName, setProductName] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [template, setTemplate] = useState<AdTemplateKey>("pain");
  const [sec, setSec] = useState<15 | 20 | 30>(30);
  const [aspect, setAspect] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [res, setRes] = useState<"720p" | "1080p">("720p");
  const [lang, setLang] = useState("zh");

  // ---------- 节拍表 ----------
  const [beats, setBeats] = useState<Beat[]>([]);
  const [beatsNote, setBeatsNote] = useState("");
  const [beatsBusy, setBeatsBusy] = useState(false);
  const [beatsOpen, setBeatsOpen] = useState(false);

  // ---------- 出片 ----------
  const [job, setJob] = useState<{ status: "idle" | "script" | "submit" | "gen" | "done" | "error"; progress?: number; err?: string; url?: string; taskId?: string; prompt?: string; startedAt?: number }>({ status: "idle" });
  const cancelRef = useRef(false);
  const [works, setWorks] = useState<Work[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [tick, setTick] = useState(0);

  // 本地草稿与作品
  useEffect(() => {
    try {
      const w = JSON.parse(localStorage.getItem(WORKS_KEY) || "[]");
      if (Array.isArray(w)) setWorks(w);
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d) {
        if (typeof d.brief === "string") setBrief(d.brief);
        if (typeof d.productName === "string") setProductName(d.productName);
        if (typeof d.productDesc === "string") setProductDesc(d.productDesc);
        if (AD_TEMPLATES.some((t) => t.key === d.template)) setTemplate(d.template);
        if ([15, 20, 30].includes(d.sec)) setSec(d.sec);
        if (["9:16", "16:9", "1:1"].includes(d.aspect)) setAspect(d.aspect);
        if (["720p", "1080p"].includes(d.res)) setRes(d.res);
        if (typeof d.lang === "string") setLang(d.lang);
        if (Array.isArray(d.assets)) setAssets(d.assets.filter((a: Asset) => a.status === "ready" && a.url).map((a: Asset) => ({ ...a, preview: a.url })));
        if (d.person && d.person.type) { setPerson(d.person); setPersonTab(d.person.type); }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ brief, productName, productDesc, template, sec, aspect, res, lang, assets: assets.filter((a) => a.status === "ready"), person }));
    } catch {}
  }, [brief, productName, productDesc, template, sec, aspect, res, lang, assets, person]);
  useEffect(() => {
    if (job.status !== "gen" && job.status !== "submit" && job.status !== "script") return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  // ---------- 素材处理 ----------
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const f of list) {
      const id = uid();
      const isImg = /^image\//.test(f.type);
      const isVid = /^video\//.test(f.type);
      const isAud = /^audio\//.test(f.type);
      if (!isImg && !isVid && !isAud) continue;
      const preview = URL.createObjectURL(f);
      const sizeMB = f.size / 1048576;
      setAssets((cur) => {
        const hasProduct = cur.some((a) => a.kind === "image" && a.role === "product");
        const base = { id, name: f.name, url: "", preview, status: "uploading" as const, sizeMB };
        const a: Asset = isImg
          ? { ...base, kind: "image", role: hasProduct ? "detail" : "product" }
          : isVid
          ? { ...base, kind: "video", role: "motion", uses: ["motion"] }
          : { ...base, kind: "audio", role: "music" };
        return [...cur, a];
      });
      try {
        let url = "";
        if (isImg) url = await rehostImage(await fileToJpegBase64(f));
        else url = await uploadMedia(f);
        setAssets((cur) => cur.map((a) => (a.id === id ? { ...a, url, status: "ready" } : a)));
      } catch (e: any) {
        setAssets((cur) => cur.map((a) => (a.id === id ? { ...a, status: "error", err: String(e?.message || e) } : a)));
      }
    }
  }, []);

  function addUrl() {
    const u = urlInput.trim();
    if (!/^https?:\/\//.test(u)) return;
    const isVid = /\.(mp4|mov|webm)(\?|$)/i.test(u);
    const isAud = /\.(mp3|wav|m4a)(\?|$)/i.test(u);
    const id = uid();
    const base = { id, name: u.split("/").pop() || u, url: u, preview: u, status: "ready" as const, sizeMB: 0 };
    setAssets((cur) => {
      const hasProduct = cur.some((a) => a.kind === "image" && a.role === "product");
      const a: Asset = isVid ? { ...base, kind: "video", role: "motion", uses: ["motion"] } : isAud ? { ...base, kind: "audio", role: "music" } : { ...base, kind: "image", role: hasProduct ? "detail" : "product" };
      return [...cur, a];
    });
    setUrlInput("");
  }

  function setImageRole(id: string, role: ImageRole) {
    setAssets((cur) => cur.map((a) => (a.id === id && a.kind === "image" ? { ...a, role } : a)));
  }
  function toggleVideoUse(id: string, use: VideoRole) {
    setAssets((cur) =>
      cur.map((a) => {
        if (a.id !== id || a.kind !== "video") return a;
        const uses = a.uses || [];
        const next = uses.includes(use) ? uses.filter((u) => u !== use) : [...uses, use];
        return { ...a, uses: next.length ? next : ["motion"], role: next[0] || "motion" };
      })
    );
  }
  function setAudioRole(id: string, role: AudioRole) {
    setAssets((cur) => cur.map((a) => (a.id === id && a.kind === "audio" ? { ...a, role } : a)));
  }
  function removeAsset(id: string) {
    setAssets((cur) => cur.filter((a) => a.id !== id));
  }

  // ---------- 人物 ----------
  async function onPhoto(f: File) {
    setPhotoBusy(true);
    try {
      const url = await rehostImage(await fileToJpegBase64(f));
      setPerson({ type: "photo", name: "代言人", img: url, desc: "" });
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setPhotoBusy(false);
    }
  }
  function pickRoster(assetId: string) {
    const p = CAST_PRESETS.find((x) => x.assetId === assetId);
    if (!p) return;
    const angles = ((CAST_ANGLES as Record<string, string[]>)[assetId] || []).slice(0, 2);
    setPerson({ type: "roster", name: p.label.split("·")[1]?.trim() || p.label, img: p.img, assetId, desc: p.desc, angles });
  }

  // ---------- 派生 ----------
  const readyAssets = assets.filter((a) => a.status === "ready");
  const productImgs = readyAssets.filter((a) => a.kind === "image" && (a.role === "product" || a.role === "detail"));
  const uploading = assets.some((a) => a.status === "uploading");
  const canGo = productImgs.length > 0 && productName.trim().length > 0 && !uploading && job.status !== "gen" && job.status !== "submit" && job.status !== "script";
  const price = (sec * ratePerSec(res)).toFixed(0);
  const assetNote = useMemo(() => {
    const n = (k: string) => readyAssets.filter((a) => a.kind === "image" && (a as any).role === k).length;
    const parts: string[] = [];
    if (n("product")) parts.push(`商品图 ${n("product")} 张`);
    if (n("detail")) parts.push(`商品细节图 ${n("detail")} 张`);
    if (n("scene")) parts.push(`场景图 ${n("scene")} 张`);
    if (readyAssets.some((a) => a.kind === "video")) parts.push("有实拍参考视频");
    if (person.type !== "none") parts.push("有固定人物出镜");
    return parts.join("，");
  }, [readyAssets, person]);

  // ---------- 节拍表 ----------
  async function makeBeats(): Promise<Beat[]> {
    setBeatsBusy(true);
    setBeatsNote("");
    try {
      const r = await fetch("/api/adscript", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-key": getAccessKey() },
        body: JSON.stringify({ brief, productName, productDesc, template, sec, lang, personKind: person.type, personName: person.type === "none" ? "" : person.name, assetNote }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || `节拍表失败（${r.status}）`);
      const b: Beat[] = Array.isArray(j?.beats) && j.beats.length === 5 ? j.beats : fallbackBeats(sec, template, productName);
      if (j?.note) setBeatsNote(String(j.note));
      setBeats(b);
      setBeatsOpen(true);
      return b;
    } catch (e: any) {
      const b = fallbackBeats(sec, template, productName);
      setBeats(b);
      setBeatsNote(`${String(e?.message || e)}，已用模板节拍`);
      setBeatsOpen(true);
      return b;
    } finally {
      setBeatsBusy(false);
    }
  }
  function editBeat(i: number, patch: Partial<Beat>) {
    setBeats((cur) => cur.map((b, ix) => (ix === i ? { ...b, ...patch } : b)));
  }

  // ---------- 出片 ----------
  async function generate(reuseBeats?: boolean) {
    if (!canGo) return;
    cancelRef.current = false;
    setJob({ status: "script", startedAt: Date.now() });
    let useBeats = beats;
    if (!reuseBeats || useBeats.length !== 5 || useBeats[4].t1 !== sec) {
      useBeats = await makeBeats();
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const refs = assembleRefs(readyAssets, person, { origin });
    const prompt = buildAdPrompt({ brief, productName, productDesc, template, sec, aspect, lang, beats: useBeats, person, refs });
    setJob({ status: "submit", prompt, startedAt: Date.now() });
    try {
      const taskId = await submitVideo({
        referenceImageUrls: refs.images.map((x) => x.url),
        sourceVideoUrls: refs.videos.length ? refs.videos.map((v) => v.url) : undefined,
        referenceAudioUrls: refs.audios.length ? refs.audios.map((a) => a.url) : undefined,
        prompt,
        model: VID_MODEL,
        resolution: res,
        duration: String(sec),
        ratio: aspect,
      });
      setJob({ status: "gen", taskId, prompt, progress: 0, startedAt: Date.now() });
      const url = await pollVideoUntilDone(taskId, VID_MODEL, (p) => setJob((j) => ({ ...j, progress: p })), () => cancelRef.current);
      setJob({ status: "done", taskId, prompt, url, startedAt: Date.now() });
      const w: Work = { id: uid(), at: Date.now(), url, sec, aspect, res, template, brief, productName, prompt, taskId };
      setWorks((cur) => {
        const next = [w, ...cur].slice(0, 30);
        try { localStorage.setItem(WORKS_KEY, JSON.stringify(next)); } catch {}
        return next;
      });
    } catch (e: any) {
      setJob((j) => ({ ...j, status: "error", err: String(e?.message || e) }));
    }
  }
  function cancel() {
    cancelRef.current = true;
    setJob({ status: "idle" });
  }

  const elapsed = job.startedAt ? Math.round((Date.now() - job.startedAt) / 1000) : 0;
  void tick;

  // ---------- 渲染 ----------
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-30 border-b hairline bg-[rgba(10,12,16,0.8)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4 md:px-6">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="wordmark text-[19px]">Easy<span className="text-accent">-</span>ADs</Link>
            <span className="text-[12px] text-ink-3">素材直出 · v{APP_VERSION}</span>
          </div>
          <nav className="flex items-center gap-2 text-[13px]">
            <span className="chip chip-accent">素材直出</span>
            <Link href="/app/studio" className="chip hover:text-ink">导演模式</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1200px] grid-cols-1 gap-6 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-6">
          {/* ① 素材 */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-bold"><span className="mr-2 text-accent">①</span>丢素材</h2>
              <span className="text-[12px] text-ink-3">图片进图床 · 视频音频 ≤ 5MB · 一次最多 30 图 / 3 段视频 / 2 段音频</span>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition ${dragOver ? "border-accent bg-[var(--accent-soft)]" : "border-[var(--line-strong)] hover:border-accent"}`}
            >
              <div className="text-[15px] font-bold">把商品图、实拍片段、场景图、logo 全拖进来</div>
              <div className="mt-1 text-[12.5px] text-ink-2">第一张图默认当商品主体，其余自动标成商品细节；标签可以改</div>
              <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            </div>
            <div className="mt-3 flex gap-2">
              <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUrl()} placeholder="或粘贴公网图片 / 视频 / 音频 URL" className="flex-1 rounded-lg border hairline bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent" />
              <button onClick={addUrl} className="btn btn-ghost !py-2 !px-4 text-[13px]">加入</button>
            </div>

            {assets.length > 0 && (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {assets.map((a) => (
                  <li key={a.id} className="overflow-hidden rounded-xl border hairline bg-surface-2">
                    <div className="relative aspect-square bg-black">
                      {a.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.preview} alt={a.name} className="h-full w-full object-cover" />
                      ) : a.kind === "video" ? (
                        <video src={a.preview} muted playsInline className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[28px]">♪</div>
                      )}
                      <button onClick={() => removeAsset(a.id)} className="absolute right-1.5 top-1.5 h-6 w-6 rounded-full bg-[rgba(0,0,0,0.6)] text-[12px] text-white" aria-label="移除">×</button>
                      {a.status === "uploading" && <div className="absolute inset-x-0 bottom-0 bg-[rgba(0,0,0,0.6)] px-2 py-1 text-[11px] text-white">上传中…</div>}
                      {a.status === "error" && <div className="absolute inset-x-0 bottom-0 bg-[rgba(178,58,58,0.9)] px-2 py-1 text-[11px] text-white" title={a.err}>失败：{a.err}</div>}
                    </div>
                    <div className="p-2">
                      {a.kind === "image" && (
                        <select value={a.role} onChange={(e) => setImageRole(a.id, e.target.value as ImageRole)} className="w-full rounded-md border hairline bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent">
                          {IMAGE_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label} · {r.hint}</option>)}
                        </select>
                      )}
                      {a.kind === "video" && (
                        <div className="flex flex-wrap gap-1">
                          {VIDEO_USES.map((u) => (
                            <button key={u.key} onClick={() => toggleVideoUse(a.id, u.key)} className={`chip !text-[11px] ${a.uses?.includes(u.key) ? "chip-accent" : ""}`}>{u.label}</button>
                          ))}
                        </div>
                      )}
                      {a.kind === "audio" && (
                        <select value={a.role} onChange={(e) => setAudioRole(a.id, e.target.value as AudioRole)} className="w-full rounded-md border hairline bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent">
                          {AUDIO_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ② 人物 */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-bold"><span className="mr-2 text-accent">②</span>补个人（可选）</h2>
              <span className="text-[12px] text-ink-3">老板本人走活体，数字人走演员库</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {([["none", "不要人物"], ["real", "真人活体 · 老板本人"], ["roster", "演员库 · 48 人"], ["photo", "上传一张照片"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => { setPersonTab(k); if (k === "none") setPerson({ type: "none" }); }} className={`chip !py-1.5 !px-3 !text-[12.5px] ${personTab === k ? "chip-accent bg-[var(--accent-soft)]" : ""}`}>{label}</button>
              ))}
            </div>

            {personTab === "real" && (
              <div className="mt-3 rounded-xl bg-white p-3" style={{ color: "#16181d", colorScheme: "light" }}>
                {person.type === "real" ? (
                  <div className="flex items-center gap-3 text-[13px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={person.img} alt={person.name} className="h-14 w-14 rounded-lg object-cover" />
                    <div className="flex-1">
                      <div className="font-bold">🪪 {person.name} · 本人</div>
                      <div className="text-[12px] text-[#6b7280]">活体素材已登记，出片原生锁脸</div>
                    </div>
                    <button onClick={() => setPerson({ type: "none" })} className="rounded-full border px-3 py-1 text-[12px]">换人</button>
                  </div>
                ) : (
                  <RealPersonAuth onDone={(c) => setPerson({ type: "real", name: c.name, img: c.img, assetId: c.assetId, desc: "" })} onError={(m) => alert(m)} />
                )}
              </div>
            )}

            {personTab === "roster" && (
              <div className="mt-3">
                <div className="grid max-h-[260px] grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6 md:grid-cols-8">
                  {CAST_PRESETS.map((p) => {
                    const on = person.type === "roster" && person.assetId === p.assetId;
                    return (
                      <button key={p.assetId} onClick={() => pickRoster(p.assetId)} title={p.desc} className={`overflow-hidden rounded-lg border text-left ${on ? "border-accent" : "border-[var(--line)]"}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.img} alt={p.label} className="aspect-[3/4] w-full object-cover" />
                        <div className="truncate px-1 py-0.5 text-[10.5px] text-ink-2">{p.label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {personTab === "photo" && (
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => photoRef.current?.click()} disabled={photoBusy} className="btn btn-ghost !py-2 !px-4 text-[13px]">{photoBusy ? "上传中…" : person.type === "photo" ? "换一张" : "选择照片"}</button>
                <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])} />
                {person.type === "photo" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={person.img} alt="人物" className="h-14 w-14 rounded-lg object-cover" />
                )}
                <span className="text-[12px] text-ink-3">正脸清晰、无遮挡；真人建议走活体认证，锁脸更稳</span>
              </div>
            )}

            {person.type !== "none" && (
              <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr]">
                <input value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value } as AdPerson)} placeholder="人物叫什么" className="rounded-lg border hairline bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent" />
                <input value={person.desc} onChange={(e) => setPerson({ ...person, desc: e.target.value } as AdPerson)} placeholder="造型锁定：发型 / 服装 / 头饰（全片不变）" className="rounded-lg border hairline bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent" />
              </div>
            )}
          </section>

          {/* ③ 主题 */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-bold"><span className="mr-2 text-accent">③</span>说一句要讲什么</h2>
              <span className="text-[12px] text-ink-3">一句话 + 选个结构，节拍表自动写</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="商品叫什么（必填），如：老张牛肉面 午市套餐" className="rounded-lg border hairline bg-surface-2 px-3 py-2.5 text-[14px] outline-none focus:border-accent" />
              <input value={productDesc} onChange={(e) => setProductDesc(e.target.value)} placeholder="商品外观一句话：颜色 / 材质 / 形状" className="rounded-lg border hairline bg-surface-2 px-3 py-2.5 text-[14px] outline-none focus:border-accent" />
            </div>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={2} placeholder="主题，如：新品上市，主打十分钟出餐；或：老板亲自讲三个卖点" className="mt-3 w-full rounded-lg border hairline bg-surface-2 px-3 py-2.5 text-[14px] outline-none focus:border-accent" />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AD_TEMPLATES.map((t) => (
                <button key={t.key} onClick={() => setTemplate(t.key)} className={`rounded-lg border px-3 py-2 text-left transition ${template === t.key ? "border-accent bg-[var(--accent-soft)]" : "border-[var(--line)] hover:border-[var(--line-strong)]"}`}>
                  <div className="text-[13.5px] font-bold">{t.name}</div>
                  <div className="text-[11.5px] text-ink-3">{t.fit}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]">
              <div className="flex items-center gap-1.5"><span className="text-ink-3">片长</span>{([15, 20, 30] as const).map((s) => <button key={s} onClick={() => setSec(s)} className={`chip !text-[12px] ${sec === s ? "chip-accent" : ""}`}>{s} 秒</button>)}</div>
              <div className="flex items-center gap-1.5"><span className="text-ink-3">画幅</span>{(["9:16", "16:9", "1:1"] as const).map((a) => <button key={a} onClick={() => setAspect(a)} className={`chip !text-[12px] ${aspect === a ? "chip-accent" : ""}`}>{a}</button>)}</div>
              <div className="flex items-center gap-1.5"><span className="text-ink-3">清晰度</span>{(["720p", "1080p"] as const).map((r) => <button key={r} onClick={() => setRes(r)} className={`chip !text-[12px] ${res === r ? "chip-accent" : ""}`}>{r}</button>)}</div>
              <div className="flex items-center gap-1.5"><span className="text-ink-3">台词</span>
                <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-md border hairline bg-surface-2 px-2 py-1 text-[12px] outline-none">
                  {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* 节拍表 */}
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-bold"><span className="mr-2 text-accent">④</span>节拍表 <span className="text-[12px] font-normal text-ink-3">五段时间戳，出片前可改</span></h2>
              <div className="flex items-center gap-2">
                <button onClick={() => makeBeats()} disabled={beatsBusy || !productName.trim()} className="btn btn-ghost !py-1.5 !px-3 text-[12.5px] disabled:opacity-50">{beatsBusy ? "编剧写作中…" : beats.length ? "重写节拍" : "先写节拍表"}</button>
                {beats.length > 0 && <button onClick={() => setBeatsOpen((o) => !o)} className="chip !text-[12px]">{beatsOpen ? "收起" : "展开"}</button>}
              </div>
            </div>
            {beatsNote && <div className="mt-2 text-[12px] text-[var(--warn,#e0a84a)]">{beatsNote}</div>}
            {beatsOpen && beats.length === 5 && (
              <ol className="mt-3 grid gap-2">
                {beats.map((b, i) => (
                  <li key={i} className="grid gap-1.5 rounded-lg border hairline bg-surface-2 p-3 sm:grid-cols-[64px_1fr]">
                    <div className="font-mono text-[12px] text-accent">{b.t0}–{b.t1}s</div>
                    <div className="grid gap-1.5">
                      <input value={b.action} onChange={(e) => editBeat(i, { action: e.target.value })} className="rounded-md border hairline bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent" placeholder="这一段发生什么" />
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        <input value={b.endState} onChange={(e) => editBeat(i, { endState: e.target.value })} className="rounded-md border hairline bg-bg px-2 py-1.5 text-[12.5px] outline-none focus:border-accent" placeholder="结束时画面停在…" />
                        <input value={b.line || ""} onChange={(e) => editBeat(i, { line: e.target.value })} className="rounded-md border hairline bg-bg px-2 py-1.5 text-[12.5px] outline-none focus:border-accent" placeholder={i === 4 ? "尾段不写台词" : "台词（可空）"} disabled={i === 4} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* 右栏：出片 */}
        <aside className="grid gap-4 self-start lg:sticky lg:top-20">
          <section className="card p-5">
            <div className="text-[12px] text-ink-3">这一条</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className="chip">{AD_TEMPLATES.find((t) => t.key === template)?.name}</span>
              <span className="chip">{sec} 秒</span>
              <span className="chip">{aspect}</span>
              <span className="chip">{res}</span>
              {person.type !== "none" && <span className="chip chip-accent">{person.type === "real" ? "🪪 真人" : "人物"} {person.name}</span>}
            </div>
            <div className="mt-3 text-[13px] text-ink-2">
              商品参考 {productImgs.length} 张 · 场景 {readyAssets.filter((a) => a.kind === "image" && a.role === "scene").length} 张 · 视频 {readyAssets.filter((a) => a.kind === "video").length} 段 · 音频 {readyAssets.filter((a) => a.kind === "audio").length} 段
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-[12px] text-ink-3">Seedance 2.5 · 单次生成</span>
              <span className="font-mono text-[15px] font-bold">≈ ¥{price}</span>
            </div>
            {job.status === "idle" || job.status === "done" || job.status === "error" ? (
              <button onClick={() => generate(beats.length === 5)} disabled={!canGo} className="btn btn-accent mt-4 w-full justify-center disabled:opacity-40">
                {uploading ? "素材上传中…" : productImgs.length === 0 ? "先放一张商品图" : !productName.trim() ? "填上商品名" : beats.length === 5 ? "按这份节拍出片" : "一键出广告"}
              </button>
            ) : (
              <button onClick={cancel} className="btn btn-ghost mt-4 w-full justify-center">
                {job.status === "script" ? `编剧写节拍中… ${elapsed}s` : job.status === "submit" ? `提交中… ${elapsed}s` : `生成中 ${typeof job.progress === "number" && job.progress > 0 ? job.progress + "% · " : ""}${elapsed}s · 点此取消`}
              </button>
            )}
            {job.status === "error" && <div className="mt-3 rounded-lg border border-[#b23a3a] bg-[rgba(178,58,58,0.12)] px-3 py-2 text-[12.5px]">{job.err}</div>}
            {job.status === "gen" && <div className="mt-2 text-[12px] text-ink-3">30 秒 720p 通常 3–10 分钟；关掉页面任务也会继续，回来在「作品」里拿。</div>}
            {job.prompt && (
              <div className="mt-3">
                <button onClick={() => setPromptOpen((o) => !o)} className="text-[12px] text-ink-3 underline-offset-2 hover:underline">{promptOpen ? "收起提示词" : "看这次的提示词"}</button>
                {promptOpen && <pre className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[11.5px] leading-relaxed text-ink-2">{job.prompt}</pre>}
              </div>
            )}
          </section>

          {job.status === "done" && job.url && (
            <section className="card overflow-hidden">
              <video src={job.url} controls autoPlay playsInline className="w-full bg-black" style={{ aspectRatio: aspect === "9:16" ? "9 / 16" : aspect === "1:1" ? "1 / 1" : "16 / 9", maxHeight: 520 }} />
              <div className="flex flex-wrap items-center gap-2 p-3">
                <a href={job.url} download={`easy-ads-${sec}s.mp4`} target="_blank" rel="noreferrer" className="btn btn-accent !py-2 !px-4 text-[13px]">下载成片</a>
                <button onClick={() => generate(true)} className="btn btn-ghost !py-2 !px-4 text-[13px]">再来一版</button>
                <button onClick={() => { setBeatsOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="btn btn-ghost !py-2 !px-4 text-[13px]">改节拍再出</button>
              </div>
              <div className="px-3 pb-3 text-[11.5px] text-ink-3">视频链接 24 小时内有效，满意就先下载。logo、价格、字幕在剪映里叠加。</div>
            </section>
          )}

          {works.length > 0 && (
            <section className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[13px] font-bold">作品</div>
                <span className="text-[11.5px] text-ink-3">{works.length} 条 · 本机保存</span>
              </div>
              <ul className="grid max-h-[320px] gap-2 overflow-y-auto">
                {works.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 rounded-lg bg-surface-2 p-2 text-[12.5px]">
                    <video src={w.url} muted playsInline preload="metadata" className="h-14 w-10 rounded bg-black object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{w.productName || "未命名"} · {AD_TEMPLATES.find((t) => t.key === w.template)?.name}</div>
                      <div className="text-ink-3">{new Date(w.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {w.sec}s · {w.aspect} · {w.res}</div>
                    </div>
                    <a href={w.url} target="_blank" rel="noreferrer" className="chip !text-[11px]">打开</a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
