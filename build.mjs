// Builds plugin/ (index.js + style.css + plugin.json) and a zip ready to install in GeoLibre.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8"));
const out = join(root, "plugin");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// GeoLibre loads one self-contained ES module and serves it exactly as built, so it is bundled and minified here.
await build({
  entryPoints: [join(root, "src", "main.js")],
  outfile: join(out, "index.js"),
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(manifest.version) },
  banner: { js: `/*! Spatial BI ${manifest.version} | GeoLibre plugin */` },
});
cpSync(join(root, "src", "style.css"), join(out, "style.css"));
cpSync(join(root, "plugin.json"), join(out, "plugin.json"));
if (existsSync(join(root, "LICENSE"))) cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

const zip = join(root, `${manifest.id}-${manifest.version}.zip`);
rmSync(zip, { force: true });
if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
else execFileSync("zip", ["-q", "-r", "-X", zip, "."], { cwd: out, stdio: "inherit" });

const sha = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${sha}  ${manifest.id}-${manifest.version}.zip\n`);
console.log(`built plugin/ and ${manifest.id}-${manifest.version}.zip (${(readFileSync(join(out, "index.js")).length / 1024).toFixed(1)} kB bundle)\nsha256 ${sha}`);
