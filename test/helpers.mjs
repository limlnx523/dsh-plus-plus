import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

/** Create a throwaway directory (used as DSH_HOME or DSHPP_HOME). */
export function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshpp-test-'));
}

/** Point DSHPP_HOME at a fresh temp dir and return it. Call before importing modules that read it. */
export function useTempDshppHome() {
  const dir = tmpHome();
  process.env.DSHPP_HOME = dir;
  return dir;
}

/** Write a file under `home`, creating parent dirs as needed. */
export function writeFile(home, rel, content) {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}
