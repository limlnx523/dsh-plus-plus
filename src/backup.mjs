import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { DSHPP_HOME, ensureDir, resolveDSHHome, timeAgo, formatBytes } from './dshhome.mjs';

const BACKUP_ROOT = path.join(DSHPP_HOME, 'backups');
export { BACKUP_ROOT };

const SOURCES = ['.env', 'settings.yaml', 'settings.yml'];

function snapshotId() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

function safeChild(root, id) {
  const abs = path.resolve(root, id || '');
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('invalid snapshot id');
  return abs;
}

async function collectSources(opts) {
  const home = resolveDSHHome(opts.home);
  const sources = [];
  for (const name of SOURCES) {
    const p = path.join(home, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) sources.push({ name, from: p, size: fs.statSync(p).size });
  }
  return { home, sources };
}

export async function snapshot(opts) {
  const { home, sources } = await collectSources(opts);
  if (!sources.length) {
    console.log(`[DSH++] nothing managed under ${home} yet; creating an empty snapshot anyway.`);
  }
  const id = snapshotId();
  const dest = ensureDir(safeChild(BACKUP_ROOT, id));
  fs.mkdirSync(dest, { recursive: true });
  const manifest = { id, created: new Date().toISOString(), home, files: [] };
  for (const s of sources) {
    fs.copyFileSync(s.from, path.join(dest, s.name));
    manifest.files.push({ name: s.name, size: s.size });
  }
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[DSH++] snapshot ${id} created (${sources.length} file(s)) @ ${dest}`);
  if (sources.some((s) => s.name === '.env')) {
    console.log('  NOTE: this snapshot contains your credentials (.env). Keep it local — do not commit or share it.');
  }
  return id;
}

export async function listBackups(opts) {
  if (!fs.existsSync(BACKUP_ROOT)) { console.log('[DSH++] no backups yet.'); return; }
  const ids = fs.readdirSync(BACKUP_ROOT).filter((d) => fs.statSync(path.join(BACKUP_ROOT, d)).isDirectory()).sort().reverse();
  if (!ids.length) { console.log('[DSH++] no backups yet.'); return; }
  console.log('\n[DSH++] backups');
  for (const id of ids) {
    const dir = path.join(BACKUP_ROOT, id);
    let files = [], created = null;
    const manifestPath = path.join(dir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        files = m.files || [];
        created = m.created;
      } catch { /* ignore */ }
    }
    const total = files.reduce((a, f) => a + (f.size || 0), 0);
    console.log(`  ${id}  ${files.length} file(s) ${formatBytes(total).padStart(8)}  created ${timeAgo(new Date(created).getTime())}`);
  }
}

export async function restoreBackup(opts, id) {
  if (!id) throw new Error('usage: dshpp backup restore <id>');
  const dir = safeChild(BACKUP_ROOT, id);
  if (!fs.existsSync(dir)) throw new Error(`snapshot ${id} not found`);
  const { home } = await collectSources(opts);
  await snapshot(opts);
  let restored = 0;
  for (const name of SOURCES) {
    const from = path.join(dir, name);
    if (fs.existsSync(from)) {
      fs.mkdirSync(home, { recursive: true });
      fs.copyFileSync(from, path.join(home, name));
      restored++;
    }
  }
  console.log(`[DSH++] restored ${id} -> ${home} (${restored} file(s)); pre-restore snapshot saved above.`);
  if (fs.existsSync(path.join(dir, '.env'))) {
    console.log('  NOTE: restored credentials (.env). Your current keys were overwritten.');
  }
}

export async function deleteBackup(opts, id) {
  if (!id) throw new Error('usage: dshpp backup rm <id>');
  const dir = safeChild(BACKUP_ROOT, id);
  if (!fs.existsSync(dir)) throw new Error(`snapshot ${id} not found`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`[DSH++] snapshot ${id} removed.`);
}