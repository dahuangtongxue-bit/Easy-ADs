import Link from "next/link";

export default function Nav({ hasShowcase }: { hasShowcase: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b hairline bg-[rgba(10,12,16,0.72)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-site items-center justify-between px-5 md:px-8">
        <Link href="/" className="wordmark text-[22px] tracking-tight" aria-label="Easy-ADs 首页">
          Easy<span className="text-accent">-</span>ADs
        </Link>
        <nav className="hidden items-center gap-7 text-[14px] text-ink-2 md:flex" aria-label="主导航">
          {hasShowcase && <a className="hover:text-ink" href="#showcase">成片</a>}
          <a className="hover:text-ink" href="#templates">模板</a>
          <a className="hover:text-ink" href="#flow">流程</a>
          <a className="hover:text-ink" href="#compliance">合规</a>
        </nav>
        <a href="#early-access" className="btn btn-accent !py-2 !px-4 text-[14px]">
          申请内测
        </a>
      </div>
    </header>
  );
}
