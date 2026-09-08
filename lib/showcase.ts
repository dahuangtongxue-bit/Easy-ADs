export type ShowcaseItem = {
  /** file name inside public/showcase */
  file: string;
  /** optional poster image inside public/showcase */
  poster?: string;
  title: string;
  /** one of the six ad templates, free text is fine */
  template?: string;
  industry?: string;
  /** seconds */
  duration?: number;
  /** e.g. "9:16" | "16:9" | "1:1" */
  ratio?: string;
  /** width/height as a number, computed by scripts/showcase.mjs */
  aspect?: number;
  /** when true this clip plays behind the hero */
  hero?: boolean;
};

export type ShowcaseManifest = {
  updatedAt?: string;
  items: ShowcaseItem[];
};

export const TEMPLATES = [
  { key: "pain", name: "痛点–解决", beats: ["痛点场景", "放大", "商品登场", "效果", "尾帧 + CTA"], fit: "功能型商品 · 本地服务" },
  { key: "story", name: "剧情植入", beats: ["生活小故事", "转折", "商品自然出现", "余韵", "尾帧"], fit: "品牌型商品 · 情绪向" },
  { key: "owner", name: "老板口播种草", beats: ["钩子", "卖点一", "卖点二", "商品特写", "尾帧 + CTA"], fit: "本地店 · 信任型消费" },
  { key: "unbox", name: "开箱 / 展示", beats: ["到手", "多角度展示", "细节", "使用一瞬", "尾帧"], fit: "电商 · 3C · 美妆" },
  { key: "before", name: "使用前后对比", beats: ["前", "商品转场", "后", "对比", "尾帧 + CTA"], fit: "清洁 · 美业 · 家居" },
  { key: "review", name: "证言 / 评价", beats: ["用户开口", "场景", "商品", "评价字幕", "尾帧"], fit: "服务 · 课程 · 体验类" },
] as const;

export function publicUrl(file: string) {
  return `/showcase/${encodeURIComponent(file)}`;
}
