// Static server with CORS for local testing: GeoLibre Web fetches plugin/plugin.json and the sample layers from here.
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 8098;
const types = { ".js": "text/javascript", ".json": "application/json", ".geojson": "application/geo+json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".zip": "application/zip" };

// Safari refuses http://localhost from an https page; TLS_KEY and TLS_CERT (a self-signed pair is enough) switch to https.
const tls = process.env.TLS_KEY && process.env.TLS_CERT ? { key: readFileSync(process.env.TLS_KEY), cert: readFileSync(process.env.TLS_CERT) } : null;
const handler = async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = join(root, path);
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Private-Network": "true", "Cache-Control": "no-store" };
  if (req.method === "OPTIONS") return res.writeHead(204, headers).end();
  if (!file.startsWith(root + sep)) return res.writeHead(403, headers).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...headers, "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404, headers).end("not found");
  }
};
(tls ? createSecureServer(tls, handler) : createServer(handler)).listen(port, "127.0.0.1", () => console.log(`${tls ? "https" : "http"}://localhost:${port}/plugin/plugin.json`));
