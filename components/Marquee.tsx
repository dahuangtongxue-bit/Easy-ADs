const WORDS = [
  "SEEDANCE 2.5",
  "30S ONE-TAKE",
  "50 REFERENCES",
  "TIMESTAMP BEATS",
  "PRODUCT-LOCKED LAST FRAME",
  "REAL-PERSON LIVENESS",
  "NATIVE AUDIO",
  "AI-LABEL BUILT IN",
  "9:16 · 1:1 · 16:9",
];

export default function Marquee() {
  const row = [...WORDS, ...WORDS];
  return (
    <div className="marquee border-b hairline py-4" aria-hidden="true">
      <div className="marquee-track wordmark text-[15px] tracking-[0.12em] text-ink-3">
        {row.map((w, i) => (
          <span key={i} className="flex items-center gap-12">
            <span>{w}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
        ))}
      </div>
    </div>
  );
}
