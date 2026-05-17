import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import toIco from "to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconSvg = readFileSync(join(root, "public", "icon.svg"));

/** ICO does not handle alpha well — flatten on black so WhatsApp/browser previews look correct. */
async function pngForIco(size) {
  return sharp(iconSvg, { density: 384 })
    .resize(size, size, { fit: "contain" })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .png()
    .toBuffer();
}

/** PNG icons keep transparency for crisp UI / apple-touch. */
async function pngTransparent(size) {
  return sharp(iconSvg, { density: 384 }).resize(size, size, { fit: "contain" }).png().toBuffer();
}

const icoSizes = [48, 32, 16];
const icoBuffers = await Promise.all(icoSizes.map((s) => pngForIco(s)));
const ico = await toIco(icoBuffers);

mkdirSync(join(root, "app"), { recursive: true });
mkdirSync(join(root, "public"), { recursive: true });

writeFileSync(join(root, "app", "favicon.ico"), ico);
writeFileSync(join(root, "public", "favicon.ico"), ico);

writeFileSync(join(root, "app", "icon.png"), await pngTransparent(32));
writeFileSync(join(root, "app", "apple-icon.png"), await pngTransparent(180));

console.log("Wrote app/favicon.ico, public/favicon.ico, app/icon.png, app/apple-icon.png");
