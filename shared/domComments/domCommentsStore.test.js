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

const tmp = mkdtempSync(join(tmpdir(), 'domcomments-'));
writeFileSync(join(tmp, 'keys.mjs'), loadStripped(join(__dirname, '../core/storageKeys.js')));
writeFileSync(join(tmp, 'sub.mjs'), loadStripped(join(__dirname, '../core/subscribable.js')));
const storeSource = readFileSync(join(__dirname, 'domCommentsStore.js'), 'utf8')
  .replace(`from '../core/storageKeys.js'`, `from './keys.mjs'`)
  .replace(`from '../core/subscribable.js'`, `from './sub.mjs'`);
writeFileSync(join(tmp, 'domCommentsStore.mjs'), storeSource);

const { addDomComment, loadDomComments, clearDomComments, getCurrentDomComments } =
  await import(pathToFileURL(join(tmp, 'domCommentsStore.mjs')).href);

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

await test('addDomComment prepends newest record first', async () => {
  stored = {};
  await addDomComment({ tag: 'div.a', comment: 'first' });
  await addDomComment({ tag: 'div.b', comment: 'second' });
  const list = getCurrentDomComments();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].tag, 'div.b');
  assert.strictEqual(list[1].tag, 'div.a');
});

await test('addDomComment assigns unique ids', async () => {
  stored = {};
  await addDomComment({ tag: 'div.a' });
  await addDomComment({ tag: 'div.a' });
  const list = getCurrentDomComments();
  assert.notStrictEqual(list[0].id, list[1].id);
});

await test('addDomComment caps at 50 records', async () => {
  stored = {};
  for (let i = 0; i < 55; i++) await addDomComment({ tag: `div.r${i}` });
  const list = getCurrentDomComments();
  assert.strictEqual(list.length, 50);
  assert.strictEqual(list[0].tag, 'div.r54');
});

await test('loadDomComments loads from storage', async () => {
  stored = { domCommentHistory: [{ id: 'x', tag: 'div.k' }] };
  const list = await loadDomComments();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'x');
});

await test('clearDomComments empties the list', async () => {
  await addDomComment({ tag: 'div.a' });
  await clearDomComments();
  assert.deepStrictEqual(getCurrentDomComments(), []);
  assert.deepStrictEqual(stored.domCommentHistory, []);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
