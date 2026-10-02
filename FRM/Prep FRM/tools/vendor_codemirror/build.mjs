// Bundles CodeMirror 6 into one ES module for the site (offline, no npm needed to run it).
// Usage, from this folder: npm install && npm run build
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../../assets/vendor/codemirror/", import.meta.url)); // decodes "Prep%20FRM"
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["entry.js"],
  bundle: true,
  format: "esm",
  minify: true,
  legalComments: "eof",
  outfile: `${out}codemirror.js`,
});
await copyFile("node_modules/@codemirror/view/LICENSE", `${out}LICENSE`);
console.log("assets/vendor/codemirror/codemirror.js written");
