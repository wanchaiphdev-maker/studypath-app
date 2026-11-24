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

/** ลบ header ที่ห้ามส่งต่อ (hop-by-hop) — ถ้าส่งต่อทั้งดุ้น บางครั้ง connection จะค้าง/ถูกตัด */
function cleanHeaders(headers) {
  const out = {};
  const drop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"]);
  for (const [k, v] of Object.entries(headers)) {
    if (!drop.has(String(k).toLowerCase())) out[k] = v;
  }
  return out;
}

function proxy(req, res, attempt = 0) {
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

  let finished = false;
  const upstream = http.request(
    { host: API.host, port: API.port, method: req.method, path: req.url, headers },
    (up) => {
      finished = true;
      if (res.writableEnded) { up.destroy(); return; }
      res.writeHead(up.statusCode || 502, cleanHeaders(up.headers));
      up.pipe(res);
      // ปลายทางขาดกลางทาง (เช่น backend ตายระหว่างส่ง SSE) → ปิดฝั่งผู้ใช้ให้รู้ ไม่ปล่อยค้าง
      up.on("error", () => { try { res.end(); } catch { /* ปิดแล้ว */ } });
      up.on("aborted", () => { try { res.end(); } catch { /* ปิดแล้ว */ } });
    }
  );

  // ถ้าไม่มีข้อมูลไหลเลย 120 วิ ถือว่าค้าง (SSE ที่ยังทำงานจะมี heartbeat ทุก 15 วิ จึงไม่ถูกตัด)
  upstream.setTimeout(120000, () => upstream.destroy(new Error("API ไม่ตอบสนองภายใน 120 วินาที")));

  upstream.on("error", (e) => {
    if (res.writableEnded) return;
    const retriable = ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"].includes(e.code);
    // ลองใหม่หนึ่งครั้งเฉพาะคำขอที่เรียกซ้ำได้ (GET/HEAD) — backend อาจกำลังรีสตาร์ท
    if (!finished && retriable && attempt === 0 && ["GET", "HEAD"].includes(req.method || "GET")) {
      return proxy(req, res, attempt + 1);
    }
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    try { res.end(JSON.stringify({ error: "API ยังไม่พร้อม: " + e.message })); } catch { /* ปิดแล้ว */ }
  });

  // ผู้ใช้ปิดแท็บ/เน็ตหลุด → เลิกคุยกับ backend ทันที ไม่ให้ค้างเป็น zombie request
  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy();
  });
  req.on("error", () => upstream.destroy());
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
  const stream = fs.createReadStream(file);
  // ไฟล์ถูกเขียนทับ/ลบระหว่างส่ง (เช่นตอน export build ใหม่) ต้องปิด response ไม่ให้ process ตาย
  stream.on("error", () => { try { res.end(); } catch { /* ปิดแล้ว */ } });
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

function safePathname(rawUrl) {
  const raw = String(rawUrl || "/").split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // % ที่ไม่ถูกต้อง — อย่าให้ throw แล้วล้มทั้งเซิร์ฟเวอร์
  }
}

const server = http.createServer((req, res) => {
  const url = safePathname(req.url);
  const method = req.method || "GET";
  const accept = String(req.headers.accept || "");
  // เรียก API ตรง ๆ (fetch) ต้องได้ JSON เสมอ ไม่ใช่ HTML ของแอป
  if (isApiPath(url)) return proxy(req, res);
  if (!["GET", "HEAD"].includes(method)) return proxy(req, res);

  // 1) exact file
  let file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  try {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(file, res);
    // 1b) Expo export บางเวอร์ชันสร้างเป็นไฟล์ /login.html (ไม่ใช่ /login/index.html)
    const flatHtml = path.join(ROOT, url.replace(/\/$/, "") + ".html");
    if (url !== "/" && fs.existsSync(flatHtml)) return serveFile(flatHtml, res);
    // 2) route.html (expo static export แบบโฟลเดอร์)
    const routeHtml = path.join(ROOT, url.replace(/\/$/, ""), "index.html");
    if (url !== "/" && fs.existsSync(routeHtml)) return serveFile(routeHtml, res);
    // 3) หน้าแรก และหน้าเว็บที่เบราว์เซอร์เปิด → SPA fallback
    const index = path.join(ROOT, "index.html");
    if (url === "/" || accept.includes("text/html")) {
      if (fs.existsSync(index)) return serveFile(index, res);
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
  } catch (error) {
    console.error("[static]", url, error?.message || error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    try { res.end("static error"); } catch { /* ปิดแล้ว */ }
    return;
  }
  // 4) คำขอข้อมูลอื่น (fetch ไป path ที่ยังไม่รู้จัก) → ส่งต่อ API เพื่อให้ได้ JSON error ที่อ่านออก
  return proxy(req, res);
});

// คำขอที่ format ผิด (HTTP เสีย) — ตอบ 400 แล้วปิด ไม่ให้ error ลอยขึ้นไปฆ่า process
server.on("clientError", (error, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  else socket.destroy();
});

// ให้ยาวกว่า timeout ของ Cloudflare เพื่อไม่ให้ proxy หยิบ connection ที่เพิ่งปิดไปใช้ (502 เป็นครั้งคราว)
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

process.on("uncaughtException", (error) => console.error("[share:uncaught]", error?.message || error));
process.on("unhandledRejection", (reason) => console.error("[share:rejection]", reason instanceof Error ? reason.message : reason));

server.listen(PORT, "0.0.0.0", () => console.log("StudyPath share server on http://0.0.0.0:" + PORT + " root=" + ROOT));
