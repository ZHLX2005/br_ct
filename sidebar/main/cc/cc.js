/**
 * cc.js — Claude Code 模块
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
 */

// ==================== 常量 ====================

const CC_DEFAULT_PATH = 'C:\\Windows\\System32';
const QUERY_TIMEOUT_MS = 120000;     // SDK 首次初始化可能较慢
const STATUS_POLL_INTERVAL = 30000;

// ==================== 状态 ====================

let _statusTimer = null;
let _sessionCounter = 1;
let _pendingQuery = null;            // 当前活跃 query 的 { resolve, reject, timer }
let _runtimeInit = false;

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
  _initFirstTab();

  // 4. 初始化子系统
  _initTabListeners();
  _initHistoryPopup();
  _initSendButton();
  _initServeControls();
  _initSkillAutocomplete();
  _initStatusPolling();

  // 5. 监听 background 转发来的 WS 事件
  if (!_runtimeInit) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.action !== 'nxce_event') return false;
      _dispatch(msg.event);
      return false;
    });
    _runtimeInit = true;
  }
}

export function unmount(container) {
  if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
  // 关闭所有 tab 的 session
  document.querySelectorAll('.cc-tab').forEach(tab => {
    if (tab.dataset.ccSession) {
      _sendBg({ action: 'nxce_ws', cmd: 'closeSession', session: tab.dataset.ccSession, cwd: tab._path }).catch(() => {});
    }
  });
  container.innerHTML = '';
}

export async function handleCcSend() { _handleSend(); }
export function getActiveCcTab() { return document.querySelector('.cc-tab.active'); }
export function createCcTab() { return _createTab(); }
export function switchCcTab(tab) { _switchTab(tab); }
export function closeCcTab(tab) { _closeTab(tab); }

// ==================== Background 通信 ====================

/**
 * 向 background 发送消息，返回 Promise。
 * fire-and-forget（不需要响应）：直接 sendMessage 不包装 Promise。
 * 请求-响应：包装为 Promise。
 */
function _sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp ?? { ok: true });
      }
    });
  });
}

/**
 * 发送带超时的请求-响应消息。
 * 用于 getSkills / getStatus / listSessions / closeSession 等。
 */
function _sendBgRequest(msg, timeout = 5000) {
  return new Promise((resolve) => {
    const settled = false;
    const timer = setTimeout(() => resolve(null), timeout);
    chrome.runtime.sendMessage(msg, (resp) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp ?? { ok: false, error: 'no response' });
      }
    });
  });
}

// ==================== WS 事件分发（来自 background） ====================

function _dispatch(msg) {
  const tab = _getActiveTab();
  if (!tab) return;

  switch (msg.type) {
    case 'init':
      if (msg.sessionId) tab._sessionId = msg.sessionId;
      if (msg.cwd && tab._path && msg.cwd !== tab._path) break;
      const skills = [...new Set([
        ...(Array.isArray(msg.slashCommands) ? msg.slashCommands : []),
        ...(Array.isArray(msg.skills) ? msg.skills : []),
      ])];
      if (skills.length > 0) {
        tab._skills = skills
          .map(s => typeof s === 'string' ? { name: s, desc: '' } : { name: s.name || String(s), desc: s.desc || '' })
          .sort((a, b) => a.name.localeCompare(b.name));
        tab._skillsCwd = tab._path || msg.cwd;
        tab._skillsLoading = false;
      }
      break;

    case 'turn_start':
      tab._streamingText = '';
      tab._streamingThinking = '';
      tab._streamingTools = [];
      break;

    case 'text':
      if (tab._silentTurn) { tab._streamingText = (tab._streamingText || '') + (msg.content || ''); break; }
      tab._streamingText = (tab._streamingText || '') + (msg.content || '');
      _appendStream(tab, msg.content);
      break;

    case 'thinking':
      tab._streamingThinking = (tab._streamingThinking || '') + (msg.content || '');
      break;

    case 'tool_use':
      if (!tab._streamingTools) tab._streamingTools = [];
      tab._streamingTools.push({ name: msg.name, input: msg.input, id: msg.id });
      break;

    case 'done':
      if (msg.sessionId) tab._sessionId = msg.sessionId;
      if (_pendingQuery) {
        _pendingQuery.resolve({ status: 'ok', data: { text: tab._streamingText, sessionId: tab._sessionId } });
        _pendingQuery = null;
      }
      if (tab._silentTurn) { tab._silentTurn = false; break; }
      _finalizeStream(tab);
      _fetchStatus(); // 完成后刷新状态
      break;

    case 'error':
      if (_pendingQuery) {
        _pendingQuery.reject(new Error(msg.content || 'error'));
        _pendingQuery = null;
      }
      break;
  }
}

// ==================== Tab 管理 ====================

function _getActiveTab() { return document.querySelector('.cc-tab.active'); }

function _saveTabState(tab) {
  if (!tab) return;
  const rc = document.getElementById('response-content');
  const pi = document.getElementById('cc-path-input');
  if (rc) tab._messages = rc.innerHTML;
  if (pi) tab._path = pi.value;
}

function _restoreTabState(tab) {
  if (!tab) return;
  const rc = document.getElementById('response-content');
  const pi = document.getElementById('cc-path-input');
  if (rc) rc.innerHTML = tab._messages ?? '';
  if (pi) pi.value = tab._path ?? CC_DEFAULT_PATH;
}

function _initFirstTab() {
  const tab = document.querySelector('.cc-tab.active');
  if (!tab) return;
  tab.dataset.ccSession = crypto.randomUUID();
  Object.assign(tab, {
    _sessionId: null, _messages: '', _path: CC_DEFAULT_PATH,
    _skills: [], _skillsCwd: null, _skillsLoading: false,
    _silentTurn: false,
  });
}

function _createTab() {
  _sessionCounter++;
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return null;
  const tab = document.createElement('div');
  tab.className = 'cc-tab';
  tab.dataset.ccSession = crypto.randomUUID();
  Object.assign(tab, {
    _sessionId: null, _messages: '', _path: CC_DEFAULT_PATH,
    _skills: [], _skillsCwd: null, _skillsLoading: false,
    _silentTurn: false,
  });
  tab.innerHTML =
    `<span class="cc-tab-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>` +
    `<span class="cc-tab-label">会话 ${_sessionCounter}</span>` +
    `<span class="cc-tab-close" title="关闭">×</span>`;
  tabsEl.insertBefore(tab, tabsEl.querySelector('.cc-tab-add'));
  _saveTabState(_getActiveTab());
  _switchTab(tab);
  _restoreTabState(tab);
  return tab;
}

function _switchTab(tab) {
  if (!tab) return;
  const cur = _getActiveTab();
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
  // 刷新 skills 和 session 状态
  _loadTabSkills(tab);
  _restartStatusPoll();
}

function _closeTab(tab) {
  if (!tab) return;
  const session = tab.dataset.ccSession;
  const cwd = tab._path;
  if (session && cwd) {
    _sendBg({ action: 'nxce_ws', cmd: 'closeSession', session, cwd }).catch(() => {});
  }
  const active = tab.classList.contains('active');
  const prev = tab.previousElementSibling;
  const next = tab.nextElementSibling;
  tab.remove();
  if (active) {
    const t = prev?.classList.contains('cc-tab') ? prev : next?.classList.contains('cc-tab') ? next : null;
    if (t) _switchTab(t);
  }
}

function _initTabListeners() {
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return;
  document.getElementById('cc-tab-add')?.addEventListener('click', _createTab);
  tabsEl.addEventListener('click', e => {
    const tab = e.target.closest('.cc-tab');
    if (!tab) return;
    if (e.target.classList.contains('cc-tab-close')) { _closeTab(tab); return; }
    _switchTab(tab);
  });

  const pathInput = document.getElementById('cc-path-input');
  if (pathInput) {
    let last = pathInput.value;
    pathInput.addEventListener('input', () => {
      const tab = _getActiveTab();
      if (!tab) return;
      const nv = pathInput.value;
      if (nv === last) return;
      if (tab._path && tab._path !== nv) {
        _sendBg({ action: 'nxce_ws', cmd: 'closeSession', session: tab.dataset.ccSession, cwd: tab._path }).catch(() => {});
      }
      last = nv;
      tab._path = nv;
      tab._skills = []; tab._skillsCwd = null; tab._skillsLoading = false; tab._sessionId = null;
      const rc = document.getElementById('response-content');
      if (rc) { rc.innerHTML = ''; tab._messages = ''; }
      _restartStatusPoll();
    });
  }
}

// ==================== Skills ====================

function _loadTabSkills(tab) {
  if (!tab || tab._skillsLoading) return;
  if (tab._skills.length > 0 && tab._skillsCwd === tab._path) return;
  tab._skillsLoading = true;
  const session = tab.dataset.ccSession || 'default';
  const cwd = tab._path || CC_DEFAULT_PATH;
  _sendBgRequest({ action: 'nxce_ws', cmd: 'getSkills', session, cwd }).then(resp => {
    tab._skillsLoading = false;
    if (!resp?.ok || !resp.data?.skills) return;
    tab._skills = resp.data.skills
      .map(s => typeof s === 'string' ? { name: s, desc: '' } : { name: s.name || String(s), desc: s.desc || '' })
      .sort((a, b) => a.name.localeCompare(b.name));
    tab._skillsCwd = cwd;
  });
}

function _initSkillAutocomplete() {
  const input = document.getElementById('chat-input');
  const popup = document.getElementById('cc-skill-popup');
  if (!input || !popup) return;
  let sel = -1;
  function close() { popup.style.display = 'none'; sel = -1; }
  function show(items) {
    popup.innerHTML = items.length === 0
      ? '<div class="cc-skill-empty">无匹配 Skill</div>'
      : items.map((s, i) =>
        `<div class="cc-skill-item${i === sel ? ' selected' : ''}" data-i="${i}">` +
        `<span class="cc-skill-item-icon">S</span>` +
        `<span class="cc-skill-item-name">${_escHtml(s.name)}</span>` +
        `<span class="cc-skill-item-desc">${_escHtml(s.desc || '')}</span></div>`
      ).join('');
    popup.style.display = 'block';
  }
  function pick(name) {
    const cur = input.selectionStart || 0;
    const v = input.value;
    const sp = v.lastIndexOf('/', cur);
    if (sp < 0) return;
    input.value = v.slice(0, sp) + '/' + name + ' ' + v.slice(cur);
    const np = sp + name.length + 2;
    input.setSelectionRange(np, np);
    input.dispatchEvent(new Event('input'));
    close();
    input.focus();
  }
  input.addEventListener('input', () => {
    const cur = input.selectionStart || 0;
    const v = input.value;
    const sp = v.lastIndexOf('/', cur);
    if (sp < 0 || sp >= cur) return close();
    const word = v.slice(sp + 1, cur);
    if (word.includes(' ')) return close();
    const tab = _getActiveTab();
    if (tab) _loadTabSkills(tab);
    const matched = (tab?._skills || []).filter(s => s.name.toLowerCase().includes(word.toLowerCase())).slice(0, 20);
    sel = matched.length > 0 ? 0 : -1;
    show(matched);
  });
  input.addEventListener('keydown', e => {
    if (popup.style.display !== 'block') return;
    const items = popup.querySelectorAll('.cc-skill-item');
    if (!items.length && e.key !== 'Escape') return;
    if (e.key === 'Tab') { e.preventDefault(); const n = items[sel]?.querySelector('.cc-skill-item-name')?.textContent; if (n) pick(n); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle('selected', i === sel)); items[sel]?.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); items.forEach((el, i) => el.classList.toggle('selected', i === sel)); items[sel]?.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === 'Escape') { close(); return; }
  });
  popup.addEventListener('mousedown', e => {
    const item = e.target.closest('.cc-skill-item');
    if (!item) return;
    const n = item.querySelector('.cc-skill-item-name')?.textContent;
    if (n) pick(n);
  });
}

// ==================== Status & Badge ====================

function _initStatusPolling() {
  _restartStatusPoll();
}

function _restartStatusPoll() {
  if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
  _fetchStatus();
  _statusTimer = setInterval(_fetchStatus, STATUS_POLL_INTERVAL);
}

function _fetchStatus() {
  const tab = _getActiveTab();
  const badge = document.getElementById('cc-status-badge');
  if (!tab || !badge) return;
  const cwd = tab._path;
  if (!cwd) return;
  _sendBgRequest({ action: 'nxce_ws', cmd: 'getStatus', session: tab.dataset.ccSession, cwd }).then(resp => {
    if (!resp?.ok || !resp.data) {
      badge.style.display = 'none';
      return;
    }
    const state = resp.data.lifecycleState || (resp.data.isActive ? 'running' : 'stopped');
    const statusMap = { running: '运行中', stopped: '已停止', crashed: '已崩溃', resuming: '恢复中' };
    const textEl = badge.querySelector('.cc-status-text');
    if (textEl) textEl.textContent = statusMap[state] || state;
    badge.dataset.state = state;
    badge.style.display = 'inline-flex';
  }).catch(() => { badge.style.display = 'none'; });
}

// ==================== History Popup ====================

function _initHistoryPopup() {
  const btn = document.getElementById('cc-history-btn');
  const popup = document.getElementById('cc-history-popup');
  if (!btn || !popup) return;

  function close() { popup.style.display = 'none'; }

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (popup.style.display === 'block') { close(); return; }
    const resp = await _sendBgRequest({ action: 'nxce_ws', cmd: 'listSessions' });
    if (!resp?.ok || !resp.data?.sessions?.length) {
      popup.innerHTML =
        '<div class="cc-history-header">历史会话</div>' +
        '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:12px;">暂无历史会话</div>';
      popup.style.display = 'block';
      return;
    }
    popup.innerHTML =
      '<div class="cc-history-header">历史会话</div>' +
      '<div class="cc-history-list">' +
      resp.data.sessions.map(s => {
        const state = s.lifecycleState || 'stopped';
        return `<div class="cc-history-item" data-session="${_escHtml(s.name || s.key || '')}" data-cwd="${_escHtml(s.cwd || '')}">` +
          `<span class="cc-session-dot" data-state="${_escHtml(state)}"></span>` +
          `<span class="cc-session-name">${_escHtml(s.name || 'unknown')}</span>` +
          `<span class="cc-session-meta">${_escHtml(s.cwd || '')}${s.model ? ' · ' + _escHtml(s.model) : ''}</span>` +
          `</div>`;
      }).join('') +
      '</div>';
    popup.style.display = 'block';
  });

  popup.addEventListener('click', (e) => {
    const item = e.target.closest('.cc-history-item');
    if (!item) return;
    const sessionName = item.dataset.session;
    const cwd = item.dataset.cwd;
    console.log('[cc] history item clicked:', { sessionName, cwd, raw: item.outerHTML?.slice(0, 120) });
    if (!sessionName) return;
    close();
    _restoreSession(sessionName, cwd);
  });

  document.addEventListener('click', (e) => {
    if (popup.style.display !== 'block') return;
    if (!btn.contains(e.target) && !popup.contains(e.target)) close();
  }, { capture: true });
}

function _restoreSession(sessionId, cwd) {
  console.log('[cc] _restoreSession:', { sessionId, cwd });
  const tab = _createTab();
  if (!tab) { console.warn('[cc] _restoreSession: _createTab returned null'); return; }
  // 同名 + 同 cwd = nx-ce 自动恢复 session
  tab.dataset.ccSession = sessionId;
  if (cwd) { tab._path = cwd; tab._skills = []; tab._skillsCwd = null; }
  console.log('[cc] _restoreSession tab:', { ds: tab.dataset.ccSession, path: tab._path });
  _loadTabSkills(tab);
  _restoreTabState(tab);
  _restartStatusPoll();
}

// ==================== Serve Controls ====================

function _updateServeStatus(state, text) {
  const el = document.getElementById('cc-serve-status');
  const btn = document.getElementById('cc-serve-btn');
  if (el) { el.dataset.state = state; const t = el.querySelector('.cc-serve-text'); if (t) t.textContent = text; }
  if (btn) {
    btn.dataset.state = state;
    btn.dataset.loading = state === 'connecting' ? 'true' : 'false';
    const l = btn.querySelector('span:last-child');
    if (l) l.textContent = ({ disconnected: '连接', connecting: '取消', connected: '断开', error: '重试' })[state] || '连接';
  }
}

function _initServeControls() {
  const btn = document.getElementById('cc-serve-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const state = btn.dataset.state;
    if (state === 'connecting' || state === 'connected') {
      _sendBg({ action: 'nxce_ws', cmd: 'disconnect' }).catch(() => {});
      _updateServeStatus('disconnected', '已断开');
      return;
    }
    _updateServeStatus('connecting', '启动中…');
    _sendBg({ action: 'nativeMessage', payload: { command: 'claudeStartServe' } }).then(resp => {
      if (resp?.status === 'ok') {
        setTimeout(async () => {
          const p = await _sendBgRequest({ action: 'nxce_ws', cmd: 'ping' }, 3000);
          _updateServeStatus(p?.connected ? 'connected' : 'error', p?.connected ? '已连接' : '启动后未连上');
        }, 2000);
      } else {
        _updateServeStatus('error', resp?.message || '启动失败');
      }
    });
  });
}

// ==================== Send ====================

function _initSendButton() {
  const sendBtn = document.getElementById('chat-btn-send');
  const input = document.getElementById('chat-input');
  if (sendBtn) sendBtn.addEventListener('click', _handleSend);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _handleSend(); }
    });
    const autoResize = () => {
      if (sendBtn) sendBtn.disabled = !input.value.trim();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    };
    input.addEventListener('input', autoResize);
    autoResize();
  }
}

async function _handleSend() {
  const input = document.getElementById('chat-input');
  const pathInput = document.getElementById('cc-path-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  const tab = _getActiveTab();
  if (!tab) return;

  console.log('[cc] _handleSend raw:', raw);

  // 解析 /skill 指令（安全解析，无 while+g 陷阱）
  const tabSkills = tab._skills || [];
  const skills = [];
  let prompt = raw;
  const slashMatches = raw.match(/\/([\w-]+)/g);
  if (slashMatches) {
    for (const m of slashMatches) {
      const name = m.slice(1);
      if (tabSkills.some(s => s.name === name)) {
        skills.push(name);
        prompt = prompt.replace(m, '').trim();
      }
    }
  }
  if (!prompt && skills.length === 0) return;
  if (!prompt && skills.length > 0) {
    console.warn('[cc] skills-only without prompt:', skills);
    // 不用 alert（会阻塞 side panel），UI 提示
    const rc2 = document.getElementById('response-content');
    if (rc2) {
      const e = document.createElement('div');
      e.className = 'notion-chat-message';
      e.innerHTML = '<div class="notion-chat-bubble" style="border-color:#f59e0b;"><div class="notion-chat-bubble-content" style="color:#92400e;">请在 /skill 后面补充问题</div></div>';
      rc2.appendChild(e);
      rc2.scrollTop = rc2.scrollHeight;
    }
    return;
  }

  console.log('[cc] send: prompt="' + prompt + '" skills=[' + skills.join(',') + ']');

  const workDir = pathInput?.value.trim() || '';
  input.value = '';
  input.dispatchEvent(new Event('input'));

  // 在 UI 中显示用户消息
  const rc = document.getElementById('response-content');
  if (rc) {
    const badges = skills.length
      ? '<div class="cc-bubble-skills">' + skills.map(s => `<span class="cc-skill-tag">${_escHtml(s)}</span>`).join('') + '</div>'
      : '';
    const u = document.createElement('div');
    u.className = 'notion-chat-message notion-chat-message--user';
    u.innerHTML =
      '<div class="notion-chat-bubble notion-chat-bubble--user" style="flex:0 1 auto;max-width:88%;">' +
      '<div class="notion-chat-bubble-header"><span class="notion-chat-bubble-name">You</span></div>' +
      `<div class="notion-chat-bubble-content">${_escHtml(prompt)}</div>${badges}</div>`;
    rc.appendChild(u);
    rc.scrollTop = rc.scrollHeight;
    tab._messages = rc.innerHTML;
  }

  // loading 动画
  const ld = document.createElement('div');
  ld.className = 'cc-loading';
  ld.innerHTML =
    '<div class="notion-chat-avatar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>' +
    '<div class="cc-loading-dots"><span class="cc-loading-dot"></span><span class="cc-loading-dot"></span><span class="cc-loading-dot"></span></div>';
  if (rc) { rc.appendChild(ld); rc.scrollTop = rc.scrollHeight; }

  // 发送 query（通过 background）
  try {
    const session = tab.dataset.ccSession || 'default';
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err, v) => {
        if (settled) return;
        settled = true;
        _pendingQuery = null;
        if (err) reject(err);
        else resolve(v);
      };
      _pendingQuery = { resolve: r => finish(null, r), reject: e => finish(e) };
      tab._silentTurn = false;

      // 超时兜底
      const timer = setTimeout(() => finish(new Error('查询超时（确认 Claude CLI 是否已安装且在 PATH 中）')), QUERY_TIMEOUT_MS);
      const origReject = _pendingQuery.reject;
      _pendingQuery.reject = (e) => { clearTimeout(timer); origReject(e); };
      _pendingQuery.resolve = (v) => { clearTimeout(timer); finish(null, v); };

      const queryMsg = { action: 'nxce_ws', cmd: 'query', session, cwd: workDir, prompt, queryId: 'q-' + Date.now() };
      if (skills.length > 0) queryMsg.skills = skills;
      console.log('[cc] sendMessage queryMsg:', JSON.stringify(queryMsg));
      chrome.runtime.sendMessage(queryMsg, (resp) => {
        console.log('[cc] query response:', resp);
        if (chrome.runtime.lastError) { finish(new Error(chrome.runtime.lastError.message)); return; }
        if (!resp?.ok) finish(new Error(resp?.error || '发送失败'));
        // 成功发送后，等待 background 转发 done/text/error
      });
    });
  } catch (err) {
    console.error('[cc] _handleSend error:', err);
    if (ld.parentNode) ld.remove();
    if (rc) {
      rc.querySelector('.cc-stream-bubble')?.remove();
      const e = document.createElement('div');
      e.className = 'notion-chat-message';
      e.innerHTML = `<div class="notion-chat-bubble" style="border-color:#e53e3e;"><div class="notion-chat-bubble-content" style="color:#e53e3e;">${_escHtml(err.message)}</div></div>`;
      rc.appendChild(e);
    }
  } finally {
    if (ld.parentNode) ld.remove();
  }
}

// ==================== Streaming ====================

function _appendStream(tab, chunk) {
  const rc = document.getElementById('response-content');
  if (!rc) return;
  let s = rc.querySelector('.cc-stream-bubble');
  if (!s) {
    s = document.createElement('div');
    s.className = 'notion-chat-message cc-stream-bubble';
    const label = tab.querySelector('.cc-tab-label')?.textContent || 'Claude Code';
    s.innerHTML =
      '<div class="notion-chat-avatar" style="background:#f97316;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;flex-shrink:0;">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 6"/></svg></div>' +
      '<div class="notion-chat-bubble"><div class="notion-chat-bubble-header">' +
      `<span class="notion-chat-bubble-name" style="color:#ea580c">${_escHtml(label)}</span></div>` +
      '<div class="notion-chat-bubble-content cc-stream-content"></div></div>';
    rc.appendChild(s);
    rc.scrollTop = rc.scrollHeight;
  }
  const c = s.querySelector('.cc-stream-content');
  if (c) c.textContent += chunk;
  rc.scrollTop = rc.scrollHeight;
  tab._messages = rc.innerHTML;
}

function _finalizeStream(tab) {
  const rc = document.getElementById('response-content');
  if (!rc) return;
  const s = rc.querySelector('.cc-stream-bubble');
  if (s) {
    const c = s.querySelector('.cc-stream-content');
    if (c) c.innerHTML = _escHtml(c.textContent || '').replace(/\n/g, '<br>');
    s.classList.remove('cc-stream-bubble');
  }
  const ld = rc.querySelector('.cc-loading');
  if (ld) ld.remove();
  tab._messages = rc.innerHTML;
}

// ==================== Utils ====================

function _escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
