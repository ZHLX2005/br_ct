/**
 * ccUI.js — UI 组件聚合
 *
 * 非核心 UI 组件：服务状态指示器、历史会话弹窗、连接控制。
 *
 * 导出层次：
 *   init*()        — cc.js mount() 中调用的初始化入口，负责绑定事件和启动定时器
 *   restart*()     — 被外部事件触发时主动调用的重启函数（如切换 tab、路径变更）
 *   fetch*()       — 实际的异步数据请求函数，也可被其他模块直接调用（如 ccDispatcher.js）
 *   update*()      — 纯 DOM 更新函数
 */

import { sendBg, sendBgRequest } from '../common/ccBgComms.js';
import { getActiveTab, createTab, saveTabState, restoreTabState } from './ccTabs.js';
import { loadTabSkills } from './ccSkills.js';
import { escHtml, pureSessionName } from '../common/ccUtils.js';
import { CC_DEFAULT_PATH, STATUS_POLL_INTERVAL, state } from '../common/ccConstants.js';

// ==================== Status & Badge ====================

/**
 * 初始化服务状态轮询。
 * 仅供 cc.js mount() 调用，作为子系统初始化的一步。
 * 实际逻辑委托给 restartStatusPoll()——所以 mount() 也可以直接调 restartStatusPoll()。
 */
export function initStatusPolling() {
  restartStatusPoll();
}

/**
 * 重启状态轮询：清除旧定时器 → 立即查一次 → 启动新定时器。
 *
 * 需要被多个场景主动触发：
 *   - mount() 首次启动（通过 initStatusPolling）
 *   - 切换 tab（onSwitch 回调）
 *   - 修改 cwd 路径（onPathChange 回调）
 *   - 恢复历史会话（restoreSession）
 * 所以它必须 export，不能只在模块内部。
 */
export function restartStatusPoll() {
  if (state.statusTimer) { clearInterval(state.statusTimer); state.statusTimer = null; }
  fetchStatus();
  state.statusTimer = setInterval(fetchStatus, STATUS_POLL_INTERVAL);
}

/**
 * 查询当前活跃 tab 对应的服务状态，更新 UI badge。
 * 也被 ccDispatcher.js 在 WS done 事件中直接调用（收到响应后立即刷新状态）。
 *
 * 幂等：无 tab / 无 badge / 无 cwd 时静默返回。
 */
export function fetchStatus() {
  const tab = getActiveTab();
  const badge = document.getElementById('cc-status-badge');
  if (!tab || !badge) return;
  const cwd = tab._path;
  if (!cwd) return;
  sendBgRequest({ action: 'nxce_ws', cmd: 'getStatus', session: tab._sessionName, cwd }).then(resp => {
    if (!resp?.ok || !resp.data) {
      badge.style.display = 'none';
      return;
    }
    const st = resp.data.lifecycleState || (resp.data.isActive ? 'running' : 'stopped');
    const statusMap = { running: '运行中', stopped: '已停止', crashed: '已崩溃', resuming: '恢复中' };
    const textEl = badge.querySelector('.cc-status-text');
    if (textEl) textEl.textContent = statusMap[st] || st;
    badge.dataset.state = st;
    badge.style.display = 'inline-flex';
  }).catch(() => { badge.style.display = 'none'; });
}

// ==================== History Popup ====================

/**
 * 初始化历史会话弹窗。
 *
 * 点击 #cc-history-btn 时通过 background 查询历史会话列表，动态构建 DOM。
 * 内部 restoreSession() 函数共享 ccTabs.createTab() 的回调机制。
 *
 * 弹窗点击外部自动关闭（全局 click 监听器）。
 */
export function initHistoryPopup() {
  const btn = document.getElementById('cc-history-btn');
  const popup = document.getElementById('cc-history-popup');
  if (!btn || !popup) return;

  function close() { popup.style.display = 'none'; }

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (popup.style.display === 'block') { close(); return; }
    const resp = await sendBgRequest({ action: 'nxce_ws', cmd: 'listSessions' });
    if (!resp?.ok || !resp.data?.sessions?.length) {
      popup.innerHTML =
        '<div class="cc-history-header">历史会话</div>' +
        '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:12px;">暂无历史会话</div>';
      popup.style.display = 'block';
      return;
    }
    const itemsHtml = resp.data.sessions.map((s) => {
      const st = s.lifecycleState || 'stopped';
      const sessionName = escHtml(pureSessionName(s));
      const cwd = escHtml(s.cwd || '');
      const model = s.model ? escHtml(s.model) : '';
      return `<div class="cc-history-item" data-session="${sessionName}" data-cwd="${cwd}">` +
        `<span class="cc-session-dot" data-state="${escHtml(st)}"></span>` +
        `<span class="cc-session-name">${escHtml(pureSessionName(s))}</span>` +
        `<span class="cc-session-meta">${cwd}${model ? ' · ' + model : ''}</span>` +
        `</div>`;
    }).join('');

    popup.innerHTML =
      '<div class="cc-history-header">历史会话</div>' +
      '<div class="cc-history-list">' + itemsHtml + '</div>';
    popup.style.display = 'block';

    popup.querySelectorAll('.cc-history-item').forEach(el => {
      el.addEventListener('click', () => {
        const sessionName = el.dataset.session;
        const cwd = el.dataset.cwd;
        if (!sessionName) return;
        close();
        restoreSession(sessionName, cwd);
      });
    });
  });

  document.addEventListener('click', (e) => {
    if (popup.style.display !== 'block') return;
    if (!btn.contains(e.target) && !popup.contains(e.target)) close();
  });
}

/**
 * 恢复历史会话：创建 tab 并填入之前的 sessionName / cwd / skills / messages。
 * 通过 ccTabs.createTab 的 onCreated 回调完成状态注入。
 */
function restoreSession(sessionName, cwd) {
  const tab = createTab({ sessionName, cwd }, {
    onCreated: (t) => {
      t._sessionName = sessionName;
      if (cwd) {
        t._path = cwd;
        t._skills = [];
        t._skillsCwd = null;
      }
      loadTabSkills(t);
      restoreTabState(t);
      restartStatusPoll();
    },
  });
}

// ==================== Serve Controls ====================

/**
 * 更新连接按钮和服务状态的 UI。
 * 纯 DOM 操作，不涉及通信。
 *
 * @param {'disconnected'|'connecting'|'connected'|'error'} stateVal
 * @param {string} text — 状态文本（如"已连接""启动中…"）
 */
export function updateServeStatus(stateVal, text) {
  const el = document.getElementById('cc-serve-status');
  const btn = document.getElementById('cc-serve-btn');
  if (el) { el.dataset.state = stateVal; const t = el.querySelector('.cc-serve-text'); if (t) t.textContent = text; }
  if (btn) {
    btn.dataset.state = stateVal;
    btn.dataset.loading = stateVal === 'connecting' ? 'true' : 'false';
    const l = btn.querySelector('span:last-child');
    if (l) l.textContent = ({ disconnected: '连接', connecting: '取消', connected: '断开', error: '重试' })[stateVal] || '连接';
  }
}

/**
 * 初始化连接控制按钮。
 *
 * 点击流程：
 *   已连接/连接中  → 断开
 *   已断开/出错    → claudeStartServe → 延迟 2s 后 ping 确认
 *
 * disconnect 走 WS 通道（nxce_ws cmd: disconnect）
 * connect 走 nativeMessage（启动 native host 进程）
 */
export function initServeControls() {
  const btn = document.getElementById('cc-serve-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const curState = btn.dataset.state;
    if (curState === 'connecting' || curState === 'connected') {
      sendBg({ action: 'nxce_ws', cmd: 'disconnect' }).catch(() => {});
      updateServeStatus('disconnected', '已断开');
      return;
    }
    updateServeStatus('connecting', '启动中…');
    sendBg({ action: 'nativeMessage', payload: { command: 'claudeStartServe' } }).then(resp => {
      if (resp?.status === 'ok') {
        setTimeout(async () => {
          const p = await sendBgRequest({ action: 'nxce_ws', cmd: 'ping' }, 3000);
          updateServeStatus(p?.connected ? 'connected' : 'error', p?.connected ? '已连接' : '启动后未连上');
        }, 2000);
      } else {
        updateServeStatus('error', resp?.message || '启动失败');
      }
    });
  });
}
