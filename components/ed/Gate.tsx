"use client";

import { useEffect, useState } from "react";
import { getAccessKey, isAccessRequired, setAccessKey, verifyAccess } from "@/lib/maas";

type Phase = "checking" | "locked" | "open";

export default function Gate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const required = await isAccessRequired();
      if (!required) {
        setPhase("open");
        return;
      }
      const stored = getAccessKey();
      if (stored && (await verifyAccess(stored))) {
        setPhase("open");
      } else {
        setPhase("locked");
      }
    })();
  }, []);

  async function submit() {
    if (busy || !input.trim()) return;
    setBusy(true);
    setError("");
    const ok = await verifyAccess(input.trim());
    setBusy(false);
    if (ok) {
      setAccessKey(input.trim());
      setPhase("open");
    } else {
      setError("口令不对，再试试");
    }
  }

  if (phase === "open") return <>{children}</>;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0f1115",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, 'PingFang SC', sans-serif",
      }}
    >
      {phase === "checking" ? (
        <div style={{ color: "#9ca3af", fontSize: 14 }}>加载中…</div>
      ) : (
        <div style={{ width: 320, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Easy-ADs</div>
          <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 20 }}>丢素材，出广告 · 请输入访问口令</div>
          <input
            type="password"
            value={input}
            placeholder="访问口令"
            autoFocus
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #2a2f3a",
              background: "#1a1d24",
              color: "#fff",
              fontSize: 14,
              outline: "none",
            }}
          />
          {error && <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 8 }}>{error}</div>}
          <button
            onClick={submit}
            disabled={busy || !input.trim()}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 8,
              border: "none",
              background: busy || !input.trim() ? "#374151" : "#6366f1",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: busy || !input.trim() ? "default" : "pointer",
            }}
          >
            {busy ? "校验中…" : "进入"}
          </button>
        </div>
      )}
    </div>
  );
}
