#!/usr/bin/env node
/**
 * build-solar-subset.mjs: bundle only the Solar icons the code uses (from the Spike Admin UI system).
 * Scans src/ for string literals like "solar:bell-bing-line-duotone", extracts them from
 * @iconify-json/solar and writes src/icons/solar-subset.json, so icons render offline with a tiny bundle.
 * Runs before dev and build, and as a Vite plugin during dev.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { getIcons } from '@iconify/utils';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(SRC, 'icons', 'solar-subset.json');
const require = createRequire(import.meta.url);
const walk = (dir) => readdirSync(dir).flatMap((name) => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(name) ? [p] : []; });
const RE = /["'`]solar:([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g;
let last = '';

export function buildSolarSubset({ quiet = false } = {}) {
  const names = new Set();
  for (const f of walk(SRC)) for (const m of readFileSync(f, 'utf8').matchAll(RE)) names.add(m[1]);
  const list = [...names].sort();
  const sig = list.join(',');
  if (sig === last) return false;
  last = sig;
  const full = JSON.parse(readFileSync(require.resolve('@iconify-json/solar/icons.json'), 'utf8'));
  const subset = getIcons(full, list, true);
  const missing = list.filter((n) => !subset?.icons?.[n] && !subset?.aliases?.[n]);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(subset) + '\n');
  if (!quiet) console.log(`[icons:solar] ${list.length} Solar icons bundled -> ${relative(ROOT, OUT)}`);
  if (missing.length) console.warn(`[icons:solar] WARNING not found: ${missing.join(', ')}`);
  return true;
}

export function solarSubsetPlugin() {
  return {
    name: 'solar-subset',
    buildStart() { buildSolarSubset({ quiet: true }); },
    handleHotUpdate(ctx) { if (/\.(tsx?|jsx?)$/.test(ctx.file) && ctx.file.startsWith(SRC)) buildSolarSubset(); },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) buildSolarSubset();
