/**
 * promptsEditorApi.test.js — Node test for shared/prompts/promptsEditorApi.js
 *
 * Source-stripping pattern (same shape as promptsStore.test.js): read the API
 * source, strip import lines, prepend inline stub for ./promptsStore.js,
 * write to a temp .mjs, dynamic-import it. chrome is stubbed globally so
 * module evaluation succeeds.
 *
 * Run: node shared/prompts/promptsEditorApi.test.js
 */

import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, 'promptsEditorApi.js');

let stored = {};

globalThis.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({ promptsVersion: 0 }),
      set: (obj, cb) => { Object.assign(stored, obj); cb?.(); },
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: {
    sendMessage: (_, cb) => cb({ status: 'success', data: '/fake' }),
    lastError: null,
  },
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
let __cache = {
  other: [
    {group:"other", label:"不修饰", alias:"raw", template:"t1"},
    {group:"other", label:"翻译", alias:"trans", template:"t2"},
  ],
};
const getCurrentPrompts = () => __cache;
const savePromptFile = async (group, list) => { __cache = { ...__cache, [group]: list }; };
`;

const src = readFileSync(SRC_PATH, 'utf8');
const stripped = src.split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
const tmpDir = mkdtempSync(join(tmpdir(), 'promptsEditorApi-test-'));
const tmpFile = join(tmpDir, 'promptsEditorApi.mjs');
writeFileSync(tmpFile, STUBS + stripped);

let addPrompt, updatePrompt, deletePrompt;
try {
  ({ addPrompt, updatePrompt, deletePrompt } = await import(pathToFileURL(tmpFile).href));
} finally {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

if (typeof addPrompt !== 'function' ||
    typeof updatePrompt !== 'function' ||
    typeof deletePrompt !== 'function') {
  console.error('Required exports missing from stripped promptsEditorApi.js');
  process.exit(2);
}

console.log('\npromptsEditorApi tests');

await test('addPrompt throws on empty label', async () => {
  await assert.rejects(
    () => addPrompt({ group: 'other', label: '', template: 'x' }),
    /标题不能为空/,
  );
});

await test('addPrompt throws on duplicate label', async () => {
  await assert.rejects(
    () => addPrompt({ group: 'other', label: '不修饰', template: 'x' }),
    /标题已存在/,
  );
});

await test('addPrompt throws on duplicate alias', async () => {
  await assert.rejects(
    () => addPrompt({ group: 'other', label: 'NEW', alias: 'raw', template: 'x' }),
    /别名已存在/,
  );
});

await test('updatePrompt throws when old label not found', async () => {
  await assert.rejects(
    () => updatePrompt({ group: 'other', oldLabel: 'NOPE', newLabel: 'X' }),
    /未找到原标题/,
  );
});

await test('updatePrompt throws on empty new label', async () => {
  await assert.rejects(
    () => updatePrompt({ group: 'other', oldLabel: '不修饰', newLabel: '' }),
    /标题不能为空/,
  );
});

await test('deletePrompt throws when label not found', async () => {
  await assert.rejects(
    () => deletePrompt({ group: 'other', label: 'NOPE' }),
    /未找到要删除的/,
  );
});

console.log(`\nResults: ${passed} passed / ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`  - ${name}: ${err.stack || err.message}`);
  process.exit(1);
}
process.exit(0);
