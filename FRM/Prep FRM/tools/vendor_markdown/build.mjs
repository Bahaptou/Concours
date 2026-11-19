// Copies the browser builds of markdown-it and KaTeX into the site (offline, works from file://).
// Usage, from this folder: npm install && npm run build
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const vendor = fileURLToPath(new URL("../../assets/vendor/", import.meta.url)); // decodes "Prep%20FRM"
await mkdir(`${vendor}markdown-it`, { recursive: true });
await cp("node_modules/markdown-it/dist/markdown-it.min.js", `${vendor}markdown-it/markdown-it.min.js`);
await cp("node_modules/markdown-it/LICENSE", `${vendor}markdown-it/LICENSE`);
await mkdir(`${vendor}katex`, { recursive: true });
for (const file of ["katex.min.js", "katex.min.css", "fonts"]) {
  await cp(`node_modules/katex/dist/${file}`, `${vendor}katex/${file}`, { recursive: true });
}
await cp("node_modules/katex/LICENSE", `${vendor}katex/LICENSE`);
console.log("assets/vendor/markdown-it and assets/vendor/katex written");
