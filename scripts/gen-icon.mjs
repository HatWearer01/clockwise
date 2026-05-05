import sharp from "sharp";
import { writeFileSync } from "fs";

const COLOR = "#3B8BF5";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <defs>
    <clipPath id="cw-top"><rect width="512" height="244"/></clipPath>
    <clipPath id="cw-bot"><rect y="268" width="512" height="244"/></clipPath>
  </defs>
  <circle cx="256" cy="256" r="216" stroke="${COLOR}" stroke-width="22" clip-path="url(#cw-top)"/>
  <circle cx="256" cy="256" r="216" stroke="${COLOR}" stroke-width="22" clip-path="url(#cw-bot)"/>
  <circle cx="62"  cy="256" r="9" fill="${COLOR}"/>
  <circle cx="118" cy="256" r="9" fill="${COLOR}"/>
  <circle cx="174" cy="256" r="9" fill="${COLOR}"/>
  <circle cx="230" cy="256" r="9" fill="${COLOR}"/>
  <circle cx="282" cy="256" r="9" fill="${COLOR}"/>
  <circle cx="338" cy="256" r="9" fill="${COLOR}"/>
  <circle cx="394" cy="256" r="9" fill="${COLOR}"/>
  <circle cx="450" cy="256" r="9" fill="${COLOR}"/>
  <line x1="256" y1="48" x2="256" y2="80" stroke="${COLOR}" stroke-width="14" stroke-linecap="round"/>
  <line x1="256" y1="256" x2="162" y2="192" stroke="${COLOR}" stroke-width="24" stroke-linecap="round"/>
  <line x1="256" y1="256" x2="390" y2="176" stroke="${COLOR}" stroke-width="16" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="22" fill="${COLOR}"/>
</svg>`;

const buf = Buffer.from(svg);

await sharp(buf, { density: 300 })
  .resize(1024, 1024)
  .png()
  .toFile("src-tauri/icon-source.png");

await sharp(buf, { density: 300 })
  .resize(64, 64)
  .png()
  .toFile("public/app-icon.png");

console.log("Generated icon-source.png (1024x1024) and app-icon.png (64x64)");
