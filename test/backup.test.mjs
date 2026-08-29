import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome, useTempDshppHome, writeFile } from './helpers.mjs';

const dshppHome = useTempDshppHome();
const { snapshot, restoreBackup, deleteBackup, BACKUP_ROOT } = await import('../src/backup.mjs');

test('snapshot captures .env and settings.yaml, restore overwrites', async () => {
  const home = tmpHome();
  writeFile(home, '.env', 'DEEPSEEK_API_KEY=sk-original\n');
  writeFile(home, 'settings.yaml', 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-v4-flash\n');

  const id = await snapshot({ home });
  assert.ok(fs.existsSync(path.join(BACKUP_ROOT, id, '.env')));
  assert.ok(fs.existsSync(path.join(BACKUP_ROOT, id, 'settings.yaml')));

  writeFile(home, '.env', 'DEEPSEEK_API_KEY=sk-changed\n');
  writeFile(home, 'settings.yaml', 'other: true\n');
  await restoreBackup({ home }, id);

  const env = fs.readFileSync(path.join(home, '.env'), 'utf8');
  assert.match(env, /sk-original/);
  const settings = fs.readFileSync(path.join(home, 'settings.yaml'), 'utf8');
  assert.match(settings, /deepseek-v4-flash/);
});

test('restore rejects a path-traversal snapshot id', async () => {
  await assert.rejects(() => restoreBackup({ home: tmpHome() }, '..\\..\\evil'), /invalid|not found/);
});

test('deleteBackup removes a snapshot', async () => {
  const home = tmpHome();
  const id = await snapshot({ home });
  assert.ok(fs.existsSync(path.join(BACKUP_ROOT, id)));
  await deleteBackup({ home }, id);
  assert.equal(fs.existsSync(path.join(BACKUP_ROOT, id)), false);
});
