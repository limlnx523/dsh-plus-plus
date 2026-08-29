import fs from 'node:fs';
import path from 'node:path';
import { DSHPP_HOME, ensureDir, resolveDSHHome } from './dshhome.mjs';
import { listSessions } from './sessions.mjs';
import { runDSH } from './dshadapter.mjs';
import { DEFAULT_PRICES } from './usage.mjs';

export const PROBE = '只输出数字：12 加 30 等于几';
export const EXPECTED = '42';
export const DEFAULT_PROVIDER = 'deepseek-official';

const EVAL_FILE = path.join(DSHPP_HOME, 'eval.json');

function setAgentDefaultModel(text, provider, model) {
  const block = `agent-default-model:\n  provider: ${provider}\n  model: ${model}\n`;
  const lines = (text || '').split(/\r?\n/);
  const out = [];
  let replaced = false;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^agent-default-model\s*:/.test(l)) {
      out.push(block.trimEnd());
      i++;
      while (i < lines.length && /^\s+/.test(lines[i])) i++;
      replaced = true;
      continue;
    }
    out.push(l);
    i++;
  }
  let txt = out.join('\n');
  if (!replaced) txt = (txt.trimEnd() ? txt.trimEnd() + '\n' : '') + block;
  return txt;
}

function newestSession(items) {
  if (!items || !items.length) return null;
  return items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
}

export async function evalOne(opts, { provider = DEFAULT_PROVIDER, model, probe = PROBE, expected = EXPECTED }) {
  const home = resolveDSHHome(opts.home);
  const sf = path.join(home, 'settings.yaml');
  const existed = fs.existsSync(sf);
  const backup = existed ? fs.readFileSync(sf, 'utf8') : '';
  const before = await listSessions(opts);
  const beforeCount = before.count;

  fs.writeFileSync(sf, setAgentDefaultModel(backup, provider, model), 'utf8');
  const { out, ms, timeout } = await runDSH(probe);
  if (existed) fs.writeFileSync(sf, backup, 'utf8');
  else { try { fs.unlinkSync(sf); } catch { /* ignore */ } }

  const after = await listSessions(opts);
  let newest = newestSession(after.items);
  if (newest && beforeCount >= after.count && newest.id === (before.items[0]?.id)) newest = null;
  const ok = out.includes(expected);
  const price = DEFAULT_PRICES[model] || DEFAULT_PRICES[DEFAULT_PROVIDER] || null;
  const cost = price && newest ? (newest.inputTokens / 1e6 * (price.input || 0)) + (newest.outputTokens / 1e6 * (price.output || 0)) : 0;
  return {
    provider,
    model,
    ok,
    timeout: !!timeout,
    latencyMs: ms,
    tokensIn: newest ? newest.inputTokens : 0,
    tokensOut: newest ? newest.outputTokens : 0,
    cost,
    answer: out.trim().slice(0, 160),
  };
}

function loadBaseline() {
  if (!fs.existsSync(EVAL_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(EVAL_FILE, 'utf8')); } catch { return null; }
}

function saveBaseline(b) {
  ensureDir(path.dirname(EVAL_FILE));
  fs.writeFileSync(EVAL_FILE, JSON.stringify(b, null, 2) + '\n', 'utf8');
}

export async function evalRun(opts, models = []) {
  const home = resolveDSHHome(opts.home);
  if (!models.length) models = ['deepseek-v4-flash'];
  const results = [];
  for (const model of models) {
    results.push(await evalOne(opts, { provider: DEFAULT_PROVIDER, model }));
  }
  const previous = loadBaseline();
  const baseline = { ranAt: Date.now(), models: results };
  saveBaseline(baseline);
  let diff = null;
  if (previous && Array.isArray(previous.models)) {
    diff = results.map((r) => {
      const p = previous.models.find((x) => x.model === r.model);
      if (!p) return { model: r.model, change: 'new' };
      return {
        model: r.model,
        okChange: p.ok !== r.ok ? (r.ok ? 'turned-ok' : 'BROKE') : 'same',
        latencyDeltaMs: r.latencyMs - (p.latencyMs || 0),
        costDelta: r.cost - (p.cost || 0),
      };
    });
  }
  return { home, results, diff, baselineFile: EVAL_FILE };
}