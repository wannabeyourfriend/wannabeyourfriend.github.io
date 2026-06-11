#!/usr/bin/env node
/* Regenerates assets/data/tokens.json from local Claude Code / Codex logs.
   Usage:  node scripts/update-tokens.mjs
   Data source: `npx ccusage daily --json` (reads ~/.claude/projects). */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
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

// backfill from Claude Code's persistent stats cache: it survives the 30-day
// transcript cleanup and its modelUsage block records the true lifetime
// totals (incl. cache traffic) for every model ever run through Claude Code
// on this machine. Reconcile: whatever ccusage can no longer see is spread
// over the cache's daily in+out series, priced at Sonnet rates.
const statsPath = join(homedir(), '.claude', 'stats-cache.json');
if (existsSync(statsPath)) {
  const cache = JSON.parse(readFileSync(statsPath, 'utf8'));
  const life = { in: 0, out: 0, cr: 0, cc: 0 };
  for (const u of Object.values(cache.modelUsage || {})) {
    life.in += u.inputTokens || 0;
    life.out += u.outputTokens || 0;
    life.cr += u.cacheReadInputTokens || 0;
    life.cc += u.cacheCreationInputTokens || 0;
  }
  const lifetimeTok = life.in + life.out + life.cr + life.cc;
  // blended $/token of the lifetime mix at Sonnet rates ($3/$15/$0.30/$3.75 per Mtok)
  const blended = (life.in * 3 + life.out * 15 + life.cr * 0.30 + life.cc * 3.75) / 1e6 / lifetimeTok;

  const ccusageClaude = (perModel.claude && perModel.claude.tok) || 0;
  const remaining = Math.max(0, lifetimeTok - ccusageClaude);

  const byDate = new Map(days.map((d) => [d.d, d]));
  const fillDays = [];
  let rawSum = 0;
  for (const e of cache.dailyModelTokens || []) {
    const day = byDate.get(e.date);
    if (day && day.f.claude) continue; // ccusage already covers this day
    const raw = Object.values(e.tokensByModel || {}).reduce((a, b) => a + b, 0);
    if (!raw) continue;
    fillDays.push({ date: e.date, raw });
    rawSum += raw;
  }
  if (rawSum && remaining) {
    const scale = remaining / rawSum;
    let backCost = 0;
    for (const fd of fillDays) {
      const tok = Math.round(fd.raw * scale);
      const cost = Math.round(tok * blended * 100) / 100;
      backCost += cost;
      const day = byDate.get(fd.date);
      if (day) {
        day.f.claude = [tok, cost];
        day.cost = Math.round((day.cost + cost) * 100) / 100;
      } else {
        const nd = { d: fd.date, f: { claude: [tok, cost] }, cost };
        days.push(nd);
        byDate.set(fd.date, nd);
      }
      const pm = (perModel.claude ||= { tok: 0, cost: 0, out: 0 });
      pm.tok += tok;
      pm.cost += cost;
    }
    totals.cost += backCost;
    days.sort((a, b) => (a.d < b.d ? -1 : 1));
    console.log(`▸ reconciled to lifetime ${(lifetimeTok / 1e9).toFixed(2)}B claude tokens — backfilled ${(remaining / 1e9).toFixed(2)}B / $${backCost.toFixed(2)} across ${fillDays.length} days @ sonnet pricing`);
  }
}

// grand total across both sources (the stat card reads this)
totals.tok = days.reduce((a, d) => a + Object.values(d.f).reduce((b, v) => b + v[0], 0), 0);

const models = Object.entries(perModel)
  .map(([name, v]) => ({ name, tok: v.tok, out: v.out, cost: Math.round(v.cost * 100) / 100 }))
  .sort((a, b) => b.cost - a.cost);

totals.cost = Math.round(totals.cost * 100) / 100;

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
