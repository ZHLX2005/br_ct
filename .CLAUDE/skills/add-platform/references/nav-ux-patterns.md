---
name: nav-ux-patterns
description: nav 交互增强的 UX 模式库。当新增按钮数量 ≥ 3、按下去会触发异步动作（向 background 发消息）、或要复用同一 nav 容器的多种交互时使用——给出 toolbar 容器、按钮状态机、异步动作三套可复用模板。
---

# nav 交互 UX 模式库

> 阅读本文档前先看 `SKILL.md` 第 3 节"扩展点地图"和 `extend-nav.md` 标准模板。
>
> 本文聚焦三个**实战中沉淀的 UX 模式**：
>
> 1. **Toolbar 容器**：当按钮数量≥3，把它们收成一行
> 2. **按钮状态机**：异步动作必须有的 `busy/success/error` 反馈
> 3. **异步动作**：经 `chrome.runtime.sendMessage` 到 background 的标准结构

---

## 1. Toolbar 容器（按钮 ≥ 3 时）

### 1.1 为什么需要 toolbar

`<all_urls>` 注入的 nav 默认是 `flex-direction: column`，每个按钮**独立成行**占用纵向空间。当按钮达到 3 个 + 行数很多（消息上百），nav 触发 `max-height: 70vh` 限制，纵向会被挤压、长消息列表无法完整浏览。

Toolbar 容器把所有"动作类"按钮收成一行（横排），从上到下结构就变成：

```
handle
rows (可能很多)
toolbar (单行)
```

这样无论按钮有多少个，nav 的纵向增长只受 rows 影响。

### 1.2 何时上 toolbar

| 按钮数 | 推荐布局 |
|---|---|
| 1 | 直接独立成行 |
| 2 | 直接独立成行 |
| **3+** | **上 toolbar**（哪怕目前不算挤，给未来留余地） |
| 未来可能增加 | **直接上 toolbar** |

### 1.3 标准实现

```javascript
// view.js 顶部
const TOOLBAR_CLASS = 'bro-chat-nav__toolbar';

// NAV_CSS 末尾
.${TOOLBAR_CLASS} {
  display: none;
  align-items: center; justify-content: flex-end;
  gap: 2px;
  padding: 4px 8px 6px 14px;
  flex-wrap: nowrap;        /* 容器宽度够时就横排 */
}
#${NAV_ID}:hover .${TOOLBAR_CLASS} { display: flex; }

// 同时把单个按钮的 padding 从独立成行版改成并排版
.${SUMMARY_CLASS} {       /* 任何想放进 toolbar 的按钮 */
  display: inline-flex;
  align-items: center; gap: 4px;
  padding: 1px 8px;         /* 不要再带 14px 左边距，外边距由 toolbar 控制 */
  font-size: 12px;
  color: var(--bro-chat-nav-text-idle);
  cursor: pointer; white-space: nowrap;
  border-radius: 4px;      /* hover 浅灰背景时圆角更干净 */
  transition: color 0.2s ease, background 0.2s ease;
}
.${SUMMARY_CLASS}:hover { color: var(--bro-chat-nav-text); background: rgba(15,17,21,0.04); }
```

```javascript
// createNavView 内构造
const toolbar = document.createElement('div');
toolbar.className = TOOLBAR_CLASS;
if (hasSummary) toolbar.appendChild(summaryBtn);    // 顺序按视觉权重
if (hasCopy) toolbar.appendChild(copyBtn);
if (hasExport) toolbar.appendChild(exportBtn);

// clear() / render() 一次操作整个 toolbar（不要再各自 append/detach）
function clear() {
  while (nav.children.length > 1) nav.removeChild(nav.lastChild);
  nav.appendChild(toolbar);
}
function render(labels) {
  if (toolbar.parentNode) nav.removeChild(toolbar);
  /* rows 增量 reconcile ... */
  nav.appendChild(toolbar);
}

// pointerdown 跳过：原来三个 if (event.target.closest(...XX_CLASS)) 可以合并成
//   if (event.target.closest(`.${TOOLBAR_CLASS}`)) return;
// 因为 toolbar 是三个按钮的最近公共祖先；命中任一按钮都会 closest 到 toolbar
```

### 1.4 视觉预期

鼠标 hover nav 时：

```
┌─────────────┐
│ ━━━━━       │ ← handle
│ 问题1 ·     │
│ 问题2 ·     │ ← rows
│ 问题3 ·     │
├─────────────┤
│ 总结 复制 导出 │ ← toolbar 单行
└─────────────┘
```

三个按钮紧贴右侧排列，间距 2px，单按钮 hover 时有浅灰背景。

---

## 2. 按钮状态机（异步动作必须）

### 2.1 为什么需要状态机

异步动作（如 `chrome.runtime.sendMessage({ action: 'directSend', ... })`）有三种结果：

| 结果 | 触发条件 | 用户期望的反馈 |
|---|---|---|
| busy | 回调未完成，**不允许多次点击** | 按钮变 "发送中…"，cursor: wait |
| success | 回调返回 truthy | 按钮变绿短闪 "已发送 ✓" |
| error | 回调抛错或返回 falsy | 按钮变红短闪 "发送失败" |

不做状态机会出现：

- **快速连点**：重复触发异步消息，可能让 AI 平台发两条相同问题
- **永远绿**：clipboard 或 sendMessage 失败后用户没察觉
- **卡死**：按钮文字改了但永远不还原

### 2.2 四态机模板

```javascript
const SUMMARY_CLASS = 'bro-chat-nav__summary';

const LABEL_IDLE = '总结';
const LABEL_BUSY = '发送中…';
const LABEL_SUCCESS = '已发送 ✓';
const LABEL_ERROR = '发送失败';
const RESET_AFTER_MS = 1600;

let summaryBtn = null;
let summaryResetTimer = null;

if (typeof onSummary === 'function') {
  summaryBtn = document.createElement('span');
  summaryBtn.className = SUMMARY_CLASS;
  summaryBtn.textContent = LABEL_IDLE;

  summaryBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    // 锁：避免重入
    if (summaryBtn.classList.contains('is-busy')) return;

    summaryBtn.classList.remove('is-success', 'is-error');
    summaryBtn.classList.add('is-busy');
    summaryBtn.textContent = LABEL_BUSY;

    let ok = false;
    try {
      ok = await onSummary();
    } catch (err) {
      console.warn('[nav] summary callback threw', err);
      ok = false;
    }

    // 取消上一次的 reset 计时器（如果有）
    if (summaryResetTimer) clearTimeout(summaryResetTimer);

    summaryBtn.classList.remove('is-busy');
    summaryBtn.classList.add(ok ? 'is-success' : 'is-error');
    summaryBtn.textContent = ok ? LABEL_SUCCESS : LABEL_ERROR;

    summaryResetTimer = setTimeout(() => {
      summaryBtn.classList.remove('is-success', 'is-error');
      summaryBtn.textContent = LABEL_IDLE;
      summaryResetTimer = null;
    }, RESET_AFTER_MS);
  });
}
```

CSS：

```css
.${SUMMARY_CLASS}.is-busy    { color: var(--bro-chat-nav-text-idle); background: rgba(15,17,21,0.04); cursor: wait; }
.${SUMMARY_CLASS}.is-success { color: #16a34a; background: rgba(22,163,74,0.10); }
.${SUMMARY_CLASS}.is-error   { color: #dc2626; background: rgba(220,38,38,0.08); }
```

### 2.3 回调契约：返回 `Promise<boolean>` 而不是 `throw`

| 选项 | 推荐度 | 理由 |
|---|---|---|
| 回调返回 `Promise<boolean>` | ✅ 推荐 | view 层不用 try/catch，只需 `if (ok)` |
| 回调 `throw` 让 view catch | 可用 | 但需要在 view 层加一层 try/catch 包裹 onXxx |
| 回调静默 catch 后返回 `undefined` | ❌ 反模式 | view 无法区分成功失败，按钮永远显示 success |

参考实现见 `SKILL.md` 第 3.2b 节 `onSummary` 实现：内部 try/catch 只用来控制 false 返回值，**不抛**。

### 2.4 计时器内存管理

每次状态切换都启 `setTimeout` 还原。如果用户连续触发（实际上被 busy 锁住了），不会重叠；但 SPA 切对话会重新 `createNav`，旧 nav 的 `summaryResetTimer` 必须清理。

`destroy()` 已经把整个 `nav#bro-chat-right-edges-nav` 节点 remove，浏览器会自动 GC 闭包里的 timer。**不需要额外**写 `clearTimeout`。但如果担心调试器看到一排 "pending timer"，可以在 destroy 时顺手 clear：

```javascript
function destroy() {
  if (summaryResetTimer) clearTimeout(summaryResetTimer);  // 可选优化
  const navEl = document.getElementById(NAV_ID);
  if (navEl) navEl.remove();
  /* ... */
}
```

---

## 3. 异步动作：经 background 的标准结构

### 3.1 为什么走 background 而不是直接调 sendMessage script

nav 在 content script 里。AI 平台的 sendMessage 脚本（`contentScripts/{platform}.js`）也是 content script，但**由 background 动态注入**——platform config 注册之后要等 `chrome.tabs.onUpdated` 状态 `complete` 才注入。

如果 nav 直接做：

```javascript
// ❌ 错：平台脚本可能还没注入
window.__platformScript.sendChatMessage(message);
```

会得到 `undefined` 或者"send but nothing happens"，特别是冷启动首次进入页面时。

**正确做法**：通过 `chrome.runtime.sendMessage` 让 background 来处理注入 + 发送。background 已经实现：

- `findOrCreatePlatformTab`：复用已注入的 Tab，避免重复注入
- `injectScript` + `waitForTabComplete`：等待注入完成
- `sendMessage`：实际发送
- `handleDirectSend`：整个流程的 single-platform 轻量封装

### 3.2 选择 directSend vs processTaskQueue

| action | 用途 | 是否会切 tab | 适用场景 |
|---|---|---|---|
| **`directSend`** | 单平台轻量发送 | `switchToTab` 参数控制 | nav 的"向当前页发送"按钮；sidebar 单平台发送 |
| **`processTaskQueue`** | 多平台批量（带并发/重试/响应捕获） | 自动判断（`shouldJump = !activeTabMatches`） | sidebar 的批量广播 |

nav 只关心"向当前页发一条"，**优先用 `directSend`**：

```javascript
async function onSummary() {
  if (records.length === 0) return false;

  const SEP = '==========';
  const questions = records.map(r => r.fullText).join(`\n\n${SEP}\n\n`);
  const message = SUMMARY_TEMPLATE.replace('%s', questions);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'directSend',
      platform: platformId,        // entry.js 已经把 platformId 注入 cfg
      message,
      switchToTab: false,          // 当前就在本页，不需要切
    });
    return !!(response && response.status === 'success');
  } catch (err) {
    console.warn('[nav] summary send failed', err);
    return false;
  }
}
```

### 3.3 background 错误处理：副作用已知坑

`handleDirectSend` 在首次 `sendMessage` 失败时会自动 retry（重新注入），所以 nav 层不用做 retry。但 view 层**必须**把"等待时间"反馈给用户——800ms ~ 数秒（取决于平台首次加载）：

- `is-busy` 状态机会自然显示"发送中…"
- 但要预留 1600ms ~ 3000ms 的 `RESET_AFTER_MS`，不能太短（避免 success 反馈还在显示时按钮又被点了）

### 3.4 模板与 `%s` 替换

模板用纯字符串 + `.replace('%s', questions)`，与 `runjs/translation/selection-ask.js` 的写法一致：

```javascript
const SUMMARY_TEMPLATE =
  '%s,这是我向你提出的这些问题 现在重新对每个问题进行总结,讲解整个知识体系,让整个所有提问和体系更加自然';

// 未来要换成 promptsCore.applyPromptTemplate 处理更多占位符也兼容：
import { applyPromptTemplate } from '../../../popup/main/prompts/promptsCore.js';
const message = applyPromptTemplate(SUMMARY_TEMPLATE, {
  userMessage: questions,
  extractedText: '',
  imageInfo: '',
});
```

> ✅ 优先选哪种取决于项目是否使用统一的 `applyPromptTemplate` 决策树（`shared/sendMessage.js` 已经在用）。如果只是简单的 `%s` 单替换，`.replace()` 就够。

---

## 4. 三个模式配合的完整范例

**场景**：nav 上有 复制 / 总结 / 导出 三个按钮。复制和导出走 `is-success` 短反馈（同步或低延迟），总结走 `is-busy` + `is-success/error` 三态异步反馈。三个按钮收在 toolbar 一行。

### view.js（DOM/CSS 层）

```javascript
const TOOLBAR_CLASS = 'bro-chat-nav__toolbar';
const COPY_CLASS = 'bro-chat-nav__copy';
const SUMMARY_CLASS = 'bro-chat-nav__summary';
const EXPORT_CLASS = 'bro-chat-nav__export';

const NAV_CSS = `... (三按钮并排样式 + 三态机) ...

.${TOOLBAR_CLASS} {
  display: none;
  align-items: center; justify-content: flex-end;
  gap: 2px; padding: 4px 8px 6px 14px;
  flex-wrap: nowrap;
}
#${NAV_ID}:hover .${TOOLBAR_CLASS} { display: flex; }
`;

export function createNavView({ onSelect, onExport, onCopy, onCopyRow, onSummary }) {
  /* ... DOM 创建 ... */

  const toolbar = document.createElement('div');
  toolbar.className = TOOLBAR_CLASS;
  if (hasSummary) toolbar.appendChild(summaryBtn);
  if (hasCopy) toolbar.appendChild(copyBtn);
  if (hasExport) toolbar.appendChild(exportBtn);

  // 拖拽判断合并为：命中整个 toolbar 就跳过
  nav.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest(`.${ROW_CLASS}`)) return;
    if (event.target.closest(`.${TOOLBAR_CLASS}`)) return;   // ← 比三个独立判断更简洁
    /* ... drag start ... */
  });

  function clear() {
    while (nav.children.length > 1) nav.removeChild(nav.lastChild);
    nav.appendChild(toolbar);
  }

  function render(labels) {
    if (toolbar.parentNode) nav.removeChild(toolbar);
    /* rows reconcile */
    nav.appendChild(toolbar);
  }
}
```

### core/index.js（业务层）

```javascript
async function onCopy() {
  if (records.length === 0) return;
  const SEP = '==========';
  await navigator.clipboard.writeText(records.map(r => r.fullText).join(`\n\n${SEP}\n\n`));
}

function onExport() {
  /* ... existing ... */
}

const SUMMARY_TEMPLATE = '%s,这是我向你提出的这些问题 现在重新对每个问题进行总结...';

async function onSummary() {
  if (records.length === 0) return false;
  const SEP = '==========';
  const questions = records.map(r => r.fullText).join(`\n\n${SEP}\n\n`);
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'directSend',
      platform: platformId,
      message: SUMMARY_TEMPLATE.replace('%s', questions),
      switchToTab: false,
    });
    return !!(response && response.status === 'success');
  } catch (err) {
    console.warn('[nav] summary send failed', err);
    return false;
  }
}

const view = createNavView({ onSelect, onExport, onCopy, onCopyRow, onSummary });
```

---

## 5. 错误案例

| 错误做法 | 后果 | 修复 |
|---|---|---|
| nav 直接调 `window.__platformScript.sendChatMessage` | 冷启动时 sendMessage 脚本未注入，按钮静默失败 | 走 `directSend` 让 background 注入 |
| async callback 没防重入 | 连点两次 → directSend 触发两次 → AI 平台发两条相同消息 | 加 `.is-busy` 锁 |
| clipboard.writeText 用 try/catch 后静默成功 | 失败时按钮永远显示绿色 | callback 抛错或返回 `false` |
| 不同按钮的 padding/margin 各自独立算 | toolbar 内首按钮布局偏左、与其他按钮不齐 | toolbar 内部按钮统一 `padding: 1px 8px`，间距交给 `gap` |
| 各自 append/detach 多个按钮 | `clear()` / `render()` 维护负担，容易漏一个 | 收进 toolbar 容器 |
| pointerdown 每个按钮单独 closest | 重复代码，新增按钮就忘加 | 命中 toolbar 公共祖先就一次 return |
| 状态机还原时间设 500ms | 用户在动画中再次点击时按钮还没回到 idle → 状态判断不一致 | 设 1200ms ~ 1600ms，让反馈完整跑完 |

---

## 6. 模板代号速查表

| 模式 | 关键字 | 落地文件 | 引用 |
|---|---|---|---|
| Toolbar | `TOOLBAR_CLASS` `display: none` `flex` | `view.js` | `SKILL.md` §3.2b |
| 状态机 | `.is-busy` `.is-success` `.is-error` | `view.js` | `SKILL.md` §3.2b, §3.4 |
| directSend | `chrome.runtime.sendMessage({action:'directSend'...})` | `core/index.js` | `SKILL.md` §3.2b |
| `%s` 替换 | `template.replace('%s', questions)` | `core/index.js` | `runjs/translation/selection-ask.js` 同款 |

