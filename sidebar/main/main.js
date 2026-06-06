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
 * 通过 native messaging 发送 Claude Code 查询。
 * 从当前激活 tab 获取 sessionId，收到响应后更新。
 */
function sendCcQuery(prompt, workDir, skills) {
  const tab = getActiveCcTab();
  if (!tab) return Promise.reject(new Error("无激活的 CC 会话"));

  console.log("[CC sendCcQuery] 发出 nativeMessage:", {
    command: "claudeQuery",
    sessionId: tab._sessionId,
    promptLen: prompt.length,
    workDir,
  });

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: "nativeMessage",
      payload: {
        command: "claudeQuery",
        prompt: prompt,
        sessionId: tab._sessionId || "",
        workDir: workDir || "",
        skills: skills || "",
      },
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[CC sendCcQuery] 错误:", chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      console.log("[CC sendCcQuery] 收到 native 响应:", {
        status: response?.status,
        sessionId: response?.data?.sessionId,
        textLen: response?.data?.text?.length,
      });
      // 更新 tab 的 sessionId（SDK 可能返回新的或原有的）
      if (response?.data?.sessionId) {
        tab._sessionId = response.data.sessionId;
        console.log("[CC sendCcQuery] 更新 tab sessionId:", tab._sessionId);
      }
      resolve(response);
    });
  });
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

    // CC 路径栏变化 → 保存到当前 tab
    const pathInput = document.getElementById("cc-path-input");
    if (pathInput) {
      pathInput.addEventListener("input", () => {
        const tab = getActiveCcTab();
        if (tab) {
          tab._path = pathInput.value;
          // 路径变了 → 清空 skill 缓存，下次 / 时重新加载
          tab._skills = [];
          tab._skillsLoading = false;
        }
      });
    }

    // CC /skill 自动补全
    setupCcSkillAutocomplete();
  } catch (error) {
    console.error("初始化popup失败:", error);
  }
});

// ==================== CC /skill 自动补全 ====================

function ensureCcTabSkills(tab) {
  if (!tab || tab._skillsLoading) return;
  if (tab._skills.length > 0) return;
  tab._skillsLoading = true;
  chrome.runtime.sendMessage({
    action: 'nativeMessage',
    payload: { command: 'getClaudeSkills', workDir: tab._path || "" },
  }, (resp) => {
    tab._skillsLoading = false;
    if (resp?.data?.skills) {
      tab._skills = resp.data.skills
        .map(name => ({ name, desc: '' }))
        .sort((a, b) => a.name.localeCompare(b.name));
      console.log(`[CC Skill] tab ${tab.dataset.ccSession} 获取到 ${tab._skills.length} 个 skill`);
    }
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

/** CC 模式发送处理 */
async function handleCcSend() {
  const input = document.getElementById("chat-input");
  const pathInput = document.getElementById("cc-path-input");
  if (!input) return;

  const raw = input.value.trim();
  if (!raw) return;

  const activeTab = getActiveCcTab();

  // 从 prompt 中提取 /skill xxx 指令
  const skillRegex = /\/([\w-]+)/g;
  let match;
  const skills = [];
  let prompt = raw;
  const tabSkills = activeTab?._skills || [];
  while ((match = skillRegex.exec(raw)) !== null) {
    const skillName = match[1];
    if (tabSkills.some(s => s.name === skillName)) {
      skills.push(skillName);
      prompt = prompt.replace(match[0], '').trim();
    }
  }

  const workDir = pathInput ? pathInput.value.trim() : "";
  const tabLabel = activeTab?.querySelector(".cc-tab-label");
  const sessionId = activeTab?._sessionId || null;

  console.log("[CC Send] 发送请求:", {
    sessionId,
    prompt: prompt.slice(0, 100) + (prompt.length > 100 ? "..." : ""),
    workDir,
    tab: activeTab?.dataset.ccSession,
  });

  // 清空输入
  input.value = "";
  input.dispatchEvent(new Event("input"));

  // 显示用户消息到回复区
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
    // 保存到 tab
    if (activeTab) activeTab._messages = responseContent.innerHTML;
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

  // 发送并等待回复
  try {
    console.log("[CC Send] 正在通过 native messaging 发送...", { skills, prompt: prompt.slice(0, 80) });
    const resp = await sendCcQuery(prompt, workDir, skills.join(","));
    console.log("[CC Send] 收到回复:", {
      status: resp?.status,
      textLength: resp?.data?.text?.length || 0,
      sessionId: resp?.data?.sessionId,
      textPreview: (resp?.data?.text || "").slice(0, 150) + ((resp?.data?.text?.length || 0) > 150 ? "..." : ""),
    });

    // 移除加载动画
    if (loadingEl.parentNode) loadingEl.remove();

    const text = resp?.data?.text || "（无回复）";

    // 显示 Claude 回复
    if (responseContent) {
      const aiMsg = document.createElement("div");
      aiMsg.className = "notion-chat-message";
      aiMsg.innerHTML = `
        <div class="notion-chat-avatar" style="background:#f97316;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;width:26px;height:26px;border-radius:50%;flex-shrink:0;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        </div>
        <div class="notion-chat-bubble">
          <div class="notion-chat-bubble-header">
            <span class="notion-chat-bubble-name" style="color:#ea580c">${tabLabel?.textContent || "Claude Code"}</span>
          </div>
          <div class="notion-chat-bubble-content">${escHtml(text)}</div>
        </div>`;
      responseContent.appendChild(aiMsg);
      responseContent.scrollTop = responseContent.scrollHeight;
      // 保存到 tab
      if (activeTab) activeTab._messages = responseContent.innerHTML;
    }
  } catch (err) {
    console.error("[CC Send] 发送失败:", err);
    // 移除加载动画
    if (loadingEl.parentNode) loadingEl.remove();
    if (responseContent) {
      const errMsg = document.createElement("div");
      errMsg.className = "notion-chat-message";
      errMsg.innerHTML = `<div class="notion-chat-bubble" style="border-color:#e53e3e;"><div class="notion-chat-bubble-content" style="color:#e53e3e;">发送失败: ${escHtml(err.message)}</div></div>`;
      responseContent.appendChild(errMsg);
    }
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
