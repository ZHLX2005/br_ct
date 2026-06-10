/**
 * ccTabs.js — Tab 管理模块
 *
 * 负责多 tab 的创建、切换、关闭、状态保存/恢复。
 * 纯 DOM 操作 + 通信层调用，不直接依赖 Skills 或 UI 模块。
 * 外部模块通过 onSwitch / onCreated 回调注入 side effect。
 */

import { sendBg } from './ccBgComms.js';
import { escHtml } from './ccUtils.js';
import { CC_DEFAULT_PATH } from './ccConstants.js';

// ==================== 查询 ====================

export function getActiveTab() {
  return document.querySelector('.cc-tab.active');
}

// ==================== 状态保存/恢复 ====================

export function saveTabState(tab) {
  if (!tab) return;
  const rc = document.getElementById('response-content');
  const pi = document.getElementById('cc-path-input');
  if (rc) tab._messages = rc.innerHTML;
  if (pi) tab._path = pi.value;
}

export function restoreTabState(tab) {
  if (!tab) return;
  const rc = document.getElementById('response-content');
  const pi = document.getElementById('cc-path-input');
  if (rc) rc.innerHTML = tab._messages ?? '';
  if (pi) pi.value = tab._path ?? CC_DEFAULT_PATH;
}

// ==================== 空状态 ====================

export function updateEmptyState() {
  const emptyEl = document.getElementById('cc-empty-state');
  const rc = document.getElementById('response-content');
  const pathBar = document.getElementById('cc-path-bar');
  const inputArea = document.querySelector('.input-area');
  const hasTab = document.querySelector('.cc-tab.active');
  if (emptyEl) emptyEl.style.display = hasTab ? 'none' : 'flex';
  if (pathBar) pathBar.style.display = hasTab ? 'flex' : 'none';
  if (inputArea) inputArea.style.display = hasTab ? '' : 'none';
}

// ==================== 切换 Tab ====================

export function switchTab(tab) {
  if (!tab) return;
  const cur = getActiveTab();
  if (cur && cur !== tab) {
    cur._path = document.getElementById('cc-path-input')?.value || CC_DEFAULT_PATH;
    cur._messages = document.getElementById('response-content')?.innerHTML || '';
  }
  document.querySelectorAll('.cc-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const pi = document.getElementById('cc-path-input');
  const rc = document.getElementById('response-content');
  if (pi) pi.value = tab._path ?? CC_DEFAULT_PATH;
  if (rc) rc.innerHTML = tab._messages ?? '';
}

// ==================== 关闭 Tab ====================

/**
 * 关闭指定 tab。返回新的活跃 tab（若有），供调用方处理 side effect。
 */
export function closeTab(tab) {
  if (!tab) return null;
  const session = tab._sessionName;
  const cwd = tab._path;
  if (session && cwd) {
    sendBg({ action: 'nxce_ws', cmd: 'closeSession', session, cwd }).catch(() => {});
  }
  const active = tab.classList.contains('active');
  const prev = tab.previousElementSibling;
  const next = tab.nextElementSibling;
  tab.remove();
  let newActive = null;
  if (active) {
    newActive = prev?.classList.contains('cc-tab') ? prev : next?.classList.contains('cc-tab') ? next : null;
    if (newActive) switchTab(newActive);
  }
  updateEmptyState();
  return newActive;
}

// ==================== 构建 Tab DOM ====================

function buildTabDom(sessionName, cwd) {
  const tab = document.createElement('div');
  tab.className = 'cc-tab';
  Object.assign(tab, {
    _sessionId: null,
    _messages: '',
    _path: cwd,
    _sessionName: sessionName,
    _skills: [],
    _skillsCwd: null,
    _skillsLoading: false,
    _silentTurn: false,
  });
  tab.innerHTML =
    `<span class="cc-tab-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>` +
    `<span class="cc-tab-label">${escHtml(sessionName)}</span>` +
    `<span class="cc-tab-close" title="关闭">×</span>`;
  return tab;
}

// ==================== 新建对话框 ====================

function showNewSessionDialog() {
  return new Promise((resolve, reject) => {
    const overlay = document.getElementById('cc-session-dialog');
    const nameInput = document.getElementById('cc-dlg-session-name');
    const cwdInput = document.getElementById('cc-dlg-cwd');
    const okBtn = document.getElementById('cc-dlg-ok');
    const cancelBtn = document.getElementById('cc-dlg-cancel');
    if (!overlay || !nameInput || !cwdInput || !okBtn || !cancelBtn) {
      reject(new Error('dialog elements missing'));
      return;
    }
    nameInput.value = '';
    cwdInput.value = CC_DEFAULT_PATH;
    overlay.style.display = 'flex';
    nameInput.focus();

    let settled = false;
    function finish(err, val) {
      if (settled) return;
      settled = true;
      overlay.style.display = 'none';
      cleanup();
      if (err) reject(err);
      else resolve(val);
    }

    const onOk = () => {
      const sessionName = nameInput.value.trim();
      const cwd = cwdInput.value.trim();
      if (!sessionName) { nameInput.focus(); return; }
      if (!cwd) { cwdInput.focus(); return; }
      finish(null, { sessionName, cwd });
    };
    const onCancel = () => finish(new Error('canceled'));
    const onKeydown = (e) => {
      if (e.key === 'Enter') onOk();
      else if (e.key === 'Escape') onCancel();
    };
    const onOverlayClick = (e) => { if (e.target === overlay) onCancel(); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', onOverlayClick);

    const cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onOverlayClick);
    };
  });
}

// ==================== 创建 Tab ====================

/**
 * 创建新 tab。
 * @param {object} [opts] - 有参数直接创建，无参数弹出对话框
 * @param {object} [handlers]
 * @param {Function} [handlers.onCreated] - tab 创建并切换后回调 (tab)
 * @returns {Element|null} 直接创建时返回 tab DOM，对话框模式返回 null
 */
export function createTab(opts, { onCreated } = {}) {
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return null;

  if (opts) {
    const { sessionName, cwd } = opts;
    const tab = buildTabDom(sessionName, cwd);
    tabsEl.insertBefore(tab, tabsEl.querySelector('.cc-tab-add'));
    saveTabState(getActiveTab());
    switchTab(tab);
    restoreTabState(tab);
    updateEmptyState();
    onCreated?.(tab);
    return tab;
  }

  // 无参数 → 弹出对话框
  showNewSessionDialog().then(({ sessionName, cwd }) => {
    const tab = buildTabDom(sessionName, cwd);
    tabsEl.insertBefore(tab, tabsEl.querySelector('.cc-tab-add'));
    saveTabState(getActiveTab());
    switchTab(tab);
    restoreTabState(tab);
    updateEmptyState();
    onCreated?.(tab);
  }).catch(() => {});
  return null;
}

// ==================== 初始化首 Tab ====================

/**
 * 初始化第一个 tab：弹出对话框创建首个会话。
 * @param {object} [handlers]
 * @param {Function} [handlers.onCreated]
 */
export function initFirstTab({ onCreated } = {}) {
  setTimeout(() => createTab(undefined, { onCreated }), 0);
}

// ==================== Tab 事件监听 ====================

/**
 * 初始化 tab 栏交互事件。
 * @param {object} [handlers]
 * @param {Function} [handlers.onSwitch] - tab 切换后回调 (tab)
 * @param {Function} [handlers.onPathChange] - 路径变更后回调
 */
export function initTabListeners({ onSwitch, onPathChange } = {}) {
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return;

  document.getElementById('cc-tab-add')?.addEventListener('click', () => createTab());

  tabsEl.addEventListener('click', e => {
    const tab = e.target.closest('.cc-tab');
    if (!tab) return;
    if (e.target.classList.contains('cc-tab-close')) {
      const newTab = closeTab(tab);
      if (newTab) onSwitch?.(newTab);
      return;
    }
    switchTab(tab);
    onSwitch?.(tab);
  });

  const pathInput = document.getElementById('cc-path-input');
  if (pathInput) {
    let last = pathInput.value;
    pathInput.addEventListener('input', () => {
      const tab = getActiveTab();
      if (!tab) return;
      const nv = pathInput.value;
      if (nv === last) return;
      if (tab._path && tab._path !== nv) {
        sendBg({ action: 'nxce_ws', cmd: 'closeSession', session: tab._sessionName, cwd: tab._path }).catch(() => {});
      }
      last = nv;
      tab._path = nv;
      tab._skills = [];
      tab._skillsCwd = null;
      tab._skillsLoading = false;
      tab._sessionId = null;
      const rc = document.getElementById('response-content');
      if (rc) { rc.innerHTML = ''; tab._messages = ''; }
      onPathChange?.();
    });
  }
}
