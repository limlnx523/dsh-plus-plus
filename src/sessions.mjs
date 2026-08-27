import fs from 'node:fs';
import path from 'node:path';
import { resolveDSHHome } from './dshhome.mjs';
import { decodeZstd, isZstd } from './multizstd.mjs';

function findUsage(x) {
  if (!x || typeof x !== 'object') return null;
  if (('inputTokens' in x) || ('outputTokens' in x)) return x;
  for (const k of Object.keys(x)) {
    const r = findUsage(x[k]);
    if (r) return r;
  }
  return null;
}

function readEvents(file) {
  const buf = fs.readFileSync(file);
  const raw = isZstd(buf) ? decodeZstd(buf) : buf;
  const text = raw.toString('utf8');
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    const s = l.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip */ }
  }
  return out;
}

function previewText(events) {
  // find the first user-role message text
  for (const e of events) {
    if (e.type === 'agent/inbox/spliced') {
      const inserted = e.data?.inserted || [];
      for (const m of inserted) {
        if (m.role === 'user' && Array.isArray(m.content)) {
          for (const c of m.content) if (c.type === 'text' && c.text) return c.text.trim();
        }
      }
    }
    if (e.type === 'user/message') {
      const c = e.data;
      if (typeof c === 'string') return c.trim();
      if (c && Array.isArray(c.content)) {
        for (const b of c.content) if (b.type === 'text' && b.text) return b.text.trim();
      }
    }
  }
  return '';
}

export function listSessionFiles(home) {
  const root = path.join(home, 'sessions');
  if (!fs.existsSync(root)) return [];
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.jsonl(\.zstd)?$/.test(e.name)) {
        // derive session id from parent dir name session-<uuid>
        const dir = path.basename(path.dirname(p));
        const m = dir.match(/session-([a-f0-9-]+)/i);
        out.push({ file: p, id: m ? m[1] : path.basename(p) });
      }
    }
  })(root);
  return out;
}

function summarize(file) {
  let events;
  try { events = readEvents(file); } catch { return null; }
  const header = events.find((e) => e && e.type === 'session');
  if (!header) return null;
  const titleEv = events.find((e) => e?.type === 'session/title');
  let model = '';
  let input = 0, output = 0;
  for (const e of events) {
    if (e.type === 'request/header') model = e.data?.header?.config?.model || model;
    const u = findUsage(e);
    if (u) { input += u.inputTokens || 0; output += u.outputTokens || 0; }
  }
  const turns = events.filter((e) => e?.type === 'turn/start').length;
  return {
    id: header.id || '',
    cwd: header.cwd || '',
    createdAt: header.createdAt || null,
    title: (titleEv && (titleEv.data?.title || titleEv.data?.text)) || '',
    turns,
    model,
    inputTokens: input,
    outputTokens: output,
    preview: previewText(events).slice(0, 120),
    events: events.length,
  };
}

export async function listSessions(opts = {}) {
  const home = resolveDSHHome(opts.home);
  const items = listSessionFiles(home)
    .map((s) => summarize(s.file))
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { home, count: items.length, items: items.map(({ preview, ...rest }) => rest) };
}

export async function showSession(opts = {}, id = '') {
  const home = resolveDSHHome(opts.home);
  const found = listSessionFiles(home).filter((s) => s.id === id);
  if (!found.length) return { error: 'session not found', id };
  const events = readEvents(found[0].file);
  return { id, events };
}

export async function exportSession(opts = {}, id = '') {
  const home = resolveDSHHome(opts.home);
  const found = listSessionFiles(home).filter((s) => s.id === id);
  if (!found.length) return { error: 'session not found', id };
  const events = readEvents(found[0].file);
  const lines = [];
  for (const e of events) {
    const t = e?.type || 'unknown';
    if (t === 'user/message' || t === 'agent/inbox/spliced') {
      const s = e.type === 'agent/inbox/spliced' ? e.data?.inserted : e.data;
      const msgs = Array.isArray(s) ? s : (s && Array.isArray(s.content) ? [{ content: s.content }] : []);
      for (const m of msgs) {
        const txt = (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        if (txt) lines.push(`\n[user] ${txt}`);
      }
    } else if (t === 'assistant/message' || t === 'assistant/chunk') {
      const txt = (e.data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (txt && !(t === 'assistant/chunk' && lines.some((l) => l.startsWith('\n[assistant]')) && ['assistant/message'].includes(''))) lines.push(`[assistant] ${txt}`);
      if (t === 'assistant/message') lines.push(`[assistant] ${txt}`);
    } else if (t === 'turn/start') lines.push(`\n--- turn ${e.data?.turn} ---`);
  }
  return { id, text: lines.join('\n') };
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
