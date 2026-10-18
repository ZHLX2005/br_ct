import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let stored = {};

globalThis.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const result = {};
        for (const key of keys) result[key] = stored[key];
        cb(result);
      },
      set: (value, cb) => {
        Object.assign(stored, value);
        cb?.();
      },
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: { lastError: null },
};

function loadStripped(path) {
  return readFileSync(path, 'utf8').replace(/^import .+;$/gm, '');
}

const tmp = mkdtempSync(join(tmpdir(), 'funcshortcuts-'));
writeFileSync(join(tmp, 'keys.mjs'), loadStripped(join(__dirname, '../core/storageKeys.js')));
writeFileSync(join(tmp, 'sub.mjs'), loadStripped(join(__dirname, '../core/subscribable.js')));
const storeSource = readFileSync(join(__dirname, 'funcShortcutsStore.js'), 'utf8')
  .replace(`from '../core/storageKeys.js'`, `from './keys.mjs'`)
  .replace(`from '../core/subscribable.js'`, `from './sub.mjs'`);
writeFileSync(join(tmp, 'funcShortcutsStore.mjs'), storeSource);

const { saveFuncShortcut, removeFuncShortcut, loadFuncShortcuts, getFuncShortcuts } =
  await import(pathToFileURL(join(tmp, 'funcShortcutsStore.mjs')).href);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL ${name}\n    ${error.message}`);
    failed++;
  }
}

const combo = { ctrlKey: true, altKey: false, shiftKey: true, metaKey: false, key: 'K' };

await test('saveFuncShortcut stores per-file shortcuts', async () => {
  stored = {};
  await saveFuncShortcut('元素dom/a.js', combo);
  await saveFuncShortcut('元素dom/b.js', { ...combo, key: 'L' });
  assert.deepStrictEqual(getFuncShortcuts()['元素dom/a.js'], combo);
  assert.strictEqual(getFuncShortcuts()['元素dom/b.js'].key, 'L');
  assert.strictEqual(stored.funcShortcuts['元素dom/a.js'].key, 'K');
});

await test('removeFuncShortcut deletes only the target file', async () => {
  await removeFuncShortcut('元素dom/a.js');
  const current = getFuncShortcuts();
  assert.strictEqual(current['元素dom/a.js'], undefined);
  assert.strictEqual(current['元素dom/b.js'].key, 'L');
});

await test('loadFuncShortcuts loads from storage', async () => {
  stored = { funcShortcuts: { 'x.js': { key: 'Z', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } } };
  const all = await loadFuncShortcuts();
  assert.strictEqual(all['x.js'].key, 'Z');
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
