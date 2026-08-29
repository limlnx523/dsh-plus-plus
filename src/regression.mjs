// src/regression.mjs
//
// Regression testing for DSH workflows.
//
// The subject under test is the *whole configured DSH system*, not a single
// model. Each case drives `dsh --profile headless` with the current harness
// configuration (default model, active plugins, prompts, settings, harness
// version) inside an isolated throwaway workspace, then asserts an outcome.
//
// A run records a fingerprint (model / provider / dsh version) plus one
// outcome per case. Against a stored baseline we flag regressions: a case that
// used to pass and now fails, or one whose latency/cost degraded. This is
// deliberately *not* a model benchmark and not a general evaluator platform.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DSHPP_HOME, ensureDir, resolveDSHHome } from './dshhome.mjs';
import { listSessions } from './sessions.mjs';
import { readSettings, parseDefaultModel, runDSH } from './dshadapter.mjs';
import { DEFAULT_PRICES } from './usage.mjs';

export const BASELINE_FILE = path.join(DSHPP_HOME, 'regression.json');

/** Fixed regression cases. `setup(ws)` prepares files; `check(out, ws)` returns `{ ok, detail }`. */
export const CASES = [
  {
    id: 'math',
    desc: 'prompt: solve 13+29, expect "42"',
    prompt: '只输出数字：13 加 29 等于几？',
    check(out) {
      const ok = out.includes('42');
      return { ok, detail: ok ? 'answer present' : 'answer missing' };
    },
  },
  {
    id: 'file-write',
    desc: 'fs: write out.txt with "hello-bench"',
    prompt: '在当前工作区创建文件 out.txt，内容为 hello-bench。完成后只回复：done',
    check(out, ws) {
      const p = path.join(ws, 'out.txt');
      const ok = fs.existsSync(p) && fs.readFileSync(p, 'utf8').trim() === 'hello-bench';
      return { ok, detail: ok ? 'file written' : 'file missing or wrong content' };
    },
  },
  {
    id: 'file-read',
    desc: 'fs: read input.txt and report its content',
    prompt: '读取当前工作区的 input.txt，只回复文件里的内容',
    setup(ws) { fs.writeFileSync(path.join(ws, 'input.txt'), 'benchmark-value-123', 'utf8'); },
    check(out) {
      const ok = out.includes('benchmark-value-123');
      return { ok, detail: ok ? 'value read' : 'value missing' };
    },
  },
  {
    id: 'edit',
    desc: 'edit: replace FOO->BAR in file.txt',
    prompt: '编辑当前工作区的 file.txt，把 FOO 替换成 BAR。完成后只回复：done',
    setup(ws) { fs.writeFileSync(path.join(ws, 'file.txt'), 'hello FOO world', 'utf8'); },
    check(out, ws) {
      const p = path.join(ws, 'file.txt');
      const ok = fs.existsSync(p) && /BAR/.test(fs.readFileSync(p, 'utf8'));
      return { ok, detail: ok ? 'replaced' : 'FOO not replaced' };
    },
  },
  {
    id: 'glob',
    desc: 'tool: count .md files, expect "2"',
    prompt: '统计当前工作区中 .md 文件的数量，只回复数字',
    setup(ws) { fs.writeFileSync(path.join(ws, 'a.md'), 'a', 'utf8'); fs.writeFileSync(path.join(ws, 'b.md'), 'b', 'utf8'); },
    check(out) {
      const ok = out.includes('2');
      return { ok, detail: ok ? 'two files counted' : 'count wrong' };
    },
  },
  {
    id: 'shell-echo',
    desc: 'shell: echo BENCH_OK, expect it in output',
    prompt: '用 shell 执行 echo BENCH_OK，只回复输出',
    check(out) {
      const ok = out.includes('BENCH_OK');
      return { ok, detail: ok ? 'echoed' : 'echo missing' };
    },
  },
];

function newestSession(items) {
  if (!items || !items.length) return null;
  return items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
}

function dshVersion(home) {
  const p = path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).version || ''; } catch { /* ignore */ }
  }
  return 'unknown';
}

function activeModel(home) {
  const s = readSettings(home);
  if (!s) return { model: 'harness-default', provider: 'harness-default' };
  const dm = parseDefaultModel(s.text);
  return { model: (dm && dm.model) || 'harness-default', provider: (dm && dm.provider) || 'harness-default' };
}

function costOf(tokensIn, tokensOut, model) {
  const price = DEFAULT_PRICES[model] || null;
  return price ? (tokensIn / 1e6 * (price.input || 0)) + (tokensOut / 1e6 * (price.output || 0)) : 0;
}

async function runCase(opts, c) {
  const home = resolveDSHHome(opts.home);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dshreg-'));
  try {
    if (c.setup) c.setup(ws);
    const beforeCount = (await listSessions(opts)).count;
    const { out, ms, timeout } = await runDSH(c.prompt, { cwd: ws });
    if (timeout) {
      return { id: c.id, desc: c.desc, ok: false, timeout: true, latencyMs: ms, tokensIn: 0, tokensOut: 0, cost: 0, detail: 'timeout', model: '' };
    }
    const after = await listSessions(opts);
    const newest = after.count > beforeCount ? newestSession(after.items) : null;
    const assertion = c.check(out, ws);
    const tokensIn = newest ? newest.inputTokens : 0;
    const tokensOut = newest ? newest.outputTokens : 0;
    const runModel = (newest && newest.model) || activeModel(home).model;
    return {
      id: c.id, desc: c.desc, ok: assertion.ok,
      latencyMs: ms, tokensIn, tokensOut, cost: costOf(tokensIn, tokensOut, runModel),
      detail: assertion.detail, answer: out.trim().slice(0, 60), model: runModel,
    };
  } finally {
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch { return null; }
}
function saveBaseline(b) {
  ensureDir(path.dirname(BASELINE_FILE));
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2) + '\n', 'utf8');
}

/** Per-case diff against a previous run. Exported for testing. */
export function diffCases(prevCases, currCases) {
  if (!Array.isArray(prevCases) || !prevCases.length) return null;
  return currCases.map((c) => {
    const p = prevCases.find((x) => x.id === c.id);
    if (!p) return { id: c.id, ok: c.ok, change: 'new', latencyDeltaMs: 0, costDelta: 0 };
    return {
      id: c.id,
      ok: c.ok,
      change: c.ok === p.ok ? 'same' : (c.ok ? 'fixed' : 'regressed'),
      latencyDeltaMs: c.latencyMs - (p.latencyMs || 0),
      costDelta: c.cost - (p.cost || 0),
    };
  });
}

export async function runRegression(opts = {}, { ids } = {}) {
  const home = resolveDSHHome(opts.home);
  const fallback = activeModel(home);
  const selected = ids && ids.length ? CASES.filter((c) => ids.includes(c.id)) : CASES;
  const results = [];
  for (const c of selected) results.push(await runCase(opts, c));

  const runModel = results.map((r) => r.model).find(Boolean) || fallback.model;
  const fingerprint = { ranAt: Date.now(), model: runModel, provider: fallback.provider, dshVersion: dshVersion(home) };
  const cases = results.map((r) => ({ ...r, model: r.model || runModel }));
  const previous = loadBaseline();
  saveBaseline({ fingerprint, cases });

  const rawDiff = diffCases(previous && previous.cases, results);
  const diff = rawDiff ? rawDiff.map((d) => ({ ...d, model: runModel, okChange: d.change })) : null;
  const regressed = rawDiff ? rawDiff.filter((d) => d.change === 'regressed') : [];
  const failed = results.filter((r) => !r.ok);
  return {
    home, fingerprint, cases, diff, results: cases,
    regressed, failed, hasRegression: regressed.length > 0,
    baselineFile: BASELINE_FILE,
  };
}