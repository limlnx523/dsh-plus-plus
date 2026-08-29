// src/dshadapter.mjs
//
// The thin, version-sensitive bridge into a DeepSeek Harness (dsh) install.
//
// Everything in this module depends on dsh internals that can shift between
// releases. They are collected here on purpose so an upgrade only needs a
// single file reviewed instead of a hunt across the codebase:
//
//   - the on-disk session layout and the concatenated-zstd JSONL event format
//     (event types such as `session`, `request/header`, `assistant/message`,
//     `turn/start`, and the usage fields `inputTokens` / `outputTokens` /
//     `cacheReadTokens`)
//   - the settings.yaml keys we surface (`agent-default-model`, top-level keys)
//   - invoking the `dsh` CLI for a `--profile headless` task run
//
// Keep DSH-format knowledge here. If a dsh bump changes one of these, the fix
// belongs in this file.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { decodeZstd, isZstd } from './multizstd.mjs';

export { decodeZstd, scanZstdFrames, isZstd } from './multizstd.mjs';

export function listSessionPaths(home) {
  const root = path.join(home, 'sessions');
  if (!fs.existsSync(root)) return [];
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.jsonl(\.zstd)?$/.test(e.name)) {
        const parent = path.basename(path.dirname(p));
        const m = parent.match(/session-([a-f0-9-]+)/i);
        out.push({ file: p, id: m ? m[1] : path.basename(p) });
      }
    }
  })(root);
  return out;
}

export function readSessionEvents(file) {
  const buf = fs.readFileSync(file);
  const raw = isZstd(buf) ? decodeZstd(buf) : buf;
  const events = [];
  for (const line of raw.toString('utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try { events.push(JSON.parse(s)); } catch { /* skip non-JSON */ }
  }
  return events;
}

export function findUsage(value) {
  if (!value || typeof value !== 'object') return null;
  if (('inputTokens' in value) || ('outputTokens' in value)) return value;
  for (const k of Object.keys(value)) {
    const hit = findUsage(value[k]);
    if (hit) return hit;
  }
  return null;
}

export function findSettingsFile(home) {
  for (const name of ['settings.yaml', 'settings.yml']) {
    const p = path.join(home, name);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* continue */ }
  }
  return null;
}

export function parseSettingsTop(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, '').trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (line.search(/\S/) !== 0) continue;          // top-level only
    if (line.trim().startsWith('-') || !line.includes(':')) continue;
    const key = line.slice(0, line.indexOf(':')).trim();
    if (key) out[key] = true;
  }
  return out;
}

export function parseDefaultModel(text) {
  const lines = String(text || '').split(/\r?\n/);
  let inBlock = false;
  let provider = '';
  let model = '';
  for (const raw of lines) {
    const line = raw.replace(/\s*#.*$/, '').trimEnd();
    if (line.search(/\S/) === 0) { inBlock = false; }
    if (line.search(/\S/) === 0 && /^agent-default-model\s*:/.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;
    const m = line.slice(line.search(/\S/)).match(/^(\w[\w.-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'provider') provider = m[2].trim().replace(/^["']|["']$/g, '');
    if (m[1] === 'model') model = m[2].trim().replace(/^["']|["']$/g, '');
  }
  if (!provider && !model) return null;
  return { provider, model };
}

export function readSettings(home) {
  const p = findSettingsFile(home);
  if (!p) return null;
  try { return { path: p, text: fs.readFileSync(p, 'utf8') }; } catch { return null; }
}

export function resolveDSHBinary() {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.ps1', '.bat'] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, 'dsh' + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* continue */ }
    }
  }
  return 'dsh';
}

export function runDSH(probe, { cwd } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let settled = false;
    const args = ['--profile', 'headless', probe];
    const isWin = process.platform === 'win32';
    // On Windows the npm shim is a .cmd wrapper that cannot be spawned directly.
    // Run it through cmd.exe (the shell *program*), not `shell: true`, which
    // avoids Node's DEP0190 shell-arg injection warning. The probe is a fixed,
    // internal constant rather than user input.
    const child = isWin
      ? spawn('cmd.exe', ['/c', 'dsh', ...args], { cwd, env: process.env, windowsHide: true })
      : spawn(resolveDSHBinary(), args, { cwd, env: process.env, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', () => { if (!settled) { settled = true; resolve({ out, ms: Date.now() - t0, error: 'spawn failed' }); } });
    child.on('close', () => { if (!settled) { settled = true; resolve({ out, ms: Date.now() - t0 }); } });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch { /* ignore */ }
        resolve({ out, ms: Date.now() - t0, timeout: true });
      }
    }, 120000).unref();
  });
}