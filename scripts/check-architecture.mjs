import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROVIDER_PACKAGES = ["@neondatabase/", "@vercel/blob", "web-push", "pg"];
const SKIPPED_DIRECTORIES = new Set([".git", ".vercel", ".worktrees", "node_modules", "__pycache__", ".pytest_cache"]);

async function walk(path) {
  const files = [];
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if ([".js", ".mjs"].includes(extname(entry.name))) files.push(full);
  }
  return files;
}

function imports(source) {
  const results = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) results.push(match[1]);
  return results;
}

function normalized(path) { return path.split(sep).join("/"); }
function isInside(path, parent) { return path === parent || path.startsWith(`${parent}${sep}`); }
function isProvider(specifier) { return PROVIDER_PACKAGES.some(prefix => specifier === prefix || specifier.startsWith(prefix)); }

export async function checkArchitecture({ root }) {
  const absoluteRoot = resolve(root);
  const publicRoot = resolve(absoluteRoot, "public");
  const apiRoot = resolve(absoluteRoot, "api");
  const libRoot = resolve(absoluteRoot, "lib");
  const files = [
    ...await walk(publicRoot),
    ...await walk(apiRoot),
    ...await walk(libRoot)
  ].sort();
  const violations = [];

  for (const file of files) {
    const relativeFile = normalized(relative(absoluteRoot, file));
    const source = await readFile(file, "utf8");
    for (const specifier of imports(source)) {
      const importedPath = specifier.startsWith(".") ? resolve(dirname(file), specifier) : null;
      if (isInside(file, publicRoot) && importedPath && !isInside(importedPath, publicRoot)) {
        violations.push({ file: relativeFile, rule: "public-server-import", import: specifier });
      }
      if (isInside(file, apiRoot) && isProvider(specifier)) {
        violations.push({ file: relativeFile, rule: "transport-provider-import", import: specifier });
      }
      if (isInside(file, libRoot) && relativeFile.endsWith("/domain.js") && isProvider(specifier)) {
        violations.push({ file: relativeFile, rule: "domain-provider-import", import: specifier });
      }
      if (isInside(file, libRoot) && importedPath && isInside(importedPath, apiRoot)) {
        violations.push({ file: relativeFile, rule: "feature-transport-import", import: specifier });
      }
    }
  }

  return { filesChecked: files.length, violations };
}

async function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const result = await checkArchitecture({ root });
  if (result.violations.length) {
    console.error(`Architecture validation failed with ${result.violations.length} issue(s):`);
    for (const violation of result.violations) console.error(`- ${violation.file}: ${violation.rule} (${violation.import})`);
    process.exitCode = 1;
    return;
  }
  console.log(`Architecture boundaries passed for ${result.filesChecked} JavaScript files.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
