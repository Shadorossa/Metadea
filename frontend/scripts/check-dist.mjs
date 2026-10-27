#!/usr/bin/env node
// Checks the production build (dist/) for two failure classes that only show
// in the installed app, never in `astro dev`:
// 1. Pages using BaseLayout must carry the same inline <script>s. Tauri's CSP
//    allows an inline script only by the hash of the page it was served
//    with, and ClientRouter keeps the first page's CSP for the whole session,
//    so a page-specific inline script is refused after a soft navigation
//    (Home's client:only islands never hydrated that way).
// 2. Every `_astro/…` file a chunk references must exist. A preload of a
//    missing CSS file made Vite reject the whole dynamic import.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new globalThis.URL('../dist/', import.meta.url));
const problems = [];

const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== '_astro') walk(path); }
    else if (name === 'index.html') pages.push(path);
  }
})(dist);

const inlineByPage = new Map();
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  if (!html.includes('id="page-content"')) continue; // BaseLayout pages only
  const hashes = new Set();
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) hashes.add(createHash('sha256').update(match[1]).digest('base64'));
  }
  inlineByPage.set(relative(dist, page), hashes);
}
const all = new Set([...inlineByPage.values()].flatMap(set => [...set]));
for (const [page, hashes] of inlineByPage) {
  const missing = [...all].filter(hash => !hashes.has(hash)).length;
  if (missing) problems.push(`${page}: lacks ${missing} inline script(s) other layout pages have`);
}

const astroDir = join(dist, '_astro');
for (const name of readdirSync(astroDir).filter(n => n.endsWith('.js'))) {
  const code = readFileSync(join(astroDir, name), 'utf8');
  for (const [, ref] of code.matchAll(/["'`](_astro\/[^"'`]+\.(?:js|css))["'`]/g)) {
    if (!existsSync(join(dist, ref))) problems.push(`_astro/${name} references missing ${ref}`);
  }
}

if (problems.length) {
  process.stderr.write(problems.join('\n') + '\n');
  process.exit(1);
}
process.stdout.write(`dist OK: ${inlineByPage.size} layout pages share their inline scripts; every _astro reference exists.\n`);
