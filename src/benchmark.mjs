import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DSHPP_HOME, ensureDir, resolveDSHHome } from './dshhome.mjs';
import { listSessions } from './sessions.mjs';
import { runDSH } from './dshadapter.mjs';
import { DEFAULT_PRICES } from './usage.mjs';

const EVAL_FILE = path.join(DSHPP_HOME, 'bench.json');
const DEFAULT_PROVIDER = 'deepseek-official';

/** Deterministic benchmark tasks. Each runs `dsh --profile headless` in an
 * isolated temp workspace and asserts an outcome. `setup(ws)` prepares files;
 * `check(out, ws)` returns `{ ok, detail }`. */
export const TASKS = [
  {
    id: 'math',
    desc: 'chat: solve 13+29, expect "42"',
    check(out) {
      const ok = out.includes('42');
      return { ok, detail: ok ? 'answer present' : 'answer missing' };
    },
  },
  {
    id: 'file-write',
    desc: 'write out.txt with "hello-bench"',
    check(out, ws) {
      const p = path.join(ws, 'out.txt');
      const ok = fs.existsSync(p) && fs.readFileSync(p, 'utf8').trim() === 'hello-bench';
      return { ok, detail: ok ? 'file written' : 'file missing or wrong content' };
    },
  },
  {
    id: 'file-read',
    desc: 'read input.txt and report its content',
    setup(ws) { fs.writeFileSync(path.join(ws, 'input.txt'), 'benchmark-value-123', 'utf8'); },
    check(out) {
      const ok = out.includes('benchmark-value-123');
      return { ok, detail: ok ? 'value read' : 'value missing' };
    },
  },
  {
    id: 'glob-md',
    desc: 'count .md files, expect "2"',
    setup(ws) { fs.writeFileSync(path.join(ws, 'a.md'), 'a', 'utf8'); fs.writeFileSync(path.join(ws, 'b.md'), 'b', 'utf8'); },
    check(out) {
      const ok = out.includes('2');
      return { ok, detail: ok ? 'two files counted' : 'count wrong' };
    },
  },
  {
    id: 'edit',
    desc: 'edit file.txt replace FOO->BAR',
    setup(ws) { fs.writeFileSync(path.join(ws, 'file.txt'), 'hello FOO world', 'utf8'); },
    check(out, ws) {
      const p = path.join(ws, 'file.txt');
      const ok = fs.existsSync(p) && /BAR/.test(fs.readFileSync(p, 'utf8'));
      return { ok, detail: ok ? 'replaced' : 'FOO not replaced' };
    },
  },
  {
    id: 'shell-echo',
    desc: 'shell echo BENCH_OK, expect it in output',
    check(out) {
      const ok = out.includes('BENCH_OK');
      return { ok, detail: ok ? 'echoed' : 'echo missing' };
    },
  },
];

function promptFor(task) {
  const wsPromptMap = {
    'file-write': '在当前工作区创建文件 out.txt，内容为 hello-bench。完成后只回复：done',
    'file-read': '读取当前工作区的 input.txt，只回复文件里的内容',
    'glob-md': '统计当前工作区中 .md 文件的数量，只回复数字',
    edit: '编辑当前工作区的 file.txt，把 FOO 替换成 BAR。完成后只回复：done',
    'shell-echo': '用 shell 执行 echo BENCH_OK，只回复输出',
  };
  return wsPromptMap[task.id] || (task.id === 'math' ? '只输出数字：13 加 29 等于几？' : '完成一个基准任务。');
}

function newestSession(items) {
  if (!items || !items.length) return null;
  return items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
}

function costOf(tokensIn, tokensOut, model) {
  const price = DEFAULT_PRICES[model] || DEFAULT_PRICES[DEFAULT_PROVIDER] || null;
  return price ? (tokensIn / 1e6 * (price.input || 0)) + (tokensOut / 1e6 * (price.output || 0)) : 0;
}

export async function runTask(opts, task, model) {
  const home = resolveDSHHome(opts.home);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dshbench-'));
  try {
    if (task.setup) task.setup(ws);
    const beforeCount = (await listSessions(opts)).count;
    const probe = promptFor(task);
    const { out, ms, timeout } = await runDSH(probe, { cwd: ws });
    if (timeout) return { id: task.id, desc: task.desc, ok: false, timeout: true, latencyMs: ms, tokensIn: 0, tokensOut: 0, cost: 0, detail: 'timeout' };
    const after = await listSessions(opts);
    const newest = after.count > beforeCount ? newestSession(after.items) : null;
    const c = task.check(out, ws);
    const tokensIn = newest ? newest.inputTokens : 0;
    const tokensOut = newest ? newest.outputTokens : 0;
    return { id: task.id, desc: task.desc, ok: c.ok, latencyMs: ms, tokensIn, tokensOut, cost: costOf(tokensIn, tokensOut, model), detail: c.detail, answer: out.trim().slice(0, 60) };
  } finally {
    try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function loadBaseline() {
  if (!fs.existsSync(EVAL_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(EVAL_FILE, 'utf8')); } catch { return null; }
}
function saveBaseline(b) { ensureDir(path.dirname(EVAL_FILE)); fs.writeFileSync(EVAL_FILE, JSON.stringify(b, null, 2) + '\n', 'utf8'); }

function emptyAgg(model) {
  return { model, tasks: 0, ok: 0, fail: 0, totalLatencyMs: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
}

export async function runBenchmark(opts, models = ['deepseek-v4-flash'], maxTasks = 2) {
  const home = resolveDSHHome(opts.home);
  const selected = TASKS.slice(0, maxTasks);
  const suites = [];
  for (const model of models) {
    const results = [];
    for (const task of selected) {
      results.push(await runTask(opts, task, model));
    }
    const agg = emptyAgg(model);
    for (const r of results) {
      agg.tasks += 1;
      if (r.ok) agg.ok += 1; else agg.fail += 1;
      agg.totalLatencyMs += r.latencyMs || 0;
      agg.inputTokens += r.tokensIn || 0;
      agg.outputTokens += r.tokensOut || 0;
      agg.cost += r.cost || 0;
    }
    suites.push({ model, results, agg });
  }
  const previous = loadBaseline();
  const baseline = { ranAt: Date.now(), models: suites.map((s) => ({ model: s.model, ok: s.agg.ok, fail: s.agg.fail, cost: s.agg.cost, totalLatencyMs: s.agg.totalLatencyMs })) };
  saveBaseline(baseline);
  let diff = null;
  if (previous && Array.isArray(previous.models)) {
    diff = suites.map((s) => {
      const p = previous.models.find((m) => m.model === s.model);
      if (!p) return { model: s.model, change: 'new' };
      return {
        model: s.model,
        okChange: (s.agg.ok - (p.ok || 0)),
        failChange: (s.agg.fail - (p.fail || 0)),
        latencyDeltaMs: s.agg.totalLatencyMs - (p.totalLatencyMs || 0),
        costDelta: s.agg.cost - (p.cost || 0),
        broke: (s.agg.fail > (p.fail || 0)),
      };
    });
  }
  return { home, models: suites, diff, baselineFile: EVAL_FILE };
}