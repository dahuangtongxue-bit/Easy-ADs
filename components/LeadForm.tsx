"use client";

import { useState } from "react";

type State = "idle" | "sending" | "ok" | "error";

export default function LeadForm() {
  const [state, setState] = useState<State>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setState("sending");
    try {
      const res = await fetch("/__forms.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(data as unknown as Record<string, string>).toString(),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("ok");
      form.reset();
    } catch {
      setState("error");
    }
  }

  return (
    <section id="early-access" className="border-b hairline bg-surface">
      <div className="mx-auto grid max-w-site grid-cols-1 gap-10 px-5 py-20 md:grid-cols-2 md:px-8 md:py-28">
        <div>
          <div className="eyebrow">Early access · 申请内测</div>
          <h2 className="display mt-4 text-[32px] md:text-[52px]">留下店铺，第一条广告片我们替你出</h2>
          <p className="mt-5 max-w-[34em] text-[16px] leading-relaxed text-ink-2">
            内测期间按店铺排期，收到后 1 个工作日内联系你要素材。第一条 480P 预览免费，满意再出 720P 定稿。
          </p>
          <ul className="mt-8 space-y-2 text-[14px] text-ink-2">
            <li>· 准备 3–6 张商品图（正面、侧面、细节）</li>
            <li>· 有实拍片段更好，5–10 秒即可</li>
            <li>· 想让老板出镜，现场手机做一次活体认证</li>
          </ul>
        </div>

        <form
          name="early-access"
          onSubmit={onSubmit}
          className="card grid gap-4 p-6 md:p-8"
          aria-label="申请内测表单"
        >
          <input type="hidden" name="form-name" value="early-access" />
          <p className="hidden">
            <label>
              不要填这个字段：<input name="bot-field" />
            </label>
          </p>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            店铺 / 品牌名
            <input name="brand" required className="rounded-lg border hairline bg-bg px-3 py-2.5 text-[15px] text-ink outline-none focus:border-accent" placeholder="例如：老张牛肉面（静安店）" />
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            微信或手机
            <input name="contact" required className="rounded-lg border hairline bg-bg px-3 py-2.5 text-[15px] text-ink outline-none focus:border-accent" placeholder="方便联系的方式" />
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            行业
            <select name="industry" className="rounded-lg border hairline bg-bg px-3 py-2.5 text-[15px] text-ink outline-none focus:border-accent">
              <option>餐饮</option>
              <option>美业</option>
              <option>3C / 数码</option>
              <option>美妆 / 个护</option>
              <option>家居 / 家电</option>
              <option>汽车 / 4S</option>
              <option>教培 / 服务</option>
              <option>其他</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-[13px] text-ink-2">
            想做的广告，一句话
            <textarea name="brief" rows={3} className="rounded-lg border hairline bg-bg px-3 py-2.5 text-[15px] text-ink outline-none focus:border-accent" placeholder="例如：新品上市，主打 30 天续航，老板出镜" />
          </label>
          <button type="submit" disabled={state === "sending"} className="btn btn-accent justify-center disabled:opacity-60">
            {state === "sending" ? "提交中…" : "申请内测"}
          </button>
          {state === "ok" && <p className="text-[14px] text-accent">收到了，1 个工作日内联系你。</p>}
          {state === "error" && <p className="text-[14px] text-ink-2">提交没成功，直接加微信或发邮件也行。</p>}
        </form>
      </div>
    </section>
  );
}
