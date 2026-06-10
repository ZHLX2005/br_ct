/**
 * ccUI.js — UI 组件聚合
 *
 * 非核心 UI 组件：服务状态指示器、历史会话弹窗、连接控制。
 */

import { sendBg, sendBgRequest } from './ccBgComms.js';
import { getActiveTab, createTab, saveTabState, restoreTabState } from './ccTabs.js';
import { loadTabSkills } from './ccSkills.js';
import { escHtml, pureSessionName } from './ccUtils.js';
import { CC_DEFAULT_PATH, STATUS_POLL_INTERVAL, state } from './ccConstants.js';

// ==================== Status & Badge ====================

export function initStatusPolling() {
  restartStatusPoll();
}

export function restartStatusPoll() {
  if (state.statusTimer) { clearInterval(state.statusTimer); state.statusTimer = null; }
  fetchStatus();
  state.statusTimer = setInterval(fetchStatus, STATUS_POLL_INTERVAL);
}

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
