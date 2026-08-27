import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';

/** DSH++ config home (its own state, never touches ~/.dsh). */
export const DSHPP_HOME = process.env.DSHPP_HOME || path.join(os.homedir(), '.dsh-plus-plus');

/** Resolve the DeepSeek Harness home: $DSH_HOME, else ~/.dsh. */
export function resolveDSHHome(override) {
  if (override) return path.resolve(override);
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME);
  return path.join(os.homedir(), '.dsh');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read a .env file into a Map (last value wins). */
export function readEnvFile(file) {
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.set(m[1], value);
  }
  return out;
}

/** Serialize a Map (or object) as a sorted, quoted .env string. Preserves nothing else. */
export function writeEnvFile(file, entries) {
  const lines = [...entries.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${quoteEnv(v)}`);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function quoteEnv(v) {
  const s = String(v);
  if (/[\s#"'\n]/.test(s) || /[^\x20-\x7E]/.test(s)) return '"' + s.replace(/(["\\])/g, '\\$1') + '"';
  return s;
}

export function isSecretKey(key) {
  return /KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH|BEARER/i.test(key);
}

export function maskSecret(v) {
  if (!v) return '';
  if (v.length <= 6) return '••••';
  return v.slice(0, 3) + '••••••' + v.slice(-2);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function timeAgo(ts) {
  if (!ts) return '-';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function jsonPretty(v) {
  return JSON.stringify(v, null, 2);
}

export function dirExists(d) { try { return fs.statSync(d).isDirectory(); } catch { return false; } }
export function fileExists(d) { try { return fs.statSync(d).isFile(); } catch { return false; } }
