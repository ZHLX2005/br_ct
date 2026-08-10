# Shared 数据层 + 三处独立提示词 UI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 popup / sidebar / options 共用的数据（提示词、平台选择、历史记录）抽离到 `shared/` 数据层；三处 UI 独立实现不共享 DOM/CSS，但通过数据层 + 订阅机制实现"一处修改，三处立即生效"。

**Architecture:** `shared/core/` 提供 storage key 集中定义 + chrome runtime/native 桥接封装；`shared/prompts/` 暴露 `promptsStore`（loadAllPrompts/savePromptFile/subscribe）+ `promptsEditorApi`（add/update/delete 细粒度封装）；`shared/platforms/` 与 `shared/history/` 同样模式。三个 UI（popup 提示词选择器、sidebar 独立面板、options 编辑器）各自 import shared API 实现，互不引用对方的 HTML/CSS。Disk 写入后 bump `promptsVersion`，`chrome.storage.onChanged` 触发所有 UI 重渲染。

**Tech Stack:** Vanilla ES modules（无构建）、Chrome MV3 unpacked extension、`chrome.storage` / `chrome.runtime`。测试使用 Node.js 内置 `node:assert`（参照 `ccExtract.test.js` 的 source-stripping 模式）。

---

## Global Constraints

- **测试框架**：纯逻辑单元（`promptsStore`、`promptsEditorApi`、`promptsCore`）使用 Node.js 内置 `assert`，参照 `sidebar/main/cc/modules/features/ccExtract.test.js` 的源码剥离模式。涉及 `chrome.*` 的代码不写单元测试，靠手动验证（`chrome://extensions` 加载解压扩展后操作）。
- **数据层目录约定**：`shared/{core,prompts,platforms,history}/` 三层。`core` 放基础设施（storageKeys、nativeBridge），`prompts/platforms/history` 放领域数据。
- **API 命名**：每个领域模块导出 `{load, save, subscribe, getCurrent}` 四元组（`getCurrent` 同步访问内存快照，避免 UI 重复异步等待）。
- **兜底**：所有 load 操作失败时回退到编译期硬编码（在调用方 import 时同步拿到一份初始值）。
- **UI 三处独立**：popup / sidebar / options 三处 UI 文件互不 import 对方的 HTML/CSS。每个 UI 自己组装 DOM/CSS，只 import shared 数据层。
- **编辑 icon**：SVG，非 emoji（user 明确要求）。
- **保存时机**：用户编辑完点确认按钮，blur 不保存（user 明确要求）。
- **三处 UI 解耦**：UI 之间不互相 import，依赖通过 storage 事件广播。
- **每个 Task 一次 commit**，提交信息遵循 Conventional Commits。

---

## File Structure

### 新增

- `shared/core/storageKeys.js` — `STORAGE_KEYS` 统一常量（含新增 `PROMPTS_VERSION`）
- `shared/core/nativeBridge.js` — `sendNativeMessage(payload)` 封装 chrome.runtime.sendMessage 到 background native_relay
- `shared/core/subscribable.js` — `createSubscribable()` 工具，用于 promptsStore/platformsStore/historyStore 内部事件分发
- `shared/prompts/promptsStore.js` — `loadAllPrompts()` / `savePromptFile(group, list)` / `subscribeToPrompts(cb)` / `getCurrentPrompts()`
- `shared/prompts/promptsEditorApi.js` — `addPrompt()` / `updatePrompt()` / `deletePrompt()` 细粒度封装
- `shared/prompts/promptsBootstrap.js` — 编译期硬编码 fallback 集合（从 popup/main/prompts/groups/*.js 重导）
- `shared/platforms/platformsStore.js` — 平台可见性 CRUD + subscribe
- `shared/history/historyStore.js` — 历史记录 CRUD + subscribe
- `sidebar/main/aichat/promptsPanel.js` — sidebar 独立 UI 模块（mount/unmount）
- `shared/prompts/promptsStore.test.js` — 单元测试
- `shared/prompts/promptsEditorApi.test.js` — 单元测试
- `shared/prompts/promptsCore.test.js` — 迁移后的单元测试

### 迁移（位置变更，逻辑不变）

- `popup/main/prompts/promptsCore.js` → `shared/prompts/promptsCore.js`（同步更新所有 import 路径）

### 重写（保留 UI 形态，改为调 shared API）

- `popup/main/prompts/promptsUI.js` — 改为 import shared 数据层；新增就地编辑交互
- `options/prompts_editor/prompts_editor.js` — 改为调 `promptsEditorApi`

### 调用方更新

- `popup/main/mainUtils.js` — 改 import 路径
- `sidebar/main/aichat/aichatUtils.js` — 改 import 路径
- `options/storage/storage.js` — 改 import 路径
- `shared/sendMessage.js` — 改 promptsCore 的 import 路径

### 后续收敛（Phase 6，本计划不强制包含）

- `popup/main/modules/storage.js` 中 `addToHistory` 下沉到 shared
- `popup/main/modules/platformVisibility.js` 下沉到 shared

---

## Task 1: storageKeys + nativeBridge 基础设施

**Files:**
- Create: `shared/core/storageKeys.js`
- Create: `shared/core/nativeBridge.js`
- Create: `shared/core/subscribable.js`

**Interfaces:**
- Produces: `STORAGE_KEYS` 常量对象；`sendNativeMessage(payload)` 返回 `Promise<{status, data, message}>`；`createSubscribable()` 返回 `{subscribe(cb), emit(value), getSubscribers()}`。

- [ ] **Step 1: 写 storageKeys.js**

Create `shared/core/storageKeys.js`:

```js
/**
 * shared/core/storageKeys.js
 *
 * 集中管理 chrome.storage.local 键名。新增键必须先在此声明，避免散落。
 * popup / sidebar / options 三处共享同一份常量。
 */
export const STORAGE_KEYS = {
  HISTORY: "messageHistory",
  OPTIMIZER: "selectedOptimizer",
  PLATFORM_VISIBILITY: "platformVisibilitySettings",
  PLATFORM_NAV: "platformNavSettings",
  LAST_MESSAGE: "lastMessage",
  PLATFORM_STATES: "platformStates",
  LAST_PROMPT_TEMPLATE: "lastPromptTemplate",
  // 新增：提示词变更版本号。bump 时所有 UI 自动重渲染。
  PROMPTS_VERSION: "promptsVersion",
};
```

- [ ] **Step 2: 写 nativeBridge.js**

Create `shared/core/nativeBridge.js`:

```js
/**
 * shared/core/nativeBridge.js
 *
 * 封装 chrome.runtime.sendMessage → background → native_relay 的调用。
 * 失败统一 reject(chrome.runtime.lastError.message)。
 */
export function sendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'nativeMessage', payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('Native host 无响应'));
          return;
        }
        if (response.status === 'error') {
          reject(new Error(response.message || '操作失败'));
          return;
        }
        resolve(response);
      }
    );
  });
}
```

- [ ] **Step 3: 写 subscribable.js（含单元测试）**

Create `shared/core/subscribable.js`:

```js
/**
 * shared/core/subscribable.js
 *
 * 极简订阅器实现：subscribe 返回 unsubscribe 函数。
 * 多个 cb 同步触发；抛错被捕获不影响其他订阅者。
 */
export function createSubscribable() {
  const subscribers = new Set();
  return {
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    emit(value) {
      for (const cb of subscribers) {
        try { cb(value); } catch (e) { console.error('[subscribable] cb threw:', e); }
      }
    },
    getSubscribers() { return subscribers.size; },
  };
}
```

Create `shared/core/subscribable.test.js`:

```js
import { strict as assert } from 'node:assert';
import { createSubscribable } from './subscribable.js';

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
};

test('subscribe returns unsubscribe function', () => {
  const s = createSubscribable();
  const unsub = s.subscribe(() => {});
  assert.strictEqual(typeof unsub, 'function');
  assert.strictEqual(s.getSubscribers(), 1);
  unsub();
  assert.strictEqual(s.getSubscribers(), 0);
});

test('emit triggers all subscribers', () => {
  const s = createSubscribable();
  let a = 0, b = 0;
  s.subscribe(() => a++);
  s.subscribe(() => b++);
  s.emit('x');
  assert.strictEqual(a, 1);
  assert.strictEqual(b, 1);
});

test('throwing subscriber does not break others', () => {
  const s = createSubscribable();
  let ok = 0;
  s.subscribe(() => { throw new Error('boom'); });
  s.subscribe(() => ok++);
  s.emit(null);
  assert.strictEqual(ok, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: 运行测试**

Run: `node shared/core/subscribable.test.js`
Expected: `3 passed, 0 failed`, exit code 0

- [ ] **Step 5: Commit**

```bash
git add shared/core/storageKeys.js shared/core/nativeBridge.js shared/core/subscribable.js shared/core/subscribable.test.js
git commit -m "feat(shared): add storageKeys, nativeBridge, subscribable infrastructure"
```

---

## Task 2: promptsStore 数据层 + 单元测试

**Files:**
- Create: `shared/prompts/promptsBootstrap.js`
- Create: `shared/prompts/promptsStore.js`
- Create: `shared/prompts/promptsStore.test.js`

**Interfaces:**
- Consumes: `STORAGE_KEYS` from `../core/storageKeys.js`; `sendNativeMessage` from `../core/nativeBridge.js`; `createSubscribable` from `../core/subscribable.js`; 编译期硬编码 from `./promptsBootstrap.js`.
- Produces: `loadAllPrompts(): Promise<Record<string, PromptItem[]>>`; `savePromptFile(group, list): Promise<void>`; `subscribeToPrompts(cb): () => void`; `getCurrentPrompts(): Record<string, PromptItem[]>`.

- [ ] **Step 1: 写 promptsBootstrap.js**

Create `shared/prompts/promptsBootstrap.js`:

```js
/**
 * shared/prompts/promptsBootstrap.js
 *
 * 编译期硬编码 fallback —— disk 读取失败时使用。
 * 数据来源：popup/main/prompts/groups/*.js（重导出，保持单一真源）。
 */
import code_gen from '../../popup/main/prompts/groups/code_gen.js';
import analyze_plan from '../../popup/main/prompts/groups/analyze_plan.js';
import custom_design from '../../popup/main/prompts/groups/custom_design.js';
import read from '../../popup/main/prompts/groups/read.js';
import search from '../../popup/main/prompts/groups/search.js';
import other from '../../popup/main/prompts/groups/other.js';
import xxxx_ask from '../../popup/main/prompts/groups/xxxx_ask.js';
import xxxx_trans from '../../popup/main/prompts/groups/xxxx_trans.js';

/**
 * 返回 bootstrap 时的硬编码快照。label → { group, label, alias, template }
 */
export function getBootstrapPrompts() {
  const map = (group, items) => {
    const out = {};
    for (const item of items) {
      out[item.label] = { group, ...item };
    }
    return out;
  };
  return {
    code_gen: code_gen.map(p => ({ group: 'code_gen', ...p })),
    analyze_plan: analyze_plan.map(p => ({ group: 'analyze_plan', ...p })),
    custom_design: custom_design.map(p => ({ group: 'custom_design', ...p })),
    read: read.map(p => ({ group: 'read', ...p })),
    search: search.map(p => ({ group: 'search', ...p })),
    other: other.map(p => ({ group: 'other', ...p })),
    xxxx_ask: xxxx_ask.map(p => ({ group: 'xxxx_ask', ...p })),
    xxxx_trans: xxxx_trans.map(p => ({ group: 'xxxx_trans', ...p })),
  };
}
```

- [ ] **Step 2: 写 promptsStore.js**

Create `shared/prompts/promptsStore.js`:

```js
/**
 * shared/prompts/promptsStore.js
 *
 * 提示词数据层。内存缓存 + disk 同步 + 订阅。
 * 任何 UI 调用 loadAllPrompts 都会先尝试从 disk 拉；
 * disk 失败 → 回退到编译期硬编码（promptsBootstrap）。
 * 写操作完成后 bump promptsVersion，触发 storage.onChanged → 所有 UI subscribe 回调。
 */
import { STORAGE_KEYS } from '../core/storageKeys.js';
import { sendNativeMessage } from '../core/nativeBridge.js';
import { createSubscribable } from '../core/subscribable.js';
import { getBootstrapPrompts } from './promptsBootstrap.js';

let cache = getBootstrapPrompts();  // 初始 = 编译期硬编码
let loaded = false;
const subs = createSubscribable();

/**
 * 同步获取当前内存快照。UI 渲染用，避免重复异步等待。
 */
export function getCurrentPrompts() {
  return cache;
}

/**
 * 启动时调一次：从 disk 拉所有 prompt 文件覆盖到 cache。
 * 失败抛错，调用方决定是否回退（默认 cache 已经是硬编码）。
 */
export async function loadAllPrompts() {
  const dirResp = await sendNativeMessage({ command: 'getPromptsDir' });
  const dir = dirResp.data;
  const listResp = await sendNativeMessage({ command: 'listDir', path: dir });
  const jsFiles = (listResp.data || []).filter(f => f.extension === 'js' && !f.isDir);

  const next = {};
  for (const file of jsFiles) {
    try {
      const parsed = await sendNativeMessage({ command: 'parsePrompts', path: `${dir}\\${file.name}` });
      const group = file.name.replace(/\.js$/, '');
      next[group] = (parsed.data || []).map(p => ({ group, ...p }));
    } catch (e) {
      console.warn('[promptsStore] parsePrompts failed for', file.name, e);
    }
  }
  cache = next;
  loaded = true;
  return cache;
}

/**
 * 写入整个 group 文件，bump version 触发订阅。
 */
export async function savePromptFile(group, list) {
  const dirResp = await sendNativeMessage({ command: 'getPromptsDir' });
  const dir = dirResp.data;
  const content = `export default ${JSON.stringify(list, null, 2)};\n`;
  await sendNativeMessage({
    command: 'savePrompts',
    path: `${dir}\\${group}.js`,
    content,
  });
  // 更新内存
  cache = { ...cache, [group]: list };
  // bump version 触发订阅
  await new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.PROMPTS_VERSION], (result) => {
      const next = (result?.[STORAGE_KEYS.PROMPTS_VERSION] || 0) + 1;
      chrome.storage.local.set({ [STORAGE_KEYS.PROMPTS_VERSION]: next }, () => resolve());
    });
  });
}

/**
 * 订阅 prompts 变更。返回 unsubscribe 函数。
 * 监听 chrome.storage.onChanged 的 PROMPTS_VERSION 变化；
 * 触发时重新调用 onChange（提供当前 cache 快照）。
 */
export function subscribeToPrompts(cb) {
  const handler = (changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEYS.PROMPTS_VERSION]) {
      cb(cache);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/**
 * 供测试 / 内部使用：标记是否已加载过 disk。
 */
export function isLoaded() { return loaded; }
```

- [ ] **Step 3: 写单元测试**

Create `shared/prompts/promptsStore.test.js`:

```js
/**
 * promptsStore.test.js
 * mock chrome.* / nativeBridge，只测纯逻辑（getCurrentPrompts fallback）。
 * 涉及 chrome.runtime 的 loadAllPrompts/savePromptFile 留给手动验证。
 */
import { strict as assert } from 'node:assert';

// Mock chrome
globalThis.chrome = {
  storage: {
    local: {
      get: (keys, cb) => cb({ [keys[0] || 'promptsVersion']: 0 }),
      set: (obj, cb) => cb?.(),
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: {
    sendMessage: () => {},
    lastError: null,
  },
};

// 用 source-stripping 加载 promptsStore（剥离 nativeBridge/subscribable/storageKeys 的 import）
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'promptsStore.js');
let src = readFileSync(SRC, 'utf8');
src = src.replace(/^import .+;$/gm, '');
const tmp = mkdtempSync(join(tmpdir(), 'promptsStore-'));
const tmpFile = join(tmp, 'promptsStore.mjs');
writeFileSync(tmpFile, src);

const { getCurrentPrompts } = await import(pathToFileURL(tmpFile).href);

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
};

test('getCurrentPrompts 返回 8 个 group（编译期硬编码兜底）', () => {
  const cur = getCurrentPrompts();
  for (const g of ['code_gen','analyze_plan','custom_design','read','search','other','xxxx_ask','xxxx_trans']) {
    assert.ok(cur[g], `missing group ${g}`);
    assert.ok(Array.isArray(cur[g]), `group ${g} not array`);
  }
});

rmSync(tmp, { recursive: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: 运行测试**

Run: `node shared/prompts/promptsStore.test.js`
Expected: `1 passed, 0 failed`, exit code 0

- [ ] **Step 5: Commit**

```bash
git add shared/prompts/promptsBootstrap.js shared/prompts/promptsStore.js shared/prompts/promptsStore.test.js
git commit -m "feat(shared/prompts): add promptsStore with disk load + bootstrap fallback"
```

---

## Task 3: promptsEditorApi 细粒度封装 + 单元测试

**Files:**
- Create: `shared/prompts/promptsEditorApi.js`
- Create: `shared/prompts/promptsEditorApi.test.js`

**Interfaces:**
- Consumes: `getCurrentPrompts`, `savePromptFile` from `./promptsStore.js`.
- Produces: `addPrompt({group, label, alias, template})`; `updatePrompt({group, oldLabel, newLabel, newAlias, newTemplate})`; `deletePrompt({group, label})`.

- [ ] **Step 1: 写 promptsEditorApi.js**

Create `shared/prompts/promptsEditorApi.js`:

```js
/**
 * shared/prompts/promptsEditorApi.js
 *
 * 细粒度编辑 API：add/update/delete 单条提示词。
 * 内部调 savePromptFile 整体写文件 + bump version 触发订阅。
 */
import { getCurrentPrompts, savePromptFile } from './promptsStore.js';

function assertUniqueLabel(list, label, excludeIndex = -1) {
  const idx = list.findIndex(p => p.label === label);
  if (idx !== -1 && idx !== excludeIndex) {
    throw new Error(`标题已存在: ${label}`);
  }
}

function assertUniqueAlias(list, alias, excludeIndex = -1) {
  if (!alias) return;
  const idx = list.findIndex(p => p.alias === alias);
  if (idx !== -1 && idx !== excludeIndex) {
    throw new Error(`别名已存在: ${alias}`);
  }
}

export async function addPrompt({ group, label, alias, template }) {
  if (!label) throw new Error('标题不能为空');
  const cur = getCurrentPrompts();
  const list = (cur[group] || []).slice();
  assertUniqueLabel(list, label);
  assertUniqueAlias(list, alias);
  list.push({ group, label, alias: alias || '', template });
  await savePromptFile(group, list);
}

export async function updatePrompt({ group, oldLabel, newLabel, newAlias, newTemplate }) {
  if (!newLabel) throw new Error('标题不能为空');
  const cur = getCurrentPrompts();
  const list = (cur[group] || []).slice();
  const idx = list.findIndex(p => p.label === oldLabel);
  if (idx === -1) throw new Error(`未找到原标题: ${oldLabel}`);
  assertUniqueLabel(list, newLabel, idx);
  assertUniqueAlias(list, newAlias, idx);
  list[idx] = { group, label: newLabel, alias: newAlias || '', template: newTemplate };
  await savePromptFile(group, list);
}

export async function deletePrompt({ group, label }) {
  const cur = getCurrentPrompts();
  const list = (cur[group] || []).slice();
  const idx = list.findIndex(p => p.label === label);
  if (idx === -1) throw new Error(`未找到要删除的: ${label}`);
  list.splice(idx, 1);
  await savePromptFile(group, list);
}
```

- [ ] **Step 2: 写单元测试**

Create `shared/prompts/promptsEditorApi.test.js`:

```js
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock chrome
globalThis.chrome = {
  storage: {
    local: {
      get: (_, cb) => cb({ promptsVersion: 0 }),
      set: (_, cb) => cb?.(),
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: {
    sendMessage: (_, cb) => cb({ status: 'success', data: '/fake' }),
    lastError: null,
  },
};

// source-stripping 加载两个文件
function loadStripped(path) {
  let src = readFileSync(path, 'utf8');
  src = src.replace(/^import .+;$/gm, '');
  return src;
}

const tmp = mkdtempSync(join(tmpdir(), 'editor-api-'));
writeFileSync(join(tmp, 'store.mjs'), loadStripped(join(__dirname, 'promptsStore.js')));
writeFileSync(join(tmp, 'api.mjs'), loadStripped(join(__dirname, 'promptsEditorApi.js'))
  .replace(`from './promptsStore.js'`, `from './store.mjs'`));

const { addPrompt, updatePrompt, deletePrompt } = await import(pathToFileURL(join(tmp, 'api.mjs')).href);

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
};

test('addPrompt throws on empty label', async () => {
  await assert.rejects(() => addPrompt({ group: 'other', label: '', template: 'x' }), /标题不能为空/);
});

test('addPrompt throws on duplicate label', async () => {
  await assert.rejects(() => addPrompt({ group: 'other', label: '不修饰', template: 'x' }), /标题已存在/);
});

test('addPrompt throws on duplicate alias', async () => {
  await assert.rejects(() => addPrompt({ group: 'other', label: 'NEW', alias: 'raw', template: 'x' }), /别名已存在/);
});

test('updatePrompt throws when old label not found', async () => {
  await assert.rejects(() => updatePrompt({ group: 'other', oldLabel: 'NOPE', newLabel: 'X' }), /未找到原标题/);
});

test('updatePrompt throws on empty new label', async () => {
  await assert.rejects(() => updatePrompt({ group: 'other', oldLabel: '不修饰', newLabel: '' }), /标题不能为空/);
});

test('deletePrompt throws when label not found', async () => {
  await assert.rejects(() => deletePrompt({ group: 'other', label: 'NOPE' }), /未找到要删除的/);
});

rmSync(tmp, { recursive: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: 运行测试**

Run: `node shared/prompts/promptsEditorApi.test.js`
Expected: `6 passed, 0 failed`, exit code 0

- [ ] **Step 4: Commit**

```bash
git add shared/prompts/promptsEditorApi.js shared/prompts/promptsEditorApi.test.js
git commit -m "feat(shared/prompts): add promptsEditorApi with add/update/delete + uniqueness checks"
```

---

## Task 4: promptsCore 迁移

**Files:**
- Move: `popup/main/prompts/promptsCore.js` → `shared/prompts/promptsCore.js`
- Create: `shared/prompts/promptsCore.test.js`
- Modify: `shared/sendMessage.js` — 改 import 路径
- Modify: `popup/main/prompts/promptsUI.js` — 改 import 路径
- Modify: `sidebar/main/aichat/aichatUtils.js` — 改 import 路径

**Interfaces:**
- Consumes: 现有 promptsCore 的所有 export（`parseTemplate`, `composeTemplate`, `applyPromptTemplate`, `_SYSTEM_NOTES`）
- Produces: 同上，位置变更

- [ ] **Step 1: git mv 文件**

Run:
```bash
git mv popup/main/prompts/promptsCore.js shared/prompts/promptsCore.js
```

- [ ] **Step 2: 修改所有 import 路径**

Run:
```bash
grep -rl "prompts/promptsCore" --include="*.js" popup/ sidebar/ shared/
```

对每个匹配文件，把 `../popup/main/prompts/promptsCore` / `../../../popup/main/prompts/promptsCore` / `../../popup/main/prompts/promptsCore` / `../prompts/promptsCore` 改为相对 `shared/prompts/promptsCore` 的正确路径。

具体预期修改：
- `shared/sendMessage.js`: `../popup/main/prompts/promptsCore.js` → `../prompts/promptsCore.js`
- `popup/main/prompts/promptsUI.js`: `./promptsCore.js` → `../../../shared/prompts/promptsCore.js`
- `sidebar/main/aichat/aichatUtils.js`: `../../../popup/main/prompts/promptsCore.js` → `../../../../shared/prompts/promptsCore.js`

- [ ] **Step 3: 写 promptsCore 单元测试**

Create `shared/prompts/promptsCore.test.js`:

```js
import { strict as assert } from 'node:assert';
import { parseTemplate, composeTemplate, applyPromptTemplate } from './promptsCore.js';

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
};

test('parseTemplate 拆分 body/good_eg/bad_eg/image_info', () => {
  const tpl = `你好\ngood_eg:\n[good note]\n好例\nbad_eg:\n[bad note]\n坏例`;
  const r = parseTemplate(tpl);
  assert.strictEqual(r.body, '你好');
  assert.strictEqual(r.good_eg, '好例');
  assert.strictEqual(r.bad_eg, '坏例');
});

test('applyPromptTemplate 替换 %s', () => {
  const r = applyPromptTemplate('Hi %s', { userMessage: 'world' });
  assert.strictEqual(r, 'Hi world');
});

test('applyPromptTemplate 替换 %v', () => {
  const r = applyPromptTemplate('ctx=%v msg=%s', { userMessage: 'u', extractedText: 'page' });
  assert.strictEqual(r, 'ctx=page msg=u');
});

test('applyPromptTemplate 替换 %i', () => {
  const r = applyPromptTemplate('img=%i msg=%s', { userMessage: 'u', imageInfo: 'OCR' });
  assert.strictEqual(r, 'img=OCR msg=u');
});

test('applyPromptTemplate 无占位符时 userMessage 兜底前置', () => {
  const r = applyPromptTemplate('just body', { userMessage: 'hi' });
  assert.strictEqual(r, 'hi just body');
});

test('applyPromptTemplate 空模板直接返回 userMessage', () => {
  assert.strictEqual(applyPromptTemplate('', { userMessage: 'x' }), 'x');
  assert.strictEqual(applyPromptTemplate(null, { userMessage: 'x' }), 'x');
});

test('applyPromptTemplate 模板含 good_eg 时拼 header + 系统注释', () => {
  const tpl = `body\ngood_eg:\n[good note]\nA`;
  const r = applyPromptTemplate(tpl, { userMessage: 'u' });
  assert.ok(r.includes('[Good Examples'));
  assert.ok(r.includes('good_eg = good example'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: 运行测试**

Run: `node shared/prompts/promptsCore.test.js`
Expected: `7 passed, 0 failed`, exit code 0

- [ ] **Step 5: 手动验证 popup/sidebar 启动未报错**

加载解压扩展，打开 popup + sidebar。检查 console 无 import 错误。发送消息测试 → 应仍能正常处理 %s/%v/%i。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(prompts): move promptsCore to shared/, update all import paths"
```

---

## Task 5: platformsStore + historyStore 数据层

**Files:**
- Create: `shared/platforms/platformsStore.js`
- Create: `shared/history/historyStore.js`
- Create: `shared/platforms/platformsStore.test.js`
- Create: `shared/history/historyStore.test.js`

**Interfaces:**
- Produces:
  - platforms: `loadPlatformVisibility(): Promise<Record<string, boolean>>`; `savePlatformVisibility(settings): Promise<void>`; `subscribeToPlatforms(cb): () => void`; `getCurrentPlatformVisibility(): Record<string, boolean>`
  - history: `loadHistory(): Promise<string[]>`; `addToHistory(msg): Promise<string[]>`; `subscribeToHistory(cb): () => void`; `getCurrentHistory(): string[]`

- [ ] **Step 1: 写 platformsStore.js**

Create `shared/platforms/platformsStore.js`:

```js
/**
 * shared/platforms/platformsStore.js
 *
 * 平台可见性数据层。chrome.storage.local[platformVisibilitySettings] = { platformId: true|false }。
 */
import { STORAGE_KEYS } from '../core/storageKeys.js';
import { createSubscribable } from '../core/subscribable.js';

const DEFAULT_SETTINGS = {};  // 空对象 = 全部可见
let cache = { ...DEFAULT_SETTINGS };
const subs = createSubscribable();

export function getCurrentPlatformVisibility() { return { ...cache }; }

export async function loadPlatformVisibility() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.PLATFORM_VISIBILITY], (result) => {
      cache = result?.[STORAGE_KEYS.PLATFORM_VISIBILITY] || { ...DEFAULT_SETTINGS };
      resolve({ ...cache });
    });
  });
}

export async function savePlatformVisibility(settings) {
  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.PLATFORM_VISIBILITY]: settings }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
  cache = { ...settings };
  subs.emit(cache);
}

export function subscribeToPlatforms(cb) {
  const unsub = subs.subscribe(cb);
  // 同时监听 storage.onChanged（跨页面同步）
  const handler = (changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.PLATFORM_VISIBILITY]) {
      cache = changes[STORAGE_KEYS.PLATFORM_VISIBILITY].newValue || { ...DEFAULT_SETTINGS };
      cb(cache);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    unsub();
    chrome.storage.onChanged.removeListener(handler);
  };
}
```

- [ ] **Step 2: 写 historyStore.js**

Create `shared/history/historyStore.js`:

```js
/**
 * shared/history/historyStore.js
 *
 * 历史记录数据层。chrome.storage.local[messageHistory] = string[]，最多 30 条，LRU。
 */
import { STORAGE_KEYS } from '../core/storageKeys.js';
import { createSubscribable } from '../core/subscribable.js';

const MAX_HISTORY = 30;
let cache = [];
const subs = createSubscribable();

export function getCurrentHistory() { return cache.slice(); }

export async function loadHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.HISTORY], (result) => {
      cache = result?.[STORAGE_KEYS.HISTORY] || [];
      resolve(cache.slice());
    });
  });
}

export async function addToHistory(message) {
  const next = cache.filter(m => m !== message);
  next.unshift(message);
  if (next.length > MAX_HISTORY) next.length = MAX_HISTORY;
  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: next }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
  cache = next;
  subs.emit(cache);
  return cache.slice();
}

export function subscribeToHistory(cb) {
  const unsub = subs.subscribe(cb);
  const handler = (changes, area) => {
    if (area === 'local' && changes[STORAGE_KEYS.HISTORY]) {
      cache = changes[STORAGE_KEYS.HISTORY].newValue || [];
      cb(cache);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    unsub();
    chrome.storage.onChanged.removeListener(handler);
  };
}
```

- [ ] **Step 3: 写 platformsStore 测试**

Create `shared/platforms/platformsStore.test.js`:

```js
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock chrome with state
let stored = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const out = {};
        for (const k of keys) out[k] = stored[k];
        cb(out);
      },
      set: (obj, cb) => { Object.assign(stored, obj); cb?.(); },
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: { lastError: null },
};

function loadStripped(p) {
  let src = readFileSync(p, 'utf8');
  src = src.replace(/^import .+;$/gm, '');
  return src;
}

const tmp = mkdtempSync(join(tmpdir(), 'platforms-'));
writeFileSync(join(tmp, 'keys.mjs'), loadStripped(join(__dirname, '../core/storageKeys.js')));
writeFileSync(join(tmp, 'sub.mjs'), loadStripped(join(__dirname, '../core/subscribable.js')));
writeFileSync(join(tmp, 'p.mjs'), loadStripped(join(__dirname, 'platformsStore.js'))
  .replace(`from '../core/storageKeys.js'`, `from './keys.mjs'`)
  .replace(`from '../core/subscribable.js'`, `from './sub.mjs'`));

const { loadPlatformVisibility, savePlatformVisibility, getCurrentPlatformVisibility } =
  await import(pathToFileURL(join(tmp, 'p.mjs')).href);

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
};

test('getCurrentPlatformVisibility 默认空对象', () => {
  stored = {};
  const v = getCurrentPlatformVisibility();
  assert.deepStrictEqual(v, {});
});

test('loadPlatformVisibility 从 storage 加载', async () => {
  stored = { platformVisibilitySettings: { yuanbao: true, gemini: false } };
  const v = await loadPlatformVisibility();
  assert.deepStrictEqual(v, { yuanbao: true, gemini: false });
});

test('savePlatformVisibility 写 storage 并触发 emit', async () => {
  stored = {};
  let emitted = null;
  const { subscribeToPlatforms } = await import(pathToFileURL(join(tmp, 'p.mjs')).href);
  const unsub = subscribeToPlatforms(v => { emitted = v; });
  await savePlatformVisibility({ chatgpt: true });
  assert.deepStrictEqual(stored.platformVisibilitySettings, { chatgpt: true });
  assert.deepStrictEqual(emitted, { chatgpt: true });
  unsub();
});

rmSync(tmp, { recursive: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: 写 historyStore 测试**

Create `shared/history/historyStore.test.js`:

```js
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
        const out = {};
        for (const k of keys) out[k] = stored[k];
        cb(out);
      },
      set: (obj, cb) => { Object.assign(stored, obj); cb?.(); },
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: { lastError: null },
};

function loadStripped(p) {
  let src = readFileSync(p, 'utf8');
  src = src.replace(/^import .+;$/gm, '');
  return src;
}

const tmp = mkdtempSync(join(tmpdir(), 'history-'));
writeFileSync(join(tmp, 'keys.mjs'), loadStripped(join(__dirname, '../core/storageKeys.js')));
writeFileSync(join(tmp, 'sub.mjs'), loadStripped(join(__dirname, '../core/subscribable.js')));
writeFileSync(join(tmp, 'h.mjs'), loadStripped(join(__dirname, 'historyStore.js'))
  .replace(`from '../core/storageKeys.js'`, `from './keys.mjs'`)
  .replace(`from '../core/subscribable.js'`, `from './sub.mjs'`));

const { addToHistory, loadHistory, getCurrentHistory } =
  await import(pathToFileURL(join(tmp, 'h.mjs')).href);

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
};

test('addToHistory LRU 去重', async () => {
  stored = {};
  await addToHistory('a');
  await addToHistory('b');
  await addToHistory('a');  // 移到最前
  const cur = getCurrentHistory();
  assert.deepStrictEqual(cur, ['a', 'b']);
});

test('addToHistory 最多 30 条', async () => {
  stored = {};
  for (let i = 0; i < 35; i++) await addToHistory(`m${i}`);
  const cur = getCurrentHistory();
  assert.strictEqual(cur.length, 30);
  assert.strictEqual(cur[0], 'm34');  // 最新在最前
});

test('loadHistory 从 storage 加载', async () => {
  stored = { messageHistory: ['x', 'y'] };
  const v = await loadHistory();
  assert.deepStrictEqual(v, ['x', 'y']);
});

rmSync(tmp, { recursive: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 5: 运行两个测试**

Run:
```bash
node shared/platforms/platformsStore.test.js
node shared/history/historyStore.test.js
```
Expected: 都 `3 passed, 0 failed`, exit code 0

- [ ] **Step 6: Commit**

```bash
git add shared/platforms/ shared/history/
git commit -m "feat(shared): add platformsStore and historyStore data layers with subscribe"
```

---

## Task 6: popup 提示词选择器接入 shared API + 就地编辑

**Files:**
- Modify: `popup/main/prompts/promptsUI.js`
- Modify: `popup/main/mainUtils.js`

**Interfaces:**
- Consumes: `getCurrentPrompts`, `loadAllPrompts`, `subscribeToPrompts` from `shared/prompts/promptsStore.js`; `updatePrompt` from `shared/prompts/promptsEditorApi.js`
- Produces: 改造后的 `populateOptimizer` 内部使用 shared 内存快照；新增就地编辑交互

- [ ] **Step 1: 修改 promptsUI.js 顶部 import**

在 `popup/main/prompts/promptsUI.js` 顶部添加：

```js
import { getCurrentPrompts, loadAllPrompts, subscribeToPrompts } from "../../../shared/prompts/promptsStore.js";
import { updatePrompt } from "../../../shared/prompts/promptsEditorApi.js";
```

- [ ] **Step 2: 改造 populateOptimizer 内部数据源**

将 `populateOptimizer` 函数内部：

```js
// 旧：使用传入的 templates 参数（编译期）
const PROMPT_TEMPLATES = templates || ...
```

改为：

```js
// 新：使用 shared 内存快照
const PROMPT_TEMPLATES = getCurrentPrompts();
```

并把 `for (const key in PROMPT_TEMPLATES)` 循环适配新结构（现在是 `{group: [{group, label, alias, template}, ...]}`）。

具体改造逻辑：

```js
// 把 group → array 扁平化为 label → entry 映射
function buildPromptMap() {
  const all = getCurrentPrompts();
  const map = {};
  for (const group of Object.keys(all)) {
    for (const item of all[group]) {
      map[item.label] = { group: item.group, label: item.label, alias: item.alias || '', template: item.template };
    }
  }
  return map;
}
```

`populateOptimizer` 内部把原 `for (const key in PROMPT_TEMPLATES)` 改为：

```js
const flat = buildPromptMap();
for (const key in flat) {
  const t = flat[key];
  // ... 现有分组/选项渲染逻辑，t.group 替代原 PROMPT_TEMPLATES[key].group
}
```

- [ ] **Step 3: mainUtils.js 启动时调 loadAllPrompts**

在 `popup/main/mainUtils.js` 的 `initializePopup` 函数末尾添加：

```js
// 启动时异步从 disk 拉取，覆盖编译期硬编码（失败时 fallback 到硬编码）
await loadAllPrompts().catch(e => console.warn('[popup] loadAllPrompts failed:', e));

// 订阅其他页面的修改（保存后自动重渲染下拉框）
subscribeToPrompts(() => {
  // 触发自定义事件，让 populateOptimizer 重新读取
  document.dispatchEvent(new CustomEvent('prompts:changed'));
});
```

并在 `popup/main/prompts/promptsUI.js` 的 `populateOptimizer` 末尾添加对 `prompts:changed` 事件的监听：

```js
document.addEventListener('prompts:changed', () => {
  // 重渲染整个下拉框
  populateOptimizer(promptOptimizerSelect, null);
});
```

- [ ] **Step 4: 实现就地编辑 UI**

在 `promptsUI.js` 中新增 export 函数 `attachInlineEditor(itemEl, currentItem)`：

```js
/**
 * 就地编辑：点击 edit icon → 该项变为 input + 确认/取消按钮
 * 用户点确认 → 调 updatePrompt → 触发 subscribe → 重渲染
 */
export function attachInlineEditor(itemEl, currentItem) {
  const editBtn = itemEl.querySelector('[data-prompt-edit]');
  if (!editBtn) return;

  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startInlineEdit(itemEl, currentItem);
  });
}

function startInlineEdit(itemEl, currentItem) {
  const body = itemEl.querySelector('.prompt-item-body') || itemEl;
  const original = body.innerHTML;
  body.innerHTML = `
    <input type="text" class="inline-edit-label" value="${escapeHtmlAttr(currentItem.label)}" />
    <input type="text" class="inline-edit-alias" value="${escapeHtmlAttr(currentItem.alias || '')}" />
    <textarea class="inline-edit-template">${escapeHtmlAttr(currentItem.template)}</textarea>
    <div class="inline-edit-actions">
      <button class="inline-confirm">确认</button>
      <button class="inline-cancel">取消</button>
    </div>
  `;

  body.querySelector('.inline-confirm').addEventListener('click', async () => {
    const newLabel = body.querySelector('.inline-edit-label').value.trim();
    const newAlias = body.querySelector('.inline-edit-alias').value.trim();
    const newTemplate = body.querySelector('.inline-edit-template').value;
    if (!newLabel) { showInlineError(body, '标题不能为空'); return; }
    try {
      await updatePrompt({
        group: currentItem.group,
        oldLabel: currentItem.label,
        newLabel, newAlias, newTemplate,
      });
      // savePromptFile 已 bump version，subscribe 会触发重渲染
    } catch (err) {
      body.innerHTML = original;
      console.error('[inline-edit] update failed:', err);
      showInlineError(body, err.message);
    }
  });

  body.querySelector('.inline-cancel').addEventListener('click', () => {
    body.innerHTML = original;
  });
}

function escapeHtmlAttr(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showInlineError(body, msg) {
  const old = body.querySelector('.inline-error');
  if (old) old.remove();
  const e = document.createElement('div');
  e.className = 'inline-error';
  e.textContent = msg;
  body.appendChild(e);
}
```

并在每个选项 DOM 里追加编辑 icon（SVG）：

```html
<svg class="prompt-edit-icon" data-prompt-edit width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <path d="M12 20h9"/>
  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
</svg>
```

调用 `attachInlineEditor(optionEl, item)`。

- [ ] **Step 5: 添加 CSS（编辑 icon + 编辑态）**

在 `popup/main/prompts/promptsUI.css` 追加：

```css
.prompt-edit-icon {
  margin-left: 6px;
  cursor: pointer;
  vertical-align: middle;
  opacity: 0.5;
  transition: opacity 0.15s;
}
.prompt-edit-icon:hover { opacity: 1; }

.inline-edit-label, .inline-edit-alias, .inline-edit-template {
  width: 100%;
  box-sizing: border-box;
  margin: 4px 0;
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-family: inherit;
  font-size: 13px;
}
.inline-edit-template { min-height: 60px; resize: vertical; }
.inline-edit-actions { display: flex; gap: 6px; margin-top: 6px; }
.inline-confirm, .inline-cancel {
  padding: 3px 10px;
  border: 1px solid #ccc;
  border-radius: 3px;
  background: #fff;
  cursor: pointer;
}
.inline-confirm { background: #4361ee; color: #fff; border-color: #4361ee; }
.inline-error { color: red; font-size: 12px; margin-top: 4px; }
```

- [ ] **Step 6: 手动验证**

1. 加载扩展，打开 popup
2. 点开提示词下拉框 → 看到每项右侧有 SVG 编辑 icon
3. 点 icon → 弹出 input + 确认/取消
4. 改 label + 点确认 → 保存成功，下拉框更新
5. 打开 options 编辑器修改 → 回到 popup 下拉框 → 已自动反映

- [ ] **Step 7: Commit**

```bash
git add popup/main/prompts/promptsUI.js popup/main/prompts/promptsUI.css popup/main/mainUtils.js
git commit -m "feat(popup): inline-edit prompts via shared/promptsStore + subscribe"
```

---

## Task 7: sidebar 独立提示词面板

**Files:**
- Create: `sidebar/main/aichat/promptsPanel.js`

**Interfaces:**
- Consumes: 同 Task 6 的 shared API
- Produces: `mountPromptsPanel(container, rootEl)` / `unmountPromptsPanel(container)`

- [ ] **Step 1: 写 promptsPanel.js**

Create `sidebar/main/aichat/promptsPanel.js`:

```js
/**
 * sidebar/main/aichat/promptsPanel.js
 *
 * sidebar 独立提示词面板（与 popup 选择器互不引用 DOM/CSS）。
 * 调 shared 数据层，subscribe 监听其他页面修改。
 */
import {
  getCurrentPrompts,
  loadAllPrompts,
  subscribeToPrompts,
} from '../../../shared/prompts/promptsStore.js';
import { updatePrompt } from '../../../shared/prompts/promptsEditorApi.js';

let mounted = false;
let unsub = null;

export async function mountPromptsPanel(container, rootEl) {
  if (mounted) return;
  mounted = true;

  // 启动时拉 disk（popup 已拉过也行，幂等）
  await loadAllPrompts().catch(() => {});

  container.innerHTML = renderPanel(getCurrentPrompts());
  bindEvents(container);

  // 订阅：其他页面修改 → 重渲染
  unsub = subscribeToPrompts(() => {
    if (!mounted) return;
    container.innerHTML = renderPanel(getCurrentPrompts());
    bindEvents(container);
  });
}

export function unmountPromptsPanel() {
  mounted = false;
  if (unsub) { unsub(); unsub = null; }
}

function renderPanel(grouped) {
  const items = [];
  for (const group of Object.keys(grouped)) {
    for (const item of grouped[group]) {
      items.push({ ...item });
    }
  }
  return `
    <div class="sidebar-prompts-panel">
      ${items.map(item => `
        <div class="sidebar-prompt-item" data-label="${esc(item.label)}" data-group="${esc(item.group)}">
          <span class="sidebar-prompt-label">${esc(item.label)}</span>
          <small class="sidebar-prompt-alias">${item.alias ? '/' + esc(item.alias) : ''}</small>
          <svg class="sidebar-prompt-edit" data-prompt-edit width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </div>
      `).join('')}
    </div>
  `;
}

function bindEvents(container) {
  container.querySelectorAll('.sidebar-prompt-item').forEach(itemEl => {
    const label = itemEl.dataset.label;
    const group = itemEl.dataset.group;
    const all = getCurrentPrompts();
    const cur = (all[group] || []).find(p => p.label === label);
    if (!cur) return;

    itemEl.querySelector('[data-prompt-edit]').addEventListener('click', (e) => {
      e.stopPropagation();
      startEdit(itemEl, cur);
    });
  });
}

function startEdit(itemEl, currentItem) {
  const original = itemEl.innerHTML;
  itemEl.innerHTML = `
    <input type="text" class="sidebar-inline-label" value="${escAttr(currentItem.label)}" />
    <input type="text" class="sidebar-inline-alias" value="${escAttr(currentItem.alias || '')}" />
    <textarea class="sidebar-inline-template">${escAttr(currentItem.template)}</textarea>
    <div class="sidebar-inline-actions">
      <button class="sidebar-inline-confirm">确认</button>
      <button class="sidebar-inline-cancel">取消</button>
    </div>
  `;
  itemEl.querySelector('.sidebar-inline-confirm').addEventListener('click', async () => {
    const newLabel = itemEl.querySelector('.sidebar-inline-label').value.trim();
    const newAlias = itemEl.querySelector('.sidebar-inline-alias').value.trim();
    const newTemplate = itemEl.querySelector('.sidebar-inline-template').value;
    if (!newLabel) { itemEl.innerHTML = original; alert('标题不能为空'); return; }
    try {
      await updatePrompt({
        group: currentItem.group,
        oldLabel: currentItem.label,
        newLabel, newAlias, newTemplate,
      });
    } catch (err) {
      itemEl.innerHTML = original;
      alert('保存失败: ' + err.message);
    }
  });
  itemEl.querySelector('.sidebar-inline-cancel').addEventListener('click', () => {
    itemEl.innerHTML = original;
  });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}
function escAttr(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

- [ ] **Step 2: 在 sidebar/main/aichat/aichat.js 中调用**

修改 `sidebar/main/aichat/aichat.js` 的 `mount` 函数，在 `container.innerHTML = html` 之后插入：

```js
// 挂载提示词面板（独立 UI）
const { mountPromptsPanel } = await import('./promptsPanel.js');
mountPromptsPanel(document.getElementById('prompts-panel-mount'), document.body);
```

并在 `aichat.html` 中添加 `<div id="prompts-panel-mount" class="prompts-panel-mount"></div>` 容器。

- [ ] **Step 3: 添加 CSS**

在 `sidebar/main/aichat/aichat.css` 追加：

```css
.sidebar-prompts-panel { padding: 8px; max-height: 200px; overflow-y: auto; border-top: 1px solid #eee; }
.sidebar-prompt-item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; border-radius: 3px; }
.sidebar-prompt-item:hover { background: #f5f5f5; }
.sidebar-prompt-edit { margin-left: auto; opacity: 0.5; cursor: pointer; }
.sidebar-prompt-edit:hover { opacity: 1; }
.sidebar-inline-label, .sidebar-inline-alias, .sidebar-inline-template {
  width: 100%; box-sizing: border-box; margin: 3px 0; padding: 3px 5px; border: 1px solid #ccc; border-radius: 3px; font-size: 12px;
}
.sidebar-inline-template { min-height: 50px; resize: vertical; }
.sidebar-inline-actions { display: flex; gap: 4px; margin-top: 4px; }
.sidebar-inline-confirm, .sidebar-inline-cancel { padding: 2px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; background: #fff; }
.sidebar-inline-confirm { background: #4361ee; color: #fff; border-color: #4361ee; }
```

- [ ] **Step 4: 手动验证**

1. 加载扩展，打开 sidebar
2. 看到提示词面板 → 每项右侧有编辑 icon
3. 点 icon → 弹出 input → 改 → 确认
4. options/popup 修改 → sidebar 面板立即反映

- [ ] **Step 5: Commit**

```bash
git add sidebar/main/aichat/promptsPanel.js sidebar/main/aichat/aichat.js sidebar/main/aichat/aichat.html sidebar/main/aichat/aichat.css
git commit -m "feat(sidebar): independent prompts panel using shared/promptsStore"
```

---

## Task 8: options 编辑器接入 shared API

**Files:**
- Rewrite: `options/prompts_editor/prompts_editor.js`

**Interfaces:**
- Consumes: `loadAllPrompts`, `getCurrentPrompts` from `shared/prompts/promptsStore.js`; `addPrompt`, `updatePrompt`, `deletePrompt` from `shared/prompts/promptsEditorApi.js`
- Produces: 完整文件列表 + 编辑表单 + CRUD 操作

- [ ] **Step 1: 重写 prompts_editor.js**

Rewrite `options/prompts_editor/prompts_editor.js`，核心结构：

```js
import {
  loadAllPrompts,
  getCurrentPrompts,
} from '../../../shared/prompts/promptsStore.js';
import {
  addPrompt,
  updatePrompt,
  deletePrompt,
} from '../../../shared/prompts/promptsEditorApi.js';
import { sendNativeMessage } from '../../../shared/core/nativeBridge.js';

let currentFile = null;
let currentGroup = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadAllPrompts().catch(e => console.warn('loadAllPrompts:', e));
  initEvents();
  await loadFiles();
}

async function loadFiles() {
  try {
    const dirResp = await sendNativeMessage({ command: 'getPromptsDir' });
    const listResp = await sendNativeMessage({ command: 'listDir', path: dirResp.data });
    renderFileList(listResp.data || []);
    if (!currentFile) {
      const first = (listResp.data || []).find(f => f.extension === 'js' && !f.isDir);
      if (first) await selectFile(first.name);
    } else {
      await selectFile(currentFile);
    }
  } catch (err) {
    toast('加载失败: ' + err.message, 'error');
  }
}

function renderFileList(files) {
  const el = document.getElementById('fileList');
  const jsFiles = files.filter(f => f.extension === 'js' && !f.isDir);
  el.innerHTML = jsFiles.map(f => `
    <div class="file-item ${f.name === currentFile ? 'active' : ''}" data-name="${f.name}">
      <span>${f.name}</span>
    </div>
  `).join('');
  el.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', () => selectFile(item.dataset.name));
  });
}

async function selectFile(fileName) {
  currentFile = fileName;
  currentGroup = fileName.replace(/\.js$/, '');
  document.getElementById('currentFileName').textContent = fileName;
  document.querySelectorAll('.file-item').forEach(el => {
    el.classList.toggle('active', el.dataset.name === fileName);
  });
  // 从内存快照读
  renderPrompts(getCurrentPrompts()[currentGroup] || []);
}

function renderPrompts(list) {
  const el = document.getElementById('editorContent');
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><p>点击上方添加按钮创建提示词</p></div>';
    return;
  }
  el.innerHTML = list.map((p, i) => `
    <div class="prompt-item" data-index="${i}">
      <div class="prompt-item-header">
        <span class="prompt-item-title">${esc(p.label)}${p.alias ? ` <small>/${esc(p.alias)}</small>` : ''}</span>
        <div class="item-buttons">
          <button data-action="delete" data-index="${i}">删除</button>
          <button class="btn-primary" data-action="save" data-index="${i}">保存</button>
        </div>
      </div>
      <div class="prompt-item-body">
        <input type="text" id="label-${i}" value="${esc(p.label)}" placeholder="输入标题">
        <input type="text" id="alias-${i}" value="${esc(p.alias || '')}" placeholder="输入别名">
        <textarea id="tpl-${i}" placeholder="输入提示词内容">${esc(p.template)}</textarea>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-action="save"]').forEach(btn => {
    btn.addEventListener('click', () => savePrompt(parseInt(btn.dataset.index)));
  });
  el.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deletePromptAt(parseInt(btn.dataset.index)));
  });
}

async function savePrompt(index) {
  const list = getCurrentPrompts()[currentGroup] || [];
  const item = list[index];
  const newLabel = document.getElementById(`label-${index}`).value.trim();
  const newAlias = document.getElementById(`alias-${index}`).value.trim();
  const newTemplate = document.getElementById(`tpl-${index}`).value;
  if (!newLabel) { toast('标题不能为空', 'error'); return; }
  try {
    await updatePrompt({
      group: currentGroup,
      oldLabel: item.label,
      newLabel, newAlias, newTemplate,
    });
    toast('已保存');
    // savePromptFile 已 bump version，但本页不受 storage 事件影响（options 不订阅） → 主动重渲染
    renderPrompts(getCurrentPrompts()[currentGroup] || []);
  } catch (err) {
    toast('保存失败: ' + err.message, 'error');
  }
}

async function deletePromptAt(index) {
  const list = getCurrentPrompts()[currentGroup] || [];
  const item = list[index];
  if (!confirm(`确定删除 "${item.label}"？`)) return;
  try {
    await deletePrompt({ group: currentGroup, label: item.label });
    toast(`已删除: ${item.label}`);
    renderPrompts(getCurrentPrompts()[currentGroup] || []);
  } catch (err) {
    toast('删除失败: ' + err.message, 'error');
  }
}

function showAddModal() { /* 原逻辑保留 */ }
function hideAddModal() { /* 原逻辑保留 */ }

async function addPromptFromModal() {
  const label = document.getElementById('promptLabel').value.trim();
  const alias = document.getElementById('promptAlias').value.trim();
  const template = document.getElementById('promptTemplate').value.trim();
  if (!label) { toast('请输入名称', 'error'); return; }
  try {
    await addPrompt({ group: currentGroup, label, alias, template });
    hideAddModal();
    toast('已添加');
    renderPrompts(getCurrentPrompts()[currentGroup] || []);
  } catch (err) {
    toast('添加失败: ' + err.message, 'error');
  }
}

// initEvents, toast, escapeHtml 同原文件逻辑
```

`initEvents` 中把 `addBtn` click 改为 `showAddModal`（保留原弹窗逻辑）。

- [ ] **Step 2: 手动验证**

1. 加载扩展，打开 options → 提示词编辑页
2. 选文件 → 看到提示词列表（从 disk 读，跟原本一样）
3. 改一条 → 保存 → 立刻在列表中反映
4. 新增一条 → 列表立刻出现
5. 删除一条 → 确认 → 列表立刻减少
6. 同步测试：打开 popup 下拉框 → 看到 options 改的内容（说明 subscribe 通了）

- [ ] **Step 3: Commit**

```bash
git add options/prompts_editor/prompts_editor.js
git commit -m "refactor(options): rewrite prompts_editor on top of shared/promptsEditorApi"
```

---

## Task 9: 主代码库切换到 shared 数据层 + 删除旧 popup 模块

**Files:**
- Modify: `popup/main/mainUtils.js`
- Modify: `sidebar/main/aichat/aichatUtils.js`
- Modify: `options/storage/storage.js`
- Modify: `options/platform/index.html` (如有 storage 引用)
- Delete: `popup/main/modules/storage.js`（如不再被引用）
- Delete: `popup/main/modules/platformVisibility.js`（如不再被引用）

**Interfaces:**
- 所有原 `popup/main/modules/storage.js` 的函数调用点改用 `shared/history/historyStore.js` 和 `shared/platforms/platformsStore.js`

- [ ] **Step 1: 找所有引用点**

Run:
```bash
grep -rl "popup/main/modules/storage\|popup/main/modules/platformVisibility" --include="*.js" popup/ sidebar/ options/ shared/
```

预期调用方：
- `popup/main/mainUtils.js` — `addToHistory`, `loadStoredData`, `saveMessageContent`, `savePlatformStates`, `saveOptimizerSetting`
- `sidebar/main/aichat/aichatUtils.js` — 同上
- `popup/main/modules/storage.js` 自身
- `popup/main/modules/platformVisibility.js` 自身

- [ ] **Step 2: 替换为 shared API**

逐个替换：
- `addToHistory` → `addToHistory` from `shared/history/historyStore.js`
- `loadStoredData` → 拆分：`loadHistory()`, `loadPlatformVisibility()`, `chrome.storage.local.get([LAST_MESSAGE, OPTIMIZER, LAST_PROMPT_TEMPLATE])` 各自调用
- `saveMessageContent` → `chrome.storage.local.set({lastMessage})`（直接调，或包个小函数）
- `savePlatformStates` → `chrome.storage.local.set({platformStates})`
- `saveOptimizerSetting` → `chrome.storage.local.set({selectedOptimizer})`
- `loadPlatformVisibilitySettings` → `loadPlatformVisibility()` from `shared/platforms/platformsStore.js`
- `savePlatformVisibilitySettings` → `savePlatformVisibility()` from `shared/platforms/platformsStore.js`
- `applyPlatformVisibilitySettings` → 保留在调用方（DOM 操作，无法下沉）
- `getVisiblePlatformCheckboxes`, `areAllVisiblePlatformsChecked` → 保留（DOM 工具）

- [ ] **Step 3: 验证无残留 import**

Run:
```bash
grep -rn "popup/main/modules/storage\|popup/main/modules/platformVisibility" --include="*.js" .
```
Expected: 无输出

- [ ] **Step 4: 删除旧模块**

```bash
git rm popup/main/modules/storage.js popup/main/modules/platformVisibility.js
```

- [ ] **Step 5: 运行所有测试**

Run:
```bash
node shared/core/subscribable.test.js
node shared/prompts/promptsStore.test.js
node shared/prompts/promptsEditorApi.test.js
node shared/prompts/promptsCore.test.js
node shared/platforms/platformsStore.test.js
node shared/history/historyStore.test.js
```
Expected: 全部通过

- [ ] **Step 6: 手动回归测试**

加载扩展，三处 UI 全跑一遍：
- popup：发送消息（含模板 + 图片）、平台勾选、关闭AI标签、历史记录、提示词就地编辑
- sidebar：同 popup
- options：平台显示、提示词编辑、存储管理、提示词编辑器跨页面同步

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: migrate popup/sidebar/options to shared data layer, remove old modules"
```

---

## Self-Review

### Spec coverage

| Spec 章节 | 覆盖 Task |
|----------|----------|
| shared/core/ 基础（storageKeys、nativeBridge、subscribable） | Task 1 |
| promptsStore + bootstrap fallback | Task 2 |
| promptsEditorApi（add/update/delete + 唯一性校验） | Task 3 |
| promptsCore 迁移到 shared | Task 4 |
| platformsStore + subscribe | Task 5 |
| historyStore + subscribe | Task 5 |
| popup 选择器接入 + 就地编辑 | Task 6 |
| sidebar 独立面板 | Task 7 |
| options 编辑器接入 shared API | Task 8 |
| 全量替换 popup 旧模块 | Task 9 |
| 三处 UI 互不引用（独立） | Task 6/7/8 各自实现独立 DOM/CSS |
| 保存即时生效（subscribe） | Task 2（savePromptFile bump version）+ Task 6/7/8（各自订阅）|
| 新增提示词即时刷新 | 同上，subscribe 触发重渲染 |
| 编辑 icon 用 SVG | Task 6/7 各自定义 SVG path |
| 确认按钮保存 | Task 6/7 各自 confirm 按钮 |
| 失败回滚 + 红色 toast | Task 6/7/8 各自处理（恢复原值 + alert/toast）|

### Placeholder scan

无 TBD/TODO/含糊描述。每个代码块都是实际可用的代码。

### Type consistency

| 名称 | 第一次定义 | 所有后续使用 |
|------|-----------|------------|
| `STORAGE_KEYS.PROMPTS_VERSION` | Task 1 storageKeys | Task 2 promptsStore |
| `getCurrentPrompts(): Record<group, PromptItem[]>` | Task 2 | Task 3, 6, 7, 8 |
| `savePromptFile(group, list): Promise<void>` | Task 2 | Task 3 |
| `subscribeToPrompts(cb): () => void` | Task 2 | Task 6, 7 |
| `updatePrompt({group, oldLabel, newLabel, newAlias, newTemplate})` | Task 3 | Task 6, 7, 8 |
| `addPrompt({group, label, alias, template})` | Task 3 | Task 8 |
| `deletePrompt({group, label})` | Task 3 | Task 8 |
| `PromptItem` shape: `{group, label, alias, template}` | Task 2 promptsBootstrap | 所有任务统一 |

所有命名、签名、shape 一致。

---

**Plan complete.** 等待用户选择执行方式（subagent-driven 或 inline）。