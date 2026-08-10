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
// createSubscribable stub mirrors shared/core/subscribable.js for tests
const createSubscribable = () => {
  const subs = new Set();
  return {
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    emit: (v) => { for (const cb of [...subs]) { try { cb(v); } catch (e) { console.error(e); } } },
  };
};
`;

const src = readFileSync(SRC_PATH, 'utf8');
const stripped = src.split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
const tmpDir = mkdtempSync(join(tmpdir(), 'promptsStore-test-'));
const tmpFile = join(tmpDir, 'promptsStore.mjs');
writeFileSync(tmpFile, STUBS + stripped);

let getCurrentPrompts, isLoaded, subscribeToPrompts, savePromptFile;
try {
  ({ getCurrentPrompts, isLoaded, subscribeToPrompts, savePromptFile } = await import(pathToFileURL(tmpFile).href));
} finally {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

if (typeof getCurrentPrompts !== 'function' ||
    typeof isLoaded !== 'function' ||
    typeof subscribeToPrompts !== 'function' ||
    typeof savePromptFile !== 'function') {
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

// 新增:进程内 emit 验证。override STUBS 里的 sendNativeMessage,让 savePromptFile
// 走完整流程,断言已订阅的 cb 在进程内同步触发。
await test('savePromptFile triggers in-process emit on subscribed cb (symmetric with platformsStore)', async () => {
  const tmpDir2 = mkdtempSync(join(tmpdir(), 'promptsStore-test-'));
  const tmpFile2 = join(tmpDir2, 'promptsStore.mjs');
  // 复用原 STUBS,但替换 sendNativeMessage 为成功 stub
  const stub2 = STUBS.replace(
    'const sendNativeMessage = () => Promise.reject(new Error("not used in tests"));',
    `const sendNativeMessage = (m) => {
      if (m && m.command === 'getPromptsDir') return Promise.resolve({ data: 'C:/fake/prompts' });
      if (m && m.command === 'savePrompts') return Promise.resolve({ data: { ok: true } });
      return Promise.resolve({ data: null });
    };`
  );
  writeFileSync(tmpFile2, stub2 + stripped);
  try {
    const mod = await import(pathToFileURL(tmpFile2).href);
    let emitCount = 0;
    let lastCache = null;
    const unsub = mod.subscribeToPrompts((cache) => { emitCount++; lastCache = cache; });
    await mod.savePromptFile('code_gen', [{ group: 'code_gen', label: 'l', alias: 'a', template: 't' }]);
    assert.ok(emitCount >= 1, `cb should fire at least once after savePromptFile, got ${emitCount}`);
    assert.ok(lastCache && lastCache.code_gen, 'last cache should contain code_gen group');
    unsub();
  } finally {
    try { rmSync(tmpDir2, { recursive: true, force: true }); } catch {}
  }
});

console.log(`\nResults: ${passed} passed / ${failed} failed`);
if (failed > 0) {
  for (const { name, err } of failures) console.error(`  - ${name}: ${err.stack || err.message}`);
  process.exit(1);
}
process.exit(0);
