#!/usr/bin/env node
/* Yuksalish Agro: tiny save server. No dependencies, Node 18+.
   Serves the project folder as static files and keeps saved plan versions as JSON files
   (one file per version in DATA_DIR/versions). The page (index.html, block "Versions") talks to it
   through GET/POST <page url>/api/versions when it is not running inside claude.ai.

   Environment:
     PORT          listen port (default 8787)
     HOST          bind address (default 127.0.0.1; put nginx in front)
     DATA_DIR      where versions are stored (default <project>/server/data)
     SAVE_KEY      optional. When set, saving needs this key (the page asks for it once per browser).
                   Unset = anyone who can open the page can save.
     MAX_VERSIONS  stop accepting new versions above this count (default 2000)            */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +process.env.PORT || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, "server", "data"));
const VDIR = path.join(DATA, "versions");
const SAVE_KEY = process.env.SAVE_KEY || "";
const MAX_VERSIONS = +process.env.MAX_VERSIONS || 2000;
const MAX_BODY = 256 * 1024;          // one version, bytes
const LIST_N = 100;                   // newest versions returned to the page
const RATE = { n: 10, windowMs: 60_000 }; // saves per IP per minute
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".mp4": "video/mp4"
};

/* ---------- versions: all in memory, one JSON file each on disk ---------- */
let versions = []; // newest first
async function load() {
  await fsp.mkdir(VDIR, { recursive: true });
  const out = [];
  for (const f of await fsp.readdir(VDIR)) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(await fsp.readFile(path.join(VDIR, f), "utf8"))); }
    catch (e) { console.error("skipping", f, e.message); }
  }
  versions = out.sort((a, b) => b.ts - a.ts);
}
const etag = () => `W/"${versions.length}-${versions[0] ? versions[0].ts : 0}"`;

/* ---------- validation: keep only the fields the page writes, with size caps ---------- */
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
function clean(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const first = str(body.first, 60).trim(), last = str(body.last, 60).trim();
  if (!first || !last) return null;
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) return null;
  const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0, 300)
    .map(c => ({ what: str(c && c.what, 300), from: str(c && c.from, 300), to: str(c && c.to, 300) }));
  const kpi = {};
  for (const k of ["avgNet", "total", "loan", "irr", "minCash", "horizon"]) {
    const v = body.kpi && body.kpi[k]; if (typeof v === "number" && isFinite(v)) kpi[k] = v;
  }
  const ts = Date.now();
  return {
    id: "v" + ts.toString(36) + crypto.randomBytes(3).toString("hex"), ts, at: new Date(ts).toISOString(),
    first, last, author: first + " " + last, uid: str(body.uid, 40), note: str(body.note, 500).trim(),
    nChanges: Math.max(0, Math.min(1e6, +body.nChanges || changes.length)), changes, state: body.state, kpi
  };
}
function keyOk(sent) {
  if (!SAVE_KEY) return true;
  const a = Buffer.from(String(sent || "")), b = Buffer.from(SAVE_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const hits = new Map();
function limited(ip) {
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  if (arr.length >= RATE.n) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > max) { req.pause(); reject(new Error("too large")); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ---------- http ---------- */
const send = (res, code, text) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" }); res.end(text); };
const json = (res, code, obj, extra = {}) => {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extra)); res.end(JSON.stringify(obj));
};

async function api(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    const tag = etag();
    if (req.headers["if-none-match"] === tag) { res.writeHead(304, { ETag: tag }); return res.end(); }
    if (req.method === "HEAD") { res.writeHead(200, { ETag: tag, "Content-Type": "application/json; charset=utf-8" }); return res.end(); }
    return json(res, 200, { needKey: !!SAVE_KEY, versions: versions.slice(0, LIST_N) }, { ETag: tag, "Cache-Control": "no-cache" });
  }
  if (req.method !== "POST") return send(res, 405, "method not allowed");
  if (!keyOk(req.headers["x-save-key"])) return json(res, 401, { error: "key" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
  if (limited(ip)) return json(res, 429, { error: "rate" });
  if (versions.length >= MAX_VERSIONS) return json(res, 507, { error: "full" });
  let raw;
  try { raw = await readBody(req, MAX_BODY); } catch (e) { return json(res, 413, { error: "size" }, { Connection: "close" }); }
  let doc = null;
  try { doc = clean(JSON.parse(raw)); } catch (e) { doc = null; }
  if (!doc) return json(res, 400, { error: "invalid" });
  await fsp.writeFile(path.join(VDIR, doc.id + ".json"), JSON.stringify(doc));
  versions.unshift(doc);
  console.log(`saved ${doc.id} by ${doc.author} (${doc.nChanges} changes) from ${ip}`);
  json(res, 201, { id: doc.id, ts: doc.ts, at: doc.at });
}

async function staticFile(req, res, p) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
  let rel; try { rel = decodeURIComponent(p); } catch (e) { return send(res, 404, "not found"); }
  if (rel === "/") rel = "/index.html";
  // never serve the server folder (saved data), the tools, or dot files
  if (rel.includes("..") || rel.includes("\0") || /^\/(server|tools)(\/|$)/.test(rel) || /\/\./.test(rel)) return send(res, 404, "not found");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, "not found");
  let st; try { st = await fsp.stat(file); } catch (e) { return send(res, 404, "not found"); }
  if (!st.isFile()) return send(res, 404, "not found");
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": st.size,
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  (p.endsWith("/api/versions") ? api(req, res) : staticFile(req, res, p))
    .catch(e => { console.error(e); if (!res.headersSent) send(res, 500, "server error"); else res.end(); });
});
load().then(() => server.listen(PORT, HOST, () =>
  console.log(`Yuksalish Agro on http://${HOST}:${PORT}  versions: ${versions.length}  data: ${VDIR}  save key: ${SAVE_KEY ? "required" : "not set, anyone can save"}`)));
