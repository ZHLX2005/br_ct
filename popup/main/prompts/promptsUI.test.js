/**
 * promptsUI.test.js — regression test for duplicate prompt labels.
 *
 * Loading strategy mirrors promptsStore.test.js: strip production imports,
 * prepend test stubs, then dynamically import the resulting module.
 *
 * Run: node popup/main/prompts/promptsUI.test.js
 */
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, 'promptsUI.js');

function makeClassList(el) {
  return {
    add(...names) {
      const set = el._classNames || (el._classNames = new Set());
      names.forEach((name) => set.add(name));
      el.className = [...set].join(' ');
    },
    remove(...names) {
      const set = el._classNames || (el._classNames = new Set());
      names.forEach((name) => set.delete(name));
      el.className = [...set].join(' ');
    },
    toggle(name, force) {
      const set = el._classNames || (el._classNames = new Set());
      const next = force === undefined ? !set.has(name) : force;
      if (next) set.add(name); else set.delete(name);
      el.className = [...set].join(' ');
      return next;
    },
    contains(name) {
      const set = el._classNames || (el._classNames = new Set());
      return set.has(name);
    },
  };
}

function makeEl(tag) {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    classList: null,
    style: {},
    dataset: {},
    attributes: {},
    textContent: '',
    _classNames: new Set(),
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      const arr = listeners[type];
      if (!arr) return;
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    },
    _emit(type, evt) {
      const arr = listeners[type];
      if (!arr) return;
      arr.slice().forEach((h) => h(evt));
    },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    },
    querySelector(selector) { return findAll(this, selector)[0] || null; },
    querySelectorAll(selector) { return findAll(this, selector); },
    contains(target) {
      return target === this || this.children.some((child) => child.contains(target));
    },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key]; },
    dispatchEvent() { return true; },
    focus() {},
    select() {},
  };
  // 让直接赋值 el.className = 'foo' 与 classList.add/remove 共享同一组 classes。
  const classes = el._classNames;
  Object.defineProperty(el, 'className', {
    configurable: true,
    enumerable: true,
    get() { return [...classes].join(' '); },
    set(value) {
      classes.clear();
      (value || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
  });
  el.classList = makeClassList(el);
  return el;
}

function matches(node, selector) {
  if (selector.startsWith('.')) {
    return node.className.split(/\s+/).includes(selector.slice(1));
  }
  if (selector.startsWith('[data-')) {
    const name = selector.slice(6, -1);
    return node.dataset[name] !== undefined;
  }
  return false;
}

function findAll(root, selector) {
  const found = [];
  const visit = (node) => {
    for (const child of node.children || []) {
      if (matches(child, selector)) found.push(child);
      visit(child);
    }
  };
  visit(root);
  return found;
}

const documentRoot = makeEl('document');
const documentStub = {
  body: documentRoot,
  createElement: (tag) => makeEl(tag),
  addEventListener() {},
  removeEventListener() {},
  querySelector: (selector) => findAll(documentRoot, selector)[0] || null,
  querySelectorAll: (selector) => findAll(documentRoot, selector),
};
globalThis.document = documentStub;
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.Event = class Event { constructor(type) { this.type = type; } };
globalThis.chrome = {
  storage: {
    sync: {
      get: (_keys, callback) => callback({}),
      set: (_values, callback) => { if (callback) callback(); },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: { lastError: null },
};

const STUBS = `
const getCurrentPrompts = () => ({
  code_gen: [{ group: "code_gen", label: "代码", alias: "code", template: "t1" }],
  analyze_plan: [{ group: "analyze_plan", label: "分析", alias: "plan", template: "t2" }],
  custom_design: [{ group: "custom_design", label: "设计", alias: "design", template: "t3" }],
  read: [
    { group: "read", label: "翻译", alias: "trans", template: "中英翻译..." },
    { group: "read", label: "太奶", alias: "tainai", template: "100岁太奶..." },
  ],
  search: [{ group: "search", label: "搜索", alias: "search", template: "t4" }],
  other: [{ group: "other", label: "其他", alias: "other", template: "t5" }],
  xxxx_ask: [
    { group: "xxxx_ask", label: "问答", alias: "qa", template: "t6" },
    { group: "xxxx_ask", label: "解释", alias: "js", template: "请详细解释:%s" },
  ],
  xxxx_trans: [
    { group: "xxxx_trans", label: "翻译", alias: "fy", template: "请翻译:%s" },
    { group: "xxxx_trans", label: "解释", alias: "js", template: "请详细解释:%s" },
  ],
});
const updatePrompt = () => Promise.resolve();
`;

const src = readFileSync(SRC_PATH, 'utf8');
const stripped = src.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
const tempDir = mkdtempSync(join(tmpdir(), 'promptsUI-test-'));
const tempFile = join(tempDir, 'promptsUI.mjs');
writeFileSync(tempFile, STUBS + stripped);

let mod;
try {
  mod = await import(pathToFileURL(tempFile).href);
} finally {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
}

const optimizerEl = makeEl('div');
optimizerEl.className = 'custom-select-container';
const selectedValue = makeEl('div');
selectedValue.className = 'selected-value';
const optionsContainer = makeEl('div');
optionsContainer.className = 'custom-select-options';
optimizerEl.appendChild(selectedValue);
optimizerEl.appendChild(optionsContainer);

documentRoot.appendChild(optimizerEl);
const cleanup = mod.populateOptimizer(optimizerEl);
try {
  const options = findAll(optionsContainer, '.select-option');
  const trans = options.find((option) => option.textContent.includes('/trans'));
  const fy = options.find((option) => option.textContent.includes('/fy'));

  assert.ok(trans, 'expected popup options to include the read/trans prompt');
  assert.ok(fy, 'expected popup options to include the xxxx_trans/fy prompt');
  assert.notStrictEqual(trans.dataset.value, fy.dataset.value,
    'read/trans and xxxx_trans/fy must be distinct option elements');
  console.log('PASS promptsUI keeps both read/trans and xxxx_trans/fy options');

  // 第三个 alias 冲突: xxxx_ask 与 xxxx_trans 都存在 label="解释" / alias="js";
  // 复合 key 必须把它们渲染成两条不同的 option。
  const jsOptions = options.filter((option) => option.textContent === '解释 (/js)');
  assert.strictEqual(jsOptions.length, 2,
    'expected both xxxx_ask::解释 and xxxx_trans::解释 options to render (same label/alias, distinct keys)');
  assert.notStrictEqual(jsOptions[0].dataset.value, jsOptions[1].dataset.value,
    'xxxx_ask::解释 and xxxx_trans::解释 must have distinct composite keys');
  console.log('PASS promptsUI keeps xxxx_ask::解释 and xxxx_trans::解释 as distinct options');
} finally {
  cleanup();
}

// === Legacy fallback test ===
// 当 storage 返回旧格式 (裸 alias 如 "trans") 时, onToggleClick 的回退查找
// 应该跨 group 找到 read/trans 这条,把 read group 标为 active 并显示。
{
  const originalGet = globalThis.chrome.storage.sync.get;
  globalThis.chrome.storage.sync.get = (_keys, callback) => callback({ lastPromptTemplate: 'trans' });

  const legacyOptimizer = makeEl('div');
  legacyOptimizer.className = 'custom-select-container';
  const legacySelectedValue = makeEl('div');
  legacySelectedValue.className = 'selected-value';
  const legacyOptionsContainer = makeEl('div');
  legacyOptionsContainer.className = 'custom-select-options';
  legacyOptimizer.appendChild(legacySelectedValue);
  legacyOptimizer.appendChild(legacyOptionsContainer);
  documentRoot.appendChild(legacyOptimizer);

  const cleanupLegacy = mod.populateOptimizer(legacyOptimizer);
  try {
    // 触发 onToggleClick — 此时 storage 返回 {lastPromptTemplate: 'trans'} (裸 alias)
    legacyOptimizer._emit('click', {});

    // 验证 legacy 回退查找命中 read group
    const optsInLegacy = findAll(legacyOptionsContainer, '.group-options');
    const readOpts = optsInLegacy.find((el) => el.dataset && el.dataset.group === 'read');
    const codeGenOpts = optsInLegacy.find((el) => el.dataset && el.dataset.group === 'code_gen');
    assert.ok(readOpts, 'expected read group-options container under legacyOptimizer');
    assert.strictEqual(readOpts.style.display, 'block',
      'legacy fallback: read group should be visible after click with bare alias "trans"');
    assert.strictEqual(codeGenOpts.style.display, 'none',
      'legacy fallback: code_gen group should be hidden after click selects read');

    const groupItemsInLegacy = findAll(legacyOptionsContainer, '.group-item');
    const readGroupItem = groupItemsInLegacy.find((el) => el.textContent === 'read');
    assert.ok(readGroupItem, 'expected read group-item in legacyOptimizer');
    assert.ok(readGroupItem.classList.contains('active'),
      'legacy fallback: read group-item should have active class');

    console.log('PASS promptsUI legacy fallback finds read group from bare alias "trans"');
  } finally {
    cleanupLegacy();
    legacyOptimizer.remove();
    globalThis.chrome.storage.sync.get = originalGet;
  }
}
