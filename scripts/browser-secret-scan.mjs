import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const forbiddenBrowserSecrets = ["VAPID_PRIVATE_KEY", "PUSH_WORKER_SECRET", "DATABASE_URL", "BLOB_READ_WRITE_TOKEN", "STRIPE_SECRET_KEY", "RESEND_API_KEY", "HOME_ASSISTANT_TOKEN"];

const textExtensions = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".txt", ".xml"]);

async function filesWithin(path) {
  const entry = await stat(path);
  if (!entry.isDirectory()) return [path];
  const files = [];
  for (const name of await readdir(path)) files.push(...await filesWithin(join(path, name)));
  return files;
}

export async function scanBrowserSecrets(paths) {
  const findings = [];
  for (const input of paths) {
    const path = input instanceof URL ? fileURLToPath(input) : input;
    for (const file of await filesWithin(path)) {
      if (!textExtensions.has(extname(file).toLowerCase())) continue;
      const source = await readFile(file, "utf8");
      for (const secret of forbiddenBrowserSecrets) {
        if (source.includes(secret)) findings.push({ file, secret });
      }
    }
  }
  return findings;
}
