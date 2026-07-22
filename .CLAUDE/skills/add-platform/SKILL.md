---
name: add-platform
description: Bro Chat 扩展新增 AI 平台 / 增强通用 nav / 调试平台适配 的完整规范与步骤。当用户提到"添加平台"、"新增平台"、"添加新平台"、"nav 增加 xxx"、"复制到剪贴板"、"增强 nav"，或在 nav 上做交互增强（复制/导出/快捷操作）时，必须使用此 skill。
---

# 新增 AI 平台 / 增强通用 nav 规范

本文档是 bro_chat 扩展"扩展一个新平台"和"扩展通用 nav"的完整索引。新人按下面的步骤走就能完整接入；增强 nav 时按"扩展点"章节做最小侵入修改。

## 目录

| 章节 | 何时读 |
|---|---|
| [1. 项目分层与扩展点地图](#1-项目分层与扩展点地图) | 任何扩展前先看，避免改错文件 |
| [2. 新增 AI 平台（完整流程）](#2-新增-ai-平台完整流程) | 新增平台 |
| [3. 增强通用 nav（复制到剪贴板 / 导出 / 快捷操作）](#3-增强通用-nav) | 改 nav 行为 |
| [4. 关键调试命令](#4-关键调试命令) | 任何改完后验证 |
| [5. 常见陷阱与错误案例](#5-常见陷阱与错误案例) | 出了问题回看 |
| [References 索引](#references-索引) | 细读子文档 |

---

## 1. 项目分层与扩展点地图

### 1.1 三大目录与扩展落点

```
bro_chat/
├── config/
│   └── platformConfig.js           ← ① 平台清单（所有扩展的源头）
│
├── contentScripts/                  ← 常驻注入到 AI 平台页面
│   ├── nav/                         ← 右侧对话快速导航（manifest 注入）
│   │   ├── entry.js                 ← IIFE 入口，URL→platformId 路由
│   │   ├── view.js                  ← ② DOM/CSS 表现层（增强 nav 改这里）
│   │   ├── core/
│   │   │   ├── index.js             ← 编排器（增强交互回调入口）
│   │   │   ├── collector.js         ← 纯函数，按 selector 收集记录
│   │   │   ├── observers.js         ← IO/scroll/MO 监听工厂
│   │   │   └── activeTracker.js     ← active 行跟踪
│   │   ├── platforms/{id}.js        ← ③ 平台 nav adapter
│   │   ├── util/                    ← disposer / scheduler 工具
│   │   ├── constants.js             ← 行为常量（CSS class 名仍留在 view.js）
│   │   ├── export.js                ← Markdown 导出纯函数 + 下载触发
│   │   └── ~~platform.template.js~~  ← 已移至 references/sendmessage-template.js
│   └── {platform}.js                ← ④ sendMessage 注入脚本（IIFE）
│
├── backgroudtask/
│   ├── platformScriptFiles.js       ← ⑤ sendMessage 注入器清单
│   └── ai_platform_processor.js     ← Tab 复用 + 注入 + 消息发送
│
├── options/platform/platform.js     ← ⑥ 平台可见性 / nav 开关 UI
├── sidebar/main/                    ← Sidebar UI（不需改）
└── manifest.json                    ← ⑦ nav 域名匹配 / web_accessible_resources
```

### 1.2 不同需求 → 改哪几个文件

| 需求 | 必改 | 视情况 |
|---|---|---|
| **新增一个 AI 平台** | ①②③④⑤⑦ | ⑥ |
| **关闭某平台的 nav** | ①`hasNav: false` | — |
| **增强通用 nav（复制到剪贴板等）** | ② + nav `core/index.js` 回调钩子 | — |
| **改 nav 平台 adapter 选择器** | ③ | — |
| **修复 nav 触发但没渲染** | ④ 不需要改 → 看 `entry.js` URL 匹配与 `③` 是否存在 | — |

> ⚠️ `contentScripts/platform.template.js` 已移动到 `.CLAUDE/skills/add-platform/references/sendmessage-template.js`（属于 skill，不属于运行时）。新平台 sendMessage 仍可直接参考任一 `contentScripts/{platform}.js`（如 `chatgpt.js`）作为样板。

---

## 2. 新增 AI 平台（完整流程）

下面以"添加 Perplexity（假设 id = `perplexity`）"为完整示例。改 5 个文件，全用 `platformId = 'perplexity'` 串起来。

### 第 1 步：在 `config/platformConfig.js` 注册平台

文件路径：`config/platformConfig.js`

```javascript
export const PLATFORM_CONFIG = {
  // ... 现有平台 ...
  perplexity: {                                  // ← key 必须和后续所有文件路径一致
    name: 'Perplexity',                          // 用户可见名
    icon: 'P',                                    // 单字图标（控件/弹窗显示）
    shortIcon: 'PE',                              // 短图标（nav 列表/拥挤空间）
    color: '#22b8cd',                             // 主题色
    url: 'https://www.perplexity.ai/',            // 入口 URL
    defaultVisible: true,                         // 默认在 Sidebar 列表显示
    hasNav: true,                                 // 是否启用右侧对话导航
  },
};
```

**字段约束**（来自 `config/platformConfig.js` + `options/platform/platform.js` 实际渲染）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 显示名（`options/platform/platform.js` 用 `${config.name}` 渲染） |
| `icon` | ✅ | 单字图标，渲染在 Sidebar 平台页签 |
| `shortIcon` | ✅ | 拥挤空间（如 nav row label）使用的短图标 |
| `color` | ✅ | 主题色，CSS background |
| `url` | ✅ | 入口 URL，nav 用 `getPlatformIdByUrl` 反查 platformId |
| `defaultVisible` | ✅ | 是否默认在 Sidebar 平台列表勾选 |
| `hasNav` | ⛔ optional | `false` 时 nav 不挂载且 Sidebar 不渲染导航开关。**默认 true**，所以新平台不写即可启用 nav |

URL 注册后 `getPlatformIdByUrl` 会自动用 origin + 路径前缀匹配，新平台无需额外代码。

### 第 2 步：在 `contentScripts/{platform}.js` 创建 sendMessage 脚本

文件路径：`contentScripts/perplexity.js`

> 这是 background.js 在 Tab 加载完成后通过 `chrome.scripting.executeScript` 动态注入的 IIFE 脚本，监听 `sendMessage` action 并完成"输入→点击"全流程。
>
> **必读样板**：
> - 默认模板：`contentScripts/chatgpt.js`（标准 textarea+button，最常见）
> - Slate/ProseMirror：`contentScripts/tongyi.js`（`contenteditableInputMode: 'beforeinput'` + `buttonEnableRetry`）
> - Enter 键发送：`contentScripts/coze.js`（`clickMode: 'enter'`）
> - React 受控组件：`contentScripts/deepseek.js`（`inputMode: 'nativeSetter'`）
> - 鼠标松开触发：`contentScripts/glm.js`（`clickMode: 'mouseup'`）
> - 多按钮容器：`contentScripts/deepseek.js`（`findButtonNearInput: true`）

**核心结构（与样板一致）**：

```javascript
(async function () {
  'use strict';
  // 1. PLATFORM_CONFIG（与 platformConfig.js 字段同步）
  const PLATFORM_CONFIG = {
    name: 'Perplexity',
    hostname: 'perplexity.ai',
    clickMode: 'click',                          // 'click' | 'mouseup' | 'both' | 'enter'
    inputMode: 'value',                          // 'value' | 'nativeSetter' | 'custom'
    contenteditableInputMode: 'auto',            // Slate/ProseMirror 用 'auto'
    needActivateInput: false,
    activateDelay: 100,
    inputDelay: 100,
    clickDelay: 100,
    elementTimeout: 5000,
    retryInterval: 100,
    verboseLogging: true,
    enableSmartDiscovery: true,
    findButtonNearInput: false,
    buttonEnableRetry: { enabled: false, maxRetries: 5, retryInterval: 200 },
  };

  // 2. INPUT_SELECTORS / BUTTON_SELECTORS（按优先级排序）
  const INPUT_SELECTORS = [
    { type: 'css', value: 'textarea[placeholder*="Ask"]' },
    { type: 'css', value: 'div[contenteditable="true"]' },
    // 兜底
    { type: 'xpath', value: '//textarea' },
  ];
  const BUTTON_SELECTORS = [
    { type: 'css', value: 'button[aria-label*="Send" i]' },
    { type: 'css', value: 'button[type="submit"]' },
  ];

  // 3. 复用样板里的工具函数（findElementBySelectors / waitForElement /
  //    setInputValue / triggerInputEvents / activateInput / triggerClick /
  //    triggerNormalClick / triggerMouseUpClick / triggerEnterKey /
  //    sendWithEnterKey / simulateContenteditableInput / waitForButtonEnabled /
  //    delay / logInfo / logWarning / logError）—— 直接从 chatgpt.js 复制
  //    ⚠️ 这些函数之间无外部依赖，整段复制即可

  // 4. 消息监听
  let isSending = false;
  async function sendChatMessage(message) { /* 参考样板第 1036 行实现 */ }

  if (!window.location.hostname.includes(PLATFORM_CONFIG.hostname)) {
    logWarning(`当前页面不是 ${PLATFORM_CONFIG.hostname}，脚本未激活`);
  } else {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'sendMessage') {
        sendChatMessage(request.message)
          .then(success => sendResponse({ status: success ? 'success' : 'failed', platform: PLATFORM_CONFIG.name }))
          .catch(error => sendResponse({ status: 'error', error: error.message }));
        return true;
      }
    });
    // 暴露调试钩子
    window.__platformScript = { config: PLATFORM_CONFIG, sendChatMessage };
  }
})();
```

> 💡 **不需要在 IIFE 之外手动检查 hostname 后再注册 listener** —— 直接在 listener 里判 `request.platform === PLATFORM_CONFIG.name` 也行，但样板统一在 IIFE 内首部检查，能避免无效 listener 注册。

### 第 3 步：让 background 知道如何注入（兜底分支已够用）

文件路径：`backgroudtask/platformScriptFiles.js`

```javascript
export function getPlatformScriptFiles(platform) {
  return [`contentScripts/${platform}.js`];
}
```

**默认分支已覆盖所有新平台**，无需修改。只有在以下情况才需要新增分支：

1. 平台需要 **多个** sendMessage 脚本（罕见）
2. 平台需要 **预注入 MAIN world 脚本**（如 hook 原型链）：见 chatgpt 的 chatgpt_copy_automation.js 模式
3. 平台需要 **自定义注入顺序**（如先注入 helper，再注入主脚本）

### 第 4 步：manifest.json 加 nav 域名匹配

文件路径：`manifest.json`

```json
{
  "matches": [
    "*://yuanbao.tencent.com/*",
    // ... 现有平台 ...
    "*://www.perplexity.ai/*"   ← 新增
  ],
  "js": ["contentScripts/nav/entry.js"],
  "run_at": "document_idle",
  "all_frames": false
}
```

> ⚠️ **域名精确陷阱**：
> - `*://example.com/*` **不匹配** `www.example.com`；要写成 `*://*.example.com/*`
> - `*://notion.so/*` **不匹配** `app.notion.com`；Notion 平台必须写 `*://app.notion.com/*`
> - 参考 `manifest.json` 已有的 17 个 matches 写法

### 第 5 步：创建 nav adapter

文件路径：`contentScripts/nav/platforms/perplexity.js`

```javascript
export default {
  itemSel: '[data-testid="user-query"]',     // 仅命中用户消息（必填）
  listSel: '[data-testid="conversation"]',   // 消息列表容器，MO 监听点（必填）
  textSel: '[data-testid="query-text"]',     // 文本节点（可选；null 则用 innerText）
  extractText: (el) => { /* 可选 hook，处理图片/附件兜底 */ },
};
```

**adapter 必填字段**：

| 字段 | 必填 | 类型 | 作用 |
|---|---|---|---|
| `itemSel` | ✅ | string | `querySelectorAll` selector，仅命中用户消息 |
| `listSel` | ✅ | string | MO 监听点（list 必须存在，否则 nav boot 失败） |
| `textSel` | ⛔ | string \| null | item 内的文本子节点 selector；`null` → 用 `el.innerText` |
| `extractText` | ⛔ | function | 自定义提取；返回 falsy 时继续走 `textSel` → `innerText` 兜底 |

**adapter 禁止做的事**（违反会被回滚）：
- ❌ 写 IIFE / 闭包（adapter 应该是纯配置对象，被 `createNav` 解构）
- ❌ 写 CSS / DOM 创建 / 副作用
- ❌ 自己挂 MutationObserver / scroll 监听（由 `core/index.js` 统一处理）

**Selector 优先级**（探查新平台时按此顺序）：

| 优先级 | 方式 | 稳定性 | 真实案例 |
|---|---|---|---|
| 1 | `data-testid` / `data-*` 唯一属性 | 高 | Grok `[data-testid="user-message"]`、NotionAI `[data-agent-chat-user-step-id]` |
| 2 | `role="article"` 语义属性 | 中 | Copilot `[id$="-user-message"]` + role |
| 3 | 稳定 class（无 hash） | 中 | Yuanbao `.agent-chat__list__item--human`、Tongyi `.chat-question-card-wrap` |
| 4 | hash class（每次构建变） | 低 | Gemini 自定义 tag `<user-query>`；避免依赖 |
| 5 | `:has(...)` 限定 | — | Doubao `.v_list_row[data-observe-row]:has([data-foundation-type="send-message-action-bar"])` |

**详细探查命令、virtual list 陷阱、extractText fallback 写法** → 见 `references/nav-adapter.md`

### 第 6 步：options UI 自动出现

文件路径：`options/platform/platform.js`（无需修改）

`generatePlatformOptions()` 通过 `Object.entries(PLATFORM_CONFIG)` 自动渲染新平台 checkbox + nav 开关。新平台**默认**勾选可见 + nav 开启（如 `defaultVisible: true`、`hasNav: true`）。

---

## 3. 增强通用 nav

> "通用 nav" 指 `contentScripts/nav/` 下的整套模块。增强它 = 增加新的交互能力（如**复制当前会话到剪贴板**、**折叠/展开 nav**、**快捷键**等），对所有平台生效。

### 3.1 扩展点地图

```
nav/
├── view.js          ← ① DOM/CSS 表现层（加按钮、改样式）
├── core/index.js    ← ② 编排器（接 onCopy / onExport 等回调钩子）
├── export.js        ← ③ Markdown 导出纯函数（可复用工具）
├── constants.js     ← ④ 行为常量
└── platforms/{id}.js ← 平台 adapter（只提供 records，与交互无关）
```

**约束**：
- `view.js` **拥有** DOM/CSS，不允许 nav adapter 创建任何 DOM
- `core/index.js` **编排** collector / view / observer；新交互回调从这里接入
- `core/collector.js` **纯函数**，只负责按 selector 拿 records
- `core/observers.js` **只**提供 listener 工厂，不调用业务逻辑

### 3.2 范例：新增"复制到剪贴板"功能

需求：nav hover 时多一个 "复制" 按钮，点击把当前所有用户消息复制到剪贴板（Markdown 格式）。

**改动文件清单**（3 个）：

| 文件 | 改动 |
|---|---|
| `contentScripts/nav/view.js` | 加 `COPY_CLASS` 常量 + `.${COPY_CLASS}` CSS；`createNavView({ onCopy })` 接受 `onCopy` 回调并创建按钮 |
| `contentScripts/nav/core/index.js` | `createNav` 接收 `platformCfg.onCopy`（adapter 自带）或自身注入 `onCopy`；`onCopy()` 内调用剪贴板 API |
| `contentScripts/nav/constants.js` | 可选，新增 `COPY_BTN_LABEL = '复制'` 等 |

#### 改动 1：`view.js` —— 加按钮 + 样式

```javascript
// 顶部新增常量
const COPY_CLASS = 'bro-chat-nav__copy';

// NAV_CSS 末尾追加（保持现有 CSS 变量一致）
//   复制按钮与 EXPORT_CLASS 同级（hover 才显示）
.${COPY_CLASS} {
  display: none;
  align-items: center;
  gap: 4px;
  padding: 1px 8px 1px 14px;
  font-size: 12px;
  color: var(--bro-chat-nav-text-idle);
  cursor: pointer;
  white-space: nowrap;
}
#${NAV_ID}:hover .${COPY_CLASS} { display: flex; }
.${COPY_CLASS}:hover { color: var(--bro-chat-nav-text); }

// createNavView 增加 onCopy 形参
export function createNavView({ onSelect, onExport, onCopy }) {
  // ... 现有代码 ...
  const hasCopy = typeof onCopy === 'function';
  let copyBtn = null;
  if (hasCopy) {
    copyBtn = document.createElement('span');
    copyBtn.className = COPY_CLASS;
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onCopy();
    });
  }

  // 拖拽判断里也跳过 copyBtn
  nav.addEventListener('pointerdown', (event) => {
    // ...
    if (event.target.closest(`.${COPY_CLASS}`)) return;  // ← 新增
    // ...
  });

  // render 末尾追加顺序：handle → rows → copyBtn → exportBtn
  //   注意 clear() 也要把 copyBtn 加回去
}
```

#### 改动 2：`core/index.js` —— 接 onCopy 回调

```javascript
export function createNav(cfg) {
  // ... 现有 onSelect / onExport ...
  const onCopy = cfg.onCopy || (async () => {
    // 默认实现：复制所有 records 到剪贴板
    const markdown = buildMarkdown(
      records.map(r => ({ fullText: r.fullText })),
      { platformId, platformName, sourceUrl: location.href, messageCount: records.length, skippedCount }
    );
    try {
      await navigator.clipboard.writeText(markdown);
      console.log('[nav] copied', records.length, 'messages');
    } catch (err) {
      console.warn('[nav] copy failed', err);
    }
  });

  const view = createNavView({ onSelect, onExport, onCopy });
  // ... 其余不变 ...
}
```

#### 改动 3：导出 `buildMarkdown` 复用

```javascript
// core/index.js 顶部 import（已有 export.js）
import { buildMarkdown } from '../export.js';
```

### 3.3 通用增强 checklist

新增任何 nav 交互能力都按下面清单走：

- [ ] 在 `view.js` 加 `XXX_CLASS` 常量 + CSS（与现有 `--bro-chat-nav-text-idle` 等 CSS 变量对齐）
- [ ] 在 `view.js` 的 `createNavView` 接受 `onXxx` 回调并创建按钮（参考 `onExport` 的实现）
- [ ] 在 `core/index.js` 的 `createNav` 内构造 `onXxx` 默认实现（基于 records）
- [ ] **不**在 nav adapter 里塞任何交互逻辑
- [ ] 不动 `collector.js` / `observers.js` / `activeTracker.js`（除非新交互本来就需要它们）

### 3.4 nav 副作用陷阱

- **id 冲突**：`view.js` 顶部所有常量 (`NAV_ID` / `STYLE_ID` / `ROW_CLASS` / `ITEM_CLASS` / `LINE_CLASS` / `HANDLE_CLASS` / `HANDLE_BAR_CLASS` / `EXPORT_CLASS`) 都在 `<all_urls>` manifest 注入，**新功能复用同一 nav 容器**，必须用新的 class 名，不能改老 class 名
- **destroy 完整性**：新加的按钮要在 `destroy()` 里清掉（参考 `EXPORT_CLASS` 的处理）
- **点击穿透**：`pointerdown` 监听里必须 `event.target.closest(XXX_CLASS)` 跳过新按钮，避免拖拽冲突

---

## 4. 关键调试命令

> 在目标平台页面打开 DevTools Console 粘贴运行。所有命令只读不修改，方便快速验证。

### 4.1 nav 是否挂载

```javascript
// 期望：{ nav: true, rows: <用户消息数> }
JSON.stringify({
  nav: document.getElementById('bro-chat-right-edges-nav') !== null,
  rows: document.querySelectorAll('.bro-chat-nav__row').length,
  active: document.querySelectorAll('.bro-chat-nav__line.is-active').length,
})
```

### 4.2 URL → platformId 是否命中

```javascript
// 直接 import 跑反查（devtools 可以 await import）
const m = await import('/config/platformConfig.js');
m.getPlatformIdByUrl(location.href)
```

### 4.3 adapter 字段能否命中消息

```javascript
// 假设 adapter 是 yuanbao.js
JSON.stringify({
  itemCount: document.querySelectorAll('.agent-chat__list__item--human').length,
  listExists: !!document.querySelector('.agent-chat__list'),
  sample: document.querySelector('.agent-chat__list__item--human')?.innerText?.trim().slice(0, 60),
})
```

### 4.4 entry 是否被注入（重复挂载防护）

```javascript
// 期望 true（entry.js 防重复注入标志）
window.__broNavInjected
```

### 4.5 sendMessage 注入是否成功

```javascript
// 在 AI 平台 Tab 控制台；期望看到 "[Perplexity] 内容脚本已加载并激活"
window.__platformScript?.config
```

### 4.6 platformConfig / hasNav 是否正确

```javascript
const m = await import('/config/platformConfig.js');
JSON.stringify(m.PLATATFORM_CONFIG.perplexity)
```

---

## 5. 常见陷阱与错误案例

### 5.1 nav 启动失败 / rows=0

按顺序排查：

| 现象 | 根因 | 修复 |
|---|---|---|
| `nav: false` | entry 没注入 | 检查 `manifest.json` matches 域名是否包含用户访问的真实域名（subdomain 陷阱） |
| `nav: true, rows: 0` | adapter `itemSel` 没命中 | 用 4.3 命令验证 selector；改 adapter |
| `nav: true, rows: 0` 持续 >9s | `listSel` 不存在，boot 30×300ms 重试后放弃 | 平台 SPA 列表延迟渲染 → 修 `listSel` 选延迟后才出现的容器 |
| rows 数量 = 2× 实际消息 | adapter 命中 user + assistant | 在 `itemSel` 加 `:not(...)` 或属性限定（如 Doubao 用 `:has(...)`） |
| rows = 0 但 console 有 `[nav] 缺少必要参数` | adapter 缺 `itemSel` / `listSel` | 补字段 |

### 5.2 sendMessage 报错 "Content script 执行失败"

- 该 Tab 还没注入 → 等 `chrome.tabs.onUpdated status==='complete'` 后再发（由 `waitForTabComplete` 处理）
- Tab 切换后又开新 Tab → `injectedTabs` 被清空导致注入失败，看 console 是否有 `[Perplexity] 注入失败`

### 5.3 平台列表找不到

- 检查 `config/platformConfig.js` 是否漏加
- 检查 Sidebar 渲染处 `popup/main/modules/storage.js` 是否读取 `PLATFORM_CONFIG`（实际是从 platformConfig 直接 import）

### 5.4 ❌ 错误案例：把交互塞进 nav adapter

```javascript
// ❌ 错：adapter 不应该有副作用、不该创建 DOM
export default {
  itemSel: '[data-testid="user-message"]',
  listSel: 'main',
  onMount() { document.createElement('button'); }  // ← 错
};
```

**正确做法**：交互放在 `core/index.js` 的 `createNav` 内或 `view.js` 的 `createNavView` 回调里，adapter 只提供 selector 配置。

### 5.5 ❌ 错误案例：改 PLATFORM_CONFIG 后忘记改 platformConfig.js 导出函数

```javascript
// ❌ 错：新增字段没考虑 getPlatformIdByUrl 是否能命中
perplexity: { url: 'https://www.perplexity.ai/' }  // 路径 /
```

URL 路径是 `/` 时 `basePath` 是 `'/'`，`currentPath.startsWith('/')` 永远为 true → 所有 URL 都可能被误判为 perplexity。**修复**：URL 必须包含唯一路径（如 `/search/`、`/chat/`）以避免误命中。

### 5.6 ❌ 错误案例：复用 manifest match 时漏写 subdomain

```json
"*://notion.so/*"   ← 错：用户访问的是 app.notion.com
```

**正确**：

```json
"*://www.notion.so/*",
"*://app.notion.com/*"
```

---

## References 索引

| Ref | 何时读 | 路径 |
|---|---|---|
| **nav-adapter.md** | 新增/修改平台 adapter 时：selector 探查命令、virtual list 陷阱、extractText 兜底写法 | `references/nav-adapter.md` |
| **sendmessage-injector.md** | 新增 sendMessage 脚本时：IIFE 模板、所有 clickMode / inputMode 适配模式、样板对照表 | `references/sendmessage-injector.md` |
| **extend-nav.md** | 增强通用 nav 时：view.js 扩展点、回调钩子、副作用陷阱清单 | `references/extend-nav.md` |

## 相关 skill（协作参考）

- 内容脚本分层注入策略（必要才注入、跨 runjs/funcs 边界）见 [[code-standards-guide]] 中 `references/runjs-module-standards.md`
- 平台侧栏入口的快捷键切换、伪关闭 vs 真关闭、tabId 生命周期见 [[keyboard-shortcut-architecture]]
- Sidebar 主架构（AI Chat / Claude Code 模式入口、消息路由）见 [[sidebar-main-architecture]]