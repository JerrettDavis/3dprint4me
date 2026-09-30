// Loopback-only private file store for `npm run dev:workspace`. It mimics signed,
// expiring, non-overwriting Blob upload/download URLs with an in-memory HMAC key.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const PATH_PATTERN = /^print-estimates\/est_[a-f0-9]{32}\/[a-f0-9]{10}-[A-Za-z0-9._() +-]{1,180}$/;
export const LOCAL_FILE_ROUTE = "/api/dev-private-file";

export function createLocalFileStore({ root, origin, key = randomBytes(32), now = () => Date.now() }) {
  const base = resolve(root);
  const target = path => {
    if (!PATH_PATTERN.test(path)) throw Object.assign(new Error("Invalid private path."), { status: 400 });
    const full = resolve(base, path);
    if (!full.startsWith(`${base}${sep}`)) throw Object.assign(new Error("Invalid private path."), { status: 400 });
    return full;
  };
  const signature = (operation, path, expires, maxBytes) => createHmac("sha256", key).update(`${operation}\n${path}\n${expires}\n${maxBytes}`).digest("base64url");
  const signedUrl = (operation, path, seconds, maxBytes = 0) => {
    const expires = now() + seconds * 1000;
    const url = new URL(LOCAL_FILE_ROUTE, origin);
    url.search = new URLSearchParams({ op: operation, path, exp: String(expires), max: String(maxBytes), sig: signature(operation, path, expires, maxBytes) }).toString();
    return url.href;
  };
  const verify = params => {
    const operation = params.get("op"); const path = params.get("path") ?? ""; const expires = Number(params.get("exp")); const maxBytes = Number(params.get("max"));
    const expected = Buffer.from(signature(operation, path, expires, maxBytes)); const actual = Buffer.from(params.get("sig") ?? "");
    if (!["put", "get"].includes(operation) || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    if (!Number.isFinite(expires) || expires < now()) return null;
    return { operation, path, maxBytes };
  };
  return {
    kind: "local",
    async authorizeUpload(path, size) {
      target(path);
      return { uploadUrl: signedUrl("put", path, 900, size), method: "PUT", headers: {}, bodyType: "file" };
    },
    async inspect(path) {
      try { const info = await stat(target(path)); return { size: info.size }; }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    },
    async read(path, maxBytes) {
      const info = await stat(target(path));
      if (info.size > maxBytes) throw Object.assign(new Error("Private object exceeds the read limit."), { code: "too_large" });
      return new Uint8Array(await readFile(target(path)));
    },
    async signDownload(path, seconds) { target(path); return signedUrl("get", path, seconds); },
    async delete(path) { await rm(target(path), { force: true }); },
    /** Dev-server route: PUT and GET with verified signatures only. */
    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://local.invalid");
      const grant = verify(url.searchParams);
      const deny = (status, message) => { res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); res.end(message); };
      if (!grant) return deny(403, "Signature invalid or expired.");
      if (req.method === "PUT" && grant.operation === "put") {
        const full = target(grant.path);
        await mkdir(dirname(full), { recursive: true });
        let handle;
        try { handle = await open(full, "wx"); } catch { return deny(409, "Object already exists."); }
        let total = 0;
        try {
          for await (const chunk of req) {
            total += chunk.length;
            if (total > grant.maxBytes) throw Object.assign(new Error("too large"), { status: 413 });
            await handle.write(chunk);
          }
          await handle.close();
        } catch (error) {
          await handle.close().catch(() => {});
          await rm(full, { force: true });
          return deny(error.status ?? 500, "Upload rejected.");
        }
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ pathname: grant.path, size: total }));
        return;
      }
      if (["GET", "HEAD"].includes(req.method) && grant.operation === "get") {
        const full = target(grant.path);
        let info;
        try { info = await stat(full); } catch { return deny(404, "Not found."); }
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": info.size, "Content-Disposition": `attachment; filename="${grant.path.split("/").pop().replace(/^[a-f0-9]{10}-/, "")}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        if (req.method === "HEAD") return res.end();
        createReadStream(full).pipe(res);
        return;
      }
      return deny(405, "Method not allowed.");
    }
  };
}
