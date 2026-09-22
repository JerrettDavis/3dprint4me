import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const output = resolve(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  cp(resolve(root, "index.html"), resolve(output, "index.html")),
  cp(resolve(root, "manifest.webmanifest"), resolve(output, "manifest.webmanifest")),
  cp(resolve(root, "sw.js"), resolve(output, "sw.js")),
  cp(resolve(root, "assets"), resolve(output, "assets"), { recursive: true })
]);
