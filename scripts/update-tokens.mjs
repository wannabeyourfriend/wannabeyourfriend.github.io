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
// transcript cleanup and its modelUsage block records true lifetime totals
// (incl. cache traffic) per model. Reconcile PER MODEL: each model's missing
// volume (lifetime minus what ccusage still sees) is spread only over that
// model's own days — so glm-era days keep glm's modest cache ratio and the
// opus-era cache tonnage stays in April/May where it happened.
const statsPath = join(homedir(), '.claude', 'stats-cache.json');
if (existsSync(statsPath)) {
  const cache = JSON.parse(readFileSync(statsPath, 'utf8'));

  // ccusage-visible total tokens per model (all four token types)
  const seen = {};
  for (const d of raw.daily) {
    for (const m of d.modelBreakdowns || []) {
      if (/synthetic/.test(m.modelName) || family(m.modelName) !== 'claude') continue;
      seen[m.modelName] = (seen[m.modelName] || 0) +
        (m.inputTokens || 0) + (m.outputTokens || 0) +
        (m.cacheCreationTokens || 0) + (m.cacheReadTokens || 0);
    }
  }

  const byDate = new Map(days.map((d) => [d.d, d]));
  const backfillDays = (cache.dailyModelTokens || []).filter((e) => {
    const day = byDate.get(e.date);
    return !(day && day.f.claude); // skip days ccusage already covers
  });

  // per-model: lifetime total, sonnet-priced $/token, raw in+out on backfill days
  const meta = {};
  for (const [name, u] of Object.entries(cache.modelUsage || {})) {
    const total = (u.inputTokens || 0) + (u.outputTokens || 0) +
      (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0);
    if (!total) continue;
    const usd = ((u.inputTokens || 0) * 3 + (u.outputTokens || 0) * 15 +
      (u.cacheReadInputTokens || 0) * 0.30 + (u.cacheCreationInputTokens || 0) * 3.75) / 1e6;
    meta[name] = { missing: Math.max(0, total - (seen[name] || 0)), costPerTok: usd / total, rawSum: 0 };
  }
  for (const e of backfillDays) {
    for (const [name, tok] of Object.entries(e.tokensByModel || {})) {
      if (meta[name] && family(name) === 'claude') meta[name].rawSum += tok;
    }
  }

  let backTok = 0, backCost = 0;
  for (const e of backfillDays) {
    let tok = 0, cost = 0;
    for (const [name, rawTok] of Object.entries(e.tokensByModel || {})) {
      const m = meta[name];
      if (!m || family(name) !== 'claude' || !m.rawSum) continue;
      const t = rawTok * (m.missing / m.rawSum);
      tok += t;
      cost += t * m.costPerTok;
    }
    if (!tok) continue;
    tok = Math.round(tok);
    cost = Math.round(cost * 100) / 100;
    backTok += tok;
    backCost += cost;
    const day = byDate.get(e.date);
    if (day) {
      day.f.claude = [tok, cost];
      day.cost = Math.round((day.cost + cost) * 100) / 100;
    } else {
      const nd = { d: e.date, f: { claude: [tok, cost] }, cost };
      days.push(nd);
      byDate.set(e.date, nd);
    }
    const pm = (perModel.claude ||= { tok: 0, cost: 0, out: 0 });
    pm.tok += tok;
    pm.cost += cost;
  }
  totals.cost += backCost;
  days.sort((a, b) => (a.d < b.d ? -1 : 1));
  console.log(`▸ per-model reconciliation: backfilled ${(backTok / 1e9).toFixed(2)}B / $${backCost.toFixed(2)} across ${backfillDays.length} days @ sonnet pricing`);
}

const models = Object.entries(perModel)
  .map(([name, v]) => ({ name, tok: v.tok, out: v.out, cost: Math.round(v.cost * 100) / 100 }))
  .sort((a, b) => b.cost - a.cost);

// merge with the on-repo archive, then write it back. The archive is the
// durable record: stats-cache.json is a cache Claude Code may reset (it did
// on 2026-06-11, dropping Jan–Apr), and transcripts get cleaned up — so for
// any day, whichever source saw MORE volume wins, and the union is saved.
const archPath = join(root, 'assets', 'data', 'tokens-archive.json');
if (existsSync(archPath)) {
  const arch = JSON.parse(readFileSync(archPath, 'utf8'));
  const byDate2 = new Map(days.map((d) => [d.d, d]));
  for (const ad of arch.days || []) {
    const cur = byDate2.get(ad.d);
    const aTok = Object.values(ad.f).reduce((a, v) => a + v[0], 0);
    const cTok = cur ? Object.values(cur.f).reduce((a, v) => a + v[0], 0) : 0;
    if (!cur) { days.push(ad); byDate2.set(ad.d, ad); }
    else if (aTok > cTok) { cur.f = ad.f; cur.cost = ad.cost; }
  }
  days.sort((a, b) => (a.d < b.d ? -1 : 1));
  for (const am of arch.models || []) {
    const m = models.find((x) => x.name === am.name);
    if (!m) models.push(am);
    else if (am.tok > m.tok) { m.tok = am.tok; m.cost = am.cost; m.out = am.out; }
  }
  models.sort((a, b) => b.cost - a.cost);
}
writeFileSync(archPath, JSON.stringify({ days, models }));

// grand totals over the merged record (the stat cards read these)
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
