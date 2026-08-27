import fs from 'node:fs';
import path from 'node:path';
import { DSHPP_HOME, ensureDir, readEnvFile, resolveDSHHome, fileExists } from './dshhome.mjs';

const MANIFEST = 'providers.json';
export const PROVIDERS_FILE = path.join(DSHPP_HOME, MANIFEST);

const DEFAULT_MANIFEST = { version: 1, default: null, providers: [] };

function manifestPath() { return PROVIDERS_FILE; }

export function loadManifest() {
  if (!fileExists(PROVIDERS_FILE)) return { ...DEFAULT_MANIFEST, providers: [] };
  try {
    const m = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8'));
    if (!Array.isArray(m.providers)) throw new Error('bad manifest');
    return { ...DEFAULT_MANIFEST, ...m };
  } catch {
    return { ...DEFAULT_MANIFEST, providers: [] };
  }
}

export function saveManifest(m) {
  ensureDir(path.dirname(PROVIDERS_FILE));
  fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

/** List providers + their linked env key presence + default selection. */
export function listProviders(opts) {
  const m = loadManifest();
  const home = resolveDSHHome(opts.home);
  const env = readEnvFile(path.join(home, '.env'));
  const items = m.providers.map((p) => ({
    ...p,
    apiKeySet: !!env.get(p.apiKeyRef || ''),
  }));
  return { default: m.default, providers: items, file: PROVIDERS_FILE };
}

/** Upsert a provider by id. */
export function saveProvider(opts, p) {
  if (!p.id || !/^[a-zA-Z0-9._-]+$/.test(p.id)) throw new Error('provider id must be [a-zA-Z0-9._-]');
  const m = loadManifest();
  const idx = m.providers.findIndex((x) => x.id === p.id);
  const entry = {
    id: p.id,
    name: p.name || p.id,
    baseURL: p.baseURL || '',
    api: p.api || 'openai',
    apiKeyRef: p.apiKeyRef || '',
    models: Array.isArray(p.models) ? p.models : [],
    enabled: p.enabled !== false,
    notes: p.notes || '',
  };
  if (idx >= 0) m.providers[idx] = entry; else m.providers.push(entry);
  saveManifest(m);
  return entry;
}

export function removeProvider(id) {
  const m = loadManifest();
  const before = m.providers.length;
  m.providers = m.providers.filter((x) => x.id !== id);
  if (m.default && m.default.provider === id) m.default = null;
  saveManifest(m);
  return before !== m.providers.length;
}

export function setDefault(provider, model) {
  const m = loadManifest();
  m.default = { provider, model: model || '' };
  saveManifest(m);
  return m.default;
}

function resolveKey(home, apiKeyRef) {
  if (!apiKeyRef) return '';
  const env = readEnvFile(path.join(home, '.env'));
  return env.get(apiKeyRef) || '';
}

/** Probe an OpenAI/DeepSeek-compatible endpoint for its advertised models. */
export async function probeModels(opts, req) {
  const home = resolveDSHHome(opts.home);
  const baseURL = (req.baseURL || '').replace(/\/+$/, '');
  if (!baseURL) throw new Error('baseURL required');
  const apiKeyRef = req.apiKeyRef || '';
  const apiKey = req.apiKey || resolveKey(home, apiKeyRef);
  const candidates = [baseURL + '/v1/models', baseURL + '/models'];
  let lastErr = null;
  for (const url of candidates) {
    const res = await fetch(url, {
      headers: { ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}) },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) { lastErr = `HTTP ${res.status} @ ${url}`; continue; }
    const j = await res.json();
    const models = (Array.isArray(j.data) ? j.data : [])
      .map((x) => ({ id: x.id || x.name, owned_by: x.owned_by || '' }))
      .filter((x) => x.id);
    return { base: baseURL, url, models: dedupe(models.map((x) => x.id)) };
  }
  throw new Error(lastErr || 'no models endpoint reachable');
}

/** Build a DSH-friendly settings snippet for the default model + provider hint. */
export function exportSettings(opts) {
  const m = loadManifest();
  const home = resolveDSHHome(opts.home);
  const lines = [];
  lines.push('# DeepSeek Harness config (DSH++ generated)');
  lines.push('# paste into ' + path.join(home, 'settings.yaml') + ' (or merge with existing)');
  lines.push('');
  if (m.default && m.default.provider) {
    lines.push('agent-default-model:');
    lines.push(`  provider: ${m.default.provider}`);
    lines.push(`  model: ${m.default.model}`);
    lines.push('');
  }
  if (m.providers.length) {
    lines.push('# provider routes registered by DSH++ (adapter plugins own registration;');
    lines.push('# keep apiKeyRef values in ' + path.join(home, '.env') + ' — never inline secrets here)');
    lines.push('');
    for (const p of m.providers) {
      lines.push(`# provider ${p.id} -> ${p.baseURL || '?'}  api=${p.api}  key=${p.apiKeyRef || '(none)'}  models=${p.models.length}`);
      if (p.apiKeyRef) lines.push(`#   ensures env: ${p.apiKeyRef}`);
    }
  }
  return lines.join('\n');
}

function dedupe(arr) { return [...new Set(arr)]; }
