/**
 * sidebar-tab-switch.js
 *
 * Content Script: 监听自定义快捷键，在 sidebar 和页面之间切换 tab
 *
 * 功能：
 * 1. Tab 切换快捷键（默认 `）：在工作区标签页与 AI 平台之间循环切换
 * 2. 添加工作区快捷键（默认 Alt+W）：快速添加当前页面到工作区
 *
 * 架构：
 * - 快捷键配置存储在 chrome.storage.local
 * - 快捷键触发时，通过 chrome.runtime.sendMessage 通知 background 处理
 * - Background 端 (sidebar_toggle.js) 执行实际切换操作
 */

(function() {
  'use strict';

  // Tab 切换快捷键配置
  let tabSwitchConfig = null;
  let tabSwitchEnabled = true;

  // 添加工作区快捷键配置
  let addWorkspaceConfig = null;
  let addWorkspaceEnabled = true;

  // 快捷键存储键名
  const TAB_SWITCH_SHORTCUT_KEY = 'translation.sidebarTabSwitch.shortcut';
  const TAB_SWITCH_ENABLED_KEY = 'translation.sidebarTabSwitch.enabled';
  const ADD_WORKSPACE_SHORTCUT_KEY = 'translation.addWorkspace.shortcut';
  const ADD_WORKSPACE_ENABLED_KEY = 'translation.addWorkspace.enabled';

  // 加载配置
  function loadConfig() {
    chrome.storage.local.get([TAB_SWITCH_SHORTCUT_KEY, TAB_SWITCH_ENABLED_KEY, ADD_WORKSPACE_SHORTCUT_KEY, ADD_WORKSPACE_ENABLED_KEY], (result) => {
      // Tab 切换快捷键
      if (result[TAB_SWITCH_SHORTCUT_KEY]) {
        tabSwitchConfig = result[TAB_SWITCH_SHORTCUT_KEY];
      } else {
        tabSwitchConfig = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '`' };
      }
      tabSwitchEnabled = result[TAB_SWITCH_ENABLED_KEY] !== false;
      console.log('[SidebarTabSwitch] Tab切换快捷键已加载:', formatShortcut(tabSwitchConfig), '开关:', tabSwitchEnabled ? '启用' : '禁用');

      // 添加工作区快捷键
      if (result[ADD_WORKSPACE_SHORTCUT_KEY]) {
        addWorkspaceConfig = result[ADD_WORKSPACE_SHORTCUT_KEY];
      } else {
        addWorkspaceConfig = { ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, key: 'W' };
      }
      addWorkspaceEnabled = result[ADD_WORKSPACE_ENABLED_KEY] !== false;
      console.log('[SidebarTabSwitch] 添加工作区快捷键已加载:', formatShortcut(addWorkspaceConfig), '开关:', addWorkspaceEnabled ? '启用' : '禁用');
    });
  }

  // 格式化快捷键显示
  function formatShortcut(config) {
    if (!config) return '未设置';
    const parts = [];
    if (config.ctrlKey) parts.push('Ctrl');
    if (config.altKey) parts.push('Alt');
    if (config.shiftKey) parts.push('Shift');
    if (config.metaKey) parts.push('Meta');
    parts.push(config.key);
    return parts.join('+');
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

  // 通知 background 切换 tab
  function notifySwitchTab() {
    chrome.runtime.sendMessage({ action: 'sidebarTabSwitch' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[SidebarTabSwitch] Background 可能未就绪');
      }
    });
  }

  // 通知 background 添加当前页面到工作区
  function notifyAddToWorkspace() {
    chrome.runtime.sendMessage({ action: 'addToWorkspace' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[SidebarTabSwitch] Background 可能未就绪');
      } else {
        console.log('[SidebarTabSwitch] 已通知添加工作区:', response);
      }
    });
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
      console.log('[SidebarTabSwitch] Tab切换快捷键触发');
      notifySwitchTab();
      return;
    }

    // 添加工作区快捷键
    if (addWorkspaceEnabled && addWorkspaceConfig && isShortcutMatch(e, addWorkspaceConfig)) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[SidebarTabSwitch] 添加工作区快捷键触发');
      notifyAddToWorkspace();
      return;
    }
  }

  // 监听来自 Sidebar 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Tab 切换快捷键更新
    if (request.action === 'translation.sidebarTabSwitch.updateShortcut') {
      tabSwitchConfig = request.shortcut;
      console.log('[SidebarTabSwitch] Tab切换快捷键已更新:', formatShortcut(tabSwitchConfig));
      sendResponse({ success: true });
    }
    if (request.action === 'translation.sidebarTabSwitch.clearShortcut') {
      tabSwitchConfig = null;
      console.log('[SidebarTabSwitch] Tab切换快捷键已清除');
      sendResponse({ success: true });
    }
    if (request.action === 'translation.sidebarTabSwitch.updateEnabled') {
      tabSwitchEnabled = request.enabled;
      console.log('[SidebarTabSwitch] Tab切换开关状态已更新:', tabSwitchEnabled ? '启用' : '禁用');
      sendResponse({ success: true });
    }

    // 添加工作区快捷键更新
    if (request.action === 'translation.addWorkspace.updateShortcut') {
      addWorkspaceConfig = request.shortcut;
      console.log('[SidebarTabSwitch] 添加工作区快捷键已更新:', formatShortcut(addWorkspaceConfig));
      sendResponse({ success: true });
    }
    if (request.action === 'translation.addWorkspace.clearShortcut') {
      addWorkspaceConfig = null;
      console.log('[SidebarTabSwitch] 添加工作区快捷键已清除');
      sendResponse({ success: true });
    }
    if (request.action === 'translation.addWorkspace.updateEnabled') {
      addWorkspaceEnabled = request.enabled;
      console.log('[SidebarTabSwitch] 添加工作区开关状态已更新:', addWorkspaceEnabled ? '启用' : '禁用');
      sendResponse({ success: true });
    }

    return true;
  });

  // 监听 storage 变化
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // Tab 切换快捷键
    if (changes[TAB_SWITCH_SHORTCUT_KEY]) {
      tabSwitchConfig = changes[TAB_SWITCH_SHORTCUT_KEY].newValue || null;
      console.log('[SidebarTabSwitch] Tab切换快捷键已同步:', formatShortcut(tabSwitchConfig));
    }
    if (changes[TAB_SWITCH_ENABLED_KEY]) {
      tabSwitchEnabled = changes[TAB_SWITCH_ENABLED_KEY].newValue !== false;
      console.log('[SidebarTabSwitch] Tab切换开关状态已同步:', tabSwitchEnabled ? '启用' : '禁用');
    }

    // 添加工作区快捷键
    if (changes[ADD_WORKSPACE_SHORTCUT_KEY]) {
      addWorkspaceConfig = changes[ADD_WORKSPACE_SHORTCUT_KEY].newValue || null;
      console.log('[SidebarTabSwitch] 添加工作区快捷键已同步:', formatShortcut(addWorkspaceConfig));
    }
    if (changes[ADD_WORKSPACE_ENABLED_KEY]) {
      addWorkspaceEnabled = changes[ADD_WORKSPACE_ENABLED_KEY].newValue !== false;
      console.log('[SidebarTabSwitch] 添加工作区开关状态已同步:', addWorkspaceEnabled ? '启用' : '禁用');
    }
  });

  // 初始化
  loadConfig();

  // 绑定键盘监听
  document.addEventListener('keydown', handleKeyDown, true);

  console.log('[SidebarTabSwitch] 已初始化，Tab切换: `, 添加工作区: Alt+W');
})();
