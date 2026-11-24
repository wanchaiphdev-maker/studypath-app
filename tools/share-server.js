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
// ทุก path ที่เป็น API ต้อง proxy ไป backend — ถ้าตกหล่นจะได้ HTML ของแอปกลับไปแทน JSON
// (อาการ: "Unexpected token '<', <!DOCTYPE ... is not valid JSON")
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

function proxy(req, res) {
  // ส่ง host เดิมของผู้ใช้ต่อให้ API รู้ว่าโดเมนที่เปิดอยู่คืออะไร (ใช้สร้าง redirect_uri ของ Google)
  // ถ้าไม่ส่ง ปลายทางจะกลายเป็น 127.0.0.1:3000 เสมอ ทำให้ Google เด้งกลับ localhost บนมือถือ
  const incomingHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const incomingProto = String(req.headers["x-forwarded-proto"] || "https");
  const headers = {
    ...req.headers,
    host: API.host + ":" + API.port,
    "x-forwarded-host": incomingHost,
    "x-forwarded-proto": incomingProto,
    "x-forwarded-for": String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""),
  };
  const upstream = http.request(
    { host: API.host, port: API.port, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "API ยังไม่พร้อม: " + e.message }));
  });
  req.pipe(upstream);
}

function serveFile(file, res) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const headers = {
    "content-type": TYPES[ext] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": file.includes(path.sep + "_expo" + path.sep)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=60",
  };
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  const method = req.method || "GET";
  const accept = String(req.headers.accept || "");
  // เรียก API ตรง ๆ (fetch) ต้องได้ JSON เสมอ ไม่ใช่ HTML ของแอป
  if (isApiPath(url)) return proxy(req, res);
  if (!["GET", "HEAD"].includes(method)) return proxy(req, res);

  // 1) exact file
  let file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(file, res);
  // 2) route.html (expo static export)
  const routeHtml = path.join(ROOT, url.replace(/\/$/, ""), "index.html");
  if (url !== "/" && fs.existsSync(routeHtml)) return serveFile(routeHtml, res);
  // 3) เบราว์เซอร์เปิดหน้าเว็บ → SPA fallback
  const index = path.join(ROOT, "index.html");
  if (accept.includes("text/html")) {
    if (fs.existsSync(index)) return serveFile(index, res);
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    return;
  }
  // 4) คำขอข้อมูลอื่น (fetch ไป path ที่ยังไม่รู้จัก) → ส่งต่อ API เพื่อให้ได้ JSON error ที่อ่านออก
  return proxy(req, res);
});

server.listen(PORT, "0.0.0.0", () => console.log("StudyPath share server on http://0.0.0.0:" + PORT + " root=" + ROOT));
