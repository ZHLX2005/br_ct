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

## 3. 注册脚本列表

**文件**: `backgroudtask/platformScriptFiles.js`

在 `getPlatformScriptFiles` 中添加新分支：

```javascript
if (platform === "{platform}") {
  return ["contentScripts/{platform}.js"];
}
```

或依赖默认分支：

```javascript
return [`contentScripts/${platform}.js`];
```

如果平台在某些情况下需要 `openPlatformTab`（仅打开不发送），还需要在 `backgroudtask/ai_platform_processor.js` 中确认 `handleDirectSend` 路径可用。

## 完整步骤汇总

```
1. config/platformConfig.js         → 注册平台（显示名、图标、URL）
2. contentScripts/{platform}.js     → 输入发送逻辑（sendMessage）
3. backgroudtask/platformScriptFiles.js  → 注册脚本列表（可省略，走默认分支）
```

## 调试清单

- [ ] Sidebar 中能勾选平台，图标/颜色正确
- [ ] 点击"发送消息"后，平台 Tab 自动打开/复用
- [ ] 控制台看到 `[Platform] ... 内容脚本已加载并激活`
- [ ] 消息成功输入并发送

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
