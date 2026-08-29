import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome, useTempDshppHome } from './helpers.mjs';

const dshppHome = useTempDshppHome();
const { listProviders, saveProvider, PROVIDERS_FILE } = await import('../src/providers.mjs');

test('listProviders defaults to an empty manifest', () => {
  const r = listProviders({ home: tmpHome() });
  assert.equal(r.providers.length, 0);
  assert.equal(r.default, null);
});

test('saveProvider validates id and persists an entry', () => {
  const home = tmpHome();
  const e = saveProvider({ home }, { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', apiKeyRef: 'DEEPSEEK_API_KEY', models: ['deepseek-v4-flash'] });
  assert.equal(e.id, 'deepseek');
  const r = listProviders({ home });
  assert.equal(r.providers.length, 1);
  assert.equal(r.providers[0].name, 'DeepSeek');
});

test('saveProvider rejects an invalid id', () => {
  assert.throws(() => saveProvider({ home: tmpHome() }, { id: 'bad id!' }), /provider id/);
});
