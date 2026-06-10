/**
 * cc.js — Claude Code 模块入口
 *
 * 架构：
 *   cc.js (side panel) → chrome.runtime.sendMessage → background (nxce_ws.js)
 *     → WebSocket → nx-ce serve → Claude SDK
 *
 * 响应路由：
 *   nx-ce serve → WS → background → chrome.runtime.sendMessage (broadcastEvent)
 *     → cc.js chrome.runtime.onMessage ('nxce_event')
 *
 * 进程管理（启动/停止 nx-ce）：
 *   cc.js → chrome.runtime.sendMessage → background (native_relay)
 *     → native_host (claudeStartServe)
 *
 * 子模块位于 cc/modules/ 下（按依赖层次分两层）：
 *   common/：
 *     ccConstants.js       — 配置常量 + 共享状态
 *     ccUtils.js           — 纯工具函数
 *     ccBgComms.js         — Background 通信层
 *   features/：
 *     ccTabs.js            — 多 Tab 管理
 *     ccSkills.js          — Skills 加载 + 自动补全
 *     ccUI.js              — 状态指示器 / 历史弹窗 / 连接控制
 *     ccDispatcher.js      — WS 事件分发 + 流式渲染
 *     ccSend.js            — 消息发送
 */

import { state } from './modules/common/ccConstants.js';
import { sendBg } from './modules/common/ccBgComms.js';
import {
  createTab, initFirstTab, initTabListeners, updateEmptyState,
} from './modules/features/ccTabs.js';
import { loadTabSkills, initSkillAutocomplete } from './modules/features/ccSkills.js';
import {
  initStatusPolling, restartStatusPoll,
  initHistoryPopup, initServeControls,
} from './modules/features/ccUI.js';
import { dispatch, initThoughtToggle } from './modules/features/ccDispatcher.js';
import { initSendButton } from './modules/features/ccSend.js';

// ==================== mount / unmount ====================

export async function mount(container) {
  // 1. 加载 cc.css
  if (!document.querySelector('link[href*="cc/cc.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './cc/cc.css';
    document.head.appendChild(link);
  }

  // 2. 注入模板
  const resp = await fetch('./cc/cc.html');
  container.innerHTML = await resp.text();

  // 3. 初始化第一个 tab
  initFirstTab({ onCreated: t => loadTabSkills(t) });

  // 4. 初始化子系统
  initTabListeners({
    onSwitch: t => { loadTabSkills(t); restartStatusPoll(); },
    onPathChange: () => restartStatusPoll(),
  });
  initHistoryPopup();
  initSendButton();
  initServeControls();
  initSkillAutocomplete();
  initStatusPolling();

  // 5. 思考区域折叠/展开事件代理
  initThoughtToggle();

  // 6. 空状态按钮
  const emptyBtn = document.getElementById('cc-empty-state-btn');
  if (emptyBtn) emptyBtn.addEventListener('click', () => createTab());

  // 7. 根据初始有无 tab 更新空状态
  updateEmptyState();

  // 8. 监听 background 转发来的 WS 事件
  if (!state.runtimeInit) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.action !== 'nxce_event') return false;
      dispatch(msg.event);
      return false;
    });
    state.runtimeInit = true;
  }
}

export function unmount(container) {
  if (state.statusTimer) { clearInterval(state.statusTimer); state.statusTimer = null; }
  // 关闭所有 tab 的 session
  document.querySelectorAll('.cc-tab').forEach(tab => {
    if (tab._sessionName) {
      sendBg({ action: 'nxce_ws', cmd: 'closeSession', session: tab._sessionName, cwd: tab._path }).catch(() => {});
    }
  });
  container.innerHTML = '';
}
