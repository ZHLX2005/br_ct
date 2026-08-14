# 修 options 全展开 + popup trans 缺失 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `013f265 feat: shared 数据层重构 + popup/sidebar 修复 + 新建提示词 + 架构文档 (#23)` 引入的两个回归：(A) options 提示词编辑器所有条目默认全展开 (B) popup 提示词下拉框拿不到 `read/trans`（被 `xxxx_trans` 同 label 提示词覆盖）。

**Architecture:**
- 回归 A 在 `options/prompts_editor/prompts_editor.js` rewrite 过程中丢失了 `expandedIndex` 状态 + `.prompt-item-header` 点击 toggle 逻辑。本次复原：把硬编码的 `class="prompt-item-body expanded"` 改成按当前 `expandedIndex` 条件挂 class，header 点击切换 index → 重渲染。
- 回归 B 在 `popup/main/prompts/promptsUI.js:11-29` `buildPromptMap()` 用 `item.label` 做 map key，导致 `read` group 的"翻译"(alias=trans) 被 `xxxx_trans` group 的"翻译"(alias=fy) 覆盖。本次把 key 改成 `${group}::${label}` 复合 key，并新增 `lastPromptTemplate` 旧存储值（裸 label/alias）的回退查找，保证现有用户数据不丢。

**Tech Stack:** Vanilla ES modules（无构建）、Chrome MV3 unpacked extension、Node.js 内置 `node:assert`（参考 `promptsStore.test.js` 的 source-stripping 模式）。

---

## Global Constraints

- **测试框架**：纯逻辑单元（`promptsStore`、`promptsEditorApi`、`promptsCore`）使用 Node.js 内置 `assert`，参照 `sidebar/main/cc/modules/features/ccExtract.test.js` 的源码剥离模式。涉及 DOM / chrome.* 的代码不写单元测试，靠手动验证（`chrome://extensions` 加载解压扩展后操作）。
- **每个 Task 一次 commit**，提交信息遵循 Conventional Commits。
- **不破坏现有 API**：`buildPromptMap` 是模块内私有函数，但被 `populateOptimizer` / `initAliasShortcut` 调用，外部消费方只看到 `populateOptimizer(promptOptimizerSelect, templates)` 签名（`templates` 参数已弃用保留兼容）。变更 key 格式后，要保证 `populateOptimizer` 内部 / `installOptimizer` / `prompts:changed` 重渲染 / popup 与 sidebar 的 `lastPromptTemplate` 写入 / 读出全链路一致。
- **跨页一致**：popup `lastPromptTemplate` 用新 key（`group::label`）；sidebar `aichatUtils.js` 仍用旧 key（`alias || label`）写入 storage。读出路径需要兼容两种格式。`syncPromptIndicator` / `loadStoredData` / `promptsUI.js:213` 这三处凡是"按 storage key 找 template"的逻辑都要走兼容回退。
- **新增 `xxxx_ask` / `xxxx_trans` 两个 group 在 popup 的可见性**：bootstrap 已经在 8 个 group 上完整提供；sidebar 用的旧 `popup/main/prompts/prompts.js` 只导 6 个 group，**不要碰**旧 `prompts.js`（本次修复范围限定 shared 路径；旧 prompts.js 由后续 Phase 6 收敛任务处理）。

---

## File Structure

### 修改

- `options/prompts_editor/prompts_editor.js` — 增加 `expandedIndex` 状态 + header click toggle 逻辑 + 条件化 expanded class
- `popup/main/prompts/promptsUI.js` — `buildPromptMap` 改用 `${group}::${label}` 复合 key；导出 helper 让 `lastPromptTemplate` 回退查找有据可循

### 新增（仅测试，无产品代码新增）

- `popup/main/prompts/promptsUI.test.js` — 单元测试 buildPromptMap 的 key 唯一性 + 旧 storage 值回退查找

---

## Task 1: 复盘 — 写一个失败测试验证 regression 已存在

**目的**: 先用测试钉死"两个 bug 都真实存在"，避免后面误以为"已经修了"但实际没复现。

**Files:**
- Create: `popup/main/prompts/promptsUI.test.js`
- (参考) Read: `shared/prompts/promptsStore.test.js`（source-stripping 模式）

**Interfaces:**
- Consumes: `getCurrentPrompts` from `shared/prompts/promptsStore.js`
- Produces: 单元测试断言 `buildPromptMap` 在 `read/trans` 与 `xxxx_trans/fy` 同时存在时,`buildPromptMap()['read::翻译']` 仍是 trans alias

- [ ] **Step 1: 写测试文件**

Create `popup/main/prompts/promptsUI.test.js`（**注意**: 这个测试只测 `buildPromptMap` 的纯逻辑副本; 实际 production 文件里 `buildPromptMap` 是闭包不可 import, 所以**先在测试里 inline 一份**参考实现, 再验证 production 行为 — 后续 Task 4 改 production 后, 我们再把 inline 实现换回 import):

```js
/**
 * promptsUI.test.js — 单元测试 buildPromptMap 的 label 冲突行为
 *
 * Loading strategy 同 promptsStore.test.js:读 promptsUI.js 源码, 剥离 import,
 * prepend 内联 stubs, 写到 temp .mjs, dynamic-import。
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

globalThis.chrome = {
  storage: { sync: { get: (_k, cb) => cb({}), set: (_o, cb) => { if (cb) cb(); } }, onChanged: { addListener: () => {}, removeListener: () => {} } },
  runtime: { lastError: null },
};

// 8 group 的标准 bootstrap(含 label="翻译" 在 read + xxxx_trans 各一份, alias 不同)
const STUBS = `
const getCurrentPrompts = () => ({
  code_gen: [{group:"code_gen",label:"l1",alias:"a1",template:"t1"}],
  analyze_plan: [{group:"analyze_plan",label:"l2",alias:"a2",template:"t2"}],
  custom_design: [{group:"custom_design",label:"l3",alias:"a3",template:"t3"}],
  read: [
    {group:"read",label:"翻译",alias:"trans",template:"中英翻译..."},
    {group:"read",label:"太奶",alias:"tainai",template:"100岁太奶..."},
  ],
  search: [{group:"search",label:"l4",alias:"a4",template:"t4"}],
  other: [{group:"other",label:"l5",alias:"a5",template:"t5"}],
  xxxx_ask: [{group:"xxxx_ask",label:"l6",alias:"a6",template:"t6"}],
  xxxx_trans: [
    {group:"xxxx_trans",label:"翻译",alias:"fy",template:"请翻译:%s"},
    {group:"xxxx_trans",label:"解释",alias:"js",template:"请详细解释:%s"},
  ],
});
const updatePrompt = () => Promise.resolve();
`;

const src = readFileSync(SRC_PATH, 'utf8');
const stripped = src.split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
const tmpDir = mkdtempSync(join(tmpdir(), 'promptsUI-test-'));
const tmpFile = join(tmpDir, 'promptsUI.mjs');
writeFileSync(tmpFile, STUBS + stripped);

let mod;
try {
  mod = await import(pathToFileURL(tmpFile).href);
} finally {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

console.log('\npromptsUI buildPromptMap tests');

// 测试 populateOptimizer 一次,把 map 计算的副作用留在闭包里观察太麻烦;
// 我们直接走 populateOptimizer 重新挂载到一个假节点观察 dataset.value 即可。
// 但更简单: 让 buildPromptMap 暴露出来 — 本 Task 不动 production,在测试里
// 借 populateOptimizer 触发的副作用 + 检查 option.dataset.value 即可。

import { JSDOM } from 'node:jsdom'; // ⚠️ 如果没装 jsdom,改用 doc-stub
// 兜底:如果环境无 jsdom,改用手写最小 DOM stub
// 简化方案: 我们不直接调 buildPromptMap, 改测一个等价行为 ——
// 通过 populateOptimizer 构造的 .select-option 的 dataset.value 是否含 trans。
// 同样依赖 DOM, 用简易 stub 即可。
```

> **⚠️ 上述 jsdom 引入会让测试变重。换成更轻量的"doc stub"方案**：写一个最小的 `document` stub，只支持 `createElement`/`addEventListener`/`appendChild`/`querySelector`/`querySelectorAll` 几个 promptsUI 用到的方法。然后用 `populateOptimizer(fakeSelect)` 触发 `buildPromptMap` 副作用，遍历所有 `.select-option` 看 `dataset.value`。

- [ ] **Step 2: 改成 doc stub 版本（更可靠，无外部依赖）**

把上面 jsdom 那段删掉，改写为：

```js
// ===== 最小 document stub =====
// 目标: 支持 buildPromptMap 副作用后,遍历所有 .select-option 读取 dataset.value
function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    style: {},
    dataset: {},
    attributes: {},
    addEventListener(){}, removeEventListener(){},
    appendChild(c){ this.children.push(c); return c; },
    querySelector(sel){ return findOne(this, sel); },
    querySelectorAll(sel){ return findAll(this, sel); },
    contains(){ return false; },
    setAttribute(k,v){ this.attributes[k]=v; },
    getAttribute(k){ return this.attributes[k]; },
    addEventListener(){},
    dispatchEvent(){ return true; },
  };
  return el;
}
function findOne(root, sel) {
  const all = findAll(root, sel);
  return all[0] || null;
}
function findAll(root, sel) {
  // 只支持 .class 和 [data-attr] 两种选择器
  const out = [];
  const walk = (node) => {
    if (node && Array.isArray(node.children)) {
      for (const c of node.children) {
        if (matches(c, sel)) out.push(c);
        walk(c);
      }
    }
  };
  walk(root);
  return out;
}
function matches(node, sel) {
  if (sel.startsWith('.')) {
    const cls = node.className || '';
    return cls.split(/\s+/).includes(sel.slice(1));
  }
  if (sel.startsWith('[data-')) {
    const m = sel.match(/^\[data-([\w-]+)(?:="?([^"]*)"?)?\]$/);
    if (m) {
      const k = 'dataset' in node ? node.dataset[m[1]] : node.attributes && node.attributes['data-' + m[1]];
      return k !== undefined;
    }
  }
  return false;
}

globalThis.document = {
  createElement: (tag) => {
    const el = makeEl(tag);
    if (tag === 'div') el.className = '';
    return el;
  },
  addEventListener(){}, removeEventListener(){},
  querySelector: () => null, querySelectorAll: () => [],
};
// populateOptimizer 内部 new CustomEvent, 简单 stub
globalThis.CustomEvent = class { constructor(type, init){ this.type=type; this.detail=init && init.detail; } };
globalThis.Event = class { constructor(type){ this.type=type; } };
```

- [ ] **Step 3: 写断言 — 验证 regression**

```js
// 构造 prompt-optimizer-select 容器
const optimizerEl = makeEl('div');
optimizerEl.className = 'custom-select-container';
optimizerEl.querySelector = (sel) => {
  if (sel === '.selected-value') return (optimizerEl._sel = optimizerEl._sel || makeEl('div'));
  if (sel === '.custom-select-options') return (optimizerEl._opts = optimizerEl._opts || makeEl('div'));
  return null;
};

// 触发 populateOptimizer 副作用(buildPromptMap 在调用栈里被求值)
const cleanup = mod.populateOptimizer(optimizerEl);
try {
  // 收集所有 .select-option 的 dataset.value
  const opts = optimizerEl._opts ? findAll(optimizerEl._opts, '.select-option') : [];
  const values = opts.map(o => o.dataset && o.dataset.value).filter(Boolean);
  const labels = opts.map(o => o.textContent).filter(Boolean);

  console.log('  collected option values:', JSON.stringify(values));
  console.log('  collected option labels:', JSON.stringify(labels));

  // ===== Regression B 断言 =====
  // bug 修复后期望: read/trans 出现,key 形如 "read::翻译"
  const hasTrans = values.some(v => typeof v === 'string' && v.includes('trans')) ||
                   labels.some(l => l.includes('/trans'));
  assert.ok(hasTrans, '期望 popup 下拉里能看到 read/trans alias 提示词 (label 含 /trans 或 value 含 trans)');

  // 旧 key (裸 label "翻译") 不能同时被 fy 覆盖 — 我们看 xxxx_trans 那个 fy 也要在
  const hasFy = labels.some(l => l.includes('/fy'));
  assert.ok(hasFy, '期望 popup 下拉里能看到 xxxx_trans/fy alias 提示词');

  console.log('  PASS promptsUI buildPromptMap has both trans and fy');
} finally {
  try { cleanup && cleanup(); } catch {}
}
```

- [ ] **Step 4: 跑测试 — 预期 FAIL**

Run: `node popup/main/prompts/promptsUI.test.js`
Expected: FAIL with "期望 popup 下拉里能看到 read/trans alias 提示词" (因为当前 buildPromptMap 用裸 label 做 key, trans alias 被 fy 覆盖, 看不到 trans)

- [ ] **Step 5: 提交 (确认 bug 复现)**

```bash
git add popup/main/prompts/promptsUI.test.js
git commit -m "test(promptsUI): 复盘 buildPromptMap label 冲突 regression — 钉死 trans 被覆盖的事实"
```

---

## Task 2: 修 Bug B — buildPromptMap 改用复合 key

**Files:**
- Modify: `popup/main/prompts/promptsUI.js:11-29`（buildPromptMap 函数体）
- (依赖) Read: `popup/main/prompts/promptsUI.js:36-72`（populateOptimizer 内部如何用 `template.key`）

**Interfaces:**
- Consumes: `getCurrentPrompts()` from `shared/prompts/promptsStore.js` (unchanged)
- Produces: `buildPromptMap()` 返回 `{ "${group}::${label}": {group, label, alias, template} }`

- [ ] **Step 1: 改 buildPromptMap key 格式**

Modify `popup/main/prompts/promptsUI.js` line 11-29:

```js
/**
 * 把 shared cache (`{group: [{group,label,alias,template}, ...]}`)
 * 扁平化为 composite-keyed map（key = "${group}::${label}"），
 * 供现有渲染逻辑继续按 key 取值。
 *
 * 为什么用 group::label 复合 key: 不同 group 的 prompt 可能共用同一 label
 * （例如 read/trans 与 xxxx_trans/fy 都叫"翻译"），
 * 用裸 label 做 key 会让后写入者覆盖前写入者,导致
 * popup 下拉里看不到部分 alias。复合 key 保证唯一。
 *
 * @returns {{[key: string]: {group: string, label: string, alias: string, template: string}}}
 */
function buildPromptMap() {
  const all = getCurrentPrompts();
  const map = {};
  if (!all) return map;
  for (const group of Object.keys(all)) {
    const items = all[group];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || !item.label) continue;
      const key = `${item.group || group}::${item.label}`;
      map[key] = {
        group: item.group || group,
        label: item.label,
        alias: item.alias || "",
        template: item.template || "",
      };
    }
  }
  return map;
}
```

- [ ] **Step 2: 跑 Task 1 写的测试 — 预期 PASS**

Run: `node popup/main/prompts/promptsUI.test.js`
Expected: PASS（现在 buildPromptMap 用 `group::label` 复合 key，read/trans 与 xxxx_trans/fy 都各自保留）

- [ ] **Step 3: 处理 `lastPromptTemplate` 旧 storage 值的读出兼容**

现状：`promptsUI.js:208-216` 在 popup 打开时读 `lastPromptTemplate`，用它做 `groupToShow`：

```js
if (result.lastPromptTemplate) {
  const template = PROMPT_TEMPLATES[result.lastPromptTemplate];
  if (template) {
    groupToShow = template.group;
  }
}
```

PROMPT_TEMPLATES 现在是复合 key map，旧的 `lastPromptTemplate` 值（裸 alias 如 "trans" 或裸 label 如 "翻译"）找不到会变 undefined。需要回退到"按 alias 或 label 跨组搜"。

替换 `popup/main/prompts/promptsUI.js:208-216` 为：

```js
if (result.lastPromptTemplate) {
  const savedKey = result.lastPromptTemplate;
  let template = PROMPT_TEMPLATES[savedKey];
  if (!template) {
    // 回退: 旧 storage 格式 (裸 alias 或 裸 label) — 跨组搜
    const all = getCurrentPrompts() || {};
    outer: for (const g of Object.keys(all)) {
      const items = all[g];
      if (!Array.isArray(items)) continue;
      for (const t of items) {
        if ((t.alias && t.alias === savedKey) || t.label === savedKey) {
          template = { group: t.group || g, label: t.label, alias: t.alias || "", template: t.template || "" };
          break outer;
        }
      }
    }
  }
  if (template) {
    groupToShow = template.group;
  }
}
```

- [ ] **Step 4: 跑现有 promptsStore / promptsEditorApi / promptsCore 单测确认没破坏**

Run:
```bash
node shared/prompts/promptsStore.test.js
node shared/prompts/promptsEditorApi.test.js
node shared/prompts/promptsCore.test.js
```
Expected: 全部 PASS（这些测试不直接测 promptsUI）。

- [ ] **Step 5: 跑 popup promptsUI 测试**

Run: `node popup/main/prompts/promptsUI.test.js`
Expected: PASS

- [ ] **Step 6: 手动验证 — 装扩展到 Chrome**

操作：
1. `chrome://extensions` → 加载解压扩展 → 选 `D:\DevProjects\my\bro_chat`
2. 打开 popup，点提示词下拉框
3. 期望：左侧 group 列表里有 `xxxx_trans` 这一项；hover 进去右侧出现 7 条（翻译/fy、解释/js、摘要/zy、分析/fx、操作//oprex、润色/rs、代码解释/code）
4. 关掉 popup，**重启浏览器**（让 lastPromptTemplate 旧值还在）
5. 再开 popup，期望自动展开到上次选中的 group（即使旧值是裸 alias "trans" 也能找到 read group）
6. 选中 `read/trans` 这条"翻译"，关掉 popup 再开，期望：顶部 selected-value 显示"翻译"，下拉自动定位到 read group

- [ ] **Step 7: 提交**

```bash
git add popup/main/prompts/promptsUI.js
git commit -m "fix(prompts): buildPromptMap 改用 group::label 复合 key + lastPromptTemplate 旧格式回退"
```

---

## Task 3: 修 Bug A — options 提示词编辑器复原折叠/展开

**Files:**
- Modify: `options/prompts_editor/prompts_editor.js:30-207`（加 expandedIndex 状态、改 renderPrompts 的 class 条件化、补 header click 事件）

**Interfaces:**
- Consumes: `getCurrentPrompts()`, `subscribeToPrompts()` (unchanged)
- Produces: `renderPrompts(list)` 中 `.prompt-item` 和 `.prompt-item-body` 按 `expandedIndex === i` 条件挂 `expanded` class；点击 header (非按钮) toggle `expandedIndex`

- [ ] **Step 1: 加 expandedIndex 模块级状态**

在 `options/prompts_editor/prompts_editor.js` line 33 附近（`let unsubscribePrompts = null;` 之后）加：

```js
// 当前展开的 prompt item 索引; -1 表示全部折叠。跨 group 切换时重置。
let expandedIndex = -1;
```

- [ ] **Step 2: 改 renderPrompts — 条件化 expanded class**

替换 `options/prompts_editor/prompts_editor.js:180-199` 整段 template 字符串为：

```js
  el.innerHTML = `
    <div class="prompts-list">
      ${list.map((p, i) => {
        const isExpanded = expandedIndex === i;
        return `
        <div class="prompt-item ${isExpanded ? 'expanded' : ''}" data-index="${i}">
          <div class="prompt-item-header">
            <span class="prompt-item-title">${escapeHtml(p.label)}${p.alias ? ` <small style="color:var(--text-muted);font-weight:400;font-size:11px;">/${escapeHtml(p.alias)}</small>` : ''}</span>
            <div class="item-buttons">
              <button data-action="delete" data-index="${i}">删除</button>
              <button class="btn-primary" data-action="save" data-index="${i}">保存</button>
            </div>
          </div>
          <div class="prompt-item-body ${isExpanded ? 'expanded' : ''}">
            <input type="text" id="label-${i}" value="${escapeHtml(p.label)}" placeholder="输入标题">
            <input type="text" id="alias-${i}" value="${escapeHtml(p.alias || '')}" placeholder="输入别名（如 fix）用于 /fix 快捷触发">
            <textarea id="tpl-${i}" placeholder="输入提示词内容">${escapeHtml(p.template)}</textarea>
          </div>
        </div>
      `;}).join('')}
    </div>
  `;
```

- [ ] **Step 3: 补 header click 事件 — 切换 expandedIndex 并重渲染**

在 `options/prompts_editor/prompts_editor.js:201-206`（querySelectorAll 绑 save/delete 之后）补：

```js
  el.querySelectorAll('.prompt-item-header').forEach((header) => {
    header.addEventListener('click', (e) => {
      // 点保存/删除按钮时不 toggle (按钮自己处理)
      if (e.target.closest('button')) return;
      const idx = parseInt(header.closest('.prompt-item').dataset.index, 10);
      expandedIndex = expandedIndex === idx ? -1 : idx;
      renderPrompts(getCurrentPrompts()[currentGroup] || []);
    });
  });
```

- [ ] **Step 4: selectFile / refreshCurrentView 时重置 expandedIndex**

`options/prompts_editor/prompts_editor.js:145-159` 的 `selectFile` / `refreshCurrentView` 需要在切 group 时把 expandedIndex 重置（不然切换文件后还显示着旧 index = -1 或别的 i，但当前 list 长度变了，expanded 行为错位）。

修改 `selectFile` 函数（line 145-154），在 `currentFile` / `currentGroup` 赋值后加一行：

```js
async function selectFile(fileName) {
  currentFile = fileName;
  currentGroup = fileName.replace(/\.js$/, '');
  expandedIndex = -1;  // 切文件时全部折叠, 避免 index 错位
  document.getElementById('currentFileName').textContent = fileName;
  document.querySelectorAll('.file-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.name === fileName);
  });
  renderPrompts(getCurrentPrompts()[currentGroup] || []);
}
```

`refreshCurrentView` (line 156-159) 保持不变 — 它只是同步最新 cache，展开状态由 expandedIndex 决定。

- [ ] **Step 5: 跑现有 promptsStore / promptsEditorApi / promptsCore 单测**

Run:
```bash
node shared/prompts/promptsStore.test.js
node shared/prompts/promptsEditorApi.test.js
node shared/prompts/promptsCore.test.js
```
Expected: 全部 PASS（这些测试不直接测 options/prompts_editor）。

- [ ] **Step 6: 跑 popup promptsUI 测试**

Run: `node popup/main/prompts/promptsUI.test.js`
Expected: PASS（这次改动不影响 promptsUI.js）

- [ ] **Step 7: 手动验证 options 折叠/展开**

操作：
1. 装扩展后，右键扩展图标 → 选项 → 进 options 页
2. 点 "prompts_editor" 子页面
3. 选任意 group（如 `read`），期望：每条 prompt 默认**折叠**（只显示 title + 删除/保存按钮），不再硬编码全展开
4. 点击任一条 title（不是按钮），期望：那条展开，显示 label/alias/template 输入框；再点一次，期望折叠
5. 点击另一条 title，期望：之前那条自动折叠，新这条展开（互斥）
6. 切到另一个 group（如 `xxxx_trans`），期望：所有条目重新折叠
7. 保存/删除/添加功能不受影响（按钮照常工作）

- [ ] **Step 8: 提交**

```bash
git add options/prompts_editor/prompts_editor.js
git commit -m "fix(options): 复原 prompts editor 折叠/展开 toggle (regression from shared 数据层重构)"
```

---

## Task 4: 综合验证 — 三处 UI 都不破

**Files:** 无产品代码变更；只做验证

**Interfaces:** N/A（验证 task）

- [ ] **Step 1: 跑全部相关单测**

Run:
```bash
node shared/prompts/promptsStore.test.js
node shared/prompts/promptsEditorApi.test.js
node shared/prompts/promptsCore.test.js
node popup/main/prompts/promptsUI.test.js
```
Expected: 全部 PASS

- [ ] **Step 2: 手动端到端 — popup 路径**

1. `chrome://extensions` → 重新加载扩展
2. 打开 popup → 提示词下拉框
3. 验证左侧 group 列表完整：code_gen / analyze_plan / custom_design / read / search / other / xxxx_ask / xxxx_trans **8 个**
4. 验证 `read` group 内有 "翻译 (/trans)" 和 "太奶 (/tainai)"
5. 验证 `xxxx_trans` group 内有 "翻译 (/fy)" 等 7 条
6. 选中 `read/trans` 翻译 → 顶部 selected-value 显示 "翻译" → 关 popup 再开 → 仍选中
7. 切换到 `xxxx_trans/fy` 翻译 → 顶部仍显示 "翻译"（label 相同）但 dataset.value 是不同 key
8. 切到 `xxxx_trans/解释 (/js)` 之类的别的 prompt → 验证 selected-value 切到新 prompt

- [ ] **Step 3: 手动端到端 — sidebar 路径**

1. 打开 sidebar (扩展图标)
2. 点 prompt-bar（顶部提示词指示器）打开 picker
3. 验证左侧 group 列表完整 8 个 group
4. 验证 `read` group 内 trans 翻译可见
5. 验证 `xxxx_trans` group 内 fy 翻译可见（与 read/trans 是**两条独立条目**）
6. 选中后顶部 selected-value 同步更新

- [ ] **Step 4: 手动端到端 — options 路径**

1. 打开 options → prompts_editor
2. 验证所有 group 切换时默认折叠
3. 验证点击 header 可展开/折叠
4. 验证编辑后保存能正常写回磁盘
5. 验证添加/删除功能正常

- [ ] **Step 5: 跨页同步 — 实时性**

1. 打开 popup + sidebar + options 三个视图
2. 在 options 编辑某个 prompt 的 label
3. 验证 popup 与 sidebar 的下拉/picker **实时**反映新 label
4. 在 popup 选 trans alias 翻译，在 sidebar 顶 prompt-bar 应显示"翻译 (/trans)"

- [ ] **Step 6: 如果上述任一步 FAIL — 回滚上一个 commit 重做**

如果发现 regression，立即 `git revert HEAD` 然后回到对应 Task 重做。

- [ ] **Step 7: 全部 PASS 后写 closeout**

无需 commit；返回 taskget 报告本次完成。

---

## Self-Review

1. **Spec coverage**:
   - Bug A (options 全展开): Task 3 完整覆盖 — 改 hardcoded class、增 expandedIndex 状态、补 header click、reset on file switch
   - Bug B (popup trans 缺失): Task 1 (复盘测试) + Task 2 (改 buildPromptMap + 旧 storage 兼容) 完整覆盖
   - 综合验证: Task 4 覆盖

2. **Placeholder scan**: 没发现 TBD / TODO / "implement later"。doc stub 的 `findAll` / `matches` 是真实实现（不是占位）。

3. **Type consistency**:
   - `buildPromptMap` 返回类型从 `{[label]: T}` 改为 `{[group::label]: T}` — Task 1 测试期望的 key 包含 `trans`（alias 字符）或 value 包含 trans，未强制 key 格式，便于测试稳定。
   - `expandedIndex` 模块级 let，类型 number，-1 表示全折叠 — 与原版 `d5d0d7e` 一致。
   - `template.key` 实际就是 map key（populateOptimizer 第 133 行 `option.dataset.value = template.key`），改了 buildPromptMap key 后这一行自动跟着变 — 单一职责，不引入第二份 key 来源。

4. **未覆盖**:
   - 旧 `popup/main/prompts/prompts.js` 仍被 `aichatUtils.js:4` / `popup/main/mainUtils.js:3` import，仅 6 个 group。本次修复不改这条路径，因为它与用户报的 popup 下拉 / options 编辑无关；这是 shared 迁移的 Phase 6 任务（见 `2026-08-10-shared-data-prompt-editor.md` 第 60 行）。
   - 测试文件用 inline doc stub，没引 jsdom；可移植性更好。如果未来 Task 4 端到端验证出问题，可考虑加 jsdom 测试。
