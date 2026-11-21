// Minimal static server for the production browser-acceptance bundle.
//
// The golden browser gate must exercise the artifact that ships, not the CRA
// development shell. That shell compiles lazy route chunks on demand and can
// leave a fresh context without the login form long enough to look like an
// authentication failure. This server serves `build/` with the history
// fallback the production ingress uses, so every browser history route
// resolves to the same immutable bundle.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 13000);
const BUILD_DIR = path.resolve(__dirname, "..", "build");
const INDEX_FILE = path.join(BUILD_DIR, "index.html");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function resolveAsset(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const resolved = path.resolve(BUILD_DIR, `.${decoded}`);
  if (resolved !== BUILD_DIR && !resolved.startsWith(`${BUILD_DIR}${path.sep}`)) return null;
  return resolved;
}

if (!fs.existsSync(INDEX_FILE)) {
  console.error(`Production bundle not found at ${INDEX_FILE}. Run the frontend build first.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const candidate = resolveAsset(requestUrl.pathname);
  if (!candidate) {
    send(res, 400, "Bad Request");
    return;
  }

  let filePath = candidate;
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }

  // Unknown paths are client-side browser-history routes. Files that exist
  // under build/ (including missing hashed assets) are served as they are, so
  // a genuinely missing asset still fails rather than silently returning HTML.
  if (!stat || !stat.isFile()) {
    if (path.extname(requestUrl.pathname)) {
      send(res, 404, "Not Found");
      return;
    }
    filePath = INDEX_FILE;
  }

  const extension = path.extname(filePath).toLowerCase();
  const isHtml = extension === ".html";
  const cacheControl = isHtml
    ? "no-store"
    : requestUrl.pathname.startsWith("/static/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600";

  try {
    const body = fs.readFileSync(filePath);
    send(res, 200, req.method === "HEAD" ? undefined : body, {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": cacheControl,
    });
  } catch (error) {
    console.error(`Failed to serve ${filePath}: ${error.message}`);
    send(res, 500, "Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Nexus production build served at http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
