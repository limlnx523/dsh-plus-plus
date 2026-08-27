import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { STATUS } from './status.mjs';
import { readEnvFile, isSecretKey, maskSecret, resolveDSHHome, dirExists } from './dshhome.mjs';
import { snapshot, restoreBackup, deleteBackup, BACKUP_ROOT } from './backup.mjs';
import { doctor } from './doctor.mjs';
import { listProviders, saveProvider, removeProvider, setDefault, probeModels, exportSettings } from './providers.mjs';
import { collectUsage } from './usage.mjs';
import { getBudget, setBudget } from './config.mjs';
import { listSessions, exportSession } from './sessions.mjs';
import { listPlugins } from './plugins.mjs';
import { evalRun } from './eval.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new Error('body too large'));
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function asset(res, file) {
  const ext = path.extname(file).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const full = path.join(WEB, file);
  if (!full.startsWith(WEB + path.sep) && full !== path.join(WEB, 'index.html')) return json(res, 404, { error: 'not found' });
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(full).pipe(res);
}

export async function startWeb(opts = {}) {
  const port = opts.port || 4848;
  let doctorCache = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    try {
      // API
      if (p === '/api/status') { const st = await STATUS(opts); return json(res, 200, st); }
      if (p === '/api/env') {
        const home = resolveDSHHome(opts.home);
        const file = path.join(home, '.env');
        const entries = readEnvFile(file);
        return json(res, 200, {
          home, file, exists: fs.existsSync(file),
          items: [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
            const secret = isSecretKey(k);
            return { key: k, value: opts.show ? v : (secret ? maskSecret(v) : v), secret, hasValue: !!v };
          }),
        });
      }
      if (p === '/api/backups') {
        const ids = dirExists(BACKUP_ROOT)
          ? fs.readdirSync(BACKUP_ROOT).filter((d) => fs.statSync(path.join(BACKUP_ROOT, d)).isDirectory()).sort().reverse()
          : [];
        return json(res, 200, { items: ids });
      }
      if (p === '/api/doctor') { doctorCache = doctorCache || []; return json(res, 200, { ok: true }); }

      if (p === '/api/providers') return json(res, 200, listProviders(opts));
      if (p === '/api/providers/export') return json(res, 200, { text: exportSettings(opts) });
      if (p === '/api/usage') { const r = await collectUsage(opts); const b = getBudget(); if (b) { const prefix = new Date().toISOString().slice(0, 7); const spent = (r.byDay || []).filter((d) => d.day && d.day.startsWith(prefix)).reduce((a, d) => a + (d.cost || 0), 0); r.budget = { monthly: b.monthly, spent, remaining: b.monthly - spent, pct: b.monthly > 0 ? (spent / b.monthly * 100) : 0, over: spent > b.monthly }; } return json(res, 200, r); }
      if (p === '/api/budget') { if (req.method === 'POST') { const b = await readBody(req); setBudget(b.monthly); return json(res, 200, { budget: getBudget() }); } return json(res, 200, { budget: getBudget() }); }
      if (p === '/api/sessions') { const r = await listSessions(opts); return json(res, 200, r); }
      if (p === '/api/plugins') { const r = await listPlugins(opts); return json(res, 200, r); }
      if (req.method === 'POST' && p === '/api/eval') { const b = await readBody(req); const r = await evalRun(opts, b.models || []); return json(res, 200, r); }
      if (req.method === 'POST' && p === '/api/sessions/export') { const b = await readBody(req); const r = await exportSession(opts, b.id || ''); return json(res, 200, r); }
      if (req.method === 'POST' && p === '/api/providers/save') { const b = await readBody(req); const e = saveProvider(opts, b); return json(res, 200, { ok: true, provider: e }); }
      if (req.method === 'POST' && p === '/api/providers/remove') { const b = await readBody(req); if (!b.id) return json(res, 400, { error: 'id required' }); removeProvider(b.id); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && p === '/api/providers/default') { const b = await readBody(req); if (!b.provider) return json(res, 400, { error: 'provider required' }); setDefault(b.provider, b.model); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && p === '/api/providers/probe') { const b = await readBody(req); const r = await probeModels(opts, b); return json(res, 200, r); }

      // mutations
      if (req.method === 'POST' && p === '/api/env/set') {
        const b = await readBody(req);
        if (!b.key || !('value' in b)) return json(res, 400, { error: 'key and value required' });
        requireEnvSet(opts, b.key, b.value);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/env/rm') {
        const b = await readBody(req);
        if (!b.key) return json(res, 400, { error: 'key required' });
        requireEnvRemove(opts, b.key);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/backup/create') { const id = await snapshot(opts); return json(res, 200, { ok: true, id }); }
      if (req.method === 'POST' && p === '/api/backup/restore') {
        const b = await readBody(req);
        if (!b.id) return json(res, 400, { error: 'id required' });
        await restoreBackup(opts, b.id);
        return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/api/backup/delete') {
        const b = await readBody(req);
        if (!b.id) return json(res, 400, { error: 'id required' });
        await deleteBackup(opts, b.id);
        return json(res, 200, { ok: true });
      }

      // static
      if (p === '/') return asset(res, 'index.html');
      if (p.startsWith('/assets/')) return asset(res, p.slice(1));
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = `http://127.0.0.1:${port}/`;
    console.log(`\n[DSH++] console running at ${addr}`);
    console.log('       Ctrl+C to stop.');
    if (opts.open) openBrowser(addr);
  });

  return server;
}

function openBrowser(url) {
  const os = process.platform;
  try {
    if (os === 'win32') require('node:child_process').spawn('cmd.exe', ['/c', 'start', '', url], { shell: false, detached: true, stdio: 'ignore' }).unref();
    else if (os === 'darwin') require('node:child_process').spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else require('node:child_process').spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* non-fatal */ }
}

function require_home() {
  const os = process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME;
  return os || process.cwd();
}

// lazy imports of env.mjs to avoid top-level circular uses
let envSetFn, envRemoveFn;
async function requireEnvSet(opts, key, value) {
  if (!envSetFn) envSetFn = (await import('./env.mjs')).envSet;
  await envSetFn(opts, `${key}=${value}`);
}
async function requireEnvRemove(opts, key) {
  if (!envRemoveFn) envRemoveFn = (await import('./env.mjs')).envRemove;
  await envRemoveFn(opts, key);
}
