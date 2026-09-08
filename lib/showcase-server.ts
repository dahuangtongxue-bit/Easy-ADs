import fs from "node:fs";
import path from "node:path";
import type { ShowcaseManifest } from "./showcase";

export function loadShowcase(): ShowcaseManifest {
  const p = path.join(process.cwd(), "data", "showcase.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as ShowcaseManifest;
    return { items: Array.isArray(parsed.items) ? parsed.items : [], updatedAt: parsed.updatedAt };
  } catch {
    return { items: [] };
  }
}
