---
name: sidebar-shortcut-impl
description: Sidebar 快捷键实现的完整参考：Tab 切换 + 添加工作区功能
reference: code-standards-guide — Sidebar 快捷键实现范例（归档版）
---

# Sidebar 快捷键实现参考

## 场景

需要实现：
1. **Tab 切换快捷键**（默认 `` ` ``）：在工作区标签页与 AI 平台之间循环切换
2. **添加工作区快捷键**（默认 `Alt+W`）：快速添加当前页面到工作区

**关键约束**：Background 是"大脑"，所有逻辑在 Background 完成，不转发到 Sidebar。

---

## 架构设计

```
用户按快捷键
    ↓
sidebar-tab-switch.js (Content Script)
    ↓ chrome.runtime.sendMessage({ action: 'sidebarTabSwitch' })
sidebar_toggle.js (Background) ← 大脑
    ↓ 读取 storage 数据，计算下一个 tab
    ↓ chrome.tabs.update() 直接切换
    ↓
完成切换
```

---

## 实现步骤

### Step 1: 创建/更新 Content Script

**文件**：`runjs/sidebar/sidebar-tab-switch.js`

```javascript
(function() {
  'use strict';

  // 快捷键配置
  let tabSwitchConfig = null;
  let tabSwitchEnabled = true;
  let addWorkspaceConfig = null;
  let addWorkspaceEnabled = true;

  // 快捷键存储键名
  const TAB_SWITCH_SHORTCUT_KEY = 'translation.sidebarTabSwitch.shortcut';
  const TAB_SWITCH_ENABLED_KEY = 'translation.sidebarTabSwitch.enabled';
  const ADD_WORKSPACE_SHORTCUT_KEY = 'translation.addWorkspace.shortcut';
  const ADD_WORKSPACE_ENABLED_KEY = 'translation.addWorkspace.enabled';

  // 加载配置
  function loadConfig() {
    chrome.storage.local.get([...], (result) => {
      // 加载各快捷键配置
    });
  }

  // 快捷键匹配检查
  function isShortcutMatch(e, config) {
    if (!config) return false;
    return (
      e.ctrlKey === config.ctrlKey &&
      e.altKey === config.altKey &&
      e.shiftKey === config.shiftKey &&
      e.metaKey === config.metaKey &&
      e.key === config.key
    );
  }

  // 键盘事件监听
  function handleKeyDown(e) {
    // 忽略输入框内的按键
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Tab 切换快捷键
    if (tabSwitchEnabled && tabSwitchConfig && isShortcutMatch(e, tabSwitchConfig)) {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'sidebarTabSwitch' });
      return;
    }

    // 添加工作区快捷键
    if (addWorkspaceEnabled && addWorkspaceConfig && isShortcutMatch(e, addWorkspaceConfig)) {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'addToWorkspace' });
      return;
    }
  }

  // 监听来自 Sidebar 的配置更新消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translation.sidebarTabSwitch.updateShortcut') {
      tabSwitchConfig = request.shortcut;
      sendResponse({ success: true });
    }
    // ... 其他消息处理
    return true;
  });

  // 监听 storage 变化
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // 同步快捷键配置
  });

  loadConfig();
  document.addEventListener('keydown', handleKeyDown, true);
})();
```

### Step 2: Background 消息处理

**文件**：`backgroudtask/sidebar_toggle.js`

```javascript
// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sidebarTabSwitch') {
    switchSelectedTab()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应
  }

  if (request.action === 'addToWorkspace') {
    addCurrentPageToWorkspace()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, reason: 'error' }));
    return true;
  }

  return false;
});

// Tab 轮询切换
async function switchSelectedTab() {
  const allTabs = await getAllTabs();
  if (allTabs.length === 0) return;

  const nextIndex = (currentTabIndex + 1) % allTabs.length;
  currentTabIndex = nextIndex;
  await saveTabCycleState();

  // 执行切换
  if (allTabs[nextIndex].type === 'workspace') {
    await switchToWorkspaceTab(allTabs[nextIndex]);
  } else {
    await switchToNextPlatform();
  }
}

// 添加当前页面到工作区
async function addCurrentPageToWorkspace(tabId) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) tabId = tab.id;
  }
  // ... 验证 + 保存逻辑
  return { success: true, title: tab.title };
}
```

### Step 3: Sidebar 设置 UI

**文件**：`sidebar/main/aichat/aichat.html`（设置弹窗内）

```html
<div class="aichat-settings-item aichat-settings-item--shortcut">
  <div class="shortcut-header">
    <label class="aichat-settings-label">Tab 切换快捷键</label>
    <label class="switch-toggle">
      <input type="checkbox" id="setting-sidebar-tab-switch-enabled" checked>
      <span class="switch-slider"></span>
    </label>
  </div>
  <div class="shortcut-input-wrapper">
    <input type="text" id="setting-sidebar-tab-switch-shortcut"
           class="shortcut-input" placeholder="默认: `" readonly>
    <button id="clear-sidebar-tab-switch-shortcut" class="shortcut-clear-btn">×</button>
  </div>
</div>
```

**文件**：`sidebar/main/aichat/aichatUtils.js`

```javascript
// 快捷键设置初始化
async function initSidebarTabSwitchShortcut() {
  await loadSidebarTabSwitchShortcut();
  await loadSidebarTabSwitchEnabled();

  // 绑定事件
  document.getElementById("setting-sidebar-tab-switch-shortcut")?.addEventListener("click", startRecording);
  // ...
}

// 保存后广播到所有 content script
async function saveSidebarTabSwitchShortcut(shortcut) {
  await chrome.storage.local.set({ [SIDEBAR_TAB_SWITCH_SHORTCUT_KEY]: shortcut });

  // 广播给所有标签页的 content script
  const tabs = await chrome.tabs.query({});
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      action: "translation.sidebarTabSwitch.updateShortcut",
      shortcut: shortcut,
    }).catch(() => {});
  });
}
```

---

## 关键设计原则

### 1. Background 是大脑

**错误做法**：
```
Content Script → Background → Sidebar → Background → 执行
```

**正确做法**：
```
Content Script → Background → 执行（直接操作 chrome.tabs）
```

### 2. 快捷键配置三端同步

| 组件 | 职责 |
|------|------|
| Content Script | 监听键盘 + 发送消息 |
| Background | 存储配置 + 处理逻辑 |
| Sidebar | 设置 UI + 保存配置 + 广播更新 |

### 3. 存储键名规范

```
translation.<功能>.<配置项>
例如：
- translation.sidebarTabSwitch.shortcut
- translation.sidebarTabSwitch.enabled
- translation.addWorkspace.shortcut
- translation.addWorkspace.enabled
```

---

## 错误案例

| 错误操作 | 后果 | 正确做法 |
|---------|------|---------|
| Background 不处理消息，只转发到 Sidebar | 消息链路复杂，Sidebar 关闭时功能失效 | Background 直接处理 |
| 快捷键配置只在 Sidebar 本地存储 | 其他标签页的 content script 无法同步 | 通过 storage 或消息广播同步 |
| Content Script 直接操作 chrome.tabs | 权限不足，无法切换标签页 | 消息发送到 Background 处理 |
| 快捷键监听在所有页面都激活 | 性能浪费，输入框内也可能触发 | 检查 `e.target` 排除 INPUT/TEXTAREA |

---

## 相关 Skill

- [[add-func-script]] — funcs/ 快捷键绑定规范
- [[keyboard-shortcut-architecture]] — 全扩展快捷键分层架构
- [[runjs-module-standards]] — runjs/ 内容脚本注入规范
