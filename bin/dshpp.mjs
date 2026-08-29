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
import { runRegression } from '../src/regression.mjs';
import { DSHPP_HOME } from '../src/dshhome.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function banner() {
  return `[DSH++] DeepSeek Harness · control plane`;
}

function usage() {
  console.log(`${banner()}

Usage:
  dshpp status                      Overview (home, env, settings, backups)
  dshpp doctor                      Diagnostics checklist
  dshpp env ls [--show]             List credentials (masked unless --show)
  dshpp env set KEY=VALUE           Add/update a credential
  dshpp env rm KEY                  Remove a credential
  dshpp backup                      Create a timestamped snapshot
  dshpp backup ls                   List snapshots
  dshpp backup restore <id>         Restore a snapshot (auto pre-snapshot)
  dshpp backup rm <id>              Delete a snapshot
  dshpp providers ls|export|probe   List providers, export config, probe endpoint models
  dshpp usage                       Token/cost aggregate from session logs
  dshpp budget [set <usd>]          Show or set the monthly budget
  dshpp sessions                    List session logs
  dshpp sessions export <id>        Export a session as text
  dshpp plugins                     Inventory installed plugins + seam audit
  dshpp audit                       Security risk report for installed plugins
  dshpp test [--case <id>]          Regression-test the DSH workflow vs baseline
  dshpp web [--port N] [--no-open]  Start the local web console (loopback only)
  dshpp help                        Show this help

DSH home defaults to $DSH_HOME or ~/.dsh. Override with --home <dir>.
DSH++ keeps its own state in ${DSHPP_HOME}.
`);
}

function riskSummary(plugins) {
  const counts = { 高: 0, 中: 0, 低: 0 };
  for (const p of plugins) if (counts[p.risk] !== undefined) counts[p.risk]++;
  return counts;
}

function printPluginAudit(r, opts) {
  const counts = riskSummary(r.plugins);
  console.log(`\n${banner()} · plugin security audit  (${r.count} plugin(s) · dsh ${r.dshVersion || '?'})`);
  console.log('  risk: 高=' + counts['高'] + '  中=' + counts['中'] + '  低=' + counts['低']);
  const risky = r.plugins.filter((p) => p.risk === '高' || p.risk === '中');
  const shown = opts.all ? r.plugins : risky;
  if (!shown.length) {
    console.log('  no high/medium-risk plugin found.');
  } else {
    for (const p of shown) {
      console.log(`  [${p.risk}] ${p.name}@${p.version}  ${p.kind}  seams=${p.seams.join(',') || '-'}`);
    }
  }
  console.log('\n  解读: 高/中风险插件可读取密钥、执行 shell 或访问网络。');
  console.log('  只安装并保留信任的插件；识别为高风险的插件建议停用或移除。');
}

function fmtCost(n) { return '$' + (n || 0).toFixed(5); }

function printRegression(r) {
  const f = r.fingerprint || {};
  console.log(`\n${banner()} · regression test  ${r.cases.length} case(s)  model=${f.model || '?'}  dsh=${f.dshVersion || '?'}`);
  for (const c of r.cases) {
    const ms = (c.latencyMs / 1000).toFixed(1) + 's';
    console.log(`  ${(c.ok ? 'PASS' : 'FAIL').padEnd(5)} ${c.id.padEnd(12)} ${ms.padStart(6)}  in=${c.tokensIn} out=${c.tokensOut}  cost=${fmtCost(c.cost)}  ${c.detail || ''}`);
    if (!c.ok && c.answer) console.log(`        out: ${c.answer}`);
  }
  if (r.diff && r.diff.length) {
    console.log('\n  vs baseline:');
    for (const d of r.diff) {
      if (d.change === 'new') { console.log(`    ${d.id.padEnd(12)} (new)`); continue; }
      const lag = (d.latencyDeltaMs / 1000).toFixed(1);
      const note = d.change === 'regressed' ? '  !! REGRESSION' : d.change === 'fixed' ? '  (fixed)' : '';
      console.log(`    ${d.id.padEnd(12)} ${d.change.padEnd(9)} latency ${lag}s  cost ${d.costDelta.toFixed(4)}${note}`);
    }
  } else if (r.cases.length) {
    console.log('\n  baseline saved (no prior run to compare).');
  }
  if (r.regressed && r.regressed.length) console.log('\n  !! regression detected: ' + r.regressed.map((d) => d.id).join(', '));
  else if (r.failed && r.failed.length) console.log('\n  !! failing case(s): ' + r.failed.map((c) => c.id).join(', '));
  else console.log('\n  no regression.');
}

async function main() {
  const args = [...process.argv.slice(2)];
  const flags = {};

  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i];
    if (a === '--home') { flags.home = args[i + 1] ?? ''; args.splice(i, 2); }
    else if (a === '--port') { flags.port = Number(args[i + 1]) || 0; args.splice(i, 2); }
    else if (a === '--show') { flags.show = true; args.splice(i, 1); }
    else if (a === '--all') { flags.all = true; args.splice(i, 1); }
    else if (a === '--open') { flags.open = true; args.splice(i, 1); }
    else if (a === '--no-open') { flags.noOpen = true; args.splice(i, 1); }
    else if (a === '--case') { flags.case = (args[i + 1] ?? '').split(',').filter(Boolean); args.splice(i, 2); }
    else if (a === '--env-name') { flags.envName = args[i + 1] ?? 'default'; args.splice(i, 2); }
  }

  const cmd = args[0] ?? 'status';
  const opts = { home: flags.home || process.env.DSH_HOME || undefined, show: flags.show, all: flags.all, case: flags.case, envName: flags.envName };

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
      console.log(`\n${banner()} · sessions (${r.count})`);
      for (const s of r.items) {
        console.log(`  ${s.id}  ${new Date(s.createdAt || 0).toISOString().replace('T', ' ').slice(0, 19)}  ${s.turns} turn  ${s.model || ''}  in=${s.inputTokens} out=${s.outputTokens}`);
      }
      return;
    }

    case 'plugins':
    case 'audit': {
      const r = await listPlugins(opts);
      if (cmd === 'audit') { printPluginAudit(r, opts); return; }
      console.log(`\n${banner()} · plugins (${r.count})  dsh=${r.dshVersion}`);
      for (const p of r.plugins) {
        console.log(`  [${p.kind}] ${p.name}@${p.version}  risk=${p.risk}  seams=${p.seams.join(',') || '-'}`);
      }
      return;
    }

    case 'test':
    case 'eval':
    case 'bench':
    case 'check': {
      const r = await runRegression(opts, { ids: opts.case });
      printRegression(r);
      if (r.failed && r.failed.length) process.exitCode = 1;
      else if (r.regressed && r.regressed.length) process.exitCode = 1;
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
      console.log(`\n${banner()} · usage  (${r.sessions} session(s) / ${r.calls} call(s))`);
      console.log(`  input        ${formatTokens(r.totals.inputTokens)}  (${r.totals.inputTokens})`);
      console.log(`  output       ${formatTokens(r.totals.outputTokens)}  (${r.totals.outputTokens})`);
      console.log(`  cache_read   ${formatTokens(r.totals.cacheReadTokens)}`);
      console.log(`  reasoning    ${formatTokens(r.totals.reasoningTokens)}`);
      console.log(`  cache hit    ${formatPercent(r.totals.cacheHitRate)}`);
      console.log(`  est. cost    ${r.prices ? formatCost(r.totals.cost) : '(no prices configured)'}${r.prices ? '  ' + r.note : ''}`);
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
        console.log(`\n${banner()} · providers (${data.providers.length})`);
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
  const usageErr = /^usage:|unknown command|subcommands:/i.test(err.message || '');
  console.error(`\n[DSH++] ${err.message}`);
  process.exit(usageErr ? 2 : 1);
});