---
name: sendmessage-injector
description: AI 平台 sendMessage 注入脚本的规范。每个平台一个 IIFE 文件（contentScripts/{platform}.js），由 background 通过 chrome.scripting.executeScript 动态注入，监听 sendMessage action 完成"输入→点击"全流程。
---
# sendMessage 注入脚本规范

> 新增/修改 sendMessage 注入脚本（`contentScripts/{platform}.js`）的完整指南。
>
> 完整模板在 `references/sendmessage-template.js`（IIFE + 全套工具函数 + 完整注释）。

## 1. 链路总览

```
Popup / Sidebar
  └─→ chrome.runtime.sendMessage({ action: 'processTaskQueue' | 'directSend', queue/... })
        ↓
        background.js → setupMessageListener (ai_platform_processor.js)
        └─→ findOrCreatePlatformTab(platform)            # 复用或创建 Tab
        └─→ waitForTabComplete(tab.id)                   # 等 status==='complete'
        └─→ injectScript(tab.id, platform)               # chrome.scripting.executeScript
              └─→ contentScripts/{platform}.js            # IIFE，监听 sendMessage
              └─→ chrome.tabs.sendMessage(tab.id, { action: 'sendMessage', message })
                    └─→ contentScripts/{platform}.js 监听器
                          └─→ sendChatMessage(message) → 输入 → 点击
                          └─→ sendResponse({ status, platform })
```

**注入方式**：background 在 `chrome.tabs.onUpdated` 状态变 `complete` 后，调用 `chrome.scripting.executeScript({ target: { tabId }, files: ['contentScripts/{platform}.js'] })` 动态注入（**不在 manifest.json 常驻**）。

**与 nav 的区别**：

|          | nav                             | sendMessage                                              |
| -------- | ------------------------------- | -------------------------------------------------------- |
| 注入方式 | manifest 常驻                   | background 动态                                          |
| 触发     | 页面加载                        | 业务消息                                                 |
| 入口文件 | `contentScripts/nav/entry.js` | `contentScripts/{platform}.js`                         |
| 通信     | 无（自动运行）                  | `chrome.runtime.onMessage` 监听 `sendMessage` action |

## 2. 文件结构样板

完整样板直接看 `contentScripts/chatgpt.js`（~210 行）。**所有现有平台都用同一种 IIFE 模式**，差异只在 PLATFORM_CONFIG 和选择器列表。

### 最小骨架

```javascript
/**
 * @fileoverview
 * 平台名 (example.com) sendMessage 内容脚本
 *
 * 由 background.js 在 Tab 加载完成后通过 chrome.scripting.executeScript 动态注入。
 * 监听 sendMessage action，调用 sendChatMessage(message) 完成输入+发送。
 */

(async function () {
  'use strict';

  // ===== 1. PLATFORM_CONFIG（与 config/platformConfig.js 字段同步） =====
  const PLATFORM_CONFIG = {
    name: 'YourPlatform',
    hostname: 'example.com',
    clickMode: 'click',                          // 'click' | 'mouseup' | 'both' | 'enter'
    inputMode: 'value',                          // 'value' | 'nativeSetter' | 'custom'
    contenteditableInputMode: 'auto',            // 'auto' | 'beforeinput' | 'typing' | 'direct'
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

  // ===== 2. 选择器列表（按优先级排序） =====
  const INPUT_SELECTORS = [
    { type: 'css', value: 'textarea[placeholder*="输入"]' },
    { type: 'css', value: 'div[contenteditable="true"]' },
    { type: 'css', value: 'textarea:not([readonly])' },
  ];
  const BUTTON_SELECTORS = [
    { type: 'css', value: 'button[aria-label*="发送" i]' },
    { type: 'css', value: 'button[aria-label*="Send" i]' },
    { type: 'xpath', value: "//button[.//span[contains(text(), '发送')]]" },
  ];

  // ===== 3. 工具函数（直接复用 chatgpt.js，不要重新发明） =====
  // findElementBySelectors / waitForElement / findInputElementIntelligently /
  // findButtonElementIntelligently / findSendButtonNearInput / isElementVisible /
  // simulateContenteditableInput / inputWithBeforeInput / inputWithTyping /
  // inputDirectly / setInputValue / triggerInputEvents / activateInput /
  // triggerClick / triggerNormalClick / triggerMouseUpClick /
  // triggerEnterKey / sendWithEnterKey / delay /
  // waitForButtonEnabled / logInfo / logWarning / logError
  // —— 全部从 chatgpt.js 复制，无外部依赖，整段复制即可

  // ===== 4. 主逻辑 =====
  let isSending = false;

  async function sendChatMessage(message) {
    if (isSending) return false;
    if (!message || typeof message !== 'string' || !message.trim()) {
      logError('消息内容无效');
      return false;
    }
    isSending = true;
    logInfo(`开始发送流程，消息: "${message}"`);

    try {
      const inputElement = await waitForElement(INPUT_SELECTORS, PLATFORM_CONFIG.elementTimeout);
      if (!inputElement) return false;

      if (PLATFORM_CONFIG.needActivateInput) {
        activateInput(inputElement);
        await delay(PLATFORM_CONFIG.activateDelay);
      }

      const inputResult = await setInputValue(inputElement, message);
      if (!inputResult) return false;

      if (!triggerInputEvents(inputElement)) return false;
      await delay(PLATFORM_CONFIG.inputDelay);

      let buttonElement;
      if (PLATFORM_CONFIG.findButtonNearInput) {
        buttonElement = findSendButtonNearInput(inputElement);
      } else {
        buttonElement = await waitForElement(BUTTON_SELECTORS, PLATFORM_CONFIG.elementTimeout, 'button');
      }
      if (!buttonElement) return false;

      if (PLATFORM_CONFIG.buttonEnableRetry.enabled) {
        const ok = await waitForButtonEnabled(buttonElement, inputElement, message.trim());
        if (!ok) return false;
      } else {
        await delay(PLATFORM_CONFIG.clickDelay);
      }

      if (PLATFORM_CONFIG.clickMode === 'enter') {
        return sendWithEnterKey(inputElement);
      } else {
        return triggerClick(buttonElement);
      }
    } catch (e) {
      logError('发送流程异常', e);
      return false;
    } finally {
      isSending = false;
    }
  }

  // ===== 5. 消息监听 =====
  if (!window.location.hostname.includes(PLATFORM_CONFIG.hostname)) {
    logWarning(`当前页面不是 ${PLATFORM_CONFIG.hostname}，脚本未激活`);
  } else {
    logInfo(`${PLATFORM_CONFIG.hostname} 内容脚本已加载并激活`);

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'sendMessage') {
        sendChatMessage(request.message)
          .then(success => sendResponse({ status: success ? 'success' : 'failed', platform: PLATFORM_CONFIG.name, timestamp: Date.now() }))
          .catch(error => sendResponse({ status: 'error', error: error.message, platform: PLATFORM_CONFIG.name, timestamp: Date.now() }));
        return true; // 异步响应
      }
      logWarning('收到未知的消息类型', request);
    });

    // 调试钩子
    if (typeof window !== 'undefined') {
      window.__platformScript = { config: PLATFORM_CONFIG, sendChatMessage };
      logInfo('调试工具已暴露到 window.__platformScript');
    }
  }
})();
```

## 3. 适配模式（按平台特性选）

### 3.1 标准 textarea + button（最常见）

参考 `contentScripts/chatgpt.js`

```javascript
const PLATFORM_CONFIG = {
  name: 'Standard',
  hostname: 'example.com',
  clickMode: 'click',
  inputMode: 'value',
  // 其他默认即可
};

const INPUT_SELECTORS = [
  { type: 'css', value: 'textarea#prompt-textarea' },   // ID 最稳定
  { type: 'css', value: 'textarea[placeholder*="输入"]' },
];

const BUTTON_SELECTORS = [
  { type: 'css', value: 'button[data-testid="send-button"]' },
  { type: 'css', value: 'button[aria-label*="Send" i]' },
];
```

### 3.2 Slate / ProseMirror contenteditable

参考 `contentScripts/tongyi.js`

```javascript
const PLATFORM_CONFIG = {
  clickMode: 'click',
  inputMode: 'value',
  contenteditableInputMode: 'beforeinput',   // 触发 beforeinput + execCommand
  buttonEnableRetry: { enabled: true, maxRetries: 5, retryInterval: 200 },
};

const INPUT_SELECTORS = [
  { type: 'css', value: 'div[contenteditable="true"]' },
  // 不要兜底 textarea，编辑器型平台没 fallback
];
```

### 3.3 Enter 键发送（CodeMirror / 编辑器型）

参考 `contentScripts/coze.js`

```javascript
const PLATFORM_CONFIG = {
  clickMode: 'enter',     // ← 关键
  // enter 模式下不查 BUTTON_SELECTORS
};

const INPUT_SELECTORS = [
  { type: 'css', value: '.ql-editor[contenteditable="true"]' },
];
```

### 3.4 GLM 特殊：mouseup 触发

参考 `contentScripts/glm.js`

```javascript
const PLATFORM_CONFIG = {
  clickMode: 'mouseup',   // 只触发 mouseup，不触发 click
};
```

### 3.5 React 受控组件

参考 `contentScripts/deepseek.js`

```javascript
const PLATFORM_CONFIG = {
  inputMode: 'nativeSetter',  // 用原生 setter 绕过 React 状态拦截
};

const INPUT_SELECTORS = [
  { type: 'css', value: 'textarea[placeholder*="输入"]' },
];
```

### 3.6 多按钮容器（侧边栏 / 工具栏有类似按钮）

参考 `contentScripts/deepseek.js`

```javascript
const PLATFORM_CONFIG = {
  findButtonNearInput: true,    // ← 沿输入框向上找公共祖先再定位按钮
};
```

## 4. 选择器探查命令

在 AI 平台页面 DevTools Console 跑：

```javascript
// 验证输入框
document.querySelector('textarea[placeholder*="输入"]')
document.querySelectorAll('div[contenteditable="true"]').length

// 验证发送按钮
document.querySelector('button[aria-label*="Send"]')
Array.from(document.querySelectorAll('button')).filter(b => b.innerText?.match(/发送|Send/))

// 列出所有 textarea / contenteditable 元素（兜底用）
Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')).map(e => ({
  tag: e.tagName,
  placeholder: e.placeholder,
  ariaLabel: e.getAttribute('aria-label'),
  readonly: e.readOnly,
}))
```

## 5. 注册到 background

### 5.1 默认分支（覆盖 95% 场景）

`backgroudtask/platformScriptFiles.js` 默认实现：

```javascript
export function getPlatformScriptFiles(platform) {
  return [`contentScripts/${platform}.js`];
}
```

**新平台无需修改此文件**。

### 5.2 自定义分支（特殊场景）

只有以下情况才需要新增分支：

| 场景                               | 例子                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 需要多个文件（先 helper 后主脚本） | `getPlatformScriptFiles('chatgpt') → ['contentScripts/chatgpt_copy_automation.js', 'contentScripts/chatgpt.js']` |
| 需要注入 MAIN world 脚本           | 用`world: 'MAIN'` 参数；通常意味着要 hook 原型链，慎用                                                            |
| 需要按平台加载不同 helper          | 在 entry 加判断                                                                                                     |

```javascript
export function getPlatformScriptFiles(platform) {
  if (platform === 'special') {
    return [
      'contentScripts/special_helper.js',
      'contentScripts/special.js',
    ];
  }
  return [`contentScripts/${platform}.js`];
}
```

## 6. 验证清单

| 项                   | 命令 / 检查                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| 配置注册             | `config/platformConfig.js` 有 `yourplatform` 字段                   |
| manifest 注入 nav    | `manifest.json` matches 含 `*://example.com/*`（如启用 nav）        |
| sendMessage 脚本创建 | `contentScripts/yourplatform.js` 存在                                 |
| background 注入      | `backgroudtask/platformScriptFiles.js` 默认分支已覆盖                 |
| Tab 加载             | 在 popup 触发发送 → DevTools 看`[YourPlatform] 内容脚本已加载并激活` |
| 选择器命中           | `window.__platformScript.config` 存在；DevTools 跑 4 节命令           |
| 点击有效             | 输入后按钮状态变化；消息成功发送                                        |
| 重复发送不冲突       | 快速连发两次 →`isSending` 锁住第二次                                 |

## 7. 常见错误

| 现象                                              | 根因                     | 修复                                                                         |
| ------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `[Platform] 当前页面不是 xxx` 出现后无 listener | hostname 拼错            | 检查`location.hostname.includes(PLATFORM_CONFIG.hostname)`                 |
| listener 收不到消息                               | background 没注入该脚本  | 检查`getPlatformScriptFiles` 返回的路径                                    |
| "Content script 执行失败"                         | Tab 没等`complete`     | `waitForTabComplete` 处理；网络慢时调大 timeout                            |
| 按钮点了没反应                                    | React 拦截了 click       | 改`inputMode: 'nativeSetter'`；或 `findButtonNearInput: true`            |
| 输入框输入了但按钮一直 disabled                   | 编辑器没收到 beforeinput | 加`contenteditableInputMode: 'auto'` + `buttonEnableRetry.enabled: true` |
| 输入后发送出去但没消息                            | 没触发 input 事件        | 确认`triggerInputEvents` 被调用；或在 `setInputValue` 后手动 dispatch    |
| Enter 模式不工作                                  | 输入框没聚焦             | 加`needActivateInput: true`                                                |
| 重复发送                                          | 没`isSending` 锁       | 复制 chatgpt.js 的`isSending` 模式                                         |

## 8. 与 nav 的协同

| 时序             | 事件                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| 用户访问平台页面 | manifest 注入`contentScripts/nav/entry.js` → nav 挂载                                 |
| 页面 complete    | background 注入`contentScripts/{platform}.js` → 控制台 `[xxx] 内容脚本已加载并激活` |
| popup 触发发送   | background`tabs.sendMessage` → contentScripts/{platform}.js 监听器处理                |

两者**完全独立**：nav 自己管 DOM 监听，sendMessage 只在消息来时工作。

## 9. ⚠️ 不推荐：多文件拆分

早期模板 `sendmessage-template.js`（原 `contentScripts/platform.template.js`，已移至 references/）尝试把所有工具函数抽出来共享，但各平台有差异（如 clickMode='enter' 时不需要找按钮），强制复用反而麻烦。**当前所有平台都是单文件**，工具函数复制即可。

如未来真的要拆共享层，可考虑 `contentScripts/_shared/send-helpers.js`，但**默认不要拆**。

## 10. 模板来源

| 平台              | 适配模式                        | 参考文件                                                                |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------- |
| 标准              | click + value                   | `chatgpt.js` `claude.js` `gemini.js` `yuanbao.js` `doubao.js` |
| Slate/ProseMirror | beforeinput + buttonEnableRetry | `tongyi.js`                                                           |
| Enter 键          | clickMode='enter'               | `coze.js`                                                             |
| GLM               | clickMode='mouseup'             | `glm.js`                                                              |
| React 受控        | inputMode='nativeSetter'        | `deepseek.js`                                                         |
| 多按钮容器        | findButtonNearInput=true        | `deepseek.js`                                                         |

`sendmessage-template.js` 保留作为"完整工具集参考"，但不直接复制给新平台使用——它不支持 enter/mouseup 等所有分支混用。
