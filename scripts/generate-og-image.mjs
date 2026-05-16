import sharp from "sharp";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "public", "og-image.png");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#000000"/>

  <g transform="translate(96 195)">
    <rect width="140" height="140" rx="31" fill="#22c55e"/>
    <path d="M54.7 44.6 95.1 70 54.7 95.4V44.6Z" fill="#000000"/>
  </g>

  <text
    x="268"
    y="300"
    font-family="Impact, Haettenschweiler, 'Franklin Gothic Bold', 'Arial Black', sans-serif"
    font-size="108"
    font-weight="700"
    letter-spacing="4"
    dominant-baseline="middle"
  >
    <tspan fill="#ffffff">CURAT</tspan><tspan fill="#22c55e">D</tspan>
  </text>

  <text
    x="96"
    y="400"
    font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
    font-size="36"
    font-weight="400"
    fill="#ffffff"
    opacity="0.92"
  >Curate your taste. Express your identity.</text>
</svg>`;

mkdirSync(join(__dirname, "..", "public"), { recursive: true });

await sharp(Buffer.from(svg))
  .resize(1200, 630)
  .png()
  .toFile(outPath);

console.log("Wrote", outPath);
