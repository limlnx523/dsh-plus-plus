import fs from 'node:fs';
import path from 'node:path';
import { resolveDSHHome } from './dshhome.mjs';
import { decodeZstd, isZstd } from './multizstd.mjs';

/** Recursively find a usage-like object (has token fields). */
function findUsage(x) {
  if (!x || typeof x !== 'object') return null;
  if (('inputTokens' in x) || ('outputTokens' in x)) return x;
  for (const k of Object.keys(x)) {
    const r = findUsage(x[k]);
    if (r) return r;
  }
  return null;
}

/** Parse a session artifact into structured events. */
function readEvents(file) {
  const buf = fs.readFileSync(file);
  const raw = isZstd(buf) ? decodeZstd(buf) : buf;
  const text = raw.toString('utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const events = [];
  for (const l of lines) {
    try { events.push(JSON.parse(l)); } catch { /* skip non-JSON */ }
  }
  return events;
}

function listSessionFiles(home) {
  const root = path.join(home, 'sessions');
  if (!fs.existsSync(root)) return [];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.jsonl(\.zstd)?$/.test(e.name)) out.push(p);
    }
  })(root);
  return out;
}

/** Approximate DeepSeek rates (per 1M tokens) for a soft cost estimate. Overridable. */
export const DEFAULT_PRICES = {
  'deepseek-v4-flash': { input: 0.27, output: 1.10, cacheRead: 0.07 },
  'deepseek-v4-pro': { input: 0.55, output: 2.20, cacheRead: 0.14 },
  'deepseek-v4-flash-vision-exp': { input: 0.27, output: 1.10, cacheRead: 0.07 },
};

export async function collectUsage(opts = {}, prices = null) {
  const home = resolveDSHHome(opts.home);
  const files = listSessionFiles(home);
  const rate = prices || DEFAULT_PRICES;
  const byModel = new Map(); // model -> agg
  const byDay = new Map();
  const byProject = new Map();
  let sessions = 0;
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalReasoning = 0, calls = 0;
  const seenSessions = new Set();

  for (const file of files) {
    let events;
    try { events = readEvents(file); } catch { continue; }
    // session id from header
    const hdr = events.find((e) => e && e.type === 'session');
    if (hdr && hdr.id) seenSessions.add(hdr.id);
    sessions = seenSessions.size;
    const cwd = hdr?.cwd || '/(root)';
    const sessionTime = hdr?.createdAt;

    let curProvider = null, curModel = null;
    for (const e of events) {
      if (!e) continue;
      if (e.type === 'request/header') {
        const cfg = e.data?.header?.config;
        if (cfg) { curProvider = cfg.provider; curModel = cfg.model; }
      }
      const u = findUsage(e);
      if (u) {
        const input = u.inputTokens || 0;
        const output = u.outputTokens || 0;
        const cacheRead = u.cacheReadTokens || 0;
        const reasoning = u.reasoningTokens || 0;
        const model = curModel || 'unknown';
        const time = e.time || sessionTime;
        const day = new Date(time).toISOString().slice(0, 10);
        let d = byDay.get(day);
        if (!d) { d = { day, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0 }; byDay.set(day, d); }
        d.calls += 1; d.inputTokens += input; d.outputTokens += output; d.cacheReadTokens += cacheRead; d.reasoningTokens += reasoning;
        { const pr = rate[model] || rate[provider] || null; if (pr) d.cost += (input / 1e6 * (pr.input || 0)) + (output / 1e6 * (pr.output || 0)) + (cacheRead / 1e6 * (pr.cacheRead || 0)); }
        let pj = byProject.get(cwd);
        if (!pj) { pj = { cwd, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0, models: new Set() }; byProject.set(cwd, pj); }
        pj.calls += 1; pj.models.add(model); pj.inputTokens += input; pj.outputTokens += output; pj.cacheReadTokens += cacheRead; pj.reasoningTokens += reasoning;
        { const pr = rate[model] || rate[provider] || null; if (pr) pj.cost += (input / 1e6 * (pr.input || 0)) + (output / 1e6 * (pr.output || 0)) + (cacheRead / 1e6 * (pr.cacheRead || 0)); }
        const agg = byModel.get(model) || { model, provider: curProvider, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 0 };
        agg.calls += 1;
        agg.inputTokens += input;
        agg.outputTokens += output;
        agg.cacheReadTokens += cacheRead;
        agg.cacheWriteTokens += u.cacheWriteTokens || 0;
        agg.reasoningTokens += reasoning;
        const p = rate[model] || rate[curProvider] || null;
        if (p) {
          agg.cost += (input / 1e6 * (p.input || 0)) + (output / 1e6 * (p.output || 0)) + (cacheRead / 1e6 * (p.cacheRead || 0));
        }
        totalInput += input; totalOutput += output; totalCacheRead += cacheRead; totalReasoning += reasoning; calls += 1;
        byModel.set(model, agg);
      }
    }
  }

  const byModelArr = [...byModel.values()].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
  const chr = (i, c) => { const den = (i || 0) + (c || 0); return den > 0 ? (c / den) * 100 : 0; };
  byModelArr.forEach((m) => { m.cacheHitRate = chr(m.inputTokens, m.cacheReadTokens); });
  const byDayArr = [...byDay.values()].map((x) => ({ ...x, cacheHitRate: chr(x.inputTokens, x.cacheReadTokens) })).sort((a, b) => b.day.localeCompare(a.day));
  const byProjectArr = [...byProject.values()].map((x) => ({ ...x, models: [...x.models] })).sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
  const havePrices = Object.keys(rate).length > 0;
  return {
    home,
    sessionFiles: files.length,
    sessions,
    calls,
    totals: { inputTokens: totalInput, outputTokens: totalOutput, cacheReadTokens: totalCacheRead, reasoningTokens: totalReasoning, cost: byModelArr.reduce((a, b) => a + b.cost, 0), cacheHitRate: chr(totalInput, totalCacheRead) },
    byModel: byModelArr, byDay: byDayArr, byProject: byProjectArr,
    prices: havePrices,
    note: havePrices ? '费用为按估计单价的软估算，可调' : '未配置单价，仅展示 tokens',
  };
}

export function formatTokens(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

export function formatCost(n) {
  return '$' + n.toFixed(3);
}

export function formatPercent(n) {
  return (n || 0).toFixed(1) + '%';
}
