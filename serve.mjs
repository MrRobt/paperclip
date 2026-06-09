import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "ui/dist");
const API_TARGET = "http://127.0.0.1:3101";
const PORT = 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  let url = req.url.split("?")[0];
  // SPA fallback: serve /dyq/ routes from index.html
  let filePath = path.join(DIST_DIR, url);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, "index.html");
    url = "/index.html";
  }
  const ext = path.extname(filePath);
  const ct = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": ct, "Access-Control-Allow-Origin": "*" });
  fs.createReadStream(filePath).pipe(res);
}

function proxyApi(req, res) {
  const url = API_TARGET + req.url;
  const opts = { method: req.method, headers: {} };
  for (const [k, v] of Object.entries(req.headers)) {
    if (k !== "host") opts.headers[k] = v;
  }
  const proxyReq = http.request(url, opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (e) => {
    res.writeHead(502);
    res.end("API proxy error: " + e.message);
  });
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url.startsWith("/api/") || url === "/api") {
    proxyApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Paperclip UI + API proxy running at http://0.0.0.0:${PORT}`);
  console.log(`  Static files: ${DIST_DIR}`);
  console.log(`  API proxy: ${API_TARGET}`);
});
