import {
  initializePopup,
  setupEventListeners,
  loadStoredData,
  initializeResponseDisplay,
} from "./mainUtils.js";
import { initializePlatformOptions } from "../../popup/main/platformRenderer.js";

// ==================== 模式状态机 ====================

const MODES = {
  AICHAT: "aichat",
  CLAUDE_CODE: "claude-code",
};

let currentMode = MODES.AICHAT;

function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  shell.dataset.mode = mode;

  const toggleBtn = document.getElementById("cc-toggle");
  if (!toggleBtn) return;

  if (mode === MODES.CLAUDE_CODE) {
    toggleBtn.title = "切换到 AI Chat 模式";
  } else {
    toggleBtn.title = "切换到 Claude Code 模式";
  }
}


function toggleMode() {
  const next = currentMode === MODES.AICHAT ? MODES.CLAUDE_CODE : MODES.AICHAT;
  setMode(next);
}

// ==================== CC 多窗口管理 ====================

let ccSessionCounter = 1;
const CC_DEFAULT_PATH = "C:\\Windows\\System32";

/** 保存当前 tab 的消息和路径到 tab 对象 */
function saveCcTabState(tab) {
  if (!tab) return;
  const rc = document.getElementById("response-content");
  const pi = document.getElementById("cc-path-input");
  if (rc) tab._messages = rc.innerHTML;
  if (pi) tab._path = pi.value;
}

/** 恢复指定 tab 的消息和路径 */
function restoreCcTabState(tab) {
  if (!tab) return;
  const rc = document.getElementById("response-content");
  const pi = document.getElementById("cc-path-input");
  if (rc) rc.innerHTML = tab._messages !== undefined ? tab._messages : "";
  if (pi) pi.value = tab._path !== undefined ? tab._path : CC_DEFAULT_PATH;
}

function createCcTab() {
  ccSessionCounter++;
  const id = `cc-session-${ccSessionCounter}`;
  const tabsEl = document.getElementById("cc-tabs");
  if (!tabsEl) return null;

  const tab = document.createElement("div");
  tab.className = "cc-tab";
  tab.dataset.ccSession = id;
  tab._sessionId = null;
  tab._messages = "";
  tab._path = CC_DEFAULT_PATH;
  tab._skills = [];       // 每个 tab 独立的 skill 缓存
  tab._skillsLoading = false;
  tab.innerHTML = `
    <span class="cc-tab-icon">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    </span>
    <span class="cc-tab-label">会话 ${ccSessionCounter}</span>
    <span class="cc-tab-close" title="关闭">×</span>
  `;

  const addBtn = tabsEl.querySelector(".cc-tab-add");
  if (addBtn) tabsEl.insertBefore(tab, addBtn);
  else tabsEl.appendChild(tab);

  // 保存当前 tab 状态 → 切换到新 tab → 恢复新 tab 状态
  const currentActive = getActiveCcTab();
  saveCcTabState(currentActive);
  switchCcTab(tab);
  restoreCcTabState(tab);

  return tab;
}

/** 获取当前激活的 CC tab */
function getActiveCcTab() {
  return document.querySelector(".cc-tab.active");
}

/**
 * 通过 WebSocket 发送 Claude Code 查询（nx-ce serve 直连模式）。
 * 从当前激活 tab 获取 sessionId（用作 nx-ce session name），流式响应通过
 * onNxceEvent 分发。返回的 Promise 在 'done' 事件到达时 resolve。
 */
function sendCcQuery(prompt, workDir, skills) {
  const tab = getActiveCcTab();
  if (!tab) return Promise.reject(new Error("无激活的 CC 会话"));

  // nx-ce session name 用 tab 的 ccSession id（保证 per-tab 隔离）
  const session = tab.dataset.ccSession || `tab-${tab._tabId || "default"}`;

  console.log("[CC sendCcQuery] WS query:", {
    session,
    sessionId: tab._sessionId,
    promptLen: prompt.length,
    workDir,
  });

  // 缓存 skills 到 query 上下文中（event handler 用）
  tab._pendingSkills = (skills || "").split(",").filter(Boolean);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, payload) => {
      if (settled) return;
      settled = true;
      tab._activeQuery = null;
      if (err) reject(err); else resolve(payload);
    };

    // 注册本轮 query 的完成回调
    tab._activeQuery = { resolve: (r) => finish(null, r), reject: (e) => finish(e) };

    chrome.runtime.sendMessage({
      action: "nxce_ws",
      cmd: "query",
      session,
      cwd: workDir || "",
      prompt,
      queryId: `q-${Date.now()}`,
    }, (resp) => {
      if (chrome.runtime.lastError) {
        finish(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp || !resp.ok) {
        // WS 没连上 → 触发 ensureRunning 兜底
        if (resp?.error?.includes?.('timeout') || resp?.error?.includes?.('connect')) {
          chrome.runtime.sendMessage({ action: "nxce_ws", cmd: "ensureRunning" }, () => {
            finish(new Error("WS 未连接，已请求启动 nx-ce，请稍后重试"));
          });
        } else {
          finish(new Error(resp?.error || "WS query 失败"));
        }
      }
      // 不在这里 resolve — 等待 nxce_event 中的 'done' 消息
    });
  });
}

/**
 * 订阅 nxce_event 流式消息。
 * 在 background.js 的 nxce_ws.js dispatch 时按 turnId 路由回当前激活 tab。
 * content_script / sidebar 只能监听自己的 tab（通过 sender.tab.id）。
 *
 * 简化：sidebar 只用 onMessage 一次性收所有 nxce_event；按 event.session 匹配当前 tab。
 */
function setupNxceEventListener() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.action !== 'nxce_event') return false;
    const ev = msg.event;
    const tab = getActiveCcTab();
    if (!tab) return false;

    switch (ev.type) {
      case 'turn_start': {
        tab._streamingText = '';
        tab._streamingThinking = '';
        tab._streamingTools = [];
        break;
      }
      case 'text': {
        if (!tab._streamingText) tab._streamingText = '';
        tab._streamingText += ev.content || '';
        appendCcStream(tab, ev.content);
        break;
      }
      case 'thinking': {
        if (!tab._streamingThinking) tab._streamingThinking = '';
        tab._streamingThinking += ev.content || '';
        break;
      }
      case 'tool_use': {
        if (!tab._streamingTools) tab._streamingTools = [];
        tab._streamingTools.push({ name: ev.name, input: ev.input, id: ev.id });
        break;
      }
      case 'done': {
        if (ev.sessionId) tab._sessionId = ev.sessionId;
        if (tab._activeQuery) {
          tab._activeQuery.resolve({ status: 'ok', data: { text: tab._streamingText, sessionId: tab._sessionId } });
        }
        finalizeCcStream(tab);
        break;
      }
      case 'init': {
        if (ev.sessionId) tab._sessionId = ev.sessionId;
        // 缓存 skills（如果 init 消息带）
        if (Array.isArray(ev.skills) && ev.skills.length > 0) {
          tab._skills = ev.skills
            .map((name) => ({ name, desc: '' }))
            .sort((a, b) => a.name.localeCompare(b.name));
        }
        break;
      }
      case 'error': {
        if (tab._activeQuery) {
          tab._activeQuery.reject(new Error(ev.content || 'nxce error'));
        }
        break;
      }
    }
    return false;
  });
}

/* ============================================================
 *  CC nx-ce serve 状态指示 + 连接按钮
 * ============================================================ */

function setServeStatus(state, text) {
  const el = document.getElementById('cc-serve-status');
  const btn = document.getElementById('cc-serve-btn');
  if (el) {
    el.dataset.state = state;
    const txt = el.querySelector('.cc-serve-text');
    if (txt) txt.textContent = text;
  }
  if (btn) {
    btn.dataset.state = state === 'connecting' ? 'loading' : '';
    const lbl = btn.querySelector('span:last-child');
    if (lbl) lbl.textContent = state === 'connected' ? '重启' : '连接';
  }
}

async function refreshServeStatus() {
  setServeStatus('connecting', '探测…');
  chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'ping' }, (resp) => {
    if (resp?.connected) {
      setServeStatus('connected', '已连接');
    } else {
      setServeStatus('disconnected', '未连接');
    }
  });
}

function setupServeControls() {
  const btn = document.getElementById('cc-serve-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    setServeStatus('connecting', '启动中…');
    btn.dataset.state = 'loading';
    chrome.runtime.sendMessage({ action: 'nxce_ws', cmd: 'ensureRunning' }, (resp) => {
      btn.dataset.state = '';
      if (resp?.ok) {
        setServeStatus('connected', '已连接');
      } else {
        setServeStatus('error', resp?.error || '启动失败');
      }
    });
  });

  // 模式切到 CC 时主动探测一次
  // （懒：仅在用户首次进入 CC 模式时检查）
  const ccToggle = document.getElementById('cc-toggle');
  if (ccToggle) {
    ccToggle.addEventListener('click', () => {
      // 切到 CC 模式时检查；切回时不动
      if (currentMode === MODES.CLAUDE_CODE) refreshServeStatus();
    });
  }

  // 初始进入时也探测（如果已在 CC 模式）
  if (currentMode === MODES.CLAUDE_CODE) refreshServeStatus();
}

// WS 状态变化时同步按钮（通过监听 connect/dispatch）
function _onWsConnected() { setServeStatus('connected', '已连接'); }
function _onWsDisconnected() { setServeStatus('disconnected', '未连接'); }
function appendCcStream(tab, chunk) {
  const rc = document.getElementById('response-content');
  if (!rc) return;
  let stream = rc.querySelector('.cc-stream-bubble');
  if (!stream) {
    stream = document.createElement('div');
    stream.className = 'notion-chat-message cc-stream-bubble';
    stream.innerHTML = `
      <div class="notion-chat-avatar" style="background:#f97316;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;flex-shrink:0;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 6"/></svg>
      </div>
      <div class="notion-chat-bubble">
        <div class="notion-chat-bubble-header">
          <span class="notion-chat-bubble-name" style="color:#ea580c">${tab.querySelector('.cc-tab-label')?.textContent || 'Claude Code'}</span>
        </div>
        <div class="notion-chat-bubble-content cc-stream-content"></div>
      </div>`;
    rc.appendChild(stream);
    rc.scrollTop = rc.scrollHeight;
  }
  const content = stream.querySelector('.cc-stream-content');
  if (content) {
    content.textContent += chunk;
    rc.scrollTop = rc.scrollHeight;
  }
  // 持久化
  tab._messages = rc.innerHTML;
}

/** 流结束：去掉 cc-stream-bubble 标记（保留内容） */
function finalizeCcStream(tab) {
  const rc = document.getElementById('response-content');
  if (!rc) return;
  const stream = rc.querySelector('.cc-stream-bubble');
  if (stream) {
    // 渲染最终 HTML（escHtml + 保留换行）
    const content = stream.querySelector('.cc-stream-content');
    if (content) {
      content.innerHTML = escHtml(content.textContent || '').replace(/\n/g, '<br>');
    }
    stream.classList.remove('cc-stream-bubble');
  }
  tab._messages = rc.innerHTML;
}

function switchCcTab(tab) {
  if (!tab) return;
  const tabsEl = document.getElementById("cc-tabs");
  if (!tabsEl) return;

  // 保存当前 tab 的状态
  const current = getActiveCcTab();
  if (current && current !== tab) {
    current._path = document.getElementById("cc-path-input")?.value || CC_DEFAULT_PATH;
    current._messages = document.getElementById("response-content")?.innerHTML || "";
  }

  tabsEl.querySelectorAll(".cc-tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");

  // 恢复目标 tab 的状态
  const pi = document.getElementById("cc-path-input");
  const rc = document.getElementById("response-content");
  if (pi) pi.value = tab._path !== undefined ? tab._path : CC_DEFAULT_PATH;
  if (rc) rc.innerHTML = tab._messages !== undefined ? tab._messages : "";
}

function closeCcTab(tab) {
  if (!tab) return;
  const isActive = tab.classList.contains("active");
  const prev = tab.previousElementSibling;
  const next = tab.nextElementSibling;
  tab.remove();

  // 如果关了的是当前激活的，切换到相邻 tab
  if (isActive) {
    const target = prev && prev.classList.contains("cc-tab") ? prev
                 : next && next.classList.contains("cc-tab") ? next
                 : null;
    if (target) {
      switchCcTab(target);
    }
  }
}

function setupCcTabListeners() {
  const tabsEl = document.getElementById("cc-tabs");
  if (!tabsEl) return;

  // 新建
  const addBtn = document.getElementById("cc-tab-add");
  if (addBtn) {
    addBtn.addEventListener("click", createCcTab);
  }

  // 切换 & 关闭（事件代理）
  tabsEl.addEventListener("click", (e) => {
    const tab = e.target.closest(".cc-tab");
    if (!tab) return;

    if (e.target.classList.contains("cc-tab-close")) {
      closeCcTab(tab);
      return;
    }

    switchCcTab(tab);
  });
}

document.addEventListener("DOMContentLoaded", async function () {
  try {
    console.log("[Sidebar] DOMContentLoaded");
    initializePlatformOptions();
    await initializePopup();
    console.log("[Sidebar] initializePopup done");
    initializeResponseDisplay();
    console.log("[Sidebar] initializeResponseDisplay done");
    await loadStoredData();
    setupEventListeners();

    // 模式切换
    const ccToggle = document.getElementById("cc-toggle");
    if (ccToggle) {
      ccToggle.addEventListener("click", toggleMode);
    }

    // CC 多窗口管理
    setupCcTabListeners();

    // CC 模式发送拦截（在 capture 阶段截获，避免走 AI Chat 的平台发送）
    const sendBtn = document.getElementById("chat-btn-send");
    const chatInput = document.getElementById("chat-input");

    if (sendBtn) {
      sendBtn.addEventListener("click", (e) => {
        if (currentMode !== MODES.CLAUDE_CODE) return; // 仅拦截 CC 模式
        e.stopImmediatePropagation();
        e.preventDefault();
        handleCcSend();
      }, true);
    }

    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (currentMode !== MODES.CLAUDE_CODE) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          handleCcSend();
        }
      }, true);
    }

    setupDragDrop();

    // CC 路径栏变化 → 保存到当前 tab；切换 cwd 时关闭旧 nx-ce session
    const pathInput = document.getElementById("cc-path-input");
    if (pathInput) {
      let lastPath = pathInput.value;
      pathInput.addEventListener("input", () => {
        const tab = getActiveCcTab();
        if (!tab) return;
        const newPath = pathInput.value;
        if (newPath === lastPath) return;

        // cwd 变了 → 关闭旧 session
        if (tab._path && tab._path !== newPath) {
          const oldCwd = tab._path;
          chrome.runtime.sendMessage({
            action: 'nxce_ws',
            cmd: 'closeSession',
            session: tab.dataset.ccSession || `tab-${tab._tabId || 'default'}`,
            cwd: oldCwd,
          });
        }
        lastPath = newPath;

        tab._path = newPath;
        // 清空 skill 缓存，下次 / 时重新加载
        tab._skills = [];
        tab._skillsLoading = false;
      });
    }

    // 监听 nxce 流式事件
    setupNxceEventListener();

    // CC nx-ce serve 状态指示 + 手动连接按钮
    setupServeControls();

    // CC /skill 自动补全
    setupCcSkillAutocomplete();
  } catch (error) {
    console.error("初始化popup失败:", error);
  }
});

// ==================== CC /skill 自动补全 ====================

function ensureCcTabSkills(tab) {
  if (!tab) return;
  if (!tab._skills) tab._skills = [];
  if (!tab._skillsLoading) tab._skillsLoading = false;
  if (tab._skillsLoading || tab._skills.length > 0) return;
  tab._skillsLoading = true;

  // 思路：nx-ce 的 getSkills 需要 session 已 init；session 在首次 query 后才 init。
  // 但 nx-ce 在任何 cwd 下 init 后，init 消息里的 skills 就是该 cwd 的可用 skills。
  // 简化策略：调一次"空 prompt"让 nx-ce init session 并回 skills，然后关闭该 session。
  // 但更稳的做法：直接复用上次的 init 缓存，或主动 query "hi" 获取一次。
  //
  // 当前选择：发一个简短占位 query 触发 init，init 后立即 closeSession。
  // skill 缓存由 init 事件（setupNxceEventListener 'init' case）写入。
  const session = tab.dataset.ccSession || `tab-${tab._tabId || 'default'}`;
  const cwd = tab._path || '';

  console.log(`[CC Skill] tab ${session} 首次拉取 skill（占位 query）`);

  // 占位 query 用 '/' 自身（不污染用户 prompt）—— 或者用 '_' 让 nx-ce 立即返回
  chrome.runtime.sendMessage({
    action: 'nxce_ws',
    cmd: 'query',
    session,
    cwd,
    prompt: ' ',  // 单空格：最快 init，无实际回复
    queryId: `skill-init-${Date.now()}`,
  }, (resp) => {
    // 占位 query 不需要等结果；init 事件会把 skills 写入 tab._skills
    if (chrome.runtime.lastError) {
      tab._skillsLoading = false;
      console.log('[CC Skill] 占位 query 失败:', chrome.runtime.lastError.message);
      return;
    }
    if (!resp?.ok) {
      tab._skillsLoading = false;
      console.log('[CC Skill] 占位 query 返回错误:', resp?.error);
      return;
    }
    // 成功发送后等待 init 事件；用轮询兜底
    let waited = 0;
    const timer = setInterval(() => {
      waited += 200;
      if (tab._skills.length > 0) {
        clearInterval(timer);
        tab._skillsLoading = false;
        console.log(`[CC Skill] tab ${session} 加载 ${tab._skills.length} 个 skill`);
      } else if (waited > 15000) {
        clearInterval(timer);
        tab._skillsLoading = false;
        console.log('[CC Skill] 超时未拿到 skill');
      }
    }, 200);
  });
}

function setupCcSkillAutocomplete() {
  const input = document.getElementById('chat-input');
  const popup = document.getElementById('cc-skill-popup');
  if (!input || !popup) return;

  let sel = -1;

  function close() { popup.style.display = 'none'; sel = -1; }

  function show(items) {
    if (items.length === 0) {
      popup.innerHTML = '<div class="cc-skill-empty">无匹配 Skill</div>';
    } else {
      popup.innerHTML = items.map((s, i) =>
        `<div class="cc-skill-item${i === sel ? ' selected' : ''}" data-i="${i}">
          <span class="cc-skill-item-icon">S</span>
          <span class="cc-skill-item-name">${escHtml(s.name)}</span>
          <span class="cc-skill-item-desc">${escHtml(s.desc || '')}</span>
        </div>`).join('');
    }
    popup.style.display = 'block';
  }

  function pickSkill(name) {
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
    if (currentMode !== MODES.CLAUDE_CODE) return close();
    const cur = input.selectionStart || 0;
    const v = input.value;
    const sp = v.lastIndexOf('/', cur);
    if (sp < 0 || sp >= cur) return close();
    const word = v.slice(sp + 1, cur);
    if (word.includes(' ')) return close();

    // 从当前 tab 加载 skill
    const tab = getActiveCcTab();
    if (tab) ensureCcTabSkills(tab);
    const skills = tab?._skills || [];

    const matched = skills.filter(s => s.name.toLowerCase().includes(word.toLowerCase())).slice(0, 20);
    sel = matched.length > 0 ? 0 : -1;
    show(matched);
  });

  input.addEventListener('keydown', (e) => {
    if (popup.style.display !== 'block') return;
    const items = popup.querySelectorAll('.cc-skill-item');
    if (!items.length && e.key !== 'Escape') return;

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const name = items[sel]?.querySelector('.cc-skill-item-name')?.textContent;
      if (name) pickSkill(name);
      return;
    }

    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle('selected', i === sel)); items[sel]?.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); items.forEach((el, i) => el.classList.toggle('selected', i === sel)); items[sel]?.scrollIntoView({ block: 'nearest' }); return; }
    if (e.key === 'Escape') { close(); return; }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-input-middle')) close();
  });

  // 点击选中
  popup.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.cc-skill-item');
    if (!item) return;
    const name = item.querySelector('.cc-skill-item-name')?.textContent;
    if (name) pickSkill(name);
  });
}

/** CC 模式发送处理（流式：发送后等 done 事件填充回复区） */
async function handleCcSend() {
  const input = document.getElementById("chat-input");
  const pathInput = document.getElementById("cc-path-input");
  if (!input) return;

  const raw = input.value.trim();
  if (!raw) return;

  const activeTab = getActiveCcTab();
  if (!activeTab) return;

  // 从 prompt 中提取 /skill xxx 指令
  const skillRegex = /\/([\w-]+)/g;
  let match;
  const skills = [];
  let prompt = raw;
  const tabSkills = activeTab._skills || [];
  while ((match = skillRegex.exec(raw)) !== null) {
    const skillName = match[1];
    if (tabSkills.some(s => s.name === skillName)) {
      skills.push(skillName);
      prompt = prompt.replace(match[0], '').trim();
    }
  }

  const workDir = pathInput ? pathInput.value.trim() : "";

  console.log("[CC Send] 发送请求:", {
    sessionId: activeTab._sessionId,
    prompt: prompt.slice(0, 100) + (prompt.length > 100 ? "..." : ""),
    workDir,
    skills,
    tab: activeTab.dataset.ccSession,
  });

  // 清空输入
  input.value = "";
  input.dispatchEvent(new Event("input"));

  // 显示用户消息
  const responseContent = document.getElementById("response-content");
  if (responseContent) {
    const userMsg = document.createElement("div");
    userMsg.className = "notion-chat-message notion-chat-message--user";
    userMsg.innerHTML = `
      <div class="notion-chat-bubble notion-chat-bubble--user" style="flex:0 1 auto;max-width:88%;">
        <div class="notion-chat-bubble-header">
          <span class="notion-chat-bubble-name">You</span>
        </div>
        <div class="notion-chat-bubble-content">${escHtml(prompt)}</div>
      </div>`;
    responseContent.appendChild(userMsg);
    responseContent.scrollTop = responseContent.scrollHeight;
    activeTab._messages = responseContent.innerHTML;
  }

  // 显示加载动画
  const loadingEl = document.createElement("div");
  loadingEl.className = "cc-loading";
  loadingEl.innerHTML = `
    <div class="notion-chat-avatar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    </div>
    <div class="cc-loading-dots">
      <span class="cc-loading-dot"></span>
      <span class="cc-loading-dot"></span>
      <span class="cc-loading-dot"></span>
    </div>`;
  if (responseContent) {
    responseContent.appendChild(loadingEl);
    responseContent.scrollTop = responseContent.scrollHeight;
  }

  // 发送（流式：resolve 在 done 事件时触发，appendCcStream 已逐块填充）
  try {
    await sendCcQuery(prompt, workDir, skills.join(","));
  } catch (err) {
    console.error("[CC Send] 失败:", err);
    if (loadingEl.parentNode) loadingEl.remove();
    if (responseContent) {
      // 移除可能残留的流式 bubble
      const stream = responseContent.querySelector('.cc-stream-bubble');
      if (stream) stream.remove();
      const errMsg = document.createElement("div");
      errMsg.className = "notion-chat-message";
      errMsg.innerHTML = `<div class="notion-chat-bubble" style="border-color:#e53e3e;"><div class="notion-chat-bubble-content" style="color:#e53e3e;">发送失败: ${escHtml(err.message)}</div></div>`;
      responseContent.appendChild(errMsg);
    }
  } finally {
    if (loadingEl.parentNode) loadingEl.remove();
  }
}

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setupDragDrop() {
  const messageInput = document.getElementById("chat-input");
  if (!messageInput) return;

  function preventDefaults(e) { e.preventDefault(); }
  function highlight() { messageInput.classList.add("dragover"); }
  function unhighlight() { messageInput.classList.remove("dragover", "drop-error"); }

  ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
    messageInput.addEventListener(eventName, preventDefaults, false);
  });
  ["dragenter", "dragover"].forEach(eventName => {
    messageInput.addEventListener(eventName, highlight, false);
  });
  ["dragleave", "drop"].forEach(eventName => {
    messageInput.addEventListener(eventName, unhighlight, false);
  });

  messageInput.addEventListener("drop", async (e) => {
    unhighlight();
    const files = e.dataTransfer?.files;
    if (!files?.length) return;

    const isSingleFile = files.length === 1;
    if (isSingleFile && files[0].type === "text/html") {
      handleHtmlDrop(files[0], messageInput);
    } else if (isSingleFile && files[0].name?.endsWith(".md")) {
      handleMdDrop(files[0], messageInput);
    } else {
      handleFileDrop(files, messageInput);
    }
  });
}

async function handleHtmlDrop(file, input) {
  try {
    const text = await file.text();
    input.value = text;
    input.dispatchEvent(new Event("input"));
  } catch (err) {
    console.error("读取 HTML 文件失败:", err);
    input.classList.add("drop-error");
  }
}

async function handleMdDrop(file, input) {
  try {
    const text = await file.text();
    input.value = text;
    input.dispatchEvent(new Event("input"));
  } catch (err) {
    console.error("读取 Markdown 文件失败:", err);
    input.classList.add("drop-error");
  }
}

async function handleFileDrop(files, input) {
  const fileNames = Array.from(files).map(f => f.name).join("\n");
  const header = `[已拖放 ${files.length} 个文件]:\n${fileNames}\n\n`;
  input.value = input.value + header;
  input.dispatchEvent(new Event("input"));
}
