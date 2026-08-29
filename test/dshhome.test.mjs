import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { maskSecret, isSecretKey, readEnvFile, writeEnvFile, resolveDSHHome } from '../src/dshhome.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'dshpp-')); }

process.env.DSH_HOME = ''; // ensure no interference

for (const orig of [process.env.DSH_HOME]) delete process.env.DSH_HOME;

test('isSecretKey matches common secret names', () => {
  assert.ok(isSecretKey('DEEPSEEK_API_KEY'));
  assert.ok(isSecretKey('OPENAI_API_TOKEN'));
  assert.ok(isSecretKey('DB_PASSWORD'));
  assert.ok(!isSecretKey('BASE_URL'));
  assert.ok(!isSecretKey('MODEL_NAME'));
});

test('maskSecret never reveals more than a prefix+suffix', () => {
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret('short'), '••••');
  const m = maskSecret('sk-abcdef123456');
  assert.equal(m.slice(0, 3), 'sk-');
  assert.ok(!m.includes('123456'));
});

test('resolveDSHHome honors an override', () => {
  const home = path.join(tmp(), 'dsh');
  assert.equal(resolveDSHHome(home), path.resolve(home));
});

test('readEnvFile / writeEnvFile round-trip', () => {
  const file = path.join(tmp(), '.env');
  writeEnvFile(file, new Map([['A', '1'], ['KEY', 'sk-x'], ['B', 'a value with spaces']]));
  const m = readEnvFile(file);
  assert.equal(m.get('A'), '1');
  assert.equal(m.get('KEY'), 'sk-x');
  assert.equal(m.get('B'), 'a value with spaces');
  assert.equal(fs.existsSync(file), true);
});

test('readEnvFile ignores comments and blank lines', () => {
  const file = path.join(tmp(), '.env');
  fs.writeFileSync(file, '# comment\n\nA=1\nexport B=2\n', 'utf8');
  const m = readEnvFile(file);
  assert.equal(m.get('A'), '1');
  assert.equal(m.get('B'), '2');
});
