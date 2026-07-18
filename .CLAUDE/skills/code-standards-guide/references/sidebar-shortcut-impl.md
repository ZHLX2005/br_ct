---
name: sidebar-shortcut-impl
description: Sidebar 快捷键实现的完整参考：Tab 切换 + 添加工作区功能
reference: code-standards-guide — Sidebar 快捷键实现范例（归档版）
---

# Sidebar 快捷键实现参考

## 场景

需要实现：
1. **Tab 切换快捷键**（默认 `` ` ``）：在工作区标签页与**已勾选**的 AI 平台之间循环切换
2. **添加/移除工作区快捷键**（默认 `Alt+W`）：快速切换当前页面在工作区的加入/移除状态
3. **Toast 提示**（黑白 DOM 创建）：用户操作即时反馈
4. **响应式数据同步**：Sidebar 打开时实时刷新新加入的工作区

**关键约束**：Background 是"大脑"，所有逻辑在 Background 完成，不转发到 Sidebar。

---

## 架构设计

```
用户按快捷键
    ↓
sidebar-tab-switch.js (Content Script)
    ↓ chrome.runtime.sendMessage({ action: ... })
sidebar_toggle.js (Background) ← 大脑
    ↓ 读取 storage 数据，计算下一个 tab
    ↓ chrome.tabs.update() 直接切换
    ↓
完成切换
```

**Tab 列表的组成**：每个**已勾选的 AI 平台**作为一个独立节点加入轮询列表，而不是"AI 平台"作为一个虚拟节点。

```javascript
// ❌ 错误：所有 AI 平台共用一个虚拟节点
tabs.push({ type: 'platform', index: -1, name: 'AI平台' });

// ✅ 正确：每个已勾选平台独立成节点
PLATFORM_HOSTNAMES.forEach((platform, index) => {
  if (platformStates[platform.id] !== false) {
    tabs.push({ type: 'platform', index, name: platform.id, platform });
  }
});
```

---

## 实现步骤

### Step 1: 创建/更新 Content Script

**文件**：`runjs/sidebar/sidebar-tab-switch.js`

```javascript
(function() {
  'use strict';

  // Tab 切换快捷键配置
  let tabSwitchConfig = null;
  let tabSwitchEnabled = true;

  // 添加工作区快捷键配置
  let addWorkspaceConfig = null;
  let addWorkspaceEnabled = true;

  // 快捷键存储键名（统一前缀 translation.<功能>.<配置项>）
  const TAB_SWITCH_SHORTCUT_KEY = 'translation.sidebarTabSwitch.shortcut';
  const TAB_SWITCH_ENABLED_KEY = 'translation.sidebarTabSwitch.enabled';
  const ADD_WORKSPACE_SHORTCUT_KEY = 'translation.addWorkspace.shortcut';
  const ADD_WORKSPACE_ENABLED_KEY = 'translation.addWorkspace.enabled';

  // 加载配置 + 监听 storage 变化（响应式更新）
  // ...

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

    // 添加/移除工作区快捷键
    if (addWorkspaceEnabled && addWorkspaceConfig && isShortcutMatch(e, addWorkspaceConfig)) {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'addToWorkspace' });
      return;
    }
  }
})();
```

### Step 2: Background 消息处理（大脑）

**文件**：`backgroudtask/sidebar_toggle.js`

```javascript
// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sidebarTabSwitch') {
    switchSelectedTab()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'addToWorkspace') {
    addCurrentPageToWorkspace()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, reason: 'error' }));
    return true;
  }

  return false;
});

/**
 * 获取所有可切换的 Tab 列表
 * - 工作区标签（来自 storage.session.sidebar_workspace_tabs）
 * - 已勾选的 AI 平台（来自 storage.local.platformStates）
 */
async function getAllTabs() {
  const tabs = [];
  // 工作区标签
  const wsResult = await chrome.storage.session.get('sidebar_workspace_tabs');
  if (wsResult.sidebar_workspace_tabs) {
    wsResult.sidebar_workspace_tabs.forEach((tab, index) => {
      tabs.push({ type: 'workspace', index, tab });
    });
  }

  // 已勾选的 AI 平台（每个独立成节点）
  const statesResult = await chrome.storage.local.get(PLATFORM_STATES_KEY);
  const platformStates = statesResult[PLATFORM_STATES_KEY] || {};
  PLATFORM_HOSTNAMES.forEach((platform, index) => {
    if (platformStates[platform.id] !== false) {
      tabs.push({ type: 'platform', index, name: platform.id, platform });
    }
  });

  return tabs;
}

/**
 * Tab 轮询切换
 */
async function switchSelectedTab() {
  const allTabs = await getAllTabs();
  if (allTabs.length === 0) return;

  const nextIndex = (currentTabIndex + 1) % allTabs.length;
  const nextTab = allTabs[nextIndex];
  currentTabIndex = nextIndex;
  await saveTabCycleState();

  if (nextTab.type === 'workspace') {
    await switchToWorkspaceTab(nextTab);
  } else {
    await switchToPlatform(nextTab.platform);
  }
}

/**
 * 切换到指定的 AI 平台（未打开则自动创建）
 */
async function switchToPlatform(platform) {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const existingTab = allTabs.find(tab => {
    if (!tab.url) return false;
    try {
      return new URL(tab.url).hostname.includes(platform.hostname);
    } catch { return false; }
  });

  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
  } else {
    // 未打开，自动创建
    await chrome.tabs.create({ url: platform.url, active: true });
  }
}

/**
 * 添加/移除当前页面到工作区（Alt+W 切换）
 */
async function addCurrentPageToWorkspace(tabId) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) tabId = tab.id;
  }

  const tab = await chrome.tabs.get(tabId);

  // 排除 AI 平台页面
  if (isAiWebUrl(tab.url)) {
    return { success: false, reason: 'ai_platform', title: tab.title };
  }

  const result = await chrome.storage.session.get(WORKSPACE_STORAGE_KEY);
  let workspaceTabs = result[WORKSPACE_STORAGE_KEY] || [];

  // 检查是否已存在 → 切换为移除
  const existingIndex = workspaceTabs.findIndex(t => t.tabId === tabId);
  if (existingIndex >= 0) {
    workspaceTabs.splice(existingIndex, 1);
    await chrome.storage.session.set({ [WORKSPACE_STORAGE_KEY]: workspaceTabs });
    return { success: true, action: 'removed', title: tab.title };
  }

  // 不存在 → 添加
  workspaceTabs.push({ tabId: tab.id, title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl });
  await chrome.storage.session.set({ [WORKSPACE_STORAGE_KEY]: workspaceTabs });
  return { success: true, action: 'added', title: tab.title };
}
```

### Step 3: Toast 提示（Content Script 创建 DOM）

在 Content Script 中通过 DOM 创建黑白 toast，反馈操作结果：

```javascript
function showToast(title, message) {
  // 移除已有的 toast
  const existing = document.getElementById('sidebar-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'sidebar-toast';
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    <div class="toast-message">${escapeHtml(message)}</div>
    <button class="toast-close">×</button>
  `;

  // 黑白配色
  toast.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 2147483647;
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; background: #1a1a1a; color: #ffffff;
    border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    font-family: -apple-system, sans-serif; font-size: 14px;
    max-width: 320px; animation: toastSlideIn 0.3s ease-out;
  `;
  // ... 动画 + 自动关闭（4秒）

  document.body.appendChild(toast);
}
```

**根据操作结果显示不同 Toast**：

| 场景 | Toast 标题 | Toast 内容 |
|------|----------|----------|
| 添加成功 | ✓ 已添加 | 「页面」已添加到工作区 |
| 移除成功 | ✓ 已移除 | 「页面」已从工作区移除 |
| AI平台 | ✓ 跳过 | AI 平台页面无需添加 |
| 添加失败 | ✓ 操作失败 | 无法获取当前标签页 |

### Step 4: Sidebar 响应式同步（关键！）

Sidebar 打开时，按 `Alt+W` 添加工作区后必须**自动刷新**，无需关闭再打开。核心：

**文件**：`sidebar/main/aichat/aichatUtils.js`

```javascript
async function initWorkspaceTabs() {
  // 1. 初始加载
  const result = await chrome.storage.session?.get(WORKSPACE_STORAGE_KEY);
  if (result?.[WORKSPACE_STORAGE_KEY]) {
    workspaceTabs = result[WORKSPACE_STORAGE_KEY].map(t => ({ ...t, localId: ++workspaceTabCounter }));
    await refreshWorkspaceTabs();
  }
  renderWorkspaceTabs();

  // 2. 关键：监听 storage 变化，实时响应
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    if (changes[WORKSPACE_STORAGE_KEY]) {
      const newTabs = changes[WORKSPACE_STORAGE_KEY].newValue || [];
      workspaceTabs = newTabs.map(t => ({ ...t, localId: ++workspaceTabCounter }));
      refreshWorkspaceTabs().then(() => renderWorkspaceTabs());
    }
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

### 2. Tab 列表 = 工作区 + 每个已勾选 AI 平台

每个已勾选的 AI 平台是**独立轮询节点**，不是虚拟分组。多个 AI 平台时按顺序循环。

### 3. 快捷键配置三端同步

| 组件 | 职责 |
|------|------|
| Content Script | 监听键盘 + 发送消息 |
| Background | 存储配置 + 处理逻辑 + 直接操作 chrome |
| Sidebar | 设置 UI + 保存配置 + 广播更新 |

### 4. 存储键名规范

```
translation.<功能>.<配置项>
例如：
- translation.sidebarTabSwitch.shortcut
- translation.sidebarTabSwitch.enabled
- translation.addWorkspace.shortcut
- translation.addWorkspace.enabled

// 工作区数据
- sidebar_workspace_tabs（chrome.storage.session）
- platformStates（chrome.storage.local）
```

### 5. 响应式数据同步

Sidebar 必须监听 `chrome.storage.onChanged`，否则后台修改 storage 后 UI 不刷新。

---

## 错误案例

| 错误操作 | 后果 | 正确做法 |
|---------|------|---------|
| Background 不处理消息，只转发到 Sidebar | 消息链路复杂，Sidebar 关闭时功能失效 | Background 直接处理 |
| 快捷键配置只在 Sidebar 本地存储 | 其他标签页的 content script 无法同步 | 通过 storage 或消息广播同步 |
| Content Script 直接操作 chrome.tabs | 权限不足 | 消息发送到 Background |
| 快捷键监听在所有页面都激活 | 输入框内也可能触发 | 检查 `e.target` 排除 INPUT/TEXTAREA |
| AI 平台作为单个虚拟节点 | 多个 AI 平台不会循环切换 | 每个已勾选 AI 平台作为独立节点 |
| Sidebar 不监听 storage.onChanged | 添加工作区后 UI 不刷新 | 添加 `chrome.storage.onChanged.addListener` |
| 用 `chrome.notifications` 反馈 | 用户体验生硬，依赖系统权限 | Content Script 创建黑白 DOM Toast |
| Content Script 中调用 `chrome.sidePanel.open()` | API 在 content script 中不可用 | 通过 background 消息 + popup 触发 |
| 通过 background 消息触发 sidePanel.open | 报错 "may only be called in response to a user gesture" | 用 `chrome.commands.onCommand`（快捷键天然是用户手势） |

---

## chrome.sidePanel 用户手势陷阱

`chrome.sidePanel.open()` **只能在用户手势上下文中调用**：

| 触发位置 | 用户手势？ | 能否调用 |
|---------|-----------|---------|
| `chrome.commands.onCommand` 回调 | ✅ 天然用户手势（快捷键） | ✅ 可以 |
| popup 中按钮点击 | ✅ 用户点击 popup 是用户手势 | ✅ 可以 |
| content script 中点击事件 | ✅ 用户点击是用户手势 | ✅ 可以 |
| background 中收到 onMessage | ❌ 消息触发不是用户手势 | ❌ 报错 |
| `chrome.action.onClicked` | ✅ 用户点击扩展图标 | ✅ 可以 |

**解决方案**：
- 快捷键场景：用 `chrome.commands.onCommand` 注册（现有 `toggle_sidebar`）
- popup 场景：popup 内按钮点击天然是用户手势
- content script 点击：通过 background 转发时**保留 sender 信息**，但仍然报错，因为消息触发不算用户手势

---

## 相关 Skill

- [[add-func-script]] — funcs/ 快捷键绑定规范
- [[keyboard-shortcut-architecture]] — 全扩展快捷键分层架构
- [[runjs-module-standards]] — runjs/ 内容脚本注入规范
