import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, diffCases } from '../src/regression.mjs';

test('regression cases are well-formed and cover harness capabilities', () => {
  assert.ok(CASES.length >= 1);
  for (const c of CASES) {
    assert.ok(c.id, 'case has an id');
    assert.ok(c.prompt, `case ${c.id} has a prompt`);
    assert.equal(typeof c.check, 'function', `case ${c.id} has a check`);
  }
  const ids = CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'case ids are unique');
});

test('a case that used to pass and now fails is flagged as regressed', () => {
  const prev = [{ id: 'math', ok: true, latencyMs: 100, cost: 0.01 }];
  const curr = [{ id: 'math', ok: false, latencyMs: 120, cost: 0.012 }];
  const diff = diffCases(prev, curr);
  assert.equal(diff[0].change, 'regressed');
});

test('a case that used to fail and now passes is flagged as fixed', () => {
  const prev = [{ id: 'edit', ok: false, latencyMs: 200, cost: 0.02 }];
  const curr = [{ id: 'edit', ok: true, latencyMs: 180, cost: 0.018 }];
  const diff = diffCases(prev, curr);
  assert.equal(diff[0].change, 'fixed');
});

test('new and unchanged cases are reported distinctly', () => {
  const prev = [{ id: 'a', ok: true, latencyMs: 100, cost: 0.01 }];
  const curr = [
    { id: 'a', ok: true, latencyMs: 110, cost: 0.011 },
    { id: 'b', ok: true, latencyMs: 50, cost: 0.005 },
  ];
  const diff = diffCases(prev, curr);
  assert.equal(diff.find((d) => d.id === 'a').change, 'same');
  assert.equal(diff.find((d) => d.id === 'b').change, 'new');
});

test('diffCases returns null when there is no baseline', () => {
  assert.equal(diffCases(null, [{ id: 'a', ok: true }]), null);
});
