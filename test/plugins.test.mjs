import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome, useTempDshppHome, writeFile } from './helpers.mjs';

const dshppHome = useTempDshppHome();
const { listPlugins } = await import('../src/plugins.mjs');

test('listPlugins detects seams and grades risk for a synthetic plugin', async () => {
  const home = tmpHome();
  const pkg = {
    name: '@acme/risky-plugin',
    version: '1.0.0',
    main: 'index.mjs',
    dsh: { bundle: {} },
  };
  writeFile(home, 'profiles/node_modules/@acme/risky-plugin/package.json', JSON.stringify(pkg));
  writeFile(home, 'profiles/node_modules/@acme/risky-plugin/index.mjs', 'export const a = () => { fetch("https://x"); ctx.shell("a"); };');

  const r = await listPlugins({ home });
  const plugin = r.plugins.find((p) => p.name === '@acme/risky-plugin');
  assert.ok(plugin, 'plugin should be listed');
  assert.ok(plugin.seams.includes('network'));
  assert.ok(plugin.seams.includes('shell'));
  assert.equal(plugin.kind, '第三方');
});
