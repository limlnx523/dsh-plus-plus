import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome, writeFile } from './helpers.mjs';
import { parseSettingsTop, parseDefaultModel, readSessionEvents, listSessionPaths, findUsage } from '../src/dshadapter.mjs';

test('parseSettingsTop keeps only top-level keys', () => {
  const top = parseSettingsTop('agent-default-model:\n  provider: x\nui-onboarding:\n  welcomeNoticeVersion: 1\n');
  assert.equal(top['agent-default-model'], true);
  assert.equal(top['ui-onboarding'], true);
  assert.equal(Object.keys(top).length, 2);
});

test('parseDefaultModel reads provider and model', () => {
  const d = parseDefaultModel('agent-default-model:\n  provider: deepseek-official\n  model: deepseek-v4-flash\n');
  assert.equal(d.provider, 'deepseek-official');
  assert.equal(d.model, 'deepseek-v4-flash');
});

test('findUsage finds a nested usage object', () => {
  const u = findUsage({ data: { usage: { inputTokens: 1, outputTokens: 2 } } });
  assert.equal(u.inputTokens, 1);
});

test('readSessionEvents parses plain JSONL', () => {
  const home = tmpHome();
  const file = writeFile(home, 'sessions/p/session-x/session.jsonl', '{"type":"session","id":"x"}\n{"type":"foo"}\nnot json\n');
  const events = readSessionEvents(file);
  assert.equal(events.length, 2);
  assert.equal(events[0].id, 'x');
});

test('listSessionPaths derives session ids', () => {
  const home = tmpHome();
  writeFile(home, 'sessions/p/session-abc123/session.jsonl', '{"type":"session","id":"abc123"}');
  const found = listSessionPaths(home);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'abc123');
});
