// Refreshes the vendored libraries from node_modules and zips the Chrome
// extension for "Load unpacked" or a Chrome Web Store upload.
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const extension = path.join(root, "chrome-extension");
const { version } = JSON.parse(readFileSync(path.join(extension, "manifest.json"), "utf8"));

copyFileSync(path.join(root, "node_modules/marked/lib/marked.umd.js"), path.join(extension, "vendor/marked.umd.js"));
copyFileSync(path.join(root, "node_modules/dompurify/dist/purify.min.js"), path.join(extension, "vendor/purify.min.js"));

const outDir = path.join(root, "dist-extension");
mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, `md-reader-${version}.zip`);
rmSync(zip, { force: true });
execFileSync("zip", ["-r", "-X", "-q", zip, ".", "-x", ".*", "-x", "*/.*", "-x", "README.md"], { cwd: extension });
console.log(zip);
