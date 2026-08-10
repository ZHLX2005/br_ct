/**
 * promptsStore.test.js — Node test for shared/prompts/promptsStore.js
 *
 * Loading strategy mirrors sidebar/main/cc/modules/features/ccExtract.test.js:
 * read promptsStore.js source, strip `import` lines, prepend inline stubs for
 * the four external symbols, write to a temp .mjs, dynamic-import it.
 * chrome is stubbed globally before import so module evaluation succeeds.
 *
 * Run: node shared/prompts/promptsStore.test.js
 */

import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, 'promptsStore.js');

globalThis.chrome = {
  storage: {
    local: {
      get: (_keys, cb) => cb({ promptsVersion: 0 }),
      set: (_obj, cb) => { if (cb) cb(); },
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: { sendMessage: () => {}, lastError: null },
};

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log(`  PASS ${name}`); passed++; },
        (err) => { console.log(`  FAIL ${name}: ${err.message}`); failed++; failures.push({ name, err }); });
    }
    console.log(`  PASS ${name}`); passed++;
  } catch (err) {
    console.log(`  FAIL ${name}: ${err.message}`); failed++; failures.push({ name, err });
  }
}

const STUBS = `
const STORAGE_KEYS = { PROMPTS_VERSION: "promptsVersion" };
const sendNativeMessage = () => Promise.reject(new Error("not used in tests"));
const getBootstrapPrompts = () => ({
  code_gen: [{group:"code_gen", label:"l", alias:"a", template:"t"}],
  analyze_plan: [{group:"analyze_plan", label:"l", alias:"a", template:"t"}],
  custom_design: [{group:"custom_design", label:"l", alias:"a", template:"t"}],
  read: [{group:"read", label:"l", alias:"a", template:"t"}],
  search: [{group:"search", label:"l", alias:"a", template:"t"}],
  other: [{group:"other", label:"l", alias:"a", template:"t"}],
  xxxx_ask: [{group:"xxxx_ask", label:"l", alias:"a", template:"t"}],
  xxxx_trans: [{group:"xxxx_trans", label:"l", alias:"a", template:"t"}],
});
`;

const src = readFileSync(SRC_PATH, 'utf8');
const stripped = src.split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
const tmpDir = mkdtempSync(join(tmpdir(), 'promptsStore-test-'));
const tmpFile = join(tmpDir, 'promptsStore.mjs');
writeFileSync(tmpFile, STUBS + stripped);

let getCurrentPrompts, isLoaded, subscribeToPrompts;
try {
  ({ getCurrentPrompts, isLoaded, subscribeToPrompts } = await import(pathToFileURL(tmpFile).href));
} finally {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

if (typeof getCurrentPrompts !== 'function' ||
    typeof isLoaded !== 'function' ||
    typeof subscribeToPrompts !== 'function') {
  console.error('Required exports missing from stripped promptsStore.js');
  process.exit(2);
}

console.log('\npromptsStore tests');

await test('getCurrentPrompts returns the 8 hardcoded groups (compile-time fallback)', () => {
  const cur = getCurrentPrompts();
  assert.ok(cur && typeof cur === 'object');
  const groups = ['code_gen','analyze_plan','custom_design','read','search','other','xxxx_ask','xxxx_trans'];
  for (const g of groups) {
    assert.ok(g in cur, `group "${g}" missing`);
    assert.ok(Array.isArray(cur[g]));
    assert.ok(cur[g].length >= 1);
  }
});

await test('isLoaded() returns false before loadAllPrompts succeeds', () => {
  assert.equal(isLoaded(), false);
});

await test('subscribeToPrompts returns an unsubscribe function', () => {
  const unsub = subscribeToPrompts(() => {});
  assert.equal(typeof unsub, 'function');
});

console.log(`\nResults: ${passed} passed / ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`  - ${name}: ${err.stack || err.message}`);
  process.exit(1);
}
process.exit(0);
