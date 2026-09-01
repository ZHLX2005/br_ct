// lastPromptRestore.test.js - regression test: selected-value restore reads sync.
//
// 回归: lastPromptTemplate 写入端在 promptsUI.js 走 chrome.storage.sync,旧
// loadStoredData 从 chrome.storage.local 读 → 永远读到 undefined → selected-value
// 永远停在 HTML 默认值 "不使用优化"。本测试固定从 sync 读这个契约。
//
// stub 设计: sync 返回 saved key,local 返回空。如果实现误从 local 读,测试立刻失败
// (selected-value 不被更新);从 sync 读则通过。这同时是 bug 的失败证明与修复后的回归网。
//
// Run: node popup/main/prompts/lastPromptRestore.test.js

import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, 'lastPromptRestore.js');

// Minimal DOM stub —— restore 只需要 optimizerEl.querySelector('.selected-value')
function makeEl(tag) {
  const el = {
    tagName: (tag || '').toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    dataset: {},
    textContent: '',
    style: {},
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return el;
}

globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: makeEl,
  body: makeEl('body'),
};
globalThis.chrome = {
  storage: {
    sync: {
      get: (_keys, callback) => callback({}),
      set: (_values, callback) => { if (callback) callback(); },
    },
    local: {
      get: (_keys, callback) => callback({}),
      set: (_values, callback) => { if (callback) callback(); },
    },
  },
  runtime: { lastError: null },
};

// shared 模块 stub —— restore 只用 STORAGE_KEYS.LAST_PROMPT_TEMPLATE 和 getCurrentPrompts()
const STUBS = `
const STORAGE_KEYS = { LAST_PROMPT_TEMPLATE: "lastPromptTemplate" };
const getCurrentPrompts = () => ({
  code_gen: [{ group: "code_gen", label: "代码", alias: "code", template: "t1" }],
  read: [{ group: "read", label: "翻译", alias: "trans", template: "中英翻译..." }],
  xxxx_trans: [{ group: "xxxx_trans", label: "翻译", alias: "fy", template: "请翻译:%s" }],
});
`;

const src = readFileSync(SRC_PATH, 'utf8');
const stripped = src.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
const tempDir = mkdtempSync(join(tmpdir(), 'lastPromptRestore-test-'));
const tempFile = join(tempDir, 'lastPromptRestore.mjs');
writeFileSync(tempFile, STUBS + stripped);

let mod;
try {
  mod = await import(pathToFileURL(tempFile).href);
} finally {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
}

function makeOptimizerWithSelected() {
  const selectedValue = makeEl('div');
  const optimizerEl = {
    querySelector(sel) {
      return sel === '.selected-value' ? selectedValue : null;
    },
  };
  return { optimizerEl, selectedValue };
}

// === Case 1: sync 有复合 key,local 空 —— 必须恢复(且从 sync 读) ===
{
  globalThis.chrome.storage.sync.get = (_keys, callback) =>
    callback({ lastPromptTemplate: 'read::翻译' });
  globalThis.chrome.storage.local.get = (_keys, callback) => callback({});

  const { optimizerEl, selectedValue } = makeOptimizerWithSelected();
  const restored = await mod.restoreLastPromptTemplate(optimizerEl);

  assert.strictEqual(restored, true, '应返回 true 表示恢复成功');
  assert.strictEqual(selectedValue.textContent, '翻译', 'selected-value label 必须写入');
  assert.strictEqual(selectedValue.dataset.value, 'read::翻译', 'selected-value key 必须原样保留');
  assert.strictEqual(selectedValue.dataset.template, '中英翻译...', 'selected-value template 必须写入');
  console.log('PASS composite key "read::翻译" restores from sync');
}

// === Case 2: 旧格式裸 alias —— 必须跨 group 找回并恢复 ===
{
  globalThis.chrome.storage.sync.get = (_keys, callback) =>
    callback({ lastPromptTemplate: 'trans' });
  globalThis.chrome.storage.local.get = (_keys, callback) => callback({});

  const { optimizerEl, selectedValue } = makeOptimizerWithSelected();
  const restored = await mod.restoreLastPromptTemplate(optimizerEl);

  assert.strictEqual(restored, true, '裸 alias 应通过跨组回退匹配成功');
  assert.strictEqual(selectedValue.textContent, '翻译');
  assert.strictEqual(selectedValue.dataset.value, 'trans', '旧值原样保留,便于与写入端契约兼容');
  assert.strictEqual(selectedValue.dataset.template, '中英翻译...');
  console.log('PASS legacy bare alias "trans" falls back to read/翻译');
}

// === Case 3: sync 没存 —— 不动 selected-value ===
{
  globalThis.chrome.storage.sync.get = (_keys, callback) => callback({});
  globalThis.chrome.storage.local.get = (_keys, callback) => callback({});

  const { optimizerEl, selectedValue } = makeOptimizerWithSelected();
  selectedValue.textContent = '默认';
  const restored = await mod.restoreLastPromptTemplate(optimizerEl);

  assert.strictEqual(restored, false, '无存储值时返回 false');
  assert.strictEqual(selectedValue.textContent, '默认', '默认值不能被覆盖');
  console.log('PASS empty storage leaves default selected-value alone');
}

// === Case 4: sync 有 key 但 prompts 快照里已无此条目 —— 不动 selected-value ===
{
  globalThis.chrome.storage.sync.get = (_keys, callback) =>
    callback({ lastPromptTemplate: 'deleted_group::消失' });
  globalThis.chrome.storage.local.get = (_keys, callback) => callback({});

  const { optimizerEl, selectedValue } = makeOptimizerWithSelected();
  selectedValue.textContent = '默认';
  const restored = await mod.restoreLastPromptTemplate(optimizerEl);

  assert.strictEqual(restored, false, '找不到匹配项时应返回 false');
  assert.strictEqual(selectedValue.textContent, '默认', '找不到时不能污染默认值');
  console.log('PASS stale key (group no longer exists) is ignored');
}
