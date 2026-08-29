import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import {
  resolveDSHHome, readEnvFile, isSecretKey, dirExists, fileExists,
  DSHPP_HOME, formatBytes, timeAgo,
} from './dshhome.mjs';
import { BACKUP_ROOT } from './backup.mjs';
import { parseSettingsTop } from './dshadapter.mjs';

function hasInPath(bin) {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.ps1'] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const e of exts) {
    const p = path.join(d, bin + e);
    if (fileExists(p)) return p;
  }
  return null;
}

export async function STATUS(opts) {
  const home = resolveDSHHome(opts.home);
  const envFile = path.join(home, '.env');
  const env = readEnvFile(envFile);
  const settings = ['settings.yaml', 'settings.yml'].map((n) => path.join(home, n)).find(fileExists);
  const entries = [...env.entries()];
  const secretKeys = entries.filter(([k]) => isSecretKey(k)).map(([k]) => k);

  let backups = [];
  if (dirExists(BACKUP_ROOT)) {
    backups = fs.readdirSync(BACKUP_ROOT).filter((d) => fs.statSync(path.join(BACKUP_ROOT, d)).isDirectory()).sort().reverse();
  }

  // Best-effort provider hints from settings.yaml (top-level keys), no secrets.
  let settingsTop = [];
  let providerHints = [];
  if (settings) {
    try {
      settingsTop = Object.keys(parseSettingsTop(fs.readFileSync(settings, 'utf8')));
      const text = fs.readFileSync(settings, 'utf8').toLowerCase();
      if (/(provider|base_url|baseurl|api_key|model)/.test(text)) {
        providerHints = settingsTop.filter((k) => /provider|model|llm|api|key|route|env/i.test(k));
      }
    } catch { /* not parseable */ }
  }

  return {
    home,
    dshBinary: hasInPath('dsh'),
    envExists: fileExists(envFile),
    envCount: entries.length,
    secretCount: secretKeys.length,
    settingsFile: settings,
    settingsTop,
    providerHints,
    backups: backups.map((id) => ({ id })),
    dshppHome: DSHPP_HOME,
  };
}

export function printStatus(st) {
  const line = '-'.repeat(52);
  console.log('\n[DSH++] DeepSeek Harness · status');
  console.log(line);
  console.log(`  DSH home        ${st.home}`);
  console.log(`  dsh CLI         ${st.dshBinary ? 'present (' + st.dshBinary + ')' : 'not installed'}`);
  console.log(`  .env            ${st.envExists ? 'found' : 'missing'} — ${st.envCount} key(s), ${st.secretCount} secret(s) hidden`);
  console.log(`  settings.yaml   ${st.settingsFile ? st.settingsFile : 'none yet'}`);
  if (st.providerHints.length) console.log(`  provider keys   ${st.providerHints.join(', ')}`);
  else console.log(`  provider keys   (none detected)`);
  console.log(`  backups         ${st.backups.length} snapshot(s)`);
  console.log(`  DSH++ home      ${st.dshppHome}`);
  console.log(line);
  console.log('  health: run `dshpp doctor` · console: run `dshpp web`');
}

