const $ = (id) => document.getElementById(id);
const state = { status: null, env: null, backups: null, providers: null, probedModels: null, selectedModels: null };

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function txt(s) {
  const n = document.createElement('span');
  n.textContent = String(s ?? '');
  return n;
}

async function loadAll() {
  const [status, env, backups, providers, usage, sessions, plugins] = await Promise.all([
    api('/api/status'),
    api('/api/env'),
    api('/api/backups'),
    api('/api/providers'),
    api('/api/usage'),
    api('/api/sessions'),
    api('/api/plugins'),
  ]);
  state.status = status;
  state.env = env;
  state.backups = backups.items;
  state.providers = providers;
  state.usage = usage;
  state.sessions = sessions;
  state.plugins = plugins;
  render();
}

function render() {
  renderChip();
  renderStats();
  renderEnv();
  renderBackups();
  renderChecks();
  renderProviders();
  renderUsage();
  renderSessions();
  renderPlugins();
}

function renderChip() {
  const home = state.status?.home || '…';
  $('chip-home').textContent = home;
  $('chip-home').title = home;
}

function statCell(label, value, cls, sub) {
  const c = document.createElement('div');
  c.className = 'cell';
  const l = document.createElement('div');
  l.className = 'cell__label';
  l.textContent = label;
  const v = document.createElement('div');
  v.className = 'cell__value' + (cls ? ' ' + cls : '');
  v.textContent = value;
  c.append(l, v);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'cell__sub';
    s.textContent = sub;
    c.append(s);
  }
  return c;
}

function renderStats() {
  const box = $('stats');
  box.replaceChildren();
  const st = state.status;
  if (!st) return;
  box.append(
    statCell('DSH home', st.dshBinary ? 'READY' : 'SETUP', st.dshBinary ? 'ok' : 'warn', st.dshBinary ? st.dshBinary : '(harness not installed)'),
    statCell('.env 凭据', String(st.envCount), st.envCount > 0 ? 'ok' : 'warn', st.secretCount + ' secret(s) masked'),
    statCell('settings', st.settingsFile ? 'OK' : '—', st.settingsFile ? 'ok' : 'warn', st.settingsFile ? 'present' : 'first-run'),
    statCell('快照', String(st.backups.length), st.backups.length ? 'ok' : '', st.backups.length + ' snapshot(s)'),
  );
}

function renderEnv() {
  const box = $('cred-table');
  box.replaceChildren();
  const env = state.env;
  if (!env) return;
  if (!env.items || !env.items.length) {
    box.append(emptyRow('尚无凭据'));
    return;
  }
  for (const it of env.items) {
    const row = document.createElement('div');
    row.className = 'trow';
    const flex = document.createElement('div');
    flex.className = 'flex';
    flex.append(txt(it.key));
    const badge = document.createElement('span');
    badge.className = 'badge ' + (it.secret ? 'badge--secret' : 'badge--ok');
    badge.textContent = it.secret ? 'secret' : 'plain';
    flex.append(badge);
    const v = txt(it.secret ? it.value : (it.value === '' ? '(empty)' : it.value));
    if (it.secret) v.className = 'v';
    else v.className = 'v';
    row.append(flex, v);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const del = iconBtn('del', '移除');
    del.addEventListener('click', () => removeKey(it.key));
    actions.append(del);
    row.append(actions);
    box.append(row);
  }
}

function renderBackups() {
  const box = $('backup-table');
  box.replaceChildren();
  const list = state.backups || [];
  if (!list.length) {
    box.append(emptyRow('尚无快照'));
    return;
  }
  for (const id of list) {
    const row = document.createElement('div');
    row.className = 'trow';
    const flex = document.createElement('div');
    flex.className = 'flex';
    const d = txt(id);
    d.className = 'datetime';
    flex.append(d);
    row.append(flex);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const r = textBtn('还原');
    r.className = 'btn btn--ghost btn--sm';
    r.addEventListener('click', () => restoreBackup(id));
    const del = iconBtn('del', '删除');
    del.addEventListener('click', () => deleteBackup(id));
    actions.append(r, del);
    row.append(actions);
    box.append(row);
  }
}

function renderChecks() {
  const box = $('checks');
  box.replaceChildren();
  const st = state.status;
  if (!st) return;
  const checks = buildChecks(st);
  box.replaceChildren(...checks.map((c) => checkRow(c.name, c.status, c.detail)));
}

function buildChecks(st) {
  return [
    { name: 'Node.js', status: 'pass', detail: 'runtime ok' },
    { name: 'DSH home', status: 'pass', detail: st.home },
    { name: 'dsh CLI', status: st.dshBinary ? 'pass' : 'warn', detail: st.dshBinary || 'not installed' },
    { name: '.env', status: st.envExists ? 'pass' : 'warn', detail: st.envExists ? st.envCount + ' key(s)' : 'not found' },
    { name: 'secret 脱敏', status: st.secretCount > 0 ? 'pass' : 'warn', detail: st.secretCount + ' secret(s) masked' },
    { name: 'settings.yaml', status: st.settingsFile ? 'pass' : 'warn', detail: st.settingsFile ? 'present' : 'first-run' },
    { name: '快照', status: st.backups.length ? 'pass' : 'warn', detail: st.backups.length + ' snapshot(s)' },
  ];
}

function checkRow(name, status, detail) {
  const c = document.createElement('div');
  c.className = 'ck';
  const dot = document.createElement('span');
  dot.className = 'ck__dot ' + status;
  const n = txt(name);
  n.className = 'ck__name';
  const d = txt(detail);
  d.className = 'ck__detail';
  c.append(dot, n, d);
  return c;
}

function emptyRow(msg) {
  const d = document.createElement('div');
  d.className = 'table__empty';
  d.textContent = msg;
  return d;
}

function iconBtn(kind, title) {
  const b = document.createElement('button');
  b.className = 'iconbtn';
  b.title = title;
  b.innerHTML = kind === 'del'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>'
    : '';
  return b;
}

function textBtn(t) {
  const b = document.createElement('button');
  b.className = 'btn btn--ghost btn--sm';
  b.textContent = t;
  return b;
}

async function addCredential(e) {
  e.preventDefault();
  const key = $('cred-key').value.trim();
  const value = $('cred-val').value;
  if (!key) return;
  await api('/api/env/set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) });
  $('cred-key').value = '';
  $('cred-val').value = '';
  await loadAll();
}

async function removeKey(key) {
  await api('/api/env/rm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
  await loadAll();
}

async function createBackup() {
  await api('/api/backup/create', { method: 'POST' });
  await loadAll();
}

async function restoreBackup(id) {
  if (!confirm('还原快照 ' + id + ' 会先自动建立当前状态的快照，然后覆盖 .env / settings.yaml。继续？')) return;
  await api('/api/backup/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  await loadAll();
}

async function deleteBackup(id) {
  if (!confirm('删除快照 ' + id + '？')) return;
  await api('/api/backup/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  await loadAll();
}

$('cred-form').addEventListener('submit', addCredential);
$('btn-backup').addEventListener('click', createBackup);
$('btn-refresh').addEventListener('click', loadAll);
$('btn-doctor').addEventListener('click', loadAll);

/* providers */
function renderProviders() {
  const box = $('provider-list');
  box.replaceChildren();
  const data = state.providers;
  if (!data || !data.providers || !data.providers.length) { box.append(emptyRow('暂无 provider')); return; }
  const def = data.default || null;
  for (const p of data.providers) {
    const row = document.createElement('div');
    row.className = 'trow';
    const main = document.createElement('div');
    main.className = 'flex provider-main';
    const nm = txt(p.name || p.id); nm.className = 'provider-name'; main.append(nm);
    if (def && def.provider === p.id) { const tag = document.createElement('span'); tag.className = 'default-tag'; tag.textContent = 'default'; main.append(tag); }
    const url = txt(p.baseURL || '(no url)'); url.className = 'provider-url'; main.append(url);
    const keyb = document.createElement('span'); keyb.className = 'badge ' + (p.apiKeySet ? 'badge--ok' : 'badge--secret'); keyb.textContent = (p.apiKeyRef || 'no-key'); main.append(keyb);
    row.append(main);
    const metas = txt(p.models.length + ' model(s)'); metas.className = 'bkfile'; row.append(metas);
    const actions = document.createElement('div'); actions.className = 'actions';
    if (!(def && def.provider === p.id)) { const set = textBtn('设为默认'); set.className = 'btn btn--ghost btn--sm'; set.addEventListener('click', () => setDefaultProvider(p.id, p.models[0] || '')); actions.append(set); }
    const del = iconBtn('del', '移除'); del.addEventListener('click', () => removeProvider(p.id)); actions.append(del);
    row.append(actions); box.append(row);
  }
}

function probeMsg(msg, kind) {
  const box = $('provider-probe'); box.className = 'probe ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : ''); box.textContent = msg; box.replaceChildren();
}

async function saveProvider() {
  const id = $('p-id').value.trim();
  if (!id) { probeMsg('需要 provider id', 'err'); return; }
  const body = { id, name: $('p-name').value.trim() || id, baseURL: $('p-url').value.trim(), apiKeyRef: $('p-keyref').value.trim(), models: state.selectedModels && state.selectedModels.size ? [...state.selectedModels] : (state.probedModels || []) };
  await api('/api/providers/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  $('p-id').value = $('p-name').value = $('p-url').value = $('p-keyref').value = ''; probeMsg('');
  await loadAll();
}

async function probeProvider() {
  const baseURL = $('p-url').value.trim();
  const apiKeyRef = $('p-keyref').value.trim();
  if (!baseURL) { probeMsg('需要 base_url', 'err'); return; }
  probeMsg('正在探测 ' + baseURL + ' …');
  try {
    const r = await api('/api/providers/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseURL, apiKeyRef }) });
    state.probedModels = r.models || []; state.selectedModels = new Set(state.probedModels);
    const box = $('provider-probe'); box.className = 'probe ok'; box.textContent = '发现 ' + state.probedModels.length + ' 个模型（点击可多选）：'; box.replaceChildren();
    const w = document.createElement('div'); w.className = 'models';
    for (const m of state.probedModels) { const chip = document.createElement('span'); chip.className = 'mchip selected'; chip.textContent = m; chip.addEventListener('click', () => { if (state.selectedModels.has(m)) { state.selectedModels.delete(m); chip.classList.remove('selected'); } else { state.selectedModels.add(m); chip.classList.add('selected'); } }); w.append(chip); }
    box.append(w);
  } catch (e) { probeMsg(e.message || String(e), 'err'); }
}

async function setDefaultProvider(provider, model) {
  await api('/api/providers/default', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, model }) }); await loadAll();
}
async function removeProvider(id) {
  if (!confirm('移除 provider ' + id + '？')) return;
  await api('/api/providers/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); await loadAll();
}
async function exportConfig() {
  const r = await api('/api/providers/export'); const pre = $('provider-export'); pre.textContent = r.text || ''; pre.classList.toggle('hidden');
}

function fmtTok(n) { n = n || 0; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'; return String(n); }
function fmtCost(n) { return '$' + (n || 0).toFixed(3); }
function fmtPct(n) { return (n || 0).toFixed(1) + '%'; }
function renderUsage() {
  const u = state.usage; if (!u) return;
  const note = $('usage-note'); if (note) note.textContent = u.note || '';
  const sum = $('usage-summary'); sum.replaceChildren();
  const t = u.totals || {};
  const cells = [ ['调用', String(u.calls || 0)], ['会话', String(u.sessions || 0)], ['输入', fmtTok(t.inputTokens)], ['输出', fmtTok(t.outputTokens)], ['缓存读', fmtTok(t.cacheReadTokens)], ['缓存命中', fmtPct(t.cacheHitRate)], ['估算成本', u.prices ? fmtCost(t.cost) : '—'] ];
  for (const [k, v] of cells) { const c = document.createElement('div'); c.className = 'cell'; const l = document.createElement('div'); l.className = 'cell__label'; l.textContent = k; const val = document.createElement('div'); val.className = 'cell__value' + (k === '估算成本' ? ' ok' : ''); val.textContent = v; c.append(l, val); sum.append(c); }
  renderBudgetBar(u);
  renderByDayTrend(u);
  const box = $('usage-table'); box.replaceChildren();
  const rows = u.byModel || [];
  if (!rows.length) { box.append(emptyRow('暂无用量')); return; }
  for (const m of rows) {
    const row = document.createElement('div'); row.className = 'trow';
    const main = document.createElement('div'); main.className = 'flex provider-main';
    const nm = txt(m.model || '?'); nm.className = 'provider-name'; main.append(nm);
    const prov = txt(m.provider || ''); prov.className = 'provider-url'; main.append(prov);
    row.append(main);
    const meta = txt(m.calls + ' call · in ' + fmtTok(m.inputTokens) + ' / out ' + fmtTok(m.outputTokens) + ' / cache ' + fmtTok(m.cacheReadTokens) + ' (' + fmtPct(m.cacheHitRate) + ')'); meta.className = 'bkfile'; row.append(meta);
    const cost = txt(u.prices ? fmtCost(m.cost) : '—'); cost.className = 'v'; row.append(cost);
    box.append(row);
  }
  const group = (label, items, fmt) => {
    if (!items || !items.length) return;
    const h = document.createElement('div'); h.className = 'usage-group-label'; h.textContent = label; box.append(h);
    for (const it of items.slice(0, 8)) { const row = document.createElement('div'); row.className = 'trow'; const main = document.createElement('div'); main.className = 'flex provider-main'; const nm = txt(fmt.n(it)); nm.className = 'provider-url'; main.append(nm); row.append(main); const v = txt(fmt.v(it)); v.className = 'bkfile'; row.append(v); const c = txt(u.prices ? fmtCost(it.cost) : '—'); c.className = 'v'; row.append(c); box.append(row); }
  };
  group('按项目', u.byProject || [], { n: (p) => p.cwd, v: (p) => p.calls + ' · in ' + fmtTok(p.inputTokens) + ' / out ' + fmtTok(p.outputTokens) + ' · ' + (p.models || []).join(', ') });
  group('按天', u.byDay || [], { n: (d) => d.day, v: (d) => d.calls + ' · in ' + fmtTok(d.inputTokens) + ' / out ' + fmtTok(d.outputTokens) });
}

function renderBudgetBar(u) {
  const el = $('budget-bar'); if (!el) return;
  const b = u && u.budget;
  if (!b) { el.classList.add('hidden'); el.replaceChildren(); return; }
  el.classList.remove('hidden'); el.replaceChildren();
  const pct = Math.min(100, b.pct || 0);
  const wrap = document.createElement('div'); wrap.className = 'budget-inner';
  const label = document.createElement('div'); label.className = 'budget-label';
  label.textContent = '月预算 ' + (b.over ? '已超' : '') + ' · $' + b.monthly.toFixed(2) + ' · 已用 $' + b.spent.toFixed(2) + ' · 剩 $' + Math.max(0, b.remaining).toFixed(2);
  const track = document.createElement('div'); track.className = 'budget-track';
  const fill = document.createElement('div'); fill.className = 'budget-fill' + (b.over ? ' over' : ''); fill.style.width = pct + '%';
  track.append(fill); wrap.append(label, track); el.append(wrap);
}

function renderByDayTrend(u) {
  const rows = (u && u.byDay) || [];
  if (rows.length < 2) return;
  const box = $('usage-table');
  const w = 640, h = 56;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('class', 'usage-trend');
  const costs = rows.map((r) => r.cost || 0);
  const max = Math.max(...costs, 1e-9);
  const pts = rows.map((r, i) => { const x = rows.length > 1 ? (i / (rows.length - 1)) * w : 0; const y = h - ((r.cost || 0) / max) * (h - 10) - 5; return x + ',' + y; });
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  area.setAttribute('points', '0,' + h + ' ' + pts.join(' ') + ' ' + w + ',' + h);
  area.setAttribute('class', 'trend-area');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('class', 'trend-line');
  svg.append(area, line);
  const head = document.createElement('div'); head.className = 'usage-group-label'; head.textContent = '成本趋势（按天）'; box.append(head, svg);
}

let autoTimer = null;
async function toggleAuto() {
  const b = $('btn-autorefresh');
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; b.classList.remove('is-active'); b.textContent = '自动'; return; }
  autoTimer = setInterval(() => loadAll().catch(() => {}), 30000);
  b.classList.add('is-active'); b.textContent = '刷新中';
}
async function setBudgetPrompt() {
  const cur = state.usage && state.usage.budget ? state.usage.budget.monthly : null;
  const v = prompt('每月预算（USD）\n留空清除', cur ? String(cur) : '20');
  if (v === null) return;
  const monthly = v.trim() === '' ? 0 : Number(v);
  await api('/api/budget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ monthly: monthly || 0 }) }).catch(() => {});
  await loadAll();
}

function renderSessions() {
  const box = $('sessions-list'); box.replaceChildren();
  const data = state.sessions;
  if (!data || !data.items || !data.items.length) { box.append(emptyRow('暂无会话')); return; }
  for (const s of data.items) {
    const row = document.createElement('div'); row.className = 'trow';
    const main = document.createElement('div'); main.className = 'provider-main';
    const t = txt(s.title || (s.id || '').slice(0, 14) + '…'); t.className = 'provider-name'; main.append(t);
    const meta = txt((s.cwd || '').replace(/\\/g, '/').slice(-28) + ' · ' + new Date(s.createdAt || 0).toISOString().slice(0, 10) + ' · ' + s.turns + ' turn · ' + (s.model || '') + ' · in ' + fmtTok(s.inputTokens)); meta.className = 'provider-url'; main.append(meta);
    row.append(main);
    const actions = document.createElement('div'); actions.className = 'actions';
    const exp = textBtn('导出'); exp.className = 'btn btn--ghost btn--sm'; exp.addEventListener('click', () => exportSession(s.id)); actions.append(exp);
    row.append(actions); box.append(row);
  }
}

async function exportSession(id) {
  const r = await api('/api/sessions/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  if (r.error) { alert(r.error); return; }
  const text = r.text || '';
  try { await navigator.clipboard.writeText(text); alert('会话已复制到剪贴板'); } catch { const w = window.open('about:blank'); if (w) { w.document.body.textContent = text; } }
}

function renderPlugins() {
  const box = $('plugins-list'); box.replaceChildren();
  const data = state.plugins;
  const note = $('plugins-note'); if (note) note.textContent = data ? (data.count + ' 个 · dsh ' + data.dshVersion) : '—';
  if (!data || !data.plugins || !data.plugins.length) { box.append(emptyRow('暂无插件')); return; }
  const list = data.plugins.slice(0, 60);
  for (const p of list) {
    const row = document.createElement('div'); row.className = 'trow';
    const main = document.createElement('div'); main.className = 'flex provider-main';
    const nm = txt(p.name); nm.className = 'provider-name'; main.append(nm);
    const ver = txt('@' + p.version); ver.className = 'provider-url'; main.append(ver);
    row.append(main);
    const meta = txt(p.kind + ' · risk ' + p.risk + ' · ' + (p.seams && p.seams.length ? p.seams.join(',') : '无外部 seam')); meta.className = 'bkfile'; row.append(meta);
    box.append(row);
  }
  if (list.length < data.plugins.length) box.append(emptyRow((data.plugins.length - list.length) + ' 更多 · 只显示前 60'));
}

$('btn-provider-save').addEventListener('click', saveProvider);
$('btn-provider-probe').addEventListener('click', probeProvider);
$('btn-provider-export').addEventListener('click', exportConfig);
$('btn-budget').addEventListener('click', setBudgetPrompt);
$('btn-autorefresh').addEventListener('click', toggleAuto);
async function runEval() {
  const box = $('eval-result'); box.replaceChildren();
  box.append(emptyRow('正在跑评估（每次约 8–12s，共 flash+pro 两次真实调用）…'));
  try {
    const r = await api('/api/eval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ models: ['deepseek-v4-flash', 'deepseek-v4-pro'] }) });
    box.replaceChildren();
    const head = document.createElement('div'); head.className = 'usage-group-label'; head.textContent = '结果'; box.append(head);
    for (const res of r.results) {
      const row = document.createElement('div'); row.className = 'trow';
      const main = document.createElement('div'); main.className = 'provider-main';
      const nm = txt(res.model || ''); nm.className = 'provider-name'; main.append(nm);
      const st = txt(res.ok ? 'PASS' : 'FAIL' + (res.timeout ? ' · timeout' : '')); st.className = 'provider-url'; main.append(st);
      row.append(main);
      const meta = txt(res.latencyMs + 'ms · in ' + fmtTok(res.tokensIn) + ' / out ' + fmtTok(res.tokensOut) + ' · $' + res.cost.toFixed(5)); meta.className = 'bkfile'; row.append(meta);
      box.append(row);
      const ans = txt('ans: ' + (res.answer || '')); ans.className = 'provider-url'; box.append(ans);
    }
    if (r.diff) {
      const h2 = document.createElement('div'); h2.className = 'usage-group-label'; h2.textContent = 'vs 基线'; box.append(h2);
      for (const d of r.diff) {
        const row = document.createElement('div'); row.className = 'trow';
        const nm = txt(d.model || ''); nm.className = 'provider-name'; row.append(nm);
        const dv = txt(d.change === 'new' ? '新加入' : (d.okChange + ' · 延迟 ' + (d.latencyDeltaMs > 0 ? '+' : '') + d.latencyDeltaMs + 'ms')); dv.className = 'bkfile'; row.append(dv);
        box.append(row);
      }
    }
  } catch (e) { box.replaceChildren(emptyRow('评估失败: ' + e.message)); }
  await loadAll();
}

$('btn-sessions-refresh').addEventListener('click', loadAll);
$('btn-eval').addEventListener('click', runEval);

render();
loadAll().catch((err) => {
  console.error(err);
  const box = $('stats');
  box.replaceChildren();
  box.append(statCell('连接失败', 'err', 'bad', err.message));
});
