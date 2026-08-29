import { resolveDSHHome } from './dshhome.mjs';
import { listSessionPaths, readSessionEvents, findUsage } from './dshadapter.mjs';

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

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  return '';
}

function summarize(file) {
  let events;
  try { events = readSessionEvents(file); } catch { return null; }
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
  const items = listSessionPaths(home)
    .map((s) => summarize(s.file))
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { home, count: items.length, items: items.map(({ preview, ...rest }) => rest) };
}

export async function showSession(opts = {}, id = '') {
  const home = resolveDSHHome(opts.home);
  const found = listSessionPaths(home).filter((s) => s.id === id);
  if (!found.length) return { error: 'session not found', id };
  return { id, events: readSessionEvents(found[0].file) };
}

export async function exportSession(opts = {}, id = '') {
  const home = resolveDSHHome(opts.home);
  const found = listSessionPaths(home).filter((s) => s.id === id);
  if (!found.length) return { error: 'session not found', id };
  const events = readSessionEvents(found[0].file);
  const lines = [];
  const chunks = [];
  const flushChunks = () => {
    const t = chunks.join('');
    if (t.trim()) lines.push(`[assistant] ${t.trim()}`);
    chunks.length = 0;
  };
  for (const e of events) {
    const t = e?.type || 'unknown';
    if (t === 'user/message' || t === 'agent/inbox/spliced') {
      flushChunks();
      const s = e.type === 'agent/inbox/spliced' ? e.data?.inserted : e.data;
      const msgs = Array.isArray(s) ? s : (s && Array.isArray(s.content) ? [{ content: s.content }] : []);
      for (const m of msgs) {
        const txt = textOf(m.content);
        if (txt) lines.push(`\n[user] ${txt}`);
      }
    } else if (t === 'assistant/chunk') {
      chunks.push(textOf(e.data?.content));
    } else if (t === 'assistant/message') {
      flushChunks();
      const txt = textOf(e.data?.content);
      if (txt) lines.push(`[assistant] ${txt}`);
    } else if (t === 'turn/start') {
      flushChunks();
      lines.push(`\n--- turn ${e.data?.turn} ---`);
    }
  }
  flushChunks();
  return { id, text: lines.join('\n') };
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}