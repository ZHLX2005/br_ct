/**
 * cc.js — Claude Code 模块（完全自包含）
 * mount()：加载 cc.css，注入 cc.html，初始化 tab/WS/serve/skill
 * unmount()：断开 WS，清空 #app-view
 */

// ==================== mount / unmount ====================

let _ws = null;
let _wsReady = null;
let _runtimeInit = false;
let _ccSessionCounter = 1;
const CC_DEFAULT_PATH = 'C:\\Windows\\System32';
const CONNECT_TIMEOUT_MS = 5000;

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

  // 初始化第一个 tab（模板中的硬编码 tab）
  const firstTab = document.querySelector('.cc-tab.active');
  if (firstTab && !firstTab._skills) {
    Object.assign(firstTab, { _sessionId: null, _messages: '', _path: CC_DEFAULT_PATH, _skills: [], _skillsCwd: null, _skillsLoading: false });
  }

  // 3. 初始化子系统
  _initTabListeners();
  _initServeControls();
  _initSkillAutocomplete();
  if (!_runtimeInit) {
    _initNxceEventListener();
    _runtimeInit = true;
  }
}

export function unmount(container) {
  _disconnectWs();
  container.innerHTML = '';
}

// force cc input to stay empty
export async function handleCcSend() { _handleSend(); }

// tab management
export function getActiveCcTab() { return document.querySelector('.cc-tab.active'); }
export function createCcTab() { return _createTab(); }
export function switchCcTab(tab) { _switchTab(tab); }
export function closeCcTab(tab) { _closeTab(tab); }

// ==================== Tab ====================

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

function _createTab() {
  _ccSessionCounter++;
  const id = 'cc-session-' + _ccSessionCounter;
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return null;
  const tab = document.createElement('div');
  tab.className = 'cc-tab';
  tab.dataset.ccSession = id;
  Object.assign(tab, { _sessionId: null, _messages: '', _path: CC_DEFAULT_PATH, _skills: [], _skillsCwd: null, _skillsLoading: false });
  tab.innerHTML = '<span class="cc-tab-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span><span class="cc-tab-label">会话 ' + _ccSessionCounter + '</span><span class="cc-tab-close" title="关闭">×</span>';
  tabsEl.insertBefore(tab, tabsEl.querySelector('.cc-tab-add'));
  _saveTabState(_getActiveTab());
  _switchTab(tab);
  _restoreTabState(tab);
  return tab;
}

function _switchTab(tab) {
  if (!tab) return;
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return;
  const cur = _getActiveTab();
  if (cur && cur !== tab) {
    cur._path = document.getElementById('cc-path-input')?.value || CC_DEFAULT_PATH;
    cur._messages = document.getElementById('response-content')?.innerHTML || '';
  }
  tabsEl.querySelectorAll('.cc-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const pi = document.getElementById('cc-path-input');
  const rc = document.getElementById('response-content');
  if (pi) pi.value = tab._path ?? CC_DEFAULT_PATH;
  if (rc) rc.innerHTML = tab._messages ?? '';
  if (cur && cur !== tab) {
    tab._sessionId = null;
    tab._skills = [];
    tab._skillsCwd = null;
    tab._skillsLoading = false;
  }
}

function _closeTab(tab) {
  if (!tab) return;
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
        chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'closeSession', session: tab.dataset.ccSession, cwd: tab._path });
      }
      last = nv;
      tab._path = nv; tab._skills = []; tab._skillsCwd = null; tab._skillsLoading = false; tab._sessionId = null;
      const rc = document.getElementById('response-content');
      if (rc) { rc.innerHTML = ''; tab._messages = ''; }
    });
  }
}

// ==================== WS ====================

function _disconnectWs() {
  if (_ws) { try { _ws.close(); } catch {} _ws = null; }
  _wsReady = null;
}

function _connect() {
  if (_ws && _ws.readyState <= 1) return _wsReady;
  if (_wsReady) return _wsReady;
  if (_ws) { try { _ws.close(); } catch {} _ws = null; }
  const r = new Promise((resolve, reject) => {
    let sock;
    try { sock = new WebSocket('ws://127.0.0.1:43720'); } catch (err) { reject(err); return; }
    _ws = sock;
    const timer = setTimeout(() => { try { sock.close(); } catch {} reject(new Error('timeout')); }, CONNECT_TIMEOUT_MS);
    sock.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'connected') { if (sock._resolved) return; sock._resolved = true; clearTimeout(timer); resolve(); return; }
      _dispatch(msg);
    });
    sock.addEventListener('close', () => { clearTimeout(timer); if (_ws === sock) _ws = null; if (_wsReady === r) _wsReady = null; });
  });
  _wsReady = r; r.catch(() => { if (_wsReady === r) _wsReady = null; });
  return r;
}

async function _wsSend(msg) { await _connect(); _ws.send(JSON.stringify(msg)); }

// ==================== WS dispatch ====================

function _dispatch(msg) {
  const tab = _getActiveTab();
  if (!tab) return;
  switch (msg.type) {
    case 'turn_start': tab._streamingText = ''; tab._streamingThinking = ''; tab._streamingTools = []; break;
    case 'text':
      if (tab._silentTurn) { tab._streamingText = (tab._streamingText || '') + (msg.content || ''); break; }
      tab._streamingText = (tab._streamingText || '') + (msg.content || '');
      _appendStream(tab, msg.content);
      break;
    case 'thinking': tab._streamingThinking = (tab._streamingThinking || '') + (msg.content || ''); break;
    case 'tool_use': if (!tab._streamingTools) tab._streamingTools = []; tab._streamingTools.push({ name: msg.name, input: msg.input, id: msg.id }); break;
    case 'done':
      if (msg.sessionId) tab._sessionId = msg.sessionId;
      if (tab._activeQuery) tab._activeQuery.resolve({ status: 'ok', data: { text: tab._streamingText, sessionId: tab._sessionId } });
      if (tab._silentTurn) { tab._silentTurn = false; break; }
      _finalizeStream(tab);
      break;
    case 'init':
      if (msg.sessionId) tab._sessionId = msg.sessionId;
      if (msg.cwd && tab._path && msg.cwd !== tab._path) break;
      const skills = [...new Set([...(Array.isArray(msg.slashCommands) ? msg.slashCommands : []), ...(Array.isArray(msg.skills) ? msg.skills : [])])];
      if (skills.length > 0) {
        tab._skills = skills.map(s => typeof s === 'string' ? { name: s, desc: '' } : { name: s.name || String(s), desc: s.desc || '' }).sort((a, b) => a.name.localeCompare(b.name));
        tab._skillsCwd = tab._path || msg.cwd; tab._skillsLoading = false;
      }
      break;
    case 'error': if (tab._activeQuery) tab._activeQuery.reject(new Error(msg.content || 'error')); break;
  }
}

function _initNxceEventListener() {
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || msg.action !== 'nxce_event') return false;
    _dispatch(msg.event);
    return false;
  });
}

function _appendStream(tab, chunk) {
  const rc = document.getElementById('response-content');
  if (!rc) return;
  let s = rc.querySelector('.cc-stream-bubble');
  if (!s) {
    s = document.createElement('div');
    s.className = 'notion-chat-message cc-stream-bubble';
    s.innerHTML = '<div class="notion-chat-avatar" style="background:#f97316;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;flex-shrink:0;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 6"/></svg></div><div class="notion-chat-bubble"><div class="notion-chat-bubble-header"><span class="notion-chat-bubble-name" style="color:#ea580c">' + (tab.querySelector('.cc-tab-label')?.textContent || 'Claude Code') + '</span></div><div class="notion-chat-bubble-content cc-stream-content"></div></div>';
    rc.appendChild(s); rc.scrollTop = rc.scrollHeight;
  }
  const c = s.querySelector('.cc-stream-content');
  if (c) c.textContent += chunk;
  rc.scrollTop = rc.scrollHeight; tab._messages = rc.innerHTML;
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
  const ld = rc.querySelector('.cc-loading'); if (ld) ld.remove();
  tab._messages = rc.innerHTML;
}

// ==================== Serve ====================

function _setServeStatus(state, text) {
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
      chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'disconnect' }, () => _setServeStatus('disconnected', '已断开'));
      return;
    }
    _setServeStatus('connecting', '启动中…');
    chrome.runtime.sendMessage({ action: 'nativeMessage', payload: { command: 'claudeStartServe' } }, resp => {
      if (resp?.status === 'ok') {
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'ping' }, p => _setServeStatus(p?.connected ? 'connected' : 'error', p?.connected ? '已连接' : '启动后未连上'));
        }, 2000);
      } else _setServeStatus('error', resp?.message || '启动失败');
    });
  });
}

// ==================== Send ====================

async function _handleSend() {
  const input = document.getElementById('chat-input');
  const pathInput = document.getElementById('cc-path-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  const tab = _getActiveTab();
  if (!tab) return;

  const tabSkills = tab._skills || [];
  const skills = [];
  let prompt = raw;
  let m;
  while ((m = /\/([\w-]+)/g.exec(raw)) !== null) {
    if (tabSkills.some(s => s.name === m[1])) { skills.push(m[1]); prompt = prompt.replace(m[0], '').trim(); }
  }
  if (!prompt && skills.length === 0) return;
  if (!prompt && skills.length > 0) { alert('请在 /skill 后面补充问题'); return; }

  const workDir = pathInput?.value.trim() || '';
  input.value = ''; input.dispatchEvent(new Event('input'));

  const rc = document.getElementById('response-content');
  if (rc) {
    const badges = skills.length ? '<div class="cc-bubble-skills">' + skills.map(s => '<span class="cc-skill-tag">' + _escHtml(s) + '</span>').join('') + '</div>' : '';
    const u = document.createElement('div');
    u.className = 'notion-chat-message notion-chat-message--user';
    u.innerHTML = '<div class="notion-chat-bubble notion-chat-bubble--user" style="flex:0 1 auto;max-width:88%;"><div class="notion-chat-bubble-header"><span class="notion-chat-bubble-name">You</span></div><div class="notion-chat-bubble-content">' + _escHtml(prompt) + '</div>' + badges + '</div>';
    rc.appendChild(u); rc.scrollTop = rc.scrollHeight; tab._messages = rc.innerHTML;
  }

  const ld = document.createElement('div');
  ld.className = 'cc-loading';
  ld.innerHTML = '<div class="notion-chat-avatar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div><div class="cc-loading-dots"><span class="cc-loading-dot"></span><span class="cc-loading-dot"></span><span class="cc-loading-dot"></span></div>';
  if (rc) { rc.appendChild(ld); rc.scrollTop = rc.scrollHeight; }

  const prefix = skills.length ? '[已选择 skill: ' + skills.join(', ') + '] ' : '';
  try {
    const session = tab.dataset.ccSession || 'default';
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err, v) => { if (settled) return; settled = true; tab._activeQuery = null; if (err) reject(err); else resolve(v); };
      tab._activeQuery = { resolve: r => finish(null, r), reject: e => finish(e) };
      chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'query', session, cwd: workDir, prompt: prefix + prompt, skills, queryId: 'q-' + Date.now() }, resp => {
        if (chrome.runtime.lastError) { finish(new Error(chrome.runtime.lastError.message)); return; }
        if (!resp?.ok) finish(new Error(resp?.error || '失败'));
      });
    });
  } catch (err) {
    if (ld.parentNode) ld.remove();
    if (rc) {
      rc.querySelector('.cc-stream-bubble')?.remove();
      const e = document.createElement('div');
      e.className = 'notion-chat-message';
      e.innerHTML = '<div class="notion-chat-bubble" style="border-color:#e53e3e;"><div class="notion-chat-bubble-content" style="color:#e53e3e;">' + _escHtml(err.message) + '</div></div>';
      rc.appendChild(e);
    }
  } finally { if (ld.parentNode) ld.remove(); }
}

// ==================== Skill autocomplete ====================

function _getTabSkills(tab) {
  if (!tab || tab._skillsLoading) return;
  if (tab._skills.length > 0 && tab._skillsCwd === tab._path) return;
  tab._skillsLoading = true;
  const session = tab.dataset.ccSession || 'default';
  const cwd = tab._path || CC_DEFAULT_PATH;
  tab._silentTurn = true;
  chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'query', session, cwd, prompt: ' ', queryId: 'skill-init-' + Date.now() }, resp => {
    if (chrome.runtime.lastError || !resp?.ok) { tab._skillsLoading = false; return; }
    let w = 0;
    const t = setInterval(() => { w += 200; if (tab._skills.length > 0 || w > 10000) { clearInterval(t); tab._skillsLoading = false; } }, 200);
  });
}

function _initSkillAutocomplete() {
  const input = document.getElementById('chat-input');
  const popup = document.getElementById('cc-skill-popup');
  if (!input || !popup) return;
  let sel = -1;
  function close() { popup.style.display = 'none'; sel = -1; }
  function show(items) {
    popup.innerHTML = items.length === 0 ? '<div class="cc-skill-empty">无匹配 Skill</div>' : items.map((s, i) => '<div class="cc-skill-item' + (i === sel ? ' selected' : '') + '" data-i="' + i + '"><span class="cc-skill-item-icon">S</span><span class="cc-skill-item-name">' + _escHtml(s.name) + '</span><span class="cc-skill-item-desc">' + _escHtml(s.desc || '') + '</span></div>').join('');
    popup.style.display = 'block';
  }
  function pick(name) {
    const cur = input.selectionStart || 0; const v = input.value; const sp = v.lastIndexOf('/', cur);
    if (sp < 0) return;
    input.value = v.slice(0, sp) + '/' + name + ' ' + v.slice(cur);
    const np = sp + name.length + 2; input.setSelectionRange(np, np); input.dispatchEvent(new Event('input')); close(); input.focus();
  }
  input.addEventListener('input', () => {
    const cur = input.selectionStart || 0; const v = input.value; const sp = v.lastIndexOf('/', cur);
    if (sp < 0 || sp >= cur) return close();
    const word = v.slice(sp + 1, cur);
    if (word.includes(' ')) return close();
    const tab = _getActiveTab();
    if (tab) _getTabSkills(tab);
    const matched = (tab?._skills || []).filter(s => s.name.toLowerCase().includes(word.toLowerCase())).slice(0, 20);
    sel = matched.length > 0 ? 0 : -1; show(matched);
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
  popup.addEventListener('mousedown', e => { const item = e.target.closest('.cc-skill-item'); if (!item) return; const n = item.querySelector('.cc-skill-item-name')?.textContent; if (n) pick(n); });
}

// ==================== Utils ====================

function _escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
