import fs from 'node:fs';
import path from 'node:path';
import { DSHPP_HOME, ensureDir } from './dshhome.mjs';

const CONFIG_FILE = path.join(DSHPP_HOME, 'config.json');

export function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { budget: null };
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { budget: null };
  }
}

export function writeConfig(c) {
  ensureDir(path.dirname(CONFIG_FILE));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2) + '\n', 'utf8');
}

/** Get the configured monthly budget (USD). */
export function getBudget() {
  const c = readConfig();
  return c.budget || null;
}

/** Set (or clear with a non-positive value) the monthly budget. */
export function setBudget(monthly) {
  const c = readConfig();
  const n = Number(monthly);
  if (!Number.isFinite(n) || n <= 0) {
    c.budget = null;
  } else {
    c.budget = { monthly: n, setAt: Date.now() };
  }
  writeConfig(c);
  return c.budget;
}
