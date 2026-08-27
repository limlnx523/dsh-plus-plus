import fs from 'node:fs';
import path from 'node:path';
import { resolveDSHHome } from './dshhome.mjs';

const SEAM_PATTERNS = {
  network: [/fetch\(/, /https?:\/\//, /WebSocket/, /require\(['"]https/],
  shell: [/\bctx\.shell\b/, /child_process/, /spawn\(/, /exec\(/, /\bctx\.subprocess\b/],
  fs: [/\bctx\.fs\b/, /readFileSync/, /writeFileSync/, /unlinkSync/, /fs\.readdir/, /fs\.writeFile/],
  credentials: [/\bctx\.credentials\b/, /apiKeyEnv/, /credential/i, /Bearer /],
  sandbox: [/\bctx\.sandbox\b/, /sandboxPolicy/],
  mcp: [/\bctx\.mcp\b/, /mcp\//],
  llm: [/\bctx\.llm\b/, /registerAdapter/],
  goal: [/\bctx\.goal\b/, /goal\//],
};

function pkgJson(dir) {
  const p = path.join(dir, 'package.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function isPluginPkg(name, pkg) {
  if (typeof name === 'string' && name.startsWith('@deepseek-ai/dsh-')) return true;
  if (pkg) {
    const blob = JSON.stringify(pkg);
    if (/dsh\.bundle|"dsh"\s*:|dsh-plugin|deepseek-harness/i.test(blob)) return true;
  }
  return false;
}

function auditSeams(pkg) {
  const pkgDir = pkg.__dir;
  const main = pkg.main || pkg.module;
  const files = [];
  if (main) {
    const cands = [path.join(pkgDir, main), path.join(pkgDir, main.replace(/\.js$/, '.mjs'))];
    for (const c of cands) if (fs.existsSync(c)) { files.push(c); break; }
  }
  // also scan lib/ dist
  const lib = path.join(pkgDir, 'lib');
  if (fs.existsSync(lib)) {
    for (const e of fs.readdirSync(lib)) if (/\.(m?js)$/.test(e)) files.push(path.join(lib, e));
  }
  const src = [];
  for (const f of files) {
    try { src.push(fs.readFileSync(f, 'utf8')); } catch { /* ignore */ }
  }
  const text = src.join('\n');
  const seams = Object.keys(SEAM_PATTERNS).filter((k) => SEAM_PATTERNS[k].some((re) => re.test(text)));
  return seams;
}

function riskOf(seams) {
  const high = ['network', 'shell', 'subprocess', 'fs', 'credentials'];
  const score = seams.filter((s) => high.includes(s)).length;
  if (score >= 3) return '高';
  if (score >= 1) return '中';
  return '低';
}

export async function listPlugins(opts = {}) {
  const home = resolveDSHHome(opts.home);
  const nodeRoot = path.join(home, 'profiles', 'node_modules');
  const pkgs = new Map();
  const seen = new Set();
  let limit = 400;

  function inspect(dir) {
    if (seen.has(dir) || limit-- <= 0) return;
    seen.add(dir);
    const pkg = pkgJson(dir);
    if (!pkg || !pkg.name) return;
    if (!isPluginPkg(pkg.name, pkg)) return;
    pkgs.set(pkg.name, { ...pkg, __dir: dir });
  }

  // top-level node_modules (third-party w/ dsh manifest) + scoped
  if (fs.existsSync(nodeRoot)) {
    for (const e of fs.readdirSync(nodeRoot)) {
      const d = path.join(nodeRoot, e);
      if (!fs.statSync(d).isDirectory()) continue;
      if (e.startsWith('@')) {
        for (const s of fs.readdirSync(d)) inspect(path.join(d, s));
      } else {
        inspect(d);
      }
    }
  }

  const list = [...pkgs.values()].map((pkg) => {
    const name = pkg.name || '';
    const seams = auditSeams(pkg);
    return {
      name,
      version: pkg.version || '?',
      kind: name.startsWith('@deepseek-ai/') ? '官方' : '第三方',
      seams,
      risk: riskOf(seams),
      describe: (pkg.description || '').slice(0, 80),
    };
  }).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === '官方' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // dsh version for compat note
  let dshVersion = '';
  try {
    dshVersion = require_version(nodeRoot);
  } catch { /* ignore */ }

  return { home, count: list.length, dshVersion, plugins: list };
}

function require_version(nodeRoot) {
  const p = path.join(nodeRoot, '@deepseek-ai', 'dsh', 'package.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).version || '';
  return '';
}
