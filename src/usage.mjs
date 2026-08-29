import { resolveDSHHome } from './dshhome.mjs';
import { listSessionPaths, readSessionEvents, findUsage } from './dshadapter.mjs';

/** Approximate DeepSeek rates (per 1M tokens) for a soft cost estimate. Overridable. */
export const DEFAULT_PRICES = {
  'deepseek-v4-flash': { input: 0.27, output: 1.10, cacheRead: 0.07 },
  'deepseek-v4-pro': { input: 0.55, output: 2.20, cacheRead: 0.14 },
  'deepseek-v4-flash-vision-exp': { input: 0.27, output: 1.10, cacheRead: 0.07 },
};

const rateFor = (rate, model, provider) => rate[model] || rate[provider] || null;

export async function collectUsage(opts = {}, prices = null) {
  const home = resolveDSHHome(opts.home);
  const files = listSessionPaths(home).map((s) => s.file);
  const rate = prices || DEFAULT_PRICES;
  const byModel = new Map(); // model -> agg
  const byDay = new Map();
  const byProject = new Map();
  let sessions = 0;
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalReasoning = 0, calls = 0;
  const seenSessions = new Set();

  for (const file of files) {
    let events;
    try { events = readSessionEvents(file); } catch { continue; }
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
        const pr = rateFor(rate, model, curProvider);

        let d = byDay.get(day);
        if (!d) { d = { day, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0 }; byDay.set(day, d); }
        d.calls += 1; d.inputTokens += input; d.outputTokens += output; d.cacheReadTokens += cacheRead; d.reasoningTokens += reasoning;
        if (pr) d.cost += (input / 1e6 * (pr.input || 0)) + (output / 1e6 * (pr.output || 0)) + (cacheRead / 1e6 * (pr.cacheRead || 0));

        let pj = byProject.get(cwd);
        if (!pj) { pj = { cwd, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, cost: 0, models: new Set() }; byProject.set(cwd, pj); }
        pj.calls += 1; pj.models.add(model); pj.inputTokens += input; pj.outputTokens += output; pj.cacheReadTokens += cacheRead; pj.reasoningTokens += reasoning;
        if (pr) pj.cost += (input / 1e6 * (pr.input || 0)) + (output / 1e6 * (pr.output || 0)) + (cacheRead / 1e6 * (pr.cacheRead || 0));

        const agg = byModel.get(model) || { model, provider: curProvider, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, cost: 0 };
        agg.calls += 1;
        agg.inputTokens += input;
        agg.outputTokens += output;
        agg.cacheReadTokens += cacheRead;
        agg.cacheWriteTokens += u.cacheWriteTokens || 0;
        agg.reasoningTokens += reasoning;
        if (pr) agg.cost += (input / 1e6 * (pr.input || 0)) + (output / 1e6 * (pr.output || 0)) + (cacheRead / 1e6 * (pr.cacheRead || 0));

        totalInput += input; totalOutput += output; totalCacheRead += cacheRead; totalReasoning += reasoning; calls += 1;
        byModel.set(model, agg);
      }
    }
  }

  const byModelArr = [...byModel.values()].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));
  const chr = (input, cache) => { const den = (input || 0) + (cache || 0); return den > 0 ? (cache / den) * 100 : 0; };
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