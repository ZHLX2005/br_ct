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

const tmp = mkdtempSync(join(tmpdir(), 'platforms-'));
writeFileSync(join(tmp, 'keys.mjs'), loadStripped(join(__dirname, '../core/storageKeys.js')));
writeFileSync(join(tmp, 'sub.mjs'), loadStripped(join(__dirname, '../core/subscribable.js')));
const storeSource = readFileSync(join(__dirname, 'platformsStore.js'), 'utf8')
  .replace(`from '../core/storageKeys.js'`, `from './keys.mjs'`)
  .replace(`from '../core/subscribable.js'`, `from './sub.mjs'`);
writeFileSync(join(tmp, 'platformsStore.mjs'), storeSource);

const {
  getCurrentPlatformVisibility,
  loadPlatformVisibility,
  savePlatformVisibility,
  subscribeToPlatforms,
} = await import(pathToFileURL(join(tmp, 'platformsStore.mjs')).href);

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

await test('getCurrentPlatformVisibility defaults to an empty object', () => {
  stored = {};
  assert.deepStrictEqual(getCurrentPlatformVisibility(), {});
});

await test('loadPlatformVisibility loads from storage', async () => {
  stored = { platformVisibilitySettings: { yuanbao: true, gemini: false } };
  const visibility = await loadPlatformVisibility();
  assert.deepStrictEqual(visibility, { yuanbao: true, gemini: false });
});

await test('savePlatformVisibility writes storage and emits', async () => {
  stored = {};
  let emitted = null;
  const unsubscribe = subscribeToPlatforms((value) => { emitted = value; });
  await savePlatformVisibility({ chatgpt: true });
  assert.deepStrictEqual(stored.platformVisibilitySettings, { chatgpt: true });
  assert.deepStrictEqual(emitted, { chatgpt: true });
  unsubscribe();
});

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
