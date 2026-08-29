import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome, writeFile } from './helpers.mjs';
import { collectUsage } from '../src/usage.mjs';

function makeSession(home, proj, id, events) {
  return writeFile(home, `sessions/${proj}/session-${id}/session.jsonl`, events.map((e) => JSON.stringify(e)).join('\n'));
}

test('collectUsage aggregates tokens and cost', async () => {
  const home = tmpHome();
  makeSession(home, 'projA', 'aaa', [
    { type: 'session', id: 's1', cwd: '/work/projA', createdAt: '2026-08-28T00:00:00.000Z' },
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } } },
    { type: 'usage', data: { usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 } } },
  ]);
  const r = await collectUsage({ home });
  assert.equal(r.sessions, 1);
  assert.equal(r.calls, 1);
  assert.equal(r.totals.inputTokens, 1000);
  assert.equal(r.totals.outputTokens, 100);
  assert.equal(r.totals.cacheReadTokens, 500);
  assert.equal(r.byModel.length, 1);
  assert.equal(r.byModel[0].model, 'deepseek-v4-flash');
  assert.ok(r.totals.cost > 0);
});

test('collectUsage does not crash on an unknown model price', async () => {
  const home = tmpHome();
  makeSession(home, 'projB', 'bbb', [
    { type: 'session', id: 's2', cwd: '/work/projB', createdAt: '2026-08-28T00:00:00.000Z' },
    { type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'custom-model-not-in-price-table' } } } },
    { type: 'usage', data: { usage: { inputTokens: 10, outputTokens: 5 } } },
  ]);
  const r = await collectUsage({ home }); // must not throw
  assert.equal(r.calls, 1);
  assert.equal(r.byModel[0].model, 'custom-model-not-in-price-table');
});
