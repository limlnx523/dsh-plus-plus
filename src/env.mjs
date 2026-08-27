import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { resolveDSHHome, readEnvFile, writeEnvFile, isSecretKey, maskSecret } from './dshhome.mjs';

function envFile(opts) {
  return path.join(resolveDSHHome(opts.home), '.env');
}

/** List credentials in DSH_HOME/.env, masking secrets unless --show. */
export async function envList(opts) {
  const file = envFile(opts);
  const entries = readEnvFile(file);
  const show = !!opts.show;
  if (!fs.existsSync(file)) {
    console.log(`\n[DSH++] no .env at ${file}`);
    console.log('       (create one with: dshpp env set DEEPSEEK_API_KEY=sk-...)');
    return;
  }
  const rows = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
  console.log(`\n[DSH++] credentials @ ${file}`);
  if (!rows.length) { console.log('       (empty)'); return; }
  const secretKeys = rows.filter(([k]) => isSecretKey(k)).map(([k]) => k);
  const showWarn = secretKeys.filter((k) => !show);
  for (const [k, v] of rows) {
    const isSecret = isSecretKey(k);
    const shown = show ? v : (isSecret ? maskSecret(v) : v);
    console.log(`  ${k.padEnd(28)} ${shown}`);
  }
  if (showWarn.length) {
    console.log(`\n  ${showWarn.length} secret key(s) hidden. Use --show to reveal.`);
  }
}

/** Add or update a credential without clobbering unrelated lines. */
export async function envSet(opts, pair) {
  const idx = pair.indexOf('=');
  if (idx <= 0) throw new Error('expected KEY=VALUE');
  const key = pair.slice(0, idx).trim();
  const value = pair.slice(idx + 1);
  const file = envFile(opts);
  let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const keyRe = new RegExp(`^(?:export\\s+)?${escapeRe(key)}\\s*=`);
  let found = false;
  lines = lines.map((line) => {
    if (keyRe.test(line.trim())) { found = true; return `${key}=${quoteVal(value)}`; }
    return line;
  });
  if (!found) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`${key}=${quoteVal(value)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n').replace(/\n+$/, '\n'), 'utf8');
  console.log(`[DSH++] ${key} written to ${file}`);
}

/** Remove a credential by key. */
export async function envRemove(opts, key) {
  const file = envFile(opts);
  if (!fs.existsSync(file)) throw new Error(`no .env at ${file}`);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const keyRe = new RegExp(`^(?:export\\s+)?${escapeRe(key)}\\s*=`);
  const kept = lines.filter((line) => !keyRe.test(line.trim()));
  if (kept.length === lines.length) { console.log(`[DSH++] ${key} not present`); return; }
  fs.writeFileSync(file, kept.join('\n').replace(/\n+$/, '\n'), 'utf8');
  console.log(`[DSH++] ${key} removed from ${file}`);
}

function quoteVal(v) {
  const s = String(v);
  if (/[\s#"'\n]/.test(s) || /[^\x20-\x7E]/.test(s)) return '"' + s.replace(/(["\\])/g, '\\$1') + '"';
  return s;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
