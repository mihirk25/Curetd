import sharp from "sharp";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "curatd-extension", "icons");

/** Curatd brand: black canvas, emerald-500 (#22c55e) rounded square, black play mark. */
const icon128Svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">
  <rect width="128" height="128" fill="#000000"/>
  <rect x="16" y="16" width="96" height="96" rx="21" fill="#22c55e"/>
  <path d="M53.5 46.6 81.4 64 53.5 81.4Z" fill="#000000"/>
</svg>`;

async function writePng(size, filename) {
  const buf = await sharp(Buffer.from(icon128Svg))
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(join(outDir, filename), buf);
  console.log(`Wrote ${filename} (${size}x${size})`);
}

await writePng(128, "icon128.png");
await writePng(48, "icon48.png");
await writePng(16, "icon16.png");
