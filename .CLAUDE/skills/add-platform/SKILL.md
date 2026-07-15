---
name: add-platform
description: Bro Chat 扩展新增 AI 平台的完整规范和步骤。当用户提到"添加平台"、"新增平台"、"添加新平台"、或需要支持新的 AI 对话站点时，必须使用此 skill。
---

# 新增 AI 平台规范与步骤

为 Bro Chat 扩展添加新 AI 平台需要创建/修改 **5 个文件**。所有文件必须保持一致，用统一的 `platformId`。

## 1. 注册平台配置

**文件**: `config/platformConfig.js`

在 `PLATFORM_CONFIG` 对象末尾添加：

```javascript
yourplatform: {
  name: 'YourPlatform',      // 显示名
  icon: 'Y',                  // 单字图标
  shortIcon: 'Y',             // 短图标
  color: '#ff0000',           // 主题色
  url: 'https://example.com/chat/',
  defaultVisible: true
},
```

`defaultVisible: false` 表示默认在平台列表中隐藏，用户需在设置中手动开启。

## 2. 创建内容脚本

**文件**: `contentScripts/{platform}.js`

负责接收 `sendMessage` 消息，在平台页面上执行输入 → 发送。

使用 IIFE 模式（非 ES module），因为通过 `chrome.scripting.executeScript` 注入。

```javascript
// ==========================================================
//                     Helper Functions
// ==========================================================

function getElementByXpath(xpath) {
  try {
    const result = document.evaluate(
      xpath, document, null,
      XPathResult.FIRST_ORDERED_NODE_TYPE, null
    );
    return result.singleNodeValue;
  } catch (e) {
    console.error(`XPath 表达式无效: ${xpath}`, e);
    return null;
  }
}

function triggerInputEvents(element) {
  if (!element) return;
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
}

function triggerClick(element) {
  if (!element || element.offsetParent === null || element.disabled) return false;
  try { element.click(); return true; }
  catch (e) { console.error('点击失败:', e); return false; }
}

// ==========================================================
//                     Element Finders
// ==========================================================

function findInputElement() {
  const selectors = [
    // 按优先级排列，尽快返回匹配
    { type: 'css', value: 'textarea[placeholder*="输入"]' },
    { type: 'css', value: 'div[contenteditable="true"]' },
    { type: 'css', value: 'textarea:not([readonly])' },
    // 最后兜底
    { type: 'xpath', value: '//*[@id="app-root"]//textarea' },
  ];
  // ... 遍历 selectors 返回第一个匹配
}

function findSendButton() {
  // 类似模式，优先 aria-label，最后兜底
}

// ==========================================================
//                     Main Logic
// ==========================================================

let isSending = false;

function sendChatMessage(message) {
  if (isSending) return false;
  isSending = true;

  // 1. 查找输入框 → 输入文本 → 触发事件
  // 2. 查找发送按钮 → 点击
  // 3. 解锁 isSending
}

// ==========================================================
//                     Message Listener
// ==========================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "sendMessage") {
    const success = sendChatMessage(request.message);
    sendResponse({ status: success ? "success" : "failed" });
  }
  return true;
});
```

### 选择器优先级

按此顺序尝试，找到第一个即返回：

| 优先级 | 方法 | 示例 |
|--------|------|------|
| 1 | CSS 选择器 | `textarea[placeholder="..."]` |
| 2 | XPath 属性 | `//div[@role="textbox"]` |
| 3 | ID 选择器 | `#prompt-textarea` |
| 4 | 完整 XPath（最后兜底） | `/html/body/div/.../button` |

### contenteditable 编辑器

如果平台使用 Slate/ProseMirror 等现代编辑器（如通义千问）：
- 使用 `document.execCommand('insertText')` 设置内容
- 触发 `beforeinput` 事件
- 输入后需等待按钮异步启用（设置 `buttonEnableRetry`）

### Enter 键发送

如果平台使用 Enter 键发送（如 Coze）：
- 设置 `clickMode: 'enter'`
- 不查找发送按钮，直接模拟 Enter 键事件

参考 `contentScripts/platform.template.js` 获取完整选项说明。

## 3. 创建剪贴板捕获配置

**文件**: `contentScripts/clipboardCapture/configs/{platform}.js`

IIFE 模式，挂载到 `window.{platform}CaptureConfig`。

```javascript
(function() {
  if (window.{platform}CaptureConfig) return;

  window.{platform}CaptureConfig = {
    name: '{platform}',
    action: '{platform}CopyCapture',

    // ============= 复制按钮 =============
    copyBtnPrimarySelector: 'button[data-testid="copy-button"]',
    copyBtnSelectors: [
      'button[data-testid="copy-button"]',
      'button[aria-label*="复制"]',
      'button[aria-label*="Copy"]',
    ],

    // ============= 内容定位 =============
    getContentRoot: function(turnRoot) {
      return turnRoot.querySelector('.markdown') ||
             turnRoot.querySelector('.prose') ||
             turnRoot;
    },

    getConversationId: function() {
      // 从 URL 提取对话 ID
      try {
        var url = new URL(window.location.href);
        // 平台特定逻辑...
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      // 从元素或父元素提取消息 ID
      return null;
    },

    // ============= 事件检测 =============
    detectTurn: function(target) {
      if (!(target instanceof Element)) return null;
      // 返回包含当前消息的容器元素
      // 必须同时包含内容和复制按钮
    },

    isCopyControl: function(element) {
      if (!(element instanceof Element)) return false;
      // 检查元素是否匹配复制按钮
      return false;
    },

    // ============= 可选 =============
    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH', 'MathJAX']),
    contextWindowMs: 2500,
    debug: true,
  };
})();
```

### 关键配置说明

| 字段 | 说明 |
|------|------|
| `copyBtnPrimarySelector` | 用于生成作用域选择器的复制按钮 CSS |
| `getContentRoot` | 从 turnRoot 中定位内容容器（不含操作栏） |
| `detectTurn` | 找到包裹整条消息（含内容+复制按钮）的当前 turn 容器 |
| `getMessageId` | 提取消息唯一 ID，用于去重 |
| `skipTags` | 文本提取时跳过这些标签 |

**重要**: `detectTurn` 返回的容器必须 **同时包含内容区和复制按钮**，否则 `autoCapture` 无法找到复制按钮。

### turnSelectors 与 copyBtn 的关系

`findTurnRootFromContainer` 使用 `turnSelectors` 从 response 容器向上找到 turn 根元素。turn 根元素要够宽（包含按钮），这是 `findCopyBtn` 能正常工作前提。

常见 DOM 模式与 turn root 选择：

| 模式 | 内容选择器 | turn 选择器 | 说明 |
|------|-----------|-------------|------|
| ChatGPT data-testid 层级 | `[data-message-author-role="assistant"]` | `[data-testid^="conversation-turn-"]` | 内容含变量 |
| 豆包消息盒子 | `[data-target-id="message-box-target-id"]` | 同上 | 容器即 turn |
| Gemini Angular 组件 | `structured-content-container` | `model-response` | 按钮在 content 外部 sibling 的 footer 中 |
| 内容内联按钮 | `article.message` | 同内容选择器 | 按钮在内容容器内 |

### 程序化点击注意事项

- **普通平台**: `btn.click()` 即可
- **检查 isTrusted 的平台**（如豆包）: 需用完整 mouse event 序列（`pointerdown→mousedown→pointerup→mouseup→click`）+ focus + 坐标
- **Angular Material 平台**（如 Gemini）: 用 `btn.click()` 避免 Angular 内部错误；dispatchEvent 会触发 "No ID or name found in config"
- 对应逻辑在 `contentScripts/clipboardCapture/mainWorldHook.js` 的 `__ccSimulateCopy` 中处理

### 复制按钮定位常见陷阱

1. **aria-label 模糊匹配**: `aria-label*="复制"` 可能匹配"复制表格"等子按钮 → 使用精确匹配 `aria-label="复制"`
2. **按钮不在 turn 容器内**: 按钮在内容容器的兄弟元素中（如 Gemini）→ turn root 必须选到公共父容器
3. **data-testid 被 Angular 清除**: Angular 异步渲染会清除程序设置的 dataset → 使用 unscoped fallback（`querySelectorAll` + 最后一个匹配）
4. **选择器匹配到嵌套按钮**: `button:first-child` 可能匹配到 dropdown menu 内的嵌套按钮 → 使用更精确的作用域选择器

## 4. 创建回复监听模块

**文件**: `contentScripts/chatResponse/{platform}ResponseListener.js`

IIFE 模式，依赖 `window.ResponseListenerCore`。

```javascript
(function() {
  if (window.__{platform}ResponseListenerInjected) return;
  window.__{platform}ResponseListenerInjected = true;

  if (!window.ResponseListenerCore) {
    console.warn('[Platform Response Listener] ResponseListenerCore not found');
    return;
  }

  window.ResponseListenerCore.createResponseListener({
    platform: '{platform}',
    hostnames: ['example.com'],

    // 查找最新回复的选择器，按优先级排列
    responseSelectors: [
      'selector-for-response-container',
    ],

    // 找到包裹完整 turn（含操作栏）的容器选择器
    turnSelectors: [
      'selector-for-turn-root',
    ],

    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH', 'MathJAX']),

    // 对应上面第 3 步的全局变量名
    captureConfig: '{platform}CaptureConfig',

    getConversationId: function() {
      // 从 URL 提取，必须和 clipboard config 的 getConversationId 一致
    },

    getMessageId: function(element) {
      // 从元素提取，必须和 clipboard config 的 getMessageId 一致
    },

    isGenerating: function() {
      // 检查页面是否正在生成回复（有无启用态的停止按钮）
    },
  });
})();
```

### 核心逻辑说明

`responseListenerCore.js` 实现自动检测新回复：

1. `MutationObserver` 监听 `document.body` 变化
2. 找到最新的 response 容器（`responseSelectors` 最后一个匹配）
3. 提取文本内容，与上次快照比较
4. 内容变化时发送 `{platform}Response` 消息到 sidebar
5. 生成完成（`!isGenerating()`）时调用 `autoCapture` 触发剪贴板捕获
6. `autoCapture` → `findTurnRootFromContainer`（用 `turnSelectors`）→ 定位 turn 根 → 尝试模拟点击复制按钮 → `dom.auto` 兜底

### responseSelectors 与 turnSelectors 的关系

- `responseSelectors`: 定位**内容容器**（最新回复的文本区），主要用于文本提取
- `turnSelectors`: 定位**完整 turn**（需包含操作栏/复制按钮），用于剪贴板捕获的 scope

```javascript
// responseListenerCore.js 中：
var container = getLatestResponseContainer();     // ← responseSelectors
var turnRoot = findTurnRootFromContainer(container); // ← turnSelectors (element.closest)
```

`responseSelectors` 一般比 `turnSelectors` 窄（只含内容），`turnSelectors` 要更宽（含按钮）。

### isGenerating 检测

用于判断回复是否生成完成：

- **通用**: 查找页面中的"停止"按钮（`button[aria-label*="stop"]`）
- **ChatGPT**: 检查按钮的 aria-label 是否包含 "stop"、"stopping" 等关键词
- **豆包**: 查找 `[data-testid="stop-generation-button"]`
- **如果没找到停止按钮**: 默认返回 `false`（认为没在生成）

## 5. 更新脚本文件列表

**文件**: `backgroudtask/platformScriptFiles.js`

在 `getPlatformScriptFiles` 中添加：

```javascript
if (platform === "{platform}") {
  return [
    "contentScripts/clipboardCapture/core.js",
    "contentScripts/clipboardCapture/configs/{platform}.js",
    "contentScripts/{platform}.js",
    "contentScripts/chatResponse/responseListenerCore.js",
    "contentScripts/chatResponse/{platform}ResponseListener.js",
  ];
}
```

注入顺序有依赖关系：
1. `core.js` — 必须先加载，定义 `window.ClipboardCapture`
2. `configs/{platform}.js` — 定义 `window.{platform}CaptureConfig`
3. `{platform}.js` — 处理 `sendMessage`（输入发送）
4. `responseListenerCore.js` — 定义 `window.ResponseListenerCore`
5. `{platform}ResponseListener.js` — 创建 listener，依赖上面的所有全局变量

**如果平台只有基础发送功能，没有剪贴板捕获**，可以简化为：

```javascript
return [`contentScripts/${platform}.js`];
```

## 完整步骤汇总

```
1. config/platformConfig.js         → 注册平台（显示名、图标、URL）
2. contentScripts/{platform}.js     → 输入发送逻辑（sendMessage）
3. contentScripts/clipboardCapture/configs/{platform}.js  → 剪贴板捕获配置
4. contentScripts/chatResponse/{platform}ResponseListener.js  → 回复监听
5. backgroudtask/platformScriptFiles.js  → 注册脚本列表
```

## 相关 skill（协作参考）

- 内容脚本的代码规范（IIFE 模式、注入顺序、模块注册）见 [[code-standards-guide]]（特别是 `references/runjs-module-standards.md` 与 `references/chrome-bg-module-pattern.md`）
- 各平台剪贴板捕获原理（路径 A 原型链替换 / simulateCopy / `mainWorldHook.js` 行为差异）详见独立 skill **clipboard-capture-architecture**
- 平台侧栏入口的快捷键切换、伪关闭 vs 真关闭、tabId 生命周期见 **keyboard-shortcut-architecture**（新增/修改本 skill 的边栏入口时读）

## 调试清单

- [ ] Sidebar 中能勾选平台，图标/颜色正确
- [ ] 点击"发送消息"后，平台 Tab 自动打开/复用
- [ ] 控制台看到 `[Platform] ... 内容脚本已加载并激活`
- [ ] 消息成功输入并发送
- [ ] Sidebar 收到回复并渲染
- [ ] 剪贴板捕获自动触发（控制台 `[platform Copy Capture] capture`）
- [ ] 手动点击复制按钮也能捕获
- [ ] `dom.auto` 兜底生效（有 HTML 回退内容）

## 常见问题

### 选择器不匹配
使用 `debug_selector.js`（控制台运行）探测 DOM，复制输出给我分析。

### 找不到复制按钮
先用 `debug_selector.js` 探测，确认：
1. 按钮是否在当前 turn 容器内？
2. 若不在，`turnSelectors` 需要选到包含按钮的父容器
3. `copyBtnPrimarySelector` 是否唯一匹配复制按钮？

### 按钮点击没反应
- 检查 `mainWorldHook.js` 是否已注入（控制台 `[CC-Hook] loaded`）
- 观察是否触发 Angular 错误 → 切换到 `btn.click()`
- 观察是否触发了 `copy` 事件 → 检查 `<script>` 标签注入

### 消息没收到
- 检查 Sidebar 的 `response-container` 是否显示
- 查看 Service Worker 控制台有无错误
- 确认 `{platform}Response` listener 是否注册
