/**
 * cc.js — Claude Code 模块
 *
 * 从 main.js 分离出来的全部 CC 逻辑。
 * main.js import 本模块来使用这些函数，CSS/DOM 完全不变。
 */

// ==================== 工具 ====================

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== CC 多窗口管理 ====================

let ccSessionCounter = 1;
const CC_DEFAULT_PATH = 'C:\\Windows\\System32';

export { CC_DEFAULT_PATH };

export function setCcSessionCounter(val) { ccSessionCounter = val; }

function saveCcTabState(tab) {
  if (!tab) return;
  const rc = document.getElementById('response-content');
  const pi = document.getElementById('cc-path-input');
  if (rc) tab._messages = rc.innerHTML;
  if (pi) tab._path = pi.value;
}

function restoreCcTabState(tab) {
  if (!tab) return;
  const rc = document.getElementById('response-content');
  const pi = document.getElementById('cc-path-input');
  if (rc) rc.innerHTML = tab._messages !== undefined ? tab._messages : '';
  if (pi) pi.value = tab._path !== undefined ? tab._path : CC_DEFAULT_PATH;
}

export function getActiveCcTab() {
  return document.querySelector('.cc-tab.active');
}

export function createCcTab() {
  ccSessionCounter++;
  const id = `cc-session-${ccSessionCounter}`;
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return null;

  const tab = document.createElement('div');
  tab.className = 'cc-tab';
  tab.dataset.ccSession = id;
  tab._sessionId = null;
  tab._messages = '';
  tab._path = CC_DEFAULT_PATH;
  tab._skills = [];
  tab._skillsCwd = null;
  tab._skillsLoading = false;
  tab.innerHTML =
    '<span class="cc-tab-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span>' +
    '<span class="cc-tab-label">会话 ' + ccSessionCounter + '</span>' +
    '<span class="cc-tab-close" title="关闭">×</span>';

  const addBtn = tabsEl.querySelector('.cc-tab-add');
  if (addBtn) tabsEl.insertBefore(tab, addBtn);
  else tabsEl.appendChild(tab);

  const currentActive = getActiveCcTab();
  saveCcTabState(currentActive);
  switchCcTab(tab);
  restoreCcTabState(tab);
  return tab;
}

export function switchCcTab(tab) {
  if (!tab) return;
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return;

  const current = getActiveCcTab();
  if (current && current !== tab) {
    current._path = document.getElementById('cc-path-input')?.value || CC_DEFAULT_PATH;
    current._messages = document.getElementById('response-content')?.innerHTML || '';
  }

  tabsEl.querySelectorAll('.cc-tab').forEach(function(t) { t.classList.remove('active'); });
  tab.classList.add('active');

  const pi = document.getElementById('cc-path-input');
  const rc = document.getElementById('response-content');
  if (pi) pi.value = tab._path !== undefined ? tab._path : CC_DEFAULT_PATH;
  if (rc) rc.innerHTML = tab._messages !== undefined ? tab._messages : '';

  if (current && current !== tab) {
    tab._sessionId = null;
    tab._skills = [];
    tab._skillsCwd = null;
    tab._skillsLoading = false;
  }
}

export function closeCcTab(tab) {
  if (!tab) return;
  const isActive = tab.classList.contains('active');
  const prev = tab.previousElementSibling;
  const next = tab.nextElementSibling;
  tab.remove();

  if (isActive) {
    const target = prev && prev.classList.contains('cc-tab') ? prev
                 : next && next.classList.contains('cc-tab') ? next
                 : null;
    if (target) switchCcTab(target);
  }
}

export function setupCcTabListeners() {
  const tabsEl = document.getElementById('cc-tabs');
  if (!tabsEl) return;

  const addBtn = document.getElementById('cc-tab-add');
  if (addBtn) addBtn.addEventListener('click', createCcTab);

  tabsEl.addEventListener('click', function(e) {
    const tab = e.target.closest('.cc-tab');
    if (!tab) return;
    if (e.target.classList.contains('cc-tab-close')) {
      closeCcTab(tab);
      return;
    }
    switchCcTab(tab);
  });
}

// ==================== WS 查询 ====================

export function sendCcQuery(prompt, workDir, skills) {
  const tab = getActiveCcTab();
  if (!tab) return Promise.reject(new Error('无激活的 CC 会话'));

  const session = tab.dataset.ccSession || ('tab-' + (tab._tabId || 'default'));
  tab._pendingSkills = (skills || '').split(',').filter(Boolean);

  return new Promise(function(resolve, reject) {
    var settled = false;
    function finish(err, payload) {
      if (settled) return;
      settled = true;
      tab._activeQuery = null;
      if (err) reject(err); else resolve(payload);
    }

    tab._activeQuery = { resolve: function(r) { finish(null, r); }, reject: function(e) { finish(e); } };

    chrome.runtime.sendMessage({
      action: 'nxce_ws',
      cmd: 'query',
      session: session,
      cwd: workDir || '',
      prompt: prompt,
      skills: (skills || '').split(',').filter(Boolean),
      queryId: 'q-' + Date.now(),
    }, function(resp) {
      if (chrome.runtime.lastError) {
        finish(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp || !resp.ok) {
        finish(new Error(resp?.error || 'WS query 失败'));
      }
    });
  });
}

// ==================== WS 事件监听 ====================

export function setupNxceEventListener() {
  chrome.runtime.onMessage.addListener(function(msg) {
    if (!msg || msg.action !== 'nxce_event') return false;
    var ev = msg.event;
    var tab = getActiveCcTab();
    if (!tab) return false;

    switch (ev.type) {
      case 'turn_start':
        tab._streamingText = '';
        tab._streamingThinking = '';
        tab._streamingTools = [];
        break;
      case 'text':
        if (tab._silentTurn) {
          if (!tab._streamingText) tab._streamingText = '';
          tab._streamingText += ev.content || '';
          break;
        }
        if (!tab._streamingText) tab._streamingText = '';
        tab._streamingText += ev.content || '';
        appendCcStream(tab, ev.content);
        break;
      case 'thinking':
        if (!tab._streamingThinking) tab._streamingThinking = '';
        tab._streamingThinking += ev.content || '';
        break;
      case 'tool_use':
        if (!tab._streamingTools) tab._streamingTools = [];
        tab._streamingTools.push({ name: ev.name, input: ev.input, id: ev.id });
        break;
      case 'done':
        if (ev.sessionId) tab._sessionId = ev.sessionId;
        if (tab._activeQuery) {
          tab._activeQuery.resolve({ status: 'ok', data: { text: tab._streamingText, sessionId: tab._sessionId } });
        }
        if (tab._silentTurn) {
          tab._silentTurn = false;
          break;
        }
        finalizeCcStream(tab);
        break;
      case 'init':
        if (ev.sessionId) tab._sessionId = ev.sessionId;
        var initCwd = ev.cwd || '';
        var currentCwd = tab._path || '';
        if (initCwd && currentCwd && initCwd !== currentCwd) break;
        var initSkills = Array.isArray(ev.skills) ? ev.skills : [];
        var initSlash = Array.isArray(ev.slashCommands) ? ev.slashCommands : [];
        var merged = [...new Set([...initSlash, ...initSkills])];
        if (merged.length > 0) {
          tab._skills = merged
            .map(function(s) { return typeof s === 'string' ? { name: s, desc: '' } : { name: s.name || String(s), desc: s.desc || '' }; })
            .sort(function(a, b) { return a.name.localeCompare(b.name); });
          tab._skillsCwd = currentCwd || initCwd;
          tab._skillsLoading = false;
        }
        break;
      case 'error':
        if (tab._activeQuery) {
          tab._activeQuery.reject(new Error(ev.content || 'nxce error'));
        }
        break;
    }
    return false;
  });
}

// ==================== Serve 控制 ====================

export function setServeStatus(state, text) {
  var el = document.getElementById('cc-serve-status');
  var btn = document.getElementById('cc-serve-btn');
  if (el) {
    el.dataset.state = state;
    var txt = el.querySelector('.cc-serve-text');
    if (txt) txt.textContent = text;
  }
  if (btn) {
    btn.dataset.state = state;
    btn.dataset.loading = state === 'connecting' ? 'true' : 'false';
    var lbl = btn.querySelector('span:last-child');
    if (lbl) {
      lbl.textContent = ({
        disconnected: '连接',
        connecting: '取消',
        connected: '断开',
        error: '重试'
      })[state] || '连接';
    }
  }
}

export function refreshServeStatus() {
  setServeStatus('connecting', '探测…');
  chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'ping' }, function(resp) {
    if (resp?.connected) {
      setServeStatus('connected', '已连接');
    } else {
      setServeStatus('disconnected', '未连接');
    }
  });
}

export function setupServeControls(getCurrentMode) {
  var btn = document.getElementById('cc-serve-btn');
  if (!btn) return;

  btn.addEventListener('click', async function() {
    var state = btn.dataset.state;
    if (state === 'connecting') {
      chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'disconnect' }, function() { setServeStatus('disconnected', '已取消'); });
      return;
    }
    if (state === 'connected') {
      chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'disconnect' }, function() { setServeStatus('disconnected', '已断开'); });
      return;
    }
    setServeStatus('connecting', '启动中…');
    chrome.runtime.sendMessage({
      action: 'nativeMessage',
      payload: { command: 'claudeStartServe' },
    }, function(resp) {
      if (resp?.status === 'ok') {
        setTimeout(function() {
          chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'ping' }, function(p) {
            setServeStatus(p?.connected ? 'connected' : 'error', p?.connected ? '已连接' : '启动后未连上，请重试');
          });
        }, 2000);
      } else {
        setServeStatus('error', resp?.message || '启动失败');
      }
    });
  });

  var ccToggle = document.getElementById('cc-toggle');
  if (ccToggle) {
    ccToggle.addEventListener('click', function() {
      if (getCurrentMode() === 'claude-code') refreshServeStatus();
    });
  }
}

// ==================== 流式渲染 ====================

function appendCcStream(tab, chunk) {
  var rc = document.getElementById('response-content');
  if (!rc) return;
  var stream = rc.querySelector('.cc-stream-bubble');
  if (!stream) {
    stream = document.createElement('div');
    stream.className = 'notion-chat-message cc-stream-bubble';
    stream.innerHTML =
      '<div class="notion-chat-avatar" style="background:#f97316;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;flex-shrink:0;">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 6"/></svg>' +
      '</div>' +
      '<div class="notion-chat-bubble">' +
        '<div class="notion-chat-bubble-header">' +
          '<span class="notion-chat-bubble-name" style="color:#ea580c">' + (tab.querySelector('.cc-tab-label')?.textContent || 'Claude Code') + '</span>' +
        '</div>' +
        '<div class="notion-chat-bubble-content cc-stream-content"></div>' +
      '</div>';
    rc.appendChild(stream);
    rc.scrollTop = rc.scrollHeight;
  }
  var content = stream.querySelector('.cc-stream-content');
  if (content) {
    content.textContent += chunk;
    rc.scrollTop = rc.scrollHeight;
  }
  tab._messages = rc.innerHTML;
}

function finalizeCcStream(tab) {
  var rc = document.getElementById('response-content');
  if (!rc) return;
  var stream = rc.querySelector('.cc-stream-bubble');
  if (stream) {
    var content = stream.querySelector('.cc-stream-content');
    if (content) {
      content.innerHTML = escHtml(content.textContent || '').replace(/\n/g, '<br>');
    }
    stream.classList.remove('cc-stream-bubble');
  }
  tab._messages = rc.innerHTML;
}

// ==================== CC 发送 ====================

export async function handleCcSend() {
  var input = document.getElementById('chat-input');
  var pathInput = document.getElementById('cc-path-input');
  if (!input) return;

  var raw = input.value.trim();
  if (!raw) return;

  var activeTab = getActiveCcTab();
  if (!activeTab) return;

  var skillRegex = /\/([\w-]+)/g;
  var match;
  var skills = [];
  var prompt = raw;
  var tabSkills = activeTab._skills || [];
  while ((match = skillRegex.exec(raw)) !== null) {
    if (tabSkills.some(function(s) { return s.name === match[1]; })) {
      skills.push(match[1]);
      prompt = prompt.replace(match[0], '').trim();
    }
  }

  if (!prompt && skills.length === 0) return;
  if (!prompt && skills.length > 0) { alert('请在 /skill 后面补充问题内容'); return; }

  var workDir = pathInput ? pathInput.value.trim() : '';

  input.value = '';
  input.dispatchEvent(new Event('input'));

  var responseContent = document.getElementById('response-content');
  if (responseContent) {
    var skillsBadge = skills.length > 0
      ? '<div class="cc-bubble-skills">' + skills.map(function(s) { return '<span class="cc-skill-tag">' + escHtml(s) + '</span>'; }).join('') + '</div>'
      : '';
    var userMsg = document.createElement('div');
    userMsg.className = 'notion-chat-message notion-chat-message--user';
    userMsg.innerHTML =
      '<div class="notion-chat-bubble notion-chat-bubble--user" style="flex:0 1 auto;max-width:88%;">' +
        '<div class="notion-chat-bubble-header"><span class="notion-chat-bubble-name">You</span></div>' +
        '<div class="notion-chat-bubble-content">' + escHtml(prompt) + '</div>' +
        skillsBadge +
      '</div>';
    responseContent.appendChild(userMsg);
    responseContent.scrollTop = responseContent.scrollHeight;
    activeTab._messages = responseContent.innerHTML;
  }

  var loadingEl = document.createElement('div');
  loadingEl.className = 'cc-loading';
  loadingEl.innerHTML =
    '<div class="notion-chat-avatar">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' +
    '</div>' +
    '<div class="cc-loading-dots"><span class="cc-loading-dot"></span><span class="cc-loading-dot"></span><span class="cc-loading-dot"></span></div>';
  if (responseContent) {
    responseContent.appendChild(loadingEl);
    responseContent.scrollTop = responseContent.scrollHeight;
  }

  var skillPrefix = skills.length > 0 ? '[已选择 skill: ' + skills.join(', ') + '] ' : '';
  var finalPrompt = skillPrefix + prompt;

  try {
    await sendCcQuery(finalPrompt, workDir, skills.join(','));
  } catch (err) {
    if (loadingEl.parentNode) loadingEl.remove();
    if (responseContent) {
      var stream = responseContent.querySelector('.cc-stream-bubble');
      if (stream) stream.remove();
      var errMsg = document.createElement('div');
      errMsg.className = 'notion-chat-message';
      errMsg.innerHTML = '<div class="notion-chat-bubble" style="border-color:#e53e3e;"><div class="notion-chat-bubble-content" style="color:#e53e3e;">发送失败: ' + escHtml(err.message) + '</div></div>';
      responseContent.appendChild(errMsg);
    }
  } finally {
    if (loadingEl.parentNode) loadingEl.remove();
  }
}

// ==================== /skill 自动补全 ====================

function ensureCcTabSkills(tab) {
  if (!tab) return;
  if (!tab._skills) tab._skills = [];
  if (!tab._skillsLoading) tab._skillsLoading = false;
  if (tab._skillsLoading) return;
  if (tab._skills.length > 0 && tab._skillsCwd === tab._path) return;
  tab._skillsLoading = true;

  var session = tab.dataset.ccSession || 'default';
  var cwd = tab._path || CC_DEFAULT_PATH;
  tab._silentTurn = true;

  chrome.runtime.sendMessage({
    action: 'nxce_ws',
    cmd: 'query',
    session: session,
    cwd: cwd,
    prompt: ' ',
    queryId: 'skill-init-' + Date.now(),
  }, function(resp) {
    if (chrome.runtime.lastError || !resp?.ok) { tab._skillsLoading = false; return; }
    var waited = 0;
    var timer = setInterval(function() {
      waited += 200;
      if (tab._skills.length > 0 || waited > 10000) { clearInterval(timer); tab._skillsLoading = false; }
    }, 200);
  });
}

export function setupCcSkillAutocomplete(getCurrentMode) {
  var input = document.getElementById('chat-input');
  var popup = document.getElementById('cc-skill-popup');
  if (!input || !popup) return;

  var sel = -1;

  function close() { popup.style.display = 'none'; sel = -1; }

  function show(items) {
    if (items.length === 0) {
      popup.innerHTML = '<div class="cc-skill-empty">无匹配 Skill</div>';
    } else {
      popup.innerHTML = items.map(function(s, i) {
        return '<div class="cc-skill-item' + (i === sel ? ' selected' : '') + '" data-i="' + i + '">' +
          '<span class="cc-skill-item-icon">S</span>' +
          '<span class="cc-skill-item-name">' + escHtml(s.name) + '</span>' +
          '<span class="cc-skill-item-desc">' + escHtml(s.desc || '') + '</span>' +
        '</div>';
      }).join('');
    }
    popup.style.display = 'block';
  }

  function pickSkill(name) {
    var cur = input.selectionStart || 0;
    var v = input.value;
    var sp = v.lastIndexOf('/', cur);
    if (sp < 0) return;
    input.value = v.slice(0, sp) + '/' + name + ' ' + v.slice(cur);
    var np = sp + name.length + 2;
    input.setSelectionRange(np, np);
    input.dispatchEvent(new Event('input'));
    close();
    input.focus();
  }

  input.addEventListener('input', function() {
    if (getCurrentMode() !== 'claude-code') return close();
    var cur = input.selectionStart || 0;
    var v = input.value;
    var sp = v.lastIndexOf('/', cur);
    if (sp < 0 || sp >= cur) return close();
    var word = v.slice(sp + 1, cur);
    if (word.includes(' ')) return close();

    var tab = getActiveCcTab();
    if (tab) ensureCcTabSkills(tab);
    var skills = tab?._skills || [];

    var matched = skills.filter(function(s) { return s.name.toLowerCase().includes(word.toLowerCase()); }).slice(0, 20);
    sel = matched.length > 0 ? 0 : -1;
    show(matched);
  });

  input.addEventListener('keydown', function(e) {
    if (popup.style.display !== 'block') return;
    var items = popup.querySelectorAll('.cc-skill-item');
    if (!items.length && e.key !== 'Escape') return;

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      var name = items[sel]?.querySelector('.cc-skill-item-name')?.textContent;
      if (name) pickSkill(name);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); items.forEach(function(el, i) { el.classList.toggle('selected', i === sel); }); items[sel]?.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); items.forEach(function(el, i) { el.classList.toggle('selected', i === sel); }); items[sel]?.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === 'Escape') { close(); return; }
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.chat-input-middle')) close();
  });

  popup.addEventListener('mousedown', function(e) {
    var item = e.target.closest('.cc-skill-item');
    if (!item) return;
    var name = item.querySelector('.cc-skill-item-name')?.textContent;
    if (name) pickSkill(name);
  });
}
