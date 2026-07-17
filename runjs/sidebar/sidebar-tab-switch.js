/**
 * sidebar-tab-switch.js
 *
 * Content Script: 监听自定义快捷键，通知 sidebar 切换 tab
 *
 * 功能：按快捷键时，在 sidebar 中切换选中的 tab（工作区标签页与平台标签页之间切换）
 *
 * 架构：
 * - 快捷键配置存储在 chrome.storage.local['translation.sidebarTabSwitch.shortcut']
 * - 开关配置存储在 chrome.storage.local['translation.sidebarTabSwitch.enabled']
 * - 快捷键触发时，通过 chrome.runtime.sendMessage 通知 sidebar
 * - Sidebar 端 (aichatUtils.js) 监听消息并执行切换
 */

(function() {
  'use strict';

  // 快捷键配置
  let shortcutConfig = null;
  let isEnabled = true;  // 默认启用

  // 快捷键存储键名
  const SHORTCUT_KEY = 'translation.sidebarTabSwitch.shortcut';
  const ENABLED_KEY = 'translation.sidebarTabSwitch.enabled';

  // 加载配置
  function loadConfig() {
    chrome.storage.local.get([SHORTCUT_KEY, ENABLED_KEY], (result) => {
      if (result[SHORTCUT_KEY]) {
        shortcutConfig = result[SHORTCUT_KEY];
        console.log('[SidebarTabSwitch] 快捷键已加载:', formatShortcut(shortcutConfig));
      } else {
        // 默认快捷键: 单独按 `
        shortcutConfig = {
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false,
          key: '`'
        };
        console.log('[SidebarTabSwitch] 使用默认快捷键: `');
      }

      isEnabled = result[ENABLED_KEY] !== false;  // 默认启用
      console.log('[SidebarTabSwitch] 开关状态:', isEnabled ? '启用' : '禁用');
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
      e.key === config.key  // 精确匹配，不转小写（区分 ` 和其他键）
    );
  }

  // 通知 sidebar 切换 tab
  function notifySidebarSwitchTab() {
    chrome.runtime.sendMessage({
      action: 'sidebarTabSwitch'
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[SidebarTabSwitch] Sidebar 可能未打开');
      } else {
        console.log('[SidebarTabSwitch] 已通知 sidebar 切换 tab');
      }
    });
  }

  // 键盘事件监听
  function handleKeyDown(e) {
    // 检查开关状态
    if (!isEnabled) return;

    // 检查快捷键配置
    if (!shortcutConfig) return;

    // 忽略输入框内的按键
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    if (isShortcutMatch(e, shortcutConfig)) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[SidebarTabSwitch] 快捷键触发');
      notifySidebarSwitchTab();
    }
  }

  // 监听快捷键更新消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translation.sidebarTabSwitch.updateShortcut') {
      shortcutConfig = request.shortcut;
      console.log('[SidebarTabSwitch] 快捷键已更新:', formatShortcut(shortcutConfig));
      sendResponse({ success: true });
    }
    if (request.action === 'translation.sidebarTabSwitch.clearShortcut') {
      shortcutConfig = null;
      console.log('[SidebarTabSwitch] 快捷键已清除');
      sendResponse({ success: true });
    }
    if (request.action === 'translation.sidebarTabSwitch.updateEnabled') {
      isEnabled = request.enabled;
      console.log('[SidebarTabSwitch] 开关状态已更新:', isEnabled ? '启用' : '禁用');
      sendResponse({ success: true });
    }
    return true;
  });

  // 监听 storage 变化
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes[SHORTCUT_KEY]) {
      const newValue = changes[SHORTCUT_KEY].newValue;
      shortcutConfig = newValue || null;
      console.log('[SidebarTabSwitch] 快捷键已同步:', formatShortcut(shortcutConfig));
    }

    if (changes[ENABLED_KEY]) {
      isEnabled = changes[ENABLED_KEY].newValue !== false;
      console.log('[SidebarTabSwitch] 开关状态已同步:', isEnabled ? '启用' : '禁用');
    }
  });

  // 初始化
  loadConfig();

  // 绑定键盘监听
  document.addEventListener('keydown', handleKeyDown, true);

  console.log('[SidebarTabSwitch] 已初始化，默认快捷键: `');
})();
