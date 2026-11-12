// Local preview with a working careers API, no Netlify CLI needed.
//   node scripts/dev-server.mjs   ->  http://localhost:8787
// Uses an in-memory store, so data is lost on restart. Admin password for local
// runs: set ADMIN_PASSWORD_HASH (see scripts/hash-password.mjs) or use the real one.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { handle } from "../lib/careers/handlers.mjs";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain", ".xml": "application/xml" };

const mem = new Map();
const store = {
  async set(k, v, o = {}) { mem.set(k, { data: v, metadata: o.metadata || {} }); },
  async setJSON(k, v) { mem.set(k, { data: JSON.stringify(v), metadata: {} }); },
  async get(k, o = {}) { const e = mem.get(k); if (!e) return null; return o.type === "json" ? JSON.parse(e.data) : e.data; },
  async getWithMetadata(k) { const e = mem.get(k); return e ? { data: e.data, metadata: e.metadata } : null; },
  async delete(k) { mem.delete(k); },
  async list({ prefix = "" } = {}) { return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/careers/")) {
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Readable.toWeb(req);
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body, duplex: "half" }), { store, ip: req.socket.remoteAddress });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([\/])+/, "");
  if (p.includes("..")) { res.writeHead(400); return res.end(); }
  if (!p || p.endsWith("/") || p.endsWith("\\")) p += "index.html";
  else if (!extname(p)) p += "/index.html";
  try {
    const data = await readFile(join(root, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(8787, () => console.log("http://localhost:8787"));
