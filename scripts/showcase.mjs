#!/usr/bin/env node
/**
 * Scan public/showcase/*.mp4, extract a poster frame (needs ffmpeg on PATH),
 * read width/height/duration (ffprobe), and merge into data/showcase.json.
 *
 * Existing titles / templates / industries in the manifest are kept;
 * new files get a title derived from the file name.
 *
 * Usage:  npm run showcase
 * Mark a hero clip by setting "hero": true on its entry afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = process.cwd();
const dir = path.join(root, "public", "showcase");
const manifestPath = path.join(root, "data", "showcase.json");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const hasFfprobe = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

let manifest = { updatedAt: "", items: [] };
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch {}
const byFile = new Map(manifest.items.map((i) => [i.file, i]));

const files = fs
  .readdirSync(dir)
  .filter((f) => /\.(mp4|mov|webm)$/i.test(f))
  .sort();

const items = [];
for (const file of files) {
  const prev = byFile.get(file) || {};
  const base = file.replace(/\.[^.]+$/, "");
  const posterName = `${base}.jpg`;
  const posterPath = path.join(dir, posterName);
  const videoPath = path.join(dir, file);

  let width = 0, height = 0, duration = prev.duration || 0;
  if (hasFfprobe) {
    try {
      const out = execFileSync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json",
        videoPath,
      ]).toString();
      const j = JSON.parse(out);
      width = j.streams?.[0]?.width || 0;
      height = j.streams?.[0]?.height || 0;
      duration = Math.round(parseFloat(j.format?.duration || "0"));
    } catch {}
  }
  if (hasFfmpeg && !fs.existsSync(posterPath)) {
    try {
      execFileSync("ffmpeg", ["-y", "-ss", "1", "-i", videoPath, "-frames:v", "1", "-q:v", "3", posterPath], { stdio: "ignore" });
    } catch {}
  }
  const aspect = width && height ? +(width / height).toFixed(4) : prev.aspect;
  const ratio = aspect ? (aspect < 0.8 ? "9:16" : aspect > 1.3 ? "16:9" : "1:1") : prev.ratio;

  items.push({
    file,
    poster: fs.existsSync(posterPath) ? posterName : prev.poster,
    title: prev.title || base.replace(/[-_]+/g, " "),
    template: prev.template,
    industry: prev.industry,
    duration: duration || undefined,
    ratio,
    aspect,
    hero: prev.hero || false,
  });
}

manifest.items = items;
manifest.updatedAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`showcase: ${items.length} clips → data/showcase.json${hasFfmpeg ? "" : " (ffmpeg not found: posters skipped)"}`);
