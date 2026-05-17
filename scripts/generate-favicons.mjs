import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import toIco from "to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconSvg = readFileSync(join(root, "app", "icon.svg"));

async function png(size) {
  return sharp(iconSvg).resize(size, size).png().toBuffer();
}

const sizes = [16, 32, 48];
const pngBuffers = await Promise.all(sizes.map((s) => png(s)));
const ico = await toIco(pngBuffers);

mkdirSync(join(root, "app"), { recursive: true });
mkdirSync(join(root, "public"), { recursive: true });

writeFileSync(join(root, "app", "favicon.ico"), ico);
writeFileSync(join(root, "public", "favicon.ico"), ico);

await sharp(iconSvg).resize(180, 180).png().toFile(join(root, "app", "apple-icon.png"));
await sharp(iconSvg).resize(32, 32).png().toFile(join(root, "app", "icon.png"));

console.log("Wrote app/favicon.ico, public/favicon.ico, app/apple-icon.png, app/icon.png");
