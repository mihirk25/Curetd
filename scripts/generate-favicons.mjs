import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconSvg = readFileSync(join(root, "public", "icon.svg"));

mkdirSync(join(root, "public"), { recursive: true });

const brandIcon = await sharp(iconSvg, { density: 384 })
  .resize(192, 192, { fit: "contain" })
  .flatten({ background: { r: 0, g: 0, b: 0 } })
  .png()
  .toBuffer();

writeFileSync(join(root, "public", "brand-icon.png"), brandIcon);

console.log("Wrote public/brand-icon.png");
