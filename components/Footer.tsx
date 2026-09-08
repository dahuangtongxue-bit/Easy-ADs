import { APP_VERSION } from "@/lib/version";

export default function Footer() {
  return (
    <footer className="mx-auto flex max-w-site flex-wrap items-center justify-between gap-4 px-5 py-10 text-[13px] text-ink-3 md:px-8">
      <div className="wordmark text-[18px] text-ink">
        Easy<span className="text-accent">-</span>ADs
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <span>素材进，广告出</span>
        <span>Powered by Seedance 2.5 · 零克云 MaaS</span>
        <span>© 2026 Easy-ADs · v{APP_VERSION}</span>
      </div>
    </footer>
  );
}
