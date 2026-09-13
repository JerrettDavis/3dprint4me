import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import requestHandler from "../api/request.js";
import uploadHandler from "../api/upload-url.js";
import checkoutHandler from "../api/checkout.js";
import healthHandler from "../api/health.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(projectRoot, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
process.env.LOCAL_DEV ||= "1";
const apiRoutes = new Map([["/api/request", requestHandler], ["/api/upload-url", uploadHandler], ["/api/checkout", checkoutHandler], ["/api/health", healthHandler]]);
const mime = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".webmanifest":"application/manifest+json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".xml":"application/xml; charset=utf-8", ".txt":"text/plain; charset=utf-8" };
function securityHeaders(res) { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()"); }
async function fileExists(path) { try { return (await stat(path)).isFile(); } catch { return false; } }
async function serveFile(req, res, path, statusCode = 200) { const body = await readFile(path); res.statusCode = statusCode; securityHeaders(res); res.setHeader("Content-Type", mime[extname(path).toLowerCase()] || "application/octet-stream"); res.setHeader("Cache-Control", extname(path) === ".html" ? "no-cache" : "public, max-age=60"); res.setHeader("Content-Length", body.length); if (req.method === "HEAD") res.end(); else res.end(body); }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    const apiHandler = apiRoutes.get(url.pathname);
    if (apiHandler) { securityHeaders(res); await apiHandler(req, res); return; }
    if (!["GET", "HEAD"].includes(req.method || "GET")) { res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" }); res.end("Method not allowed"); return; }
    let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { pathname = "/404.html"; }
    if (pathname === "/") pathname = "/index.html";
    if (!extname(pathname)) { const htmlCandidate = resolve(root, `.${pathname}.html`); if (await fileExists(htmlCandidate)) pathname = `${pathname}.html`; }
    const target = resolve(root, `.${pathname}`);
    if (!(target === root || target.startsWith(`${root}${sep}`)) || !(await fileExists(target))) { await serveFile(req, res, resolve(root, "404.html"), 404); return; }
    await serveFile(req, res, target);
  } catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Internal server error"); }
});
server.listen(port, host, () => console.log(`3dprint4.me running at http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
