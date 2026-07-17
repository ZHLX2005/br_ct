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
        showToast('添加到工作区', '扩展未就绪，请刷新页面');
      } else {
        console.log('[SidebarTabSwitch] 添加结果:', response);
        if (response.success) {
          showToast('已添加', `「${response.title}」已添加到工作区`);
        } else if (response.reason === 'already_exists') {
          showToast('已在工作区', '该标签页已存在');
        } else if (response.reason === 'ai_platform') {
          showToast('跳过', 'AI 平台页面无需添加');
        } else if (response.reason === 'no_tab') {
          showToast('添加失败', '无法获取当前标签页');
        } else {
          showToast('添加失败', '添加到工作区时出错');
        }
      }
    });
  }

  // 显示 Toast 提示
  function showToast(title, message) {
    // 移除已有的 toast
    const existingToast = document.getElementById('sidebar-toast');
    if (existingToast) existingToast.remove();

    // 创建 toast 元素
    const toast = document.createElement('div');
    toast.id = 'sidebar-toast';
    toast.innerHTML = `
      <div class="toast-icon">✓</div>
      <div class="toast-content">
        <div class="toast-title">${escapeHtml(title)}</div>
        <div class="toast-message">${escapeHtml(message)}</div>
      </div>
      <button class="toast-close">×</button>
    `;

    // 添加样式
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #1a1a1a;
      color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      max-width: 320px;
      animation: toastSlideIn 0.3s ease-out;
    `;

    const iconStyle = `flex-shrink: 0; width: 24px; height: 24px; background: #333; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px;`;
    const contentStyle = `flex: 1; min-width: 0;`;
    const titleStyle = `font-weight: 600; margin-bottom: 2px;`;
    const messageStyle = `opacity: 0.8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
    const closeStyle = `flex-shrink: 0; width: 20px; height: 20px; background: #333; border: none; border-radius: 50%; color: #999; cursor: pointer; font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; transition: all 0.2s;`;

    toast.querySelector('.toast-icon').style.cssText = iconStyle;
    toast.querySelector('.toast-content').style.cssText = contentStyle;
    toast.querySelector('.toast-title').style.cssText = titleStyle;
    toast.querySelector('.toast-message').style.cssText = messageStyle;
    toast.querySelector('.toast-close').style.cssText = closeStyle;

    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
      @keyframes toastSlideIn {
        from { opacity: 0; transform: translateX(100px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes toastSlideOut {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(100px); }
      }
    `;
    if (!document.querySelector('#sidebar-toast-styles')) {
      style.id = 'sidebar-toast-styles';
      document.head.appendChild(style);
    }

    // 关闭按钮
    toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));

    // 自动关闭（4秒）
    toast._timeout = setTimeout(() => removeToast(toast), 4000);

    // 添加到页面
    document.body.appendChild(toast);
  }

  function removeToast(toast) {
    if (!toast) toast = document.getElementById('sidebar-toast');
    if (!toast) return;
    clearTimeout(toast._timeout);
    toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
