import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome } from './helpers.mjs';
import { readEnvFile } from '../src/dshhome.mjs';
import { envSet, envRemove } from '../src/env.mjs';

test('envSet and envRemove write and remove keys', async () => {
  const home = tmpHome();
  const opts = { home };
  const file = path.join(home, '.env');

  await envSet(opts, 'DEEPSEEK_API_KEY=sk-test-value');
  let m = readEnvFile(file);
  assert.equal(m.get('DEEPSEEK_API_KEY'), 'sk-test-value');

  // updating an existing key preserves unrelated lines
  await envSet(opts, 'BASE_URL=https://api.example.com');
  await envSet(opts, 'DEEPSEEK_API_KEY=sk-new-value');
  m = readEnvFile(file);
  assert.equal(m.get('DEEPSEEK_API_KEY'), 'sk-new-value');
  assert.equal(m.get('BASE_URL'), 'https://api.example.com');

  await envRemove(opts, 'BASE_URL');
  m = readEnvFile(file);
  assert.equal(m.has('BASE_URL'), false);
  assert.equal(m.get('DEEPSEEK_API_KEY'), 'sk-new-value');
});

test('envSet rejects a malformed pair', async () => {
  const home = tmpHome();
  await assert.rejects(() => envSet({ home }, 'NOEQUALS'), /expected KEY=VALUE/);
});
