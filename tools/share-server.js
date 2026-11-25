// Static host for the exported StudyPath web build + reverse proxy to the local API.
// One public origin (Cloudflare quick tunnel) serves both the app and the API.
//
// Usage (from the repo root):
//   node tools/share-server.js [web-build-dir] [port]
// Default build dir: mobile/web-share (created by `npx expo export --platform web --output-dir web-share`)
// Default port: 8090
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, "..", "mobile", "web-share"));
const PORT = Number(process.argv[3] || 8090);
const API = { host: "127.0.0.1", port: Number(process.env.API_PORT || 3000) };
// à¸—à¸¸à¸ path à¸—à¸µà¹ˆà¹€à¸›à¹‡à¸™ API à¸•à¹‰à¸­à¸‡ proxy à¹„à¸› backend â€” à¸–à¹‰à¸²à¸•à¸à¸«à¸¥à¹ˆà¸™à¸ˆà¸°à¹„à¸”à¹‰ HTML à¸‚à¸­à¸‡à¹à¸­à¸›à¸à¸¥à¸±à¸šà¹„à¸›à¹à¸—à¸™ JSON
// (à¸­à¸²à¸à¸²à¸£: "Unexpected token '<', <!DOCTYPE ... is not valid JSON")
const PROXY_PREFIXES = ["/studypath", "/auth", "/health", "/me", "/privacy", "/terms"];

function isApiPath(url) {
  return PROXY_PREFIXES.some((p) => url === p || url.startsWith(p + "/"));
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

/** à¸¥à¸š header à¸—à¸µà¹ˆà¸«à¹‰à¸²à¸¡à¸ªà¹ˆà¸‡à¸•à¹ˆà¸­ (hop-by-hop) â€” à¸–à¹‰à¸²à¸ªà¹ˆà¸‡à¸•à¹ˆà¸­à¸—à¸±à¹‰à¸‡à¸”à¸¸à¹‰à¸™ à¸šà¸²à¸‡à¸„à¸£à¸±à¹‰à¸‡ connection à¸ˆà¸°à¸„à¹‰à¸²à¸‡/à¸–à¸¹à¸à¸•à¸±à¸” */
function cleanHeaders(headers) {
  const out = {};
  const drop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"]);
  for (const [k, v] of Object.entries(headers)) {
    if (!drop.has(String(k).toLowerCase())) out[k] = v;
  }
  return out;
}

function proxy(req, res, attempt = 0) {
  // à¸ªà¹ˆà¸‡ host à¹€à¸”à¸´à¸¡à¸‚à¸­à¸‡à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¸•à¹ˆà¸­à¹ƒà¸«à¹‰ API à¸£à¸¹à¹‰à¸§à¹ˆà¸²à¹‚à¸”à¹€à¸¡à¸™à¸—à¸µà¹ˆà¹€à¸›à¸´à¸”à¸­à¸¢à¸¹à¹ˆà¸„à¸·à¸­à¸­à¸°à¹„à¸£ (à¹ƒà¸Šà¹‰à¸ªà¸£à¹‰à¸²à¸‡ redirect_uri à¸‚à¸­à¸‡ Google)
  // à¸–à¹‰à¸²à¹„à¸¡à¹ˆà¸ªà¹ˆà¸‡ à¸›à¸¥à¸²à¸¢à¸—à¸²à¸‡à¸ˆà¸°à¸à¸¥à¸²à¸¢à¹€à¸›à¹‡à¸™ 127.0.0.1:3000 à¹€à¸ªà¸¡à¸­ à¸—à¸³à¹ƒà¸«à¹‰ Google à¹€à¸”à¹‰à¸‡à¸à¸¥à¸±à¸š localhost à¸šà¸™à¸¡à¸·à¸­à¸–à¸·à¸­
  const incomingHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const incomingProto = String(req.headers["x-forwarded-proto"] || "https");
  const headers = {
    ...req.headers,
    host: API.host + ":" + API.port,
    "x-forwarded-host": incomingHost,
    "x-forwarded-proto": incomingProto,
    "x-forwarded-for": String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""),
  };

  let finished = false;
  const upstream = http.request(
    { host: API.host, port: API.port, method: req.method, path: req.url, headers },
    (up) => {
      finished = true;
      if (res.writableEnded) { up.destroy(); return; }
      res.writeHead(up.statusCode || 502, cleanHeaders(up.headers));
      up.pipe(res);
      // à¸›à¸¥à¸²à¸¢à¸—à¸²à¸‡à¸‚à¸²à¸”à¸à¸¥à¸²à¸‡à¸—à¸²à¸‡ (à¹€à¸Šà¹ˆà¸™ backend à¸•à¸²à¸¢à¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¸ªà¹ˆà¸‡ SSE) â†’ à¸›à¸´à¸”à¸à¸±à¹ˆà¸‡à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¹ƒà¸«à¹‰à¸£à¸¹à¹‰ à¹„à¸¡à¹ˆà¸›à¸¥à¹ˆà¸­à¸¢à¸„à¹‰à¸²à¸‡
      up.on("error", () => { try { res.end(); } catch { /* à¸›à¸´à¸”à¹à¸¥à¹‰à¸§ */ } });
      up.on("aborted", () => { try { res.end(); } catch { /* à¸›à¸´à¸”à¹à¸¥à¹‰à¸§ */ } });
    }
  );

  // à¸–à¹‰à¸²à¹„à¸¡à¹ˆà¸¡à¸µà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹„à¸«à¸¥à¹€à¸¥à¸¢ 120 à¸§à¸´ à¸–à¸·à¸­à¸§à¹ˆà¸²à¸„à¹‰à¸²à¸‡ (SSE à¸—à¸µà¹ˆà¸¢à¸±à¸‡à¸—à¸³à¸‡à¸²à¸™à¸ˆà¸°à¸¡à¸µ heartbeat à¸—à¸¸à¸ 15 à¸§à¸´ à¸ˆà¸¶à¸‡à¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¸±à¸”)
  upstream.setTimeout(120000, () => upstream.destroy(new Error("API à¹„à¸¡à¹ˆà¸•à¸­à¸šà¸ªà¸™à¸­à¸‡à¸ à¸²à¸¢à¹ƒà¸™ 120 à¸§à¸´à¸™à¸²à¸—à¸µ")));

  upstream.on("error", (e) => {
    if (res.writableEnded) return;
    const retriable = ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"].includes(e.code);
    // à¸¥à¸­à¸‡à¹ƒà¸«à¸¡à¹ˆà¸«à¸™à¸¶à¹ˆà¸‡à¸„à¸£à¸±à¹‰à¸‡à¹€à¸‰à¸žà¸²à¸°à¸„à¸³à¸‚à¸­à¸—à¸µà¹ˆà¹€à¸£à¸µà¸¢à¸à¸‹à¹‰à¸³à¹„à¸”à¹‰ (GET/HEAD) â€” backend à¸­à¸²à¸ˆà¸à¸³à¸¥à¸±à¸‡à¸£à¸µà¸ªà¸•à¸²à¸£à¹Œà¸—
    if (!finished && retriable && attempt === 0 && ["GET", "HEAD"].includes(req.method || "GET")) {
      return proxy(req, res, attempt + 1);
    }
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    try { res.end(JSON.stringify({ error: "API à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸žà¸£à¹‰à¸­à¸¡: " + e.message })); } catch { /* à¸›à¸´à¸”à¹à¸¥à¹‰à¸§ */ }
  });

  // à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¸›à¸´à¸”à¹à¸—à¹‡à¸š/à¹€à¸™à¹‡à¸•à¸«à¸¥à¸¸à¸” â†’ à¹€à¸¥à¸´à¸à¸„à¸¸à¸¢à¸à¸±à¸š backend à¸—à¸±à¸™à¸—à¸µ à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰à¸„à¹‰à¸²à¸‡à¹€à¸›à¹‡à¸™ zombie request
  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy();
  });
  req.on("error", () => upstream.destroy());
  req.pipe(upstream);
}

function serveFile(file, res, req) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const isHtml = ext === ".html";
  const headers = {
    "content-type": TYPES[ext] || "application/octet-stream",
    // à¸«à¸™à¹‰à¸² HTML à¸•à¹‰à¸­à¸‡à¸•à¸£à¸§à¸ˆà¹ƒà¸«à¸¡à¹ˆà¸—à¸¸à¸à¸„à¸£à¸±à¹‰à¸‡ à¹„à¸¡à¹ˆà¸‡à¸±à¹‰à¸™ iOS Safari à¸­à¸²à¸ˆà¹ƒà¸Šà¹‰ HTML à¹€à¸à¹ˆà¸²à¸—à¸µà¹ˆà¸Šà¸µà¹‰à¹„à¸› bundle à¸—à¸µà¹ˆà¸–à¸¹à¸à¸¥à¸šà¹à¸¥à¹‰à¸§ â†’ à¸«à¸™à¹‰à¸²à¸ˆà¸­à¸‚à¸²à¸§
    "cache-control": isHtml
      ? "no-cache"
      : file.includes(path.sep + "_expo" + path.sep)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    "accept-ranges": "bytes",
  };

  // à¸£à¸­à¸‡à¸£à¸±à¸š Range (iOS Safari/AVPlayer à¸‚à¸­à¸Šà¹ˆà¸§à¸‡à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸à¹ˆà¸­à¸™à¹€à¸¥à¹ˆà¸™à¹€à¸ªà¸µà¸¢à¸‡/à¸§à¸´à¸”à¸µà¹‚à¸­)
  const range = req && req.headers ? String(req.headers.range || "") : "";
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
      "content-length": end - start + 1,
    });
    const part = fs.createReadStream(file, { start, end });
    part.on("error", () => { try { res.end(); } catch { /* à¸›à¸´à¸”à¹à¸¥à¹‰à¸§ */ } });
    res.on("close", () => part.destroy());
    return part.pipe(res);
  }

  headers["content-length"] = stat.size;
  res.writeHead(200, headers);
  const stream = fs.createReadStream(file);
  // à¹„à¸Ÿà¸¥à¹Œà¸–à¸¹à¸à¹€à¸‚à¸µà¸¢à¸™à¸—à¸±à¸š/à¸¥à¸šà¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡à¸ªà¹ˆà¸‡ (à¹€à¸Šà¹ˆà¸™à¸•à¸­à¸™ export build à¹ƒà¸«à¸¡à¹ˆ) à¸•à¹‰à¸­à¸‡à¸›à¸´à¸” response à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰ process à¸•à¸²à¸¢
  stream.on("error", () => { try { res.end(); } catch { /* à¸›à¸´à¸”à¹à¸¥à¹‰à¸§ */ } });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

function safePathname(rawUrl) {
  const raw = String(rawUrl || "/").split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // % à¸—à¸µà¹ˆà¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡ â€” à¸­à¸¢à¹ˆà¸²à¹ƒà¸«à¹‰ throw à¹à¸¥à¹‰à¸§à¸¥à¹‰à¸¡à¸—à¸±à¹‰à¸‡à¹€à¸‹à¸´à¸£à¹Œà¸Ÿà¹€à¸§à¸­à¸£à¹Œ
  }
}

const server = http.createServer((req, res) => {
  const url = safePathname(req.url);
  const method = req.method || "GET";
  const accept = String(req.headers.accept || "");
  // à¹€à¸£à¸µà¸¢à¸ API à¸•à¸£à¸‡ à¹† (fetch) à¸•à¹‰à¸­à¸‡à¹„à¸”à¹‰ JSON à¹€à¸ªà¸¡à¸­ à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ HTML à¸‚à¸­à¸‡à¹à¸­à¸›
  if (isApiPath(url)) return proxy(req, res);
  if (!["GET", "HEAD"].includes(method)) return proxy(req, res);

  // 1) exact file
  let file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  try {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(file, res, req);
    // 1b) Expo export à¸šà¸²à¸‡à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸ªà¸£à¹‰à¸²à¸‡à¹€à¸›à¹‡à¸™à¹„à¸Ÿà¸¥à¹Œ /login.html (à¹„à¸¡à¹ˆà¹ƒà¸Šà¹ˆ /login/index.html)
    const flatHtml = path.join(ROOT, url.replace(/\/$/, "") + ".html");
    if (url !== "/" && fs.existsSync(flatHtml)) return serveFile(flatHtml, res, req);
    // 2) route.html (expo static export à¹à¸šà¸šà¹‚à¸Ÿà¸¥à¹€à¸”à¸­à¸£à¹Œ)
    const routeHtml = path.join(ROOT, url.replace(/\/$/, ""), "index.html");
    if (url !== "/" && fs.existsSync(routeHtml)) return serveFile(routeHtml, res, req);
    // 3) à¸«à¸™à¹‰à¸²à¹à¸£à¸ à¹à¸¥à¸°à¸«à¸™à¹‰à¸²à¹€à¸§à¹‡à¸šà¸—à¸µà¹ˆà¹€à¸šà¸£à¸²à¸§à¹Œà¹€à¸‹à¸­à¸£à¹Œà¹€à¸›à¸´à¸” â†’ SPA fallback
    const index = path.join(ROOT, "index.html");
    if (url === "/" || accept.includes("text/html")) {
      if (fs.existsSync(index)) return serveFile(index, res, req);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
  } catch (error) {
    console.error("[static]", url, error?.message || error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    try { res.end("static error"); } catch { /* à¸›à¸´à¸”à¹à¸¥à¹‰à¸§ */ }
    return;
  }
  // 4) à¸„à¸³à¸‚à¸­à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸­à¸·à¹ˆà¸™ (fetch à¹„à¸› path à¸—à¸µà¹ˆà¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸£à¸¹à¹‰à¸ˆà¸±à¸) â†’ à¸ªà¹ˆà¸‡à¸•à¹ˆà¸­ API à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰à¹„à¸”à¹‰ JSON error à¸—à¸µà¹ˆà¸­à¹ˆà¸²à¸™à¸­à¸­à¸
  return proxy(req, res);
});

// à¸„à¸³à¸‚à¸­à¸—à¸µà¹ˆ format à¸œà¸´à¸” (HTTP à¹€à¸ªà¸µà¸¢) â€” à¸•à¸­à¸š 400 à¹à¸¥à¹‰à¸§à¸›à¸´à¸” à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰ error à¸¥à¸­à¸¢à¸‚à¸¶à¹‰à¸™à¹„à¸›à¸†à¹ˆà¸² process
server.on("clientError", (error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  else socket.destroy();
});

// à¹ƒà¸«à¹‰à¸¢à¸²à¸§à¸à¸§à¹ˆà¸² timeout à¸‚à¸­à¸‡ Cloudflare à¹€à¸žà¸·à¹ˆà¸­à¹„à¸¡à¹ˆà¹ƒà¸«à¹‰ proxy à¸«à¸¢à¸´à¸š connection à¸—à¸µà¹ˆà¹€à¸žà¸´à¹ˆà¸‡à¸›à¸´à¸”à¹„à¸›à¹ƒà¸Šà¹‰ (502 à¹€à¸›à¹‡à¸™à¸„à¸£à¸±à¹‰à¸‡à¸„à¸£à¸²à¸§)
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

process.on("uncaughtException", (error) => console.error("[share:uncaught]", error?.message || error));
process.on("unhandledRejection", (reason) => console.error("[share:rejection]", reason instanceof Error ? reason.message : reason));

server.listen(PORT, "0.0.0.0", () => console.log("StudyPath share server on http://0.0.0.0:" + PORT + " root=" + ROOT));
