#!/usr/bin/env node
/* Regenerates assets/data/tokens.json from local Claude Code / Codex logs.
   Usage:  node scripts/update-tokens.mjs
   Data source: `npx ccusage daily --json` (reads ~/.claude/projects). */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

const models = Object.entries(perModel)
  .map(([name, v]) => ({ name, tok: v.tok, out: v.out, cost: Math.round(v.cost * 100) / 100 }))
  .sort((a, b) => b.cost - a.cost);

// Grand totals over exactly what ccusage returned. The stat cards read these,
// so keep them aligned with `npx ccusage daily --json`.
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
