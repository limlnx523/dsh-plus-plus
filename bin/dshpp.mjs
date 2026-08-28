#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import { STATUS, printStatus } from '../src/status.mjs';
import { envList, envSet, envRemove } from '../src/env.mjs';
import { snapshot, listBackups, restoreBackup, deleteBackup } from '../src/backup.mjs';
import { doctor } from '../src/doctor.mjs';
import { startWeb } from '../src/web.mjs';
import { listProviders, exportSettings, probeModels } from '../src/providers.mjs';
import { collectUsage, formatTokens, formatCost, formatPercent } from '../src/usage.mjs';
import { getBudget, setBudget } from '../src/config.mjs';
import { listSessions, exportSession } from '../src/sessions.mjs';
import { listPlugins } from '../src/plugins.mjs';
import { evalRun, PROBE, EXPECTED } from '../src/eval.mjs';
import { runBenchmark } from '../src/benchmark.mjs';
import { DSHPP_HOME } from '../src/dshhome.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(`
DSH++ — DeepSeek Harness lifecycle & provider manager

Usage:
  dshpp status                         Show DSH home, env, backup, diagnostics summary
  dshpp env ls [--show]                List credentials (masked by default)
  dshpp env set KEY=VALUE [--env-name N] Add/update a credential
  dshpp env rm KEY                    Remove a credential
  dshpp backup                         Create a timestamped snapshot
  dshpp backup ls                      List snapshots
  dshpp restore <id>                   Restore a snapshot
  dshpp backup rm <id>                 Delete a snapshot
  dshpp doctor                         Run environment/diagnostic checks
  dshpp providers ls|export|probe       List providers, export config, probe endpoint models
  dshpp eval [flash,pro]                 Run deterministic model probe, diff vs baseline
  dshpp bench [flash|pro] [tasks]       Multi-task benchmark (chat/fs/edit/glob/shell) + regression
  dshpp usage                           Aggregate token usage from session logs (per model)
  dshpp budget                          Show/set monthly budget (dshpp budget set <usd>)
  dshpp web [--port N] [--no-open]     Start the local web console
  dshpp help                           Show this help

DSH home defaults to $DSH_HOME or ~/.dsh. Override with --home <dir>.
DSH++ keeps its own state in ${DSHPP_HOME}.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = [...argv];
  const flags = {};

  // parse global flags (--home, --port, --show, --no-open, --env-name)
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i];
    if (a === '--home') { flags.home = args[i + 1] ?? ''; args.splice(i, 2); }
    else if (a === '--port') { flags.port = Number(args[i + 1]) || 0; args.splice(i, 2); }
    else if (a === '--show') { flags.show = true; args.splice(i, 1); }
    else if (a === '--open') { flags.open = true; args.splice(i, 1); }
    else if (a === '--no-open') { flags.noOpen = true; args.splice(i, 1); }
    else if (a === '--env-name') { flags.envName = args[i + 1] ?? 'default'; args.splice(i, 2); }
  }

  const cmd = args[0] ?? 'status';
  let opts = { home: flags.home || process.env.DSH_HOME || undefined, show: flags.show, envName: flags.envName };

  switch (cmd) {
    case 'help':
    case '-h':
    case '--help':
      usage();
      return;

    case 'status': {
      const st = await STATUS(opts);
      printStatus(st);
      return;
    }

    case 'env': {
      const sub = args[1];
      if (sub === 'ls') { await envList(opts); return; }
      if (sub === 'set') {
        const pair = args[2];
        if (!pair || !pair.includes('=')) throw new Error('usage: dshpp env set KEY=VALUE');
        await envSet(opts, pair);
        return;
      }
      if (sub === 'rm') {
        const key = args[2];
        if (!key) throw new Error('usage: dshpp env rm KEY');
        await envRemove(opts, key);
        return;
      }
      throw new Error('env subcommands: ls | set | rm');
    }

    case 'backup': {
      const sub = args[1];
      if (!sub || sub === 'create') { await snapshot(opts); return; }
      if (sub === 'ls') { await listBackups(opts); return; }
      if (sub === 'restore') { await restoreBackup(opts, args[2]); return; }
      if (sub === 'rm') { await deleteBackup(opts, args[2]); return; }
      throw new Error('backup subcommands: create | ls | restore | rm');
    }

    case 'doctor': {
      await doctor(opts);
      return;
    }

    case 'sessions': {
      const sub = args[1];
      if (sub === 'export') {
        const id = args[2]; if (!id) throw new Error('usage: dshpp sessions export <id>');
        const r = await exportSession(opts, id);
        if (r.error) throw new Error(r.error);
        console.log(r.text);
        return;
      }
      const r = await listSessions(opts);
      console.log(`\n[DSH++] sessions (${r.count})`);
      for (const s of r.items) {
        console.log(`  ${s.id}  ${new Date(s.createdAt || 0).toISOString().replace('T', ' ').slice(0, 19)}  ${s.turns} turn  ${s.model || ''}  in=${s.inputTokens} out=${s.outputTokens}`);
      }
      return;
    }

    case 'plugins': {
      const r = await listPlugins(opts);
      console.log(`\n[DSH++] plugins (${r.count})  dsh=${r.dshVersion}`);
      for (const p of r.plugins) {
        console.log(`  [${p.kind}] ${p.name}@${p.version}  risk=${p.risk}  seams=${p.seams.join(',') || '-'}`);
      }
      return;
    }
    case 'eval': {
      const variants = (args[1] || 'flash').split(',');
      const models = variants.map((v) => (v.includes('pro') ? 'deepseek-v4-pro' : v.includes('vision') ? 'deepseek-v4-flash-vision-exp' : 'deepseek-v4-flash'));
      const r = await evalRun(opts, models);
      console.log(`\n[DSH++] eval  probe: \"${PROBE}\"  expected=\"${EXPECTED}\"`);
      for (const res of r.results) {
        console.log(`  ${(res.model || '').padEnd(30)} ${res.ok ? 'PASS' : 'FAIL'}${res.timeout ? ' (timeout)' : ''}  ${res.latencyMs}ms  in=${res.tokensIn} out=${res.tokensOut}  cost=$${res.cost.toFixed(5)}`);
        if (res.answer) console.log(`      ans: ${res.answer}`);
      }
      if (r.diff) {
        console.log('\n  vs baseline:');
        for (const d of r.diff) {
          if (d.change === 'new') { console.log(`    ${d.model}  (新加入)`); continue; }
          console.log(`    ${d.model}  ${d.okChange}  latency ${d.latencyDeltaMs > 0 ? '+' : ''}${d.latencyDeltaMs}ms  cost ${(d.costDelta || 0).toFixed(4)}`);
        }
      }
      return;
    }
    case 'bench': {
      const variants = (args[1] || 'flash').split(',');
      const models = variants.map((v) => (v.includes('pro') ? 'deepseek-v4-pro' : v.includes('vision') ? 'deepseek-v4-flash-vision-exp' : 'deepseek-v4-flash'));
      const maxTasks = Number(args[2]) || 2;
      const r = await runBenchmark(opts, models, maxTasks);
      const tasks = r.models[0]?.results?.length || 0;
      console.log(`\n[DSH++] benchmark  tasks=${tasks}  models=${models.join(',')}`);
      for (const s of r.models) {
        console.log(`\n  ${s.model}  ok=${s.agg.ok}/${s.agg.tasks}  fail=${s.agg.fail}  latency=${s.agg.totalLatencyMs}ms  in=${s.agg.inputTokens} out=${s.agg.outputTokens}  cost=${formatCost(s.agg.cost)}`);
        for (const t of s.results) {
          console.log(`    ${(t.ok ? 'PASS' : 'FAIL').padEnd(5)} ${t.id.padEnd(12)} ${t.latencyMs}ms  ${t.detail}`);
        }
      }
      if (r.diff) {
        console.log('\n  vs baseline:');
        for (const d of r.diff) {
          if (d.change === 'new') { console.log(`    ${d.model}  (new)`); continue; }
          console.log(`    ${d.model}  ok ${d.okChange > 0 ? '+' : ''}${d.okChange}/${d.failChange}  latency ${(d.latencyDeltaMs || 0) > 0 ? '+' : ''}${d.latencyDeltaMs}ms  cost ${(d.costDelta || 0).toFixed(4)}${d.broke ? '  !! REGRESSION' : ''}`);
        }
      }
      return;
    }
    case 'budget': {
      const sub = args[1];
      if (sub === 'set') {
        const n = Number(args[2]);
        if (!Number.isFinite(n)) throw new Error('usage: dshpp budget set <monthly_usd>');
        const b = setBudget(n);
        console.log(`[DSH++] monthly budget set to ${b ? '$' + b.monthly : '(cleared)'}`);
        return;
      }
      const b = getBudget();
      const r = await collectUsage(opts);
      const prefix = new Date().toISOString().slice(0, 7);
      const spent = (r.byDay || []).filter((d) => d.day && d.day.startsWith(prefix)).reduce((a, d) => a + (d.cost || 0), 0);
      if (!b) { console.log(`[DSH++] no monthly budget set (spent this month: ${formatCost(spent)}).\n       set one: dshpp budget set <monthly_usd>`); return; }
      console.log(`\n[DSH++] budget  monthly=${formatCost(b.monthly)}  spent=${formatCost(spent)}  remaining=${formatCost(b.monthly - spent)}`);
      if (spent > b.monthly) console.log('  !! OVER BUDGET');
      return;
    }
    case 'usage': {
      const r = await collectUsage(opts);
      console.log(`\n[DSH++] usage  (${r.sessions} session(s) / ${r.calls} call(s))`);
      console.log(`  input        ${formatTokens(r.totals.inputTokens)}  (${r.totals.inputTokens})`);
      console.log(`  output       ${formatTokens(r.totals.outputTokens)}  (${r.totals.outputTokens})`);
      console.log(`  cache_read   ${formatTokens(r.totals.cacheReadTokens)}`);
      console.log(`  reasoning    ${formatTokens(r.totals.reasoningTokens)}`);
      console.log(`  cache hit    ${formatPercent(r.totals.cacheHitRate)}`);
      if (r.prices) console.log(`  est. cost    ${formatCost(r.totals.cost)}   ${r.note}`);
      { const bu = getBudget(); if (bu) { const prefix = new Date().toISOString().slice(0, 7); const spent = (r.byDay || []).filter((d) => d.day && d.day.startsWith(prefix)).reduce((a, d) => a + (d.cost || 0), 0); console.log(`  budget      ${formatCost(bu.monthly)} / ${formatCost(spent)}${spent > bu.monthly ? '  !! OVER' : ''}`); } }
      console.log('\n  by model:');
      for (const m of r.byModel) {
        console.log(`    ${m.model.padEnd(30)} ${(m.provider || '').padEnd(18)} ${m.calls} call  in=${formatTokens(m.inputTokens)} out=${formatTokens(m.outputTokens)} cache=${formatPercent(m.cacheHitRate)}${r.prices ? '  cost=' + formatCost(m.cost) : ''}`);
      }
      console.log('\n  by day:');
      for (const d of r.byDay) {
        console.log(`    ${d.day}  ${d.calls} call  in=${formatTokens(d.inputTokens)} out=${formatTokens(d.outputTokens)} cache=${formatPercent(d.cacheHitRate)}${r.prices ? '  cost=' + formatCost(d.cost) : ''}`);
      }
      console.log('\n  by project:');
      for (const p of r.byProject) {
        console.log(`    ${String(p.cwd).slice(0, 46).padEnd(48)} ${p.calls} call  in=${formatTokens(p.inputTokens)} out=${formatTokens(p.outputTokens)}  models=${p.models.join(',')}`);
      }
      return;
    }
    case 'web': {
      await startWeb({ ...opts, port: flags.port, open: !!flags.open });
      return;
    }

    case 'providers': {
      const sub = args[1] || 'ls';
      if (sub === 'ls' || sub === 'list') {
        const data = listProviders(opts);
        console.log(`\n[DSH++] providers (${data.providers.length})`);
        for (const p of data.providers) {
          console.log(`  ${p.id.padEnd(16)} ${p.name.padEnd(18)} ${p.baseURL || '(no url)'}  key=${p.apiKeyRef || '-'}  models=${p.models.length}`);
        }
        if (data.default) console.log(`\n  default: ${data.default.provider}${data.default.model ? ' / ' + data.default.model : ''}`);
        else console.log('\n  default: (none set)');
        return;
      }
      if (sub === 'export') {
        console.log(exportSettings(opts));
        return;
      }
      if (sub === 'probe') {
        const url = args[2] || (process.env.DSH_BASE_URL || '');
        const ref = args[3] || '';
        if (!url) throw new Error('usage: dshpp providers probe <baseURL> [API_KEY_REF]');
        const r = await probeModels(opts, { baseURL: url, apiKeyRef: ref });
        console.log(`\n[DSH++] discovered ${r.models.length} model(s) @ ${r.base}`);
        r.models.forEach((m) => console.log('  - ' + m));
        return;
      }
      throw new Error('providers subcommands: ls | export | probe');
    }

    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  console.error('\n[DSH++] ' + err.message);
  process.exit(1);
});
