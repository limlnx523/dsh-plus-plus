import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { resolveDSHHome, readEnvFile, isSecretKey, dirExists, fileExists } from './dshhome.mjs';

function hasInPath(bin) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.ps1'] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, bin + e);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export async function doctor(opts) {
  const home = resolveDSHHome(opts.home);
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  // node
  const major = Number(process.versions.node.split('.')[0]);
  add('Node.js', major >= 20 ? 'pass' : 'fail', `${process.versions.node} (need >=20)`);

  // DSH home
  const homeExists = dirExists(home);
  add('DSH home', homeExists ? 'pass' : 'warn', home);
  if (homeExists) {
    add('DSH home writable', (() => { try { fs.accessSync(home, fs.constants.W_OK); return true; } catch { return false; } })() ? 'pass' : 'fail', home);
  }

  // DSH binary
  const dshBin = hasInPath('dsh');
  add('dsh CLI', dshBin ? 'pass' : 'warn', dshBin || 'not in PATH (harness not installed or not linked)');

  // .env
  const envFile = path.join(home, '.env');
  const envExists = fileExists(envFile);
  add('.env', envExists ? 'pass' : 'warn', envExists ? envFile : 'not found — create with: dshpp env set KEY=VALUE');

  let invalidEnv = 0, secretKeys = 0;
  if (envExists) {
    const raw = fs.readFileSync(envFile, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
    for (const l of lines) if (!/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l.trim())) invalidEnv++;
    const entries = readEnvFile(envFile);
    secretKeys = [...entries.keys()].filter(isSecretKey).length;
  }
  add('.env format', invalidEnv === 0 ? 'pass' : 'warn', `${invalidEnv} line(s) not K=V`);

  // settings
  const settings = ['settings.yaml', 'settings.yml'].map((n) => path.join(home, n)).find(fileExists);
  add('settings.yaml', settings ? 'pass' : 'warn', settings || 'not found (harness will create on first run)');
  if (settings) {
    let parseOk = true;
    try { parseMiniYaml(fs.readFileSync(settings, 'utf8')); } catch { parseOk = false; }
    add('settings.yaml parse', parseOk ? 'pass' : 'fail', parseOk ? 'readable' : 'failed to parse — likely malformed');
  }

  // secret hygiene (never print values)
  add('secret hygiene', secretKeys > 0 ? 'pass' : 'warn', `${secretKeys} secret-looking key(s) present; masks in listings, real values stay in .env`);

  // backups
  add('DSH++ backups dir', dirExists(path.join(process.env.DSHPP_HOME || homeDir_DSHPP(), 'backups')) ? 'pass' : 'warn', 'no snapshot yet — run: dshpp backup');

  // port hint
  add('local web console', 'info', 'dshpp web (default 127.0.0.1:4848)');

  // report
  const pad = 16;
  console.log('\n[DSH++] diagnostics  (home: ' + home + ')');
  console.log('-'.repeat(64));
  for (const c of checks) {
    const tag = c.status.toUpperCase().padEnd(5);
    const color = c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : c.status === 'warn' ? 'WARN' : 'INFO';
    console.log(`  ${tag}  ${c.name.padEnd(pad)} ${c.detail || ''}`);
  }
  console.log('-'.repeat(64));
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  console.log(`  ${fails} fail, ${warns} warnings.`);
  if (fails) console.log('  Fix fails before relying on the console.');
}

function homeDir_DSHPP() {
  // avoid circular import; replicate DSHPP_HOME resolution
  const os = process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME;
  return path.join(os || process.cwd(), '.dsh-plus-plus');
}

// minimal YAML parser: top-level `key: value` and 2-space-nested maps; enough to sanity-check.
function parseMiniYaml(text) {
  let stack = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, '').trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.search(/\S/);
    if (line.trim().startsWith('-')) continue;
    if (!line.includes(':')) throw new Error('expected key: value');
    const key = line.slice(indent).split(':')[0].trim();
    if (!key) throw new Error('empty key');
    while (stack.length && indent <= stack[stack.length - 1]) stack.pop();
    stack.push(indent);
    const val = line.slice(line.indexOf(':') + 1).trim();
    if (val === '' || val === '|' || val === '>') continue; // nested block follows
  }
  return true;
}
