#!/usr/bin/env node
/* Yuksalish Agro: tiny save server. No dependencies, Node 18+.
   Serves the project folder as static files behind a password screen and keeps saved plan versions as
   JSON files (one file per version in DATA_DIR/versions). The page (index.html, block "Versions") talks to it
   through GET/POST <page url>/api/versions and DELETE <page url>/api/versions/<id> when it is not inside claude.ai.

   Environment:
     PORT             listen port (default 8787)
     HOST             bind address (default 127.0.0.1; put nginx in front)
     DATA_DIR         where versions are stored (default <project>/server/data)
     SITE_PASSWORD    password asked once per browser before the site opens (default "agro2026");
                      set it to an empty string to open the site without a password
     DELETE_PASSWORD  password asked when someone deletes a saved version (default "real1536soft")
     SAVE_KEY         optional extra key asked when saving; unset = everyone who got in can save
     MAX_VERSIONS     stop accepting new versions above this count (default 2000)
   Routes: POST /login (form field "password"), GET /logout, GET/POST /api/versions, DELETE /api/versions/<id>. */
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
const SITE_PASSWORD = process.env.SITE_PASSWORD === undefined ? "agro2026" : process.env.SITE_PASSWORD;
const DELETE_PASSWORD = process.env.DELETE_PASSWORD || "real1536soft";
const SAVE_KEY = process.env.SAVE_KEY || "";
const MAX_VERSIONS = +process.env.MAX_VERSIONS || 2000;
const MAX_BODY = 256 * 1024;              // one version, bytes
const LIST_N = 100;                       // newest versions returned to the page
const RATE = { n: 10, windowMs: 60_000 }; // saves/deletes per IP per minute; login attempts likewise
const COOKIE = "agro_auth", SESSION_DAYS = 30;
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
function safeEq(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const limiters = new Map();
function limited(bucket, ip) {
  const k = bucket + ":" + ip, now = Date.now(), arr = (limiters.get(k) || []).filter(t => now - t < RATE.windowMs);
  if (arr.length >= RATE.n) { limiters.set(k, arr); return true; }
  arr.push(now); limiters.set(k, arr); return false;
}
const ipOf = req => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > max) { req.pause(); reject(new Error("too large")); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ---------- http helpers ---------- */
const send = (res, code, text, extra = {}) => { res.writeHead(code, Object.assign({ "Content-Type": "text/plain; charset=utf-8" }, extra)); res.end(text); };
const json = (res, code, obj, extra = {}) => {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extra)); res.end(JSON.stringify(obj));
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- login: one cookie per browser, valid until the site password changes ---------- */
const gate = SITE_PASSWORD !== "";
const sessionToken = () => crypto.createHmac("sha256", SITE_PASSWORD).update("yuksalish-agro-session-v1").digest("hex");
function authed(req) {
  if (!gate) return true;
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([a-f0-9]{64})"));
  return !!m && safeEq(m[1], sessionToken());
}
const isHttps = req => String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
const cookie = (req, value, maxAge) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(req) ? "; Secure" : ""}`;
function loginPage(res, code, err) {
  res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yuksalish Agro: kirish</title>
<style>
:root{--bg:#f5f7f2;--surface:#fff;--fg:#16211a;--muted:#5a665e;--line:#dce2d7;--accent:#2c6a42;--accent-ink:#fff;--bad:#c23636}
@media(prefers-color-scheme:dark){:root{--bg:#111512;--surface:#181d19;--fg:#e8eee7;--muted:#a3aea6;--line:#2c342e;--accent:#7cc596;--accent-ink:#0e1a12;--bad:#e66767}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
form{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:28px;width:min(380px,100%);display:grid;gap:14px}
h1{font-size:22px;margin:0}p{margin:0;color:var(--muted);font-size:14px}label{display:grid;gap:6px;font-size:14px;font-weight:600}
input{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);width:100%}
button{font:inherit;font-weight:600;padding:10px 16px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);cursor:pointer}
.err{color:var(--bad);font-size:14px;min-height:1.2em}
</style></head><body>
<form method="post" action="login">
<h1>Yuksalish Agro</h1><p>Biznes-rejani ochish uchun parolni kiriting.</p>
<label>Parol<input type="password" name="password" autofocus autocomplete="current-password" required maxlength="200"></label>
<div class="err">${esc(err)}</div>
<button type="submit">Kirish</button>
</form></body></html>`);
}
async function login(req, res) {
  const ip = ipOf(req);
  if (limited("login", ip)) return loginPage(res, 429, "Juda ko'p urinish. Bir daqiqadan keyin qayta urinib ko'ring.");
  let raw = ""; try { raw = await readBody(req, 4096); } catch (e) { return loginPage(res, 413, "Parol juda uzun."); }
  const pw = new URLSearchParams(raw).get("password") || "";
  if (!safeEq(pw, SITE_PASSWORD)) { console.log(`login failed from ${ip}`); return loginPage(res, 401, "Parol noto'g'ri."); }
  res.writeHead(303, { "Set-Cookie": cookie(req, sessionToken(), SESSION_DAYS * 86400), Location: "/" });
  res.end();
}

/* ---------- api ---------- */
async function api(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    const tag = etag();
    if (req.headers["if-none-match"] === tag) { res.writeHead(304, { ETag: tag }); return res.end(); }
    if (req.method === "HEAD") { res.writeHead(200, { ETag: tag, "Content-Type": "application/json; charset=utf-8" }); return res.end(); }
    return json(res, 200, { needKey: !!SAVE_KEY, canDelete: true, versions: versions.slice(0, LIST_N) }, { ETag: tag, "Cache-Control": "no-cache" });
  }
  if (req.method !== "POST") return send(res, 405, "method not allowed");
  if (SAVE_KEY && !safeEq(req.headers["x-save-key"], SAVE_KEY)) return json(res, 401, { error: "key" });
  const ip = ipOf(req);
  if (limited("write", ip)) return json(res, 429, { error: "rate" });
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
async function apiDelete(req, res, id) {
  if (req.method !== "DELETE") return send(res, 405, "method not allowed");
  const ip = ipOf(req);
  if (limited("write", ip)) return json(res, 429, { error: "rate" });
  if (!safeEq(req.headers["x-delete-key"], DELETE_PASSWORD)) { console.log(`delete refused (bad password) from ${ip}`); return json(res, 401, { error: "delkey" }); }
  const i = versions.findIndex(v => v.id === id);
  if (i < 0) return json(res, 404, { error: "not_found" });
  const [doc] = versions.splice(i, 1);
  try { await fsp.unlink(path.join(VDIR, id + ".json")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  console.log(`deleted ${id} (${doc.author}, ${doc.at}) from ${ip}`);
  json(res, 200, { ok: true, id });
}

/* ---------- static files ---------- */
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
    "Cache-Control": ext === ".html" ? "no-cache" : "private, max-age=86400" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------- routing ---------- */
async function handle(req, res) {
  const p = new URL(req.url, "http://localhost").pathname;
  if (p.endsWith("/login") && req.method === "POST") return gate ? login(req, res) : (res.writeHead(303, { Location: "/" }), res.end());
  if (p.endsWith("/logout")) { res.writeHead(303, { "Set-Cookie": cookie(req, "x", 0), Location: "/" }); return res.end(); }
  if (!authed(req)) {
    if (p.includes("/api/")) return json(res, 401, { error: "auth" });
    if (req.method === "GET" || req.method === "HEAD") return loginPage(res, 200, "");
    return send(res, 401, "login required");
  }
  if (p.endsWith("/api/versions")) return api(req, res);
  const m = p.match(/\/api\/versions\/([A-Za-z0-9]{1,40})$/);
  if (m) return apiDelete(req, res, m[1]);
  return staticFile(req, res, p);
}
const server = http.createServer((req, res) => {
  handle(req, res).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, "server error"); else res.end(); });
});
load().then(() => server.listen(PORT, HOST, () =>
  console.log(`Yuksalish Agro on http://${HOST}:${PORT}  versions: ${versions.length}  data: ${VDIR}  site password: ${gate ? "required" : "OFF"}  save key: ${SAVE_KEY ? "required" : "not set"}`)));
