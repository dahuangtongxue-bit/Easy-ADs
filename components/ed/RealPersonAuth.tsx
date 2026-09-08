"use client";

import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { rehostImage, rpRegister, rpStartSession, rpStatus } from "@/lib/maas";

// 真人活体数字人：客户本人 / 代言人 → 手机活体认证 → 登记本人照片 → 拿到 assetId → 2.5 原生锁脸。
// 这是 2.5 独占能力（形象图三视图只是绕路，活体素材才是真锁脸）。
// 链路不查「活体做完了没」——活体结果直接体现在 GetAsset：Active = 本人匹配；Failed = 没做活体或不是本人。
export type RealPersonCast = { name: string; img: string; assetId: string };

type Props = {
  onDone: (c: RealPersonCast) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
};

const box: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fafafa", marginTop: 8 };
const btn: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 999, padding: "4px 12px", background: "#fff", fontSize: 12, cursor: "pointer" };
const btnPri: React.CSSProperties = { ...btn, background: "#111827", color: "#fff", borderColor: "#111827", fontWeight: 700 };
const hint: React.CSSProperties = { fontSize: 11, color: "#6b7280", lineHeight: 1.6 };

export default function RealPersonAuth({ onDone, onError, disabled }: Props) {
  const [open, setOpen] = useState(false);
  // 步骤一：活体会话
  const [h5Link, setH5Link] = useState("");
  const [qr, setQr] = useState("");
  const [left, setLeft] = useState(0); // 会话剩余秒
  const [sessBusy, setSessBusy] = useState(false);
  const [liveDone, setLiveDone] = useState(false); // 用户自报「手机上做完了」
  // 步骤二：照片登记
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(""); // 活体结果页给的真人组 Id（group-2026…-xxxxx），手机上一键复制过来
  const [regBusy, setRegBusy] = useState(false);
  const [regMsg, setRegMsg] = useState("");
  const [preview, setPreview] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isMobile = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  // 倒计时
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const fail = (m: string) => { setRegMsg(m); onError?.(m); };

  async function startSession() {
    setSessBusy(true);
    setRegMsg("");
    try {
      const s = await rpStartSession();
      setH5Link(s.h5Link);
      setLeft(s.expiresIn || 120);
      setLiveDone(false);
      // 二维码：链接 ~900 字符，密度高，画大一点手机才扫得动
      const url = await QRCode.toDataURL(s.h5Link, { errorCorrectionLevel: "L", margin: 1, width: 320 });
      setQr(url);
    } catch (e: any) {
      fail(`开活体会话失败：${String(e?.message || e)}`);
    }
    setSessBusy(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const nm = name.trim().slice(0, 8);
    if (!nm) { fail("先给这位真人数字人起个名字（2~6 字，如 张总/小李）"); return; }
    setRegBusy(true);
    setRegMsg("转存照片…");
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("图片读取失败"));
        r.readAsDataURL(f);
      });
      setPreview(dataUrl);
      const hosted = await rehostImage(dataUrl.replace(/^data:[^,]+,/, ""));
      setRegMsg("登记到真人素材库…");
      const gid = groupId.trim();
      if (gid && !/^group-\d{14}-[a-z0-9]{4,8}$/i.test(gid)) { fail("GroupId 格式不对：应为 group-年月日时分秒-5位，例如 group-20260907224355-v6gm4"); setRegBusy(false); return; }
      const { assetId } = await rpRegister(hosted, nm, gid);
      // 轮询：素材审核是异步的（跟视频任务一个德性：拿到 Id ≠ 成功），必须等到 Active / Failed
      let st = "";
      let reason = "";
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, i < 5 ? 2000 : 3000));
        const q = await rpStatus(assetId);
        st = (q.status || "").toLowerCase();
        reason = q.reason || "";
        setRegMsg(`平台核验中（${st || "pending"}）… ${i + 1}`);
        if (st === "active" || st === "failed" || st === "fail" || st === "rejected") break;
      }
      if (st === "active") {
        setRegMsg("");
        onDone({ name: nm, img: hosted, assetId });
        // 收尾：清会话，留名字方便再登记一位
        setH5Link(""); setQr(""); setLeft(0); setLiveDone(false); setPreview(""); setName(""); setGroupId("");
        setOpen(false);
      } else if (!st) {
        fail("核验超时：平台还没给结果。稍后可用「贴 assetId」方式补录，或重试。");
      } else {
        fail(`核验未通过（${st}）${reason ? "：" + reason : ""}。常见原因：手机上没做完活体、照片不是活体本人、照片不是清晰正脸。`);
      }
    } catch (err: any) {
      fail(`登记失败：${String(err?.message || err)}`);
    }
    setRegBusy(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} disabled={disabled} style={{ ...btn, opacity: disabled ? 0.5 : 1 }} title="客户本人/代言人做一次活体认证，之后 2.5 出片原生锁脸（比形象图稳得多）">
        🪪 活体认证真人数字人
      </button>
    );
  }

  return (
    <div style={{ ...box, width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>🪪 活体认证真人数字人 <span style={{ fontWeight: 400, color: "#6b7280" }}>· Seedance 2.5 原生锁脸</span></div>
        <button onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", color: "#9ca3af", cursor: "pointer", fontSize: 14 }} title="收起">✕</button>
      </div>
      <div style={hint}>
        真人的脸不能靠照片直接登记——平台要求<b>本人做一次活体认证</b>（手机刷脸，2 分钟内），然后再传本人照片，平台核对是同一个人才放行。认证一次长期有效，之后这位真人在 2.5 上出片就是原生锁脸，转头、大动作都不漂。
      </div>

      {/* 步骤一 */}
      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: "#374151" }}>① 手机活体认证</div>
      {!h5Link ? (
        <div style={{ marginTop: 6 }}>
          <button onClick={() => void startSession()} disabled={sessBusy} style={{ ...btnPri, opacity: sessBusy ? 0.6 : 1 }}>{sessBusy ? "生成中…" : isMobile ? "开始活体认证" : "生成认证二维码"}</button>
          <span style={{ ...hint, marginLeft: 8 }}>让要出镜的真人本人来做（客户、老板、代言人）。</span>
        </div>
      ) : (
        <div style={{ marginTop: 6, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          {!isMobile && qr && <img src={qr} alt="活体认证二维码" style={{ width: 200, height: 200, borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff" }} />}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={hint}>
              {isMobile ? "点下面按钮进入认证页，按提示刷脸。" : "用手机（微信/相机）扫码，按提示刷脸。"}
              {left > 0 ? <span style={{ color: left <= 20 ? "#b91c1c" : "#374151", fontWeight: 700 }}>　剩余 {left} 秒</span> : <span style={{ color: "#b91c1c", fontWeight: 700 }}>　已过期，请重新生成</span>}
            </div>
            <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {isMobile && left > 0 && <a href={h5Link} target="_blank" rel="noreferrer" style={{ ...btnPri, textDecoration: "none", display: "inline-block" }}>打开认证页</a>}
              <button onClick={() => void startSession()} disabled={sessBusy} style={btn}>{left > 0 ? "重新生成" : "重新生成二维码"}</button>
              {left > 0 && !liveDone && <button onClick={() => setLiveDone(true)} style={btn}>手机上做完了 →</button>}
              {liveDone && <span style={{ ...hint, color: "#047857", fontWeight: 700 }}>✓ 已做完活体，去登记照片</span>}
            </div>
          </div>
        </div>
      )}

      {/* 步骤二 */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: liveDone || h5Link ? "#374151" : "#9ca3af" }}>② 登记本人照片</div>
      <div style={{ ...hint, marginTop: 2 }}>活体做完，手机结果页会显示「真人认证成功，素材组已创建」和一个 <b>GroupId</b>（点「复制」）——把它粘到下面；再传一张<b>本人清晰正脸照</b>（光线均匀、无遮挡、无滤镜）。平台会核对是不是活体那个人，不是就不放行。</div>
      <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={groupId} onChange={(e) => setGroupId(e.target.value.trim())} placeholder="手机上复制的 GroupId：group-2026…" style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "4px 8px", fontSize: 12, width: 250, fontFamily: "monospace" }} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="角色名（如 张总）" maxLength={8} style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "4px 8px", fontSize: 12, width: 120 }} />
        <button onClick={() => fileRef.current?.click()} disabled={regBusy || !name.trim() || !groupId.trim()} style={{ ...btnPri, opacity: regBusy || !name.trim() || !groupId.trim() ? 0.5 : 1 }} title={!groupId.trim() ? "先粘贴手机上的 GroupId" : ""}>{regBusy ? "登记中…" : "上传本人照片并登记"}</button>
        <input ref={fileRef} type="file" accept="image/*" onChange={(e) => void onFile(e)} style={{ display: "none" }} />
        {preview && <img src={preview} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />}
      </div>
      {regMsg && <div style={{ ...hint, marginTop: 6, color: /失败|未通过|超时/.test(regMsg) ? "#b91c1c" : "#374151" }}>{regMsg}</div>}
    </div>
  );
}
