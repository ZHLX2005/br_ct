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

const tmp = mkdtempSync(join(tmpdir(), 'history-'));
writeFileSync(join(tmp, 'keys.mjs'), loadStripped(join(__dirname, '../core/storageKeys.js')));
writeFileSync(join(tmp, 'sub.mjs'), loadStripped(join(__dirname, '../core/subscribable.js')));
const storeSource = readFileSync(join(__dirname, 'historyStore.js'), 'utf8')
  .replace(`from '../core/storageKeys.js'`, `from './keys.mjs'`)
  .replace(`from '../core/subscribable.js'`, `from './sub.mjs'`);
writeFileSync(join(tmp, 'historyStore.mjs'), storeSource);

const { addToHistory, loadHistory, getCurrentHistory } =
  await import(pathToFileURL(join(tmp, 'historyStore.mjs')).href);

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

await test('addToHistory applies LRU deduplication', async () => {
  stored = {};
  await addToHistory('a');
  await addToHistory('b');
  await addToHistory('a');
  assert.deepStrictEqual(getCurrentHistory(), ['a', 'b']);
});

await test('addToHistory caps history at 30 entries', async () => {
  stored = {};
  for (let i = 0; i < 35; i++) await addToHistory(`m${i}`);
  const current = getCurrentHistory();
  assert.strictEqual(current.length, 30);
  assert.strictEqual(current[0], 'm34');
});

await test('loadHistory loads from storage', async () => {
  stored = { messageHistory: ['x', 'y'] };
  const history = await loadHistory();
  assert.deepStrictEqual(history, ['x', 'y']);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
