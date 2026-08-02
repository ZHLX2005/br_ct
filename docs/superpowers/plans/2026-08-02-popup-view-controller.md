# Popup 视图挂载控制器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个 `viewController` 中间件在 popup shell 内通过 fetch+DOMParser 取各视图 body、attach/detach（保留 DOM 实例）+ 切 `<link>` 隔离 CSS + 首次跑 init，取代三页间的裸 `<a href>` 整页导航。

**Architecture:** `main.html` 改为 shell（nav + `#view-mount`）。`viewController` 单例按 nav/hash 切换：首次 `mount(viewId)` 时 `getBody()` → `DOMParser` 抽 `[data-view-content]` → 包进 `.view` 存为 DOM 实例 → attach；切走时 teardown + detach（不销毁，状态/监听保留）+ 切页级 `<link>`；`theme.css` 恒留。

**Tech Stack:** Vanilla ES modules（无构建/无测试框架），Chrome MV3 unpacked extension，`chrome.storage` / `chrome.runtime`。

## Global Constraints

- **无 JS 测试框架**：纯逻辑单元（viewController，不依赖 chrome.*）配一个**浏览器内断言 harness**（`viewController.test.html`，加载解压扩展后用 `chrome-extension://.../popup/viewSystem/viewController.test.html` 打开，断言结果写页 + console）。依赖 `chrome.*` 的行为（视图 init/storage）靠**手动验证**：`chrome://extensions` 加载解压扩展，点 nav 走查。
- **CSS 隔离 = 运行时切 `<link>`**：`theme.css` 静态恒留且在 head 最前；页级 CSS 由控制器 add/remove。**不做命名空间化**。
- **视图内容约定**：每个视图源 `<body>` 内有唯一 `<div data-view-content>...</div>` 包裹"shell 要挂载的内容"。**视图源不含 nav header**——nav 只在 shell（避免 4 份 nav 重复）。直开视图源 = 只看该视图内容（无跨视图 nav），仍可用于调试。（细化 spec 的"独立可用"。）
- **init/teardown 契约**：每个视图模块 export `async init(rootEl)` 与 `teardown(rootEl)`。**所有 DOM 查询 scope 到 `rootEl`**，不得裸用 `document.querySelector`。init 幂等（仅首次 mount 调）；teardown 在 detach 前调。
- **view def 接口**（细化 spec 的 `htmlUrl`）：`{ id, getBody: async()=>htmlString, cssHrefs: string[], init, teardown }`。`getBody` 解耦控制器与 `fetch`（生产由 shell.js 接 `fetch(htmlUrl)`，测试直接返回内联串）。
- 在 `feature/popup-view-controller` 分支上**每个 Task 一次 commit**。

## File Structure

**新增**：
- `popup/viewSystem/viewController.js` — 中间件单例（`setMountPoint` / `register` / `mount` / `getCurrent`）。
- `popup/viewSystem/viewController.test.html` — 控制器单元断言 harness。
- `popup/shell.css` — nav 容器 + `#view-mount` + 迁移自 main.css 的滚动条隐藏。
- `popup/shell.js` — 注册视图表 + 绑 nav + hash 路由 + 启动 mount + 各视图 `getBody` 接 fetch。
- `popup/main/mainView.html` — 主页视图内容源（`[data-view-content]`）。

**改造**：
- `popup/main/main.html` → shell 结构。
- `popup/main/main.js` + `mainUtils.js` + `platformRenderer.js` → init 包成 `export async function init(rootEl)`，查询 scope 到 rootEl。
- `popup/func_execute/functioncall.html` + `functioncall.js` → `[data-view-content]` + export init/teardown + rootEl scope。
- `popup/translation/translation.html` + `translation.js` → `[data-view-content]` + export init/teardown（含录制态清理）+ rootEl scope。
- `popup/main/main.css` → `body` 规则迁移到 `.view-main` / `shell.css`。

---

### Task 1: viewController 中间件 + 单元 harness（TDD）

**Files:**
- Create: `popup/viewSystem/viewController.js`
- Create: `popup/viewSystem/viewController.test.html`

**Interfaces:**
- Produces: `setMountPoint(el)`, `register(viewDefs)`, `mount(viewId): Promise<void>`, `getCurrent(): string|null`。view def = `{ id, getBody, cssHrefs, init, teardown }`。

- [ ] **Step 1: 写 harness（失败测试先行）**

Create `popup/viewSystem/viewController.test.html`（完整、可直接运行。测试侧保留 `viewA`/`viewB` 引用——控制器 `register` 存同一引用，故 `init` 内 `this===def`，`viewA.initCalls` 可被外部读取断言）：

```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>viewController tests</title>
<style>body{font-family:monospace;padding:12px} .pass{color:green} .fail{color:red;font-weight:bold}</style>
</head><body>
<h3>viewController tests</h3>
<div id="mount"></div>
<div id="out"></div>
<script type="module">
import { setMountPoint, register, mount, getCurrent } from './viewController.js';

const out = document.getElementById('out');
const log = (name, ok, detail='') => {
  const d = document.createElement('div'); d.className = ok ? 'pass' : 'fail';
  d.textContent = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`;
  out.appendChild(d);
};
const assert = (name, cond, detail) => log(name, !!cond, detail);
const hasLink = href => !!document.head.querySelector(`link[data-view-css="${href}"]`);

// 模拟恒留的 theme.css（静态 link，放 head 最前）
const theme = document.createElement('link');
theme.rel='stylesheet'; theme.href='theme.css'; theme.dataset.static='1';
document.head.insertBefore(theme, document.head.firstChild);
const hasTheme = () => !!document.head.querySelector('link[data-static="1"]');

// def 对象：init/teardown 内 this===def，故 def.initCalls 可读
const viewA = { id:'a', cssHrefs:['a.css'], initCalls:0, teardownCalls:0,
  getBody: async () => '<body><div data-view-content><input id="a-input"></div></body>',
  init(el){ this.initCalls++; }, teardown(el){ this.teardownCalls++; } };
const viewB = { id:'b', cssHrefs:['b.css'], initCalls:0, teardownCalls:0,
  getBody: async () => '<body><div data-view-content><p>b</p></div></body>',
  init(el){ this.initCalls++; }, teardown(el){ this.teardownCalls++; } };

setMountPoint(document.getElementById('mount'));
register([viewA, viewB]);

(async () => {
  await mount('a');
  assert('1 current===a', getCurrent()==='a');
  assert('1 a-input 在 DOM', !!document.getElementById('a-input'));
  assert('1 a.init 调 1 次', viewA.initCalls===1, `got ${viewA.initCalls}`);
  assert('1 a.css 在 head', hasLink('a.css'));
  assert('1 theme.css 恒在', hasTheme());

  document.getElementById('a-input').value = 'hello'; // 切走前写值

  await mount('a'); // 幂等
  assert('2 重复 mount(a) 幂等,init 不再调', viewA.initCalls===1, `got ${viewA.initCalls}`);

  await mount('b');
  assert('3 current===b', getCurrent()==='b');
  assert('3 a-input 已从 mount 点移除', !document.getElementById('a-input'));
  assert('3 b.init 调 1 次', viewB.initCalls===1);
  assert('3 a.css 已移除', !hasLink('a.css'));
  assert('3 b.css 已加', hasLink('b.css'));
  assert('3 a.teardown 调 1 次', viewA.teardownCalls===1, `got ${viewA.teardownCalls}`);

  await mount('a'); // 切回
  assert('4 a 重新挂载', !!document.getElementById('a-input'));
  assert('4 a.init 不再调(ready)', viewA.initCalls===1, `got ${viewA.initCalls}`);
  assert('4 a-input 值保留', document.getElementById('a-input').value==='hello', `got "${document.getElementById('a-input').value}"`);
  assert('4 b.teardown 调 1 次', viewB.teardownCalls===1);
})();
</script>
</body></html>
```

- [ ] **Step 2: 打开 harness 确认全部 FAIL（控制器尚未实现）**

加载解压扩展后，浏览器开 `chrome-extension://<id>/popup/viewSystem/viewController.test.html`。
Expected: 全部 FAIL（`viewController.js` 导出为 undefined / 报错）。

- [ ] **Step 3: 实现 viewController**

Create `popup/viewSystem/viewController.js`：

```js
// popup/viewSystem/viewController.js
// 视图挂载控制器（中间件）：在单一 mount 点 attach/detach 各视图的 DOM 实例，
// 切换时切页级 <link> 隔离 CSS。detach 不销毁实例 → 状态/监听保留。

let mountPoint = null;
let views = Object.create(null);
let current = null;
const CSS_ATTR = 'data-view-css';

export function setMountPoint(el) { mountPoint = el; }

export function register(viewDefs) {
  views = Object.create(null);
  for (const def of viewDefs) {
    // 存「同一引用」并就地补默认值：init 内 this===def，测试方可读 def.initCalls。
    // 不做 {...def} 拷贝，否则 this 指向内部副本、外部引用失效。
    def.init = def.init || (() => {});
    def.teardown = def.teardown || (() => {});
    def.cssHrefs = def.cssHrefs || [];
    def.dom = null;
    def.ready = false;
    views[def.id] = def;
  }
}

export function getCurrent() { return current; }

async function loadBody(view) {
  const html = await view.getBody();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body.querySelector('[data-view-content]') || doc.body;
  const wrapper = document.createElement('div');
  wrapper.className = `view view-${view.id}`;
  while (root.firstChild) wrapper.appendChild(root.firstChild);
  return wrapper;
}

function addLinks(viewId) {
  for (const href of views[viewId].cssHrefs) {
    if (document.head.querySelector(`link[${CSS_ATTR}="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href; link.setAttribute(CSS_ATTR, href);
    document.head.appendChild(link); // theme.css 静态在最前，页级 link 追加其后
  }
}
function removeLinks(viewId) {
  for (const href of views[viewId].cssHrefs) {
    const el = document.head.querySelector(`link[${CSS_ATTR}="${href}"]`);
    if (el) el.remove();
  }
}

export async function mount(viewId) {
  if (current === viewId) return;
  const view = views[viewId];
  if (!view) { console.error('[viewController] unknown view', viewId); return; }

  // 首次取 body（异步，期间旧视图仍可见，无闪烁）
  if (view.dom === null) {
    try { view.dom = await loadBody(view); }
    catch (e) { console.error('[viewController] loadBody failed', viewId, e); return; }
  }

  const prev = current;
  // 同步块：teardown prev → add 新 css → attach 新 → remove 旧 css → detach 旧（一次绘制）
  if (prev !== null && views[prev].teardown) {
    try { views[prev].teardown(views[prev].dom); } catch (e) { console.error(e); }
  }
  addLinks(viewId);
  mountPoint.appendChild(view.dom);
  if (prev !== null) {
    removeLinks(prev);
    mountPoint.removeChild(views[prev].dom);
  }
  current = viewId;

  // 首次 init（视图已可见）
  if (!view.ready) {
    try { await view.init(view.dom); view.ready = true; }
    catch (e) { console.error('[viewController] init failed', viewId, e); }
  }
}
```

- [ ] **Step 4: 打开 harness 确认全部 PASS**

刷新 `viewController.test.html`。
Expected: 全部 PASS（共 13 条断言）。

- [ ] **Step 5: Commit**

```bash
git add popup/viewSystem/viewController.js popup/viewSystem/viewController.test.html
git commit -m "feat(viewSystem): viewController 中间件 + 单元 harness"
```

---

### Task 2: functioncall 视图重构（data-view-content + init/teardown export）

**Files:**
- Modify: `popup/func_execute/functioncall.html`
- Modify: `popup/func_execute/functioncall.js`

**Interfaces:**
- Produces: `popup/func_execute/functioncall.js` 导出 `init(rootEl)` / `teardown(rootEl)`，body 内有 `[data-view-content]`。
- Consumes: Task 5 的 shell.js 会 import 这两个函数。

- [ ] **Step 1: functioncall.html —— 去掉 nav，body 仅留视图内容并用 `[data-view-content]` 包裹**

把 `<body>` 内的 `.header`（nav）整体删除；把 `.main-content` 用 `<div data-view-content>` 包裹（或给现有根容器加 `data-view-content` 属性）。改造后 body 形如：

```html
<body>
  <div data-view-content>
    <div class="main-content">
      <!-- 原有统计卡片 + 脚本列表 -->
    </div>
  </div>
  <script src="functioncall.js" type="module"></script>
</body>
```

删除原 `<a class="back-button" href="/popup/main/main.html">`（shell 接管返回）与 `.settings-link` nav 项（shell 接管设置）。

- [ ] **Step 2: functioncall.js —— DOMContentLoaded 体包成 export init(rootEl)，查询 scope 到 rootEl，删 settings-link 绑定**

把 `document.addEventListener("DOMContentLoaded", () => { ... })` 改为：

```js
const scriptFiles = [ /* 原数组不动 */ ];

export function init(rootEl) {
  const scriptList = rootEl.querySelector("#script-list");
  const statsCount = rootEl.querySelector("#stats-count");
  if (statsCount) statsCount.textContent = scriptFiles.length;

  // ...原动态生成 scriptItem 逻辑不动（innerHTML/appendChild 用 scriptList）...
  // ...原 scriptList click 监听不动...

  // 删除原 .settings-link 绑定块（settings 由 shell 处理）
}

export function teardown(rootEl) { /* 无 document 级监听/定时器，no-op */ }

// 直开（非嵌入）时仍自动 init
if (document.querySelector('[data-view-content]')) {
  document.addEventListener("DOMContentLoaded", () => init(document.body));
}
```

**精确改动点**（全文件 `document.*` 查询 → `rootEl.*`）：
- `functioncall.js:21` `document.getElementById("script-list")` → `rootEl.querySelector("#script-list")`
- `functioncall.js:22` `document.getElementById("stats-count")` → `rootEl.querySelector("#stats-count")`
- `functioncall.js:85-90` 整个 `.settings-link` 绑定块 → **删除**

- [ ] **Step 3: 手动验证（直开）**

`chrome://extensions` 刷新扩展，开 `chrome-extension://<id>/popup/func_execute/functioncall.html`。
Expected: 脚本列表正常渲染、统计数字正确、点"执行"仍能触发（console 可见 sendMessage）；无 nav（预期）。

- [ ] **Step 4: Commit**

```bash
git add popup/func_execute/functioncall.html popup/func_execute/functioncall.js
git commit -m "refactor(func_execute): 视图内容收敛为 data-view-content + 导出 init/teardown"
```

---

### Task 3: translation 视图重构（含录制态 teardown）

**Files:**
- Modify: `popup/translation/translation.html`
- Modify: `popup/translation/translation.js`

**Interfaces:**
- Produces: `translation.js` 导出 `init(rootEl)` / `teardown(rootEl)`（teardown 清理快捷键录制 document 级监听）。body 内有 `[data-view-content]`。

- [ ] **Step 1: translation.html —— 去 nav，body 用 `[data-view-content]` 包裹视图内容**

原 `<body>` 是 `.translation-container`（内含 `.header` + `.main-content` + `.footer`）。删除 `.header`；让 `.translation-container` 成为 `[data-view-content]`：

```html
<body>
  <div class="translation-container" data-view-content>
    <div class="main-content"> <!-- 原内容 --> </div>
    <div class="footer"><button id="openFavoritesBtn" class="footer-btn">收藏管理</button></div>
  </div>
  <script src="translation.js" type="module"></script>
</body>
```

- [ ] **Step 2: translation.js —— init/teardown 重构 + rootEl scope + 录制态清理**

把 `document.addEventListener('DOMContentLoaded', () => { ... })`（`translation.js:66`）体抽成 `export function init(rootEl)`，所有 `document.getElementById/.querySelector` → `rootEl.querySelector`。

**录制态 teardown（关键）**：模块顶层已有 `isRecordingOcrShortcut` / `isRecordingFavoritesShortcut` 标志与 `finishOcrShortcutRecording` / `finishFavoritesShortcutRecording`（后者内部已 `removeEventListener`，见 `translation.js:320-321,443-444`）。teardown 在录制中时强制 finish：

```js
export function teardown(rootEl) {
  if (isRecordingOcrShortcut) finishOcrShortcutRecording(new Event('keyup'));
  if (isRecordingFavoritesShortcut) finishFavoritesShortcutRecording(new Event('keyup'));
}
```

> 注：`finishXxxShortcutRecording` 内部判录制态 + removeEventListener，传一个合成的 keyup Event 触发其清理分支即可；若其实现要求真实按键，改为直接调用其内部的 remove 三行（见 `:320-321`/`:443-444`）。实现时读这两个函数体确认分支条件。

**直开自动 init**：

```js
if (document.querySelector('[data-view-content]')) {
  document.addEventListener('DOMContentLoaded', () => init(document.body));
}
```

**精确改动点**：`translation.js` 中所有 `document.getElementById('…')` 与 `document.querySelector('…')`（init 内的 radio/toggle/input/slider/shortcut 绑定，约 20 处，行 70-160）→ `rootEl.querySelector`。document 级 `keydown`/`keyup`（`:287-288,410-411`）保持绑 `document`（录制需要全局捕获），由 teardown 清理。

- [ ] **Step 3: 手动验证（直开）**

开 `chrome-extension://<id>/popup/translation/translation.html`。
Expected: 设置项正常加载（从 storage 恢复）；点 OCR 快捷键输入 → 录制 → 按组合键完成；无 nav（预期）。

- [ ] **Step 4: Commit**

```bash
git add popup/translation/translation.html popup/translation/translation.js
git commit -m "refactor(translation): data-view-content + 导出 init/teardown(含录制态清理)"
```

---

### Task 4: 主页视图重构 + 抽 mainView.html

**Files:**
- Create: `popup/main/mainView.html`
- Modify: `popup/main/main.js`
- Modify: `popup/main/mainUtils.js`
- Modify: `popup/main/platformRenderer.js`
- Modify: `popup/main/main.css`

**Interfaces:**
- Produces: `mainView.html`（`[data-view-content]` 包主页内容）；`main.js` 导出 `init(rootEl)`/`teardown(rootEl)`。
- Consumes: Task 5 shell.js import main 的 init/teardown。

- [ ] **Step 1: 新建 mainView.html —— 主页视图内容（无 nav）**

把现 `main.html` body 内**除 `.header` 外**的内容（`.platform-selector` / `#history-select` / `.prompt-optimizer-selector` / `#image-preview-area` / `.message-input` / `.button-group`）移入新文件，用 `[data-view-content]` 包裹：

```html
<!-- popup/main/mainView.html -->
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>主页视图</title>
  <link rel="stylesheet" href="../components/theme.css">
  <link rel="stylesheet" href="main.css">
  <link rel="stylesheet" href="./prompts/promptsUI.css">
</head><body>
  <div data-view-content>
    <div class="platform-selector"> ...原内容... </div>
    <select id="history-select" class="history-select"><option value="">选择历史消息</option></select>
    <div class="prompt-optimizer-selector"> ...原内容... </div>
    <div id="image-preview-area" class="image-preview-area" hidden></div>
    <textarea class="message-input" id="message-input" placeholder="..."></textarea>
    <div class="button-group"><button class="send-button" id="send-button">发送消息</button></div>
  </div>
</body></html>
```

- [ ] **Step 2: main.js —— DOMContentLoaded 链包成 export init(rootEl)**

```js
import { initializePopup, setupEventListeners, loadStoredData } from "./mainUtils.js";
import { setupDragDropEvents } from "./dragDropHandler.js";
import { initializePlatformOptions } from "./platformRenderer.js";

export async function init(rootEl) {
  try {
    initializePlatformOptions(rootEl);
    await initializePopup(rootEl);
    await loadStoredData();
    setupEventListeners();
    setupDragDropEvents(rootEl);   // 见 Step 4：dragDrop 接 rootEl
  } catch (e) { console.error("初始化 main 视图失败:", e); }
}

export function teardown(rootEl) { /* 无 document 级常驻监听，no-op */ }

if (document.querySelector('[data-view-content]')) {
  document.addEventListener("DOMContentLoaded", () => init(document.body));
}
```

- [ ] **Step 3: mainUtils.js —— initializePopup 接 rootEl，查询 scope**

`initializePopup()` 签名改 `initializePopup(rootEl)`，内部 `elements = {...}` 里所有 `document.getElementById/.querySelectorAll` → `rootEl.querySelector/.querySelectorAll`：

- `mainUtils.js:72-73` `document.querySelectorAll('.platform-icon-option input[type="checkbox"]')` → `rootEl.querySelectorAll(...)`
- `:75-81` `document.getElementById("message-input" / "send-button" / "close-tabs-button" / "select-all" / "history-select" / "prompt-optimizer-select" / "open-options")` → `rootEl.querySelector("#…")`
- `mainUtils.js:221` `document.getElementById("open-sidepanel-btn")`（侧边栏按钮，在 shell nav 里，**不属 mainView**）→ 改由 shell 绑定（见 Task 5），从 mainUtils 移除该绑定块。

> `loadStoredData()` / `setupEventListeners()` 内部用模块级 `elements` 对象（已 rootEl 化），无需再改查询；storage 读写不变。

- [ ] **Step 4: platformRenderer.js + dragDropHandler.js —— 接 rootEl**

`platformRenderer.js:32` `initializePlatformOptions()` → `initializePlatformOptions(rootEl)`，`:33` `document.getElementById('platform-options-row')` → `rootEl.querySelector('#platform-options-row')`。

`dragDropHandler.js` 的 `setupDragDropEvents()` → `setupDragDropEvents(rootEl)`，内部对 `#message-input` 等的查询改 `rootEl.querySelector`（读该文件确认查询点，统一替换 `document.` → `rootEl.`）。

- [ ] **Step 5: main.css —— body 规则迁移**

- `main.css:8` `body { padding: 16px }` → `.view-main { padding: 16px }`（由控制器 wrapper `.view.view-main` 命中）。
- `main.css` 末尾 `html::-webkit-scrollbar, body::-webkit-scrollbar { width:0; ... }`（隐藏 popup 滚动条）→ 移到 `shell.css`（Task 5），从 main.css 删除。

- [ ] **Step 6: 手动验证（直开 mainView.html）**

开 `chrome-extension://<id>/popup/main/mainView.html`。
Expected: 平台图标行渲染、输入框聚焦、历史/优化器下拉加载、拖放生效；无 nav（预期）。注意：此时 `main.html` 尚未改 shell（Task 5），`default_popup` 仍指向旧结构——本步只验 mainView 内容 + main init 在 rootEl=document.body 下能跑。

- [ ] **Step 7: Commit**

```bash
git add popup/main/mainView.html popup/main/main.js popup/main/mainUtils.js popup/main/platformRenderer.js popup/main/dragDropHandler.js popup/main/main.css
git commit -m "refactor(main): 抽 mainView.html + init(rootEl) + body 规则迁移"
```

---

### Task 5: shell（main.html 改造 + shell.css + shell.js 接线 + hash 路由）

**Files:**
- Modify: `popup/main/main.html`
- Create: `popup/shell.css`
- Create: `popup/shell.js`

**Interfaces:**
- Consumes: Task 1 `viewController`（`setMountPoint/register/mount/getCurrent`）；Task 2-4 各视图 `init/teardown`。
- Produces: 可工作的 popup shell——nav 切换经控制器，状态保留、CSS 隔离。

- [ ] **Step 1: main.html 改 shell 结构**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>AI Assistant - 多端AI调度工具</title>
    <link rel="stylesheet" href="../components/theme.css" />
    <link rel="stylesheet" href="../shell.css" />
    <script type="module" src="../shell.js"></script>
  </head>
  <body>
    <div class="header">
      <button class="open-sidepanel-btn" id="open-sidepanel-btn" title="打开侧边栏">☰</button>
      <h1>AI Assistant</h1>
      <div class="header-nav-menu">
        <a href="#main" class="header-nav-item" data-view="main">主页</a>
        <a href="#func" class="header-nav-item" data-view="func">函数库</a>
        <a href="#translation" class="header-nav-item" data-view="translation">划词翻译</a>
        <span id="open-options" class="header-nav-item">设置</span>
      </div>
    </div>
    <div id="view-mount"></div>
  </body>
</html>
```

- [ ] **Step 2: 创建 shell.css**

```css
/* popup/shell.css —— shell 专属：mount 点 + 迁移自 main.css 的滚动条隐藏 */
#view-mount { width: 100%; }

/* popup 整体隐藏页面滚动条（视觉隐藏，滚轮仍可滚动） */
html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }
html::-webkit-scrollbar-track, body::-webkit-scrollbar-track,
html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb { background: transparent; opacity: 0; }
```

> nav / header / header-nav-* 样式由 `theme.css` 提供（已含），shell.css 不重复。

- [ ] **Step 3: 创建 shell.js —— 注册视图 + nav 绑定 + hash 路由 + getBody 接 fetch**

```js
// popup/shell.js
import { setMountPoint, register, mount, getCurrent } from "./viewSystem/viewController.js";
import { init as initMain, teardown as teardownMain } from "./main/main.js";
import { init as initFunc, teardown as teardownFunc } from "./func_execute/functioncall.js";
import { init as initTranslation, teardown as teardownTranslation } from "./translation/translation.js";

const popupBase = chrome.runtime.getURL('popup'); // 形如 chrome-extension://<id>/popup
const fetchBody = (rel) => fetch(`${popupBase}/${rel}`).then(r => r.text());

setMountPoint(document.getElementById('view-mount'));
register([
  { id: 'main',        cssHrefs: [chrome.runtime.getURL('popup/main/main.css'), chrome.runtime.getURL('popup/main/prompts/promptsUI.css')],
    getBody: () => fetchBody('main/mainView.html'),         init: initMain,        teardown: teardownMain },
  { id: 'func',        cssHrefs: [chrome.runtime.getURL('popup/func_execute/functioncall.css')],
    getBody: () => fetchBody('func_execute/functioncall.html'), init: initFunc,    teardown: teardownFunc },
  { id: 'translation', cssHrefs: [chrome.runtime.getURL('popup/translation/translation.css')],
    getBody: () => fetchBody('translation/translation.html'), init: initTranslation, teardown: teardownTranslation },
]);

// nav：用 hash 驱动（<a href="#xxx">），hashchange → mount
const VIEW_BY_HASH = { '#main': 'main', '#func': 'func', '#translation': 'translation' };
function activeFromHash() {
  const id = VIEW_BY_HASH[location.hash] || 'main';
  mount(id);
  document.querySelectorAll('.header-nav-item[data-view]').forEach(a => {
    const on = a.dataset.view === id;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', activeFromHash);

// 设置项 + 侧边栏按钮
document.getElementById('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
const sideBtn = document.getElementById('open-sidepanel-btn');
sideBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) { await chrome.sidePanel.open({ tabId: tab.id }); window.close(); }
});

// 启动
document.addEventListener('DOMContentLoaded', activeFromHash);
```

> `chrome.runtime.getURL` 产出绝对扩展 URL，确保 fetch 与 `<link href>` 在 shell 上下文可解析。manifest 的 `web_accessible_resources` 已含 `popup/**`? **需确认**——若 fetch 被拦，给 manifest `web_accessible_resources.resources` 加 `"popup/*.html"` 与 `"popup/**/*.html"`（见 Step 5 校验）。

- [ ] **Step 4:（按需）manifest 增 web_accessible_resources**

读 `manifest.json` 的 `web_accessible_resources`（当前含 `contentScripts/*.js`/`config/*.js`/`funcs/*.js`/`runjs/*`/`modules/translation/*`）。**追加** `"popup/*.html"`、`"popup/**/*.html"`、`"popup/**/*.css"`，确保 shell fetch 视图 HTML 与运行时 `<link>` 加载页级 CSS 不被拦。

```json
"resources": [
  "contentScripts/*.js", "config/*.js", "funcs/*.js", "runjs/*.js", "runjs/*.css",
  "modules/translation/*.js", "modules/translation/*.html",
  "popup/*.html", "popup/**/*.html", "popup/**/*.css"
]
```

- [ ] **Step 5: 手动验证（shell 整体）**

`chrome://extensions` 刷新扩展 → 点扩展图标开 popup。
Expected：
- 默认显示主页（平台图标、输入框、下拉）。
- 点「函数库」→ 无刷新切到脚本列表；点「划词翻译」→ 切到设置；切回「主页」→ **之前输入框的内容还在**（状态保留）。
- DevTools Network：切换不产生 main.html 重新导航；视图 HTML 仅首次 fetch 一次。
- DevTools Elements：`#view-mount` 内任一时刻只有一个 `.view`；`<head>` 内页级 `<link>` 随视图切换 add/remove，`theme.css` 恒在。
- 若 fetch 报错（资源不可访问）→ 确认 Step 4 manifest 已加。

- [ ] **Step 6: Commit**

```bash
git add popup/main/main.html popup/shell.css popup/shell.js manifest.json
git commit -m "feat(popup): shell 化 main.html + viewController 接线 + hash 路由"
```

---

### Task 6: 端到端集成验证

**Files:** 无（验证 only）。

- [ ] **Step 1: 跨视图状态保留**

popup → 主页输入"测试文本"、勾选 2 个平台 → 切函数库 → 切划词翻译（进入快捷键录制但不按完，直接切走）→ 切回主页。
Expected: 输入框"测试文本"在；平台勾选不变；切回翻译无残留键盘拦截（任意键正常响应，录制态已重置）。

- [ ] **Step 2: 直开调试 URL**

- `chrome-extension://<id>/popup/translation/translation.html` → 仅翻译设置内容（无 nav），功能正常。
- `chrome-extension://<id>/popup/main/main.html#translation` → shell 启动并定位翻译视图。

- [ ] **Step 3: 回归**

- popup 高度随当前视图自适应，无塌陷/无 FOUC。
- 「设置」仍能打开 options 页。
- 「打开侧边栏」按钮仍生效。
- viewController.test.html 仍 13/13 PASS。

- [ ] **Step 4: 最终 commit（若有修正）**

```bash
git add -A
git commit -m "test(popup): 端到端集成验证通过"
```

---

## Self-Review（写完后自查）

**Spec 覆盖**：
- 消除刷新 → Task 5（shell 无导航，控制器 attach/detach）✓
- 状态保留 → Task 1 断言 4 + Task 6 Step 1 ✓
- 直开调试 → Task 6 Step 2 ✓
- CSS 隔离（切 link）→ Task 1 断言 3 + Task 5 Step 5 ✓
- fetch+DOMParser 取 body → Task 1 `loadBody` + Task 5 `getBody` ✓
- init/teardown 契约 + rootEl scope → Task 2/3/4 ✓
- translation 录制态 teardown → Task 3 Step 2 ✓
- main body 规则迁移 → Task 4 Step 5 ✓
- hash 路由 → Task 5 Step 3 ✓

**类型/命名一致**：`setMountPoint/register/mount/getCurrent`（Task 1 定义，Task 5 消费）✓；view def `{ id, getBody, cssHrefs, init, teardown }`（Task 1 定义，Task 5 填充）✓；`[data-view-content]`（Task 1 `loadBody` 读取，Task 2/3/4 各页注入）✓；`.view.view-{id}` wrapper 类（Task 1 产出，Task 4 `.view-main` 命中）✓。

**已知风险点**（实现时留意，非阻塞）：
1. `finishXxxShortcutRecording(new Event('keyup'))` 能否触发其清理分支——Task 3 Step 2 已要求读函数体确认；若不行直接复用其 `removeEventListener` 三行。
2. 并发不同 id 的 mount（用户狂点 nav）——控制器同 id 幂等，不同 id 有极小竞态窗口（popup 低频，可接受）。
3. `chrome.runtime.getURL` + `web_accessible_resources`——Task 5 Step 4 已覆盖。
