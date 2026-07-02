---
name: chrome-sidebar-shortcut
description: Chrome 扩展边栏快捷键切换模块实现
---

# Chrome Sidebar 快捷键切换模块

## ⚠️ 难度警告

此功能涉及 Chrome Side Panel API，对 AI 理解能力要求较高：
- 伪关闭（setOptions 空白页）和真关闭（close API）效果完全不同
- 状态持久化不当会导致扩展重启后状态丢失
- 多标签页场景下 tabId 管理容易出错
- open() API 有 tabId 和 windowId 两种参数，适用场景不同

## 核心 API 速查

| 操作 | API | 说明 |
|-----|-----|------|
| 打开边栏 | `chrome.sidePanel.open({ tabId })` | 直接打开，使用 manifest 的 default_path |
| 打开边栏 | `chrome.sidePanel.open({ windowId })` | 不知道具体 tab 时 |
| **真正关闭** | `chrome.sidePanel.close({ tabId })` | ⚠️ 不要用空白页替代 |
| 切换内容 | `chrome.sidePanel.setOptions({ tabId, path })` | 仅在需要切换到不同页面时 |

## ⚠️ 关键点：不需要 setOptions

manifest.json 已配置默认路径：

```json
"side_panel": {
  "default_path": "sidebar/main/main.html"
}
```

所以 **打开边栏只需一行**：
```javascript
await chrome.sidePanel.open({ tabId });
// 不需要 setOptions！会自动使用 default_path
```

只有需要切换到不同页面时才用 setOptions。

## 打开边栏的四种方式

### 1. popup 中打开（精确控制）

```javascript
// popup/main/mainUtils.js
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (tab) {
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
}
```

### 2. background script 中打开（用 windowId）

```javascript
// backgroudtask/html_text_reader/index.js
const windowId = sender.tab?.windowId;
if (windowId) {
  chrome.sidePanel.open({ windowId }).catch(() => {});
}
```

### 3. 快捷键命令中打开（直接用回调的 tab）

```javascript
// backgroudtask/sidebar_toggle.js
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle_sidebar') {
    // 快捷键回调直接提供 tab，无需 query
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});
```

### 4. 切换内容页面时

```javascript
// 当边栏已打开，需要切换到不同页面
await chrome.sidePanel.setOptions({
  tabId,
  path: 'sidebar/other/other.html'
});
```

## 完整模块代码（sidebar_toggle.js）

```javascript
/**
 * 边栏切换模块
 */
console.log('[SidebarToggle] 模块加载');

let sidebarOpenTabs = new Set();

// ========== 状态管理 ==========

chrome.storage.session.get('sidebarOpenTabs').then(result => {
  if (result.sidebarOpenTabs) {
    sidebarOpenTabs = new Set(result.sidebarOpenTabs);
  }
});

async function saveState() {
  await chrome.storage.session.set({
    sidebarOpenTabs: Array.from(sidebarOpenTabs)
  });
}

// ========== 打开边栏（只需 open，不需 setOptions） ==========

async function openSidebar(tabId) {
  try {
    console.log('[SidebarToggle] 打开边栏，tab:', tabId);

    // ⚠️ 只需一行 open，会自动使用 manifest 的 default_path
    await chrome.sidePanel.open({ tabId });

    sidebarOpenTabs.add(tabId);
    await saveState();
    console.log('[SidebarToggle] 打开成功');
  } catch (e) {
    console.error('[SidebarToggle] 打开失败:', e);
  }
}

// ========== 关闭边栏 - 真正关闭 ==========

async function closeSidebar(tabId) {
  try {
    console.log('[SidebarToggle] 关闭边栏，tab:', tabId);

    // ⚠️ 使用 close() 而不是 setOptions 空白页
    await chrome.sidePanel.close({ tabId });

    sidebarOpenTabs.delete(tabId);
    await saveState();
    console.log('[SidebarToggle] 关闭成功');
  } catch (e) {
    console.error('[SidebarToggle] 关闭失败:', e);
  }
}

// ========== 切换逻辑 ==========

async function toggleSidebar(tabId) {
  if (!tabId || tabId === -1) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) tabId = tab.id;
    if (!tabId) {
      console.log('[SidebarToggle] 无法获取标签页 ID');
      return;
    }
  }

  if (sidebarOpenTabs.has(tabId)) {
    await closeSidebar(tabId);
  } else {
    await openSidebar(tabId);
  }
}

// ========== 监听器 ==========

chrome.commands.onCommand.addListener((command, tab) => {
  console.log('[SidebarToggle] 收到命令:', command, 'tab:', tab?.id);
  if (command === 'toggle_sidebar') {
    toggleSidebar(tab?.id);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sidebarOpenTabs.delete(tabId);
  saveState();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    sidebarOpenTabs.delete(tabId);
    saveState();
  }
});

export function setupSidebarCommandListener() {
  console.log('[SidebarToggle] setupSidebarCommandListener 被调用');
}
```

## manifest.json 配置

```json
{
  "permissions": ["sidePanel", "tabs"],
  "commands": {
    "toggle_sidebar": {
      "suggested_key": { "default": "Alt+S" },
      "description": "打开/关闭 AI 助手边栏"
    }
  },
  "side_panel": {
    "default_path": "sidebar/main/main.html"
  }
}
```

## 错误案例（AI 常见犯错）

| AI 错误做法 | 实际后果 | 正确做法 |
|------------|---------|---------|
| 打开时调用 `setOptions` | 多余代码，default_path 已设置 | 只用 `open()` |
| 用 `setOptions({ path: 'closed.html' })` 关闭 | 伪关闭，边栏仍存在 | 用 `chrome.sidePanel.close()` |
| `open()` 和 `setOptions()` 合并 | 不需要，default_path 已指定 | 分开或省略 setOptions |
| 未监听 `tabs.onRemoved` | 标签页关闭后状态残留 | 必须添加 |
| 未持久化状态 | 扩展重启后状态丢失 | 用 `storage.session` |

## tabId vs windowId 选择

| 场景 | 推荐参数 | 原因 |
|-----|---------|------|
| popup 中 | `tabId` | 直接获取当前 tab |
| background 消息处理 | `windowId` | 从 sender.tab.windowId |
| 快捷键回调 | `tabId` | 回调直接提供 tab |
| 不知道具体标签页 | `windowId` | 打开窗口的边栏 |

## 文件清理

伪关闭方案创建的 `closed.html` 已在使用真关闭后删除。
