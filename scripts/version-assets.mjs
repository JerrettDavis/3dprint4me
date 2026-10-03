import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const customizeRoot = join(root, 'customize');
async function walk(dir) {
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (/\.(html|css|js)$/.test(entry.name)) {
      // Vite output under public/customize carries its own content hashes and relative chunk
      // imports that must not gain ?v=; only its HTML (which references shared site assets) is versioned.
      if (dir.startsWith(customizeRoot) && !entry.name.endsWith('.html')) continue;
      paths.push(path);
    }
  }
  return paths.sort();
}

// One content-derived release key covers HTML and the entire module/style graph.
// Strip the previous key before hashing so generation is deterministic/idempotent.
// Vite chunk names in public/customize HTML carry content hashes that depend on the ?v= keys of
// the public modules they bundle. Hashing them would make the release key chase its own tail
// (build -> version -> build never settles), so the hash part is ignored; those chunks are
// cache-busted by their own names.
const viteChunk = /(\/customize\/assets\/[A-Za-z0-9_.-]+?)-[A-Za-z0-9_-]{8}(\.(?:js|css|wasm))/g;
const reference = /(["'])((?:\/assets\/|\.{1,2}\/)[^"'?\s]+\.(?:js|css))(?:\?v=[a-f0-9]{16})?\1/g;
const files = await Promise.all((await walk(root)).map(async path => {
  const source = await readFile(path, 'utf8');
  const normalized = source.replace(reference, '$1$2$1').replace(/\r\n/g, '\n');
  return { path, source, normalized, hashInput: normalized.replace(viteChunk, '$1$2') };
}));
const hash = createHash('sha256');
for (const file of files) hash.update(relative(root, file.path).replaceAll('\\', '/') + '\0' + file.hashInput + '\0');
const version = hash.digest('hex').slice(0, 16);
const stale = [];
for (const file of files) {
  const output = file.normalized.replace(reference, (_, quote, path) => `${quote}${path}?v=${version}${quote}`);
  if (output === file.source.replace(/\r\n/g, '\n')) continue;
  stale.push(relative(root, file.path));
  if (!process.argv.includes('--check')) await writeFile(file.path, output);
}
// The Vite page sources reference shared site assets with vite-ignore; they carry the same key
// so a fresh `customizer:build` already emits versioned HTML (the build output then passes
// --check without a second versioning pass). Only absolute /assets/ references are touched;
// relative references belong to Vite.
const sourceRoot = fileURLToPath(new URL('../customizer/', import.meta.url));
const sourceReference = /(["'])(\/assets\/[^"'?\s]+\.(?:js|css))(?:\?v=[a-f0-9]{16})?\1/g;
for (const path of (await walkHtml(sourceRoot))) {
  const source = await readFile(path, 'utf8');
  const output = source.replace(/\r\n/g, '\n').replace(sourceReference, (_, quote, ref) => `${quote}${ref}?v=${version}${quote}`);
  if (output === source.replace(/\r\n/g, '\n')) continue;
  stale.push(relative(root, path));
  if (!process.argv.includes('--check')) await writeFile(path, output);
}
async function walkHtml(dir) {
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') paths.push(...await walkHtml(path));
    else if (entry.name.endsWith('.html')) paths.push(path);
  }
  return paths.sort();
}
if (stale.length && process.argv.includes('--check')) {
  console.error('Asset versions are stale. Run npm run assets:version.\n' + stale.join('\n'));
  process.exitCode = 1;
} else console.log(`Asset release ${version}: ${stale.length ? 'updated' : 'verified'} ${files.length} HTML, CSS, and JavaScript files.`);
