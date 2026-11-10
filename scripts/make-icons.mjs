// Regenerates the Pathtoon "P" app icons. Run: node scripts/make-icons.mjs
import sharp from "sharp";

const BRAND = "#b8501a";
const CREAM = "#fff8ef";

// The "P" is drawn as shapes (no fonts needed) on a 512 grid.
const svg = (circle) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BRAND}"/>
  <circle cx="256" cy="256" r="${circle}" fill="${CREAM}"/>
  <g transform="translate(256 256) scale(${circle / 200}) translate(-256 -256)" fill="${BRAND}">
    <path fill-rule="evenodd" d="M186 128h98c46 0 78 30 78 76s-32 76-78 76h-42v104h-56V128zm56 50v52h38c18 0 28-10 28-26s-10-26-28-26h-38z"/>
  </g>
</svg>`;

const targets = [
  ["public/icons/icon-192.png", 192, 200],
  ["public/icons/icon-512.png", 512, 200],
  ["public/icons/maskable-512.png", 512, 150], // smaller, so launchers can crop it
  ["src/app/icon.png", 512, 200],
  ["src/app/apple-icon.png", 180, 200],
];
for (const [file, size, r] of targets) {
  await sharp(Buffer.from(svg(r))).resize(size, size).png().toFile(file);
}
console.log("icons written");
