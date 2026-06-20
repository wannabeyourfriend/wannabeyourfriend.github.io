#!/usr/bin/env node
/* Regenerates assets/data/tokens.json from local Claude Code / Codex logs.
   Usage:  node scripts/update-tokens.mjs
   Data source: `npx ccusage daily --json` (reads ~/.claude/projects). */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

console.log('▸ running ccusage …');
const raw = JSON.parse(
  execSync('npx ccusage@latest daily --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
);

// model name -> agent family
function family(name) {
  return /gpt|codex|openai/.test(name) ? 'codex' : 'claude';
}

const FAMILIES = ['claude', 'codex'];
const totals = { in: 0, out: 0, cc: 0, cr: 0, cost: 0 };
const perModel = {};
const BAD_ARCHIVE_DAY_FAMILIES = new Set([
  // Same backfill issue as 2026-06-17: current ccusage has a real Codex record
  // for this day, but no Claude record. The archived Claude value was an
  // unverifiable 1.9B-token estimate created by the removed stats-cache path.
  '2026-04-25:claude',
  // This value was produced by the removed stats-cache lifetime backfill path:
  // 2026-06-17 claude was inflated to 2.2B tokens even though current ccusage
  // has no daily record for it and stats-cache only has a small raw marker.
  '2026-06-17:claude',
]);

function round2(n) {
  return Math.round(n * 100) / 100;
}

function cloneDay(day) {
  const f = {};
  for (const [name, value] of Object.entries(day.f || {})) {
    f[name] = [value[0] || 0, round2(value[1] || 0)];
  }
  return { d: day.d, f, cost: round2(day.cost || 0) };
}

function cloneArchivedDay(day) {
  const f = {};
  for (const [name, value] of Object.entries(day.f || {})) {
    if (BAD_ARCHIVE_DAY_FAMILIES.has(`${day.d}:${name}`)) continue;
    f[name] = [value[0] || 0, round2(value[1] || 0)];
  }
  return { d: day.d, f, cost: round2(Object.values(f).reduce((sum, value) => sum + (value[1] || 0), 0)) };
}

function mergeDay(current, archived) {
  if (!current) return cloneDay(archived);
  if (!archived) return cloneDay(current);

  const f = {};
  for (const name of new Set([...Object.keys(current.f || {}), ...Object.keys(archived.f || {})])) {
    const c = current.f?.[name];
    const a = archived.f?.[name];
    const winner = !a || (c && c[0] >= a[0]) ? c : a;
    f[name] = [winner[0] || 0, round2(winner[1] || 0)];
  }
  return {
    d: current.d,
    f,
    cost: round2(Object.values(f).reduce((sum, value) => sum + (value[1] || 0), 0)),
  };
}

function buildModelsFromDays(sourceDays, outByModel) {
  const byModel = {};
  for (const day of sourceDays) {
    for (const [name, value] of Object.entries(day.f || {})) {
      const model = (byModel[name] ||= { tok: 0, cost: 0, out: outByModel[name] || 0 });
      model.tok += value[0] || 0;
      model.cost += value[1] || 0;
    }
  }
  return Object.entries(byModel)
    .map(([name, value]) => ({ name, tok: value.tok, out: value.out, cost: round2(value.cost) }))
    .sort((a, b) => b.cost - a.cost);
}

const days = raw.daily.map((d) => {
  const f = {};
  for (const m of d.modelBreakdowns || []) {
    if (/synthetic/.test(m.modelName)) continue;
    const fam = family(m.modelName);
    const tok = (m.inputTokens || 0) + (m.outputTokens || 0) + (m.cacheCreationTokens || 0) + (m.cacheReadTokens || 0);
    if (!f[fam]) f[fam] = [0, 0];
    f[fam][0] += tok;
    f[fam][1] += m.cost || 0;
    const pm = (perModel[fam] ||= { tok: 0, cost: 0, out: 0 });
    pm.tok += tok;
    pm.cost += m.cost || 0;
    pm.out += m.outputTokens || 0;
  }
  totals.in += d.inputTokens || 0;
  totals.out += d.outputTokens || 0;
  totals.cc += d.cacheCreationTokens || 0;
  totals.cr += d.cacheReadTokens || 0;
  totals.cost += d.totalCost || 0;
  // round costs for compactness
  for (const k of Object.keys(f)) f[k][1] = Math.round(f[k][1] * 100) / 100;
  return { d: d.period, f, cost: Math.round((d.totalCost || 0) * 100) / 100 };
});

let models = Object.entries(perModel)
  .map(([name, v]) => ({ name, tok: v.tok, out: v.out, cost: Math.round(v.cost * 100) / 100 }))
  .sort((a, b) => b.cost - a.cost);

// Merge live ccusage output with the durable on-repo archive. ccusage can lose
// older local transcript days; the archive preserves the last known values.
const archPath = join(root, 'assets', 'data', 'tokens-archive.json');
if (existsSync(archPath)) {
  const arch = JSON.parse(readFileSync(archPath, 'utf8'));
  const byDate = new Map(days.map((d) => [d.d, cloneDay(d)]));
  const outByModel = Object.fromEntries(models.map((model) => [model.name, model.out || 0]));

  for (const archived of arch.days || []) {
    const cleanArchived = cloneArchivedDay(archived);
    if (!Object.keys(cleanArchived.f).length) continue;
    byDate.set(archived.d, mergeDay(byDate.get(archived.d), cleanArchived));
  }

  days.length = 0;
  days.push(...[...byDate.values()].sort((a, b) => (a.d < b.d ? -1 : 1)));

  for (const archived of arch.models || []) {
    outByModel[archived.name] = Math.max(outByModel[archived.name] || 0, archived.out || 0);
  }
  models = buildModelsFromDays(days, outByModel);
  writeFileSync(archPath, JSON.stringify({ days, models }));
}

// Grand totals over the merged record. in/out/cache segment totals remain the
// live ccusage breakdown; archived days only have family-level totals.
totals.tok = days.reduce((a, d) => a + Object.values(d.f).reduce((b, v) => b + v[0], 0), 0);
totals.cost = Math.round(days.reduce((a, d) => a + (d.cost || 0), 0) * 100) / 100;

const out = {
  synced: new Date().toISOString().slice(0, 10),
  families: FAMILIES,
  totals,
  models,
  days,
};

const dest = join(root, 'assets', 'data', 'tokens.json');
writeFileSync(dest, JSON.stringify(out));
const hit = ((totals.cr / (totals.in + totals.cc + totals.cr)) * 100).toFixed(1);
console.log(`▸ wrote ${dest}`);
console.log(`▸ ${days.length} days · ${(totals.tok / 1e9).toFixed(2)}B tokens · cache hit ${hit}% · $${totals.cost.toFixed(2)} api-equivalent`);
