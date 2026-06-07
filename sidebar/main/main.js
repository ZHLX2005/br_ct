import {
  initializePopup,
  setupEventListeners,
  loadStoredData,
  initializeResponseDisplay,
} from "./mainUtils.js";
import { initializePlatformOptions } from "../../popup/main/platformRenderer.js";

import {
  getActiveCcTab,
  createCcTab,
  switchCcTab,
  closeCcTab,
  setupCcTabListeners,
  sendCcQuery,
  setupNxceEventListener,
  setServeStatus,
  refreshServeStatus,
  setupServeControls,
  handleCcSend,
  setupCcSkillAutocomplete,
} from "./cc/cc.js";

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

// ==================== DOMContentLoaded ====================

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
        if (currentMode !== MODES.CLAUDE_CODE) return;
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

        if (tab._path && tab._path !== newPath) {
          chrome.runtime.sendMessage({
            action: 'nxce_ws',
            cmd: 'closeSession',
            session: tab.dataset.ccSession || `tab-${tab._tabId || 'default'}`,
            cwd: tab._path,
          });
        }
        lastPath = newPath;

        tab._path = newPath;
        tab._skills = [];
        tab._skillsCwd = null;
        tab._skillsLoading = false;
        tab._pendingSkillInitCwd = newPath;
        tab._sessionId = null;

        const rcEl = document.getElementById("response-content");
        if (rcEl) {
          rcEl.innerHTML = "";
          tab._messages = "";
        }
        const inputEl = document.getElementById("chat-input");
        if (inputEl) {
          inputEl.value = "";
          inputEl.dispatchEvent(new Event("input"));
        }
      });
    }

    // 监听 nxce 流式事件
    setupNxceEventListener();

    // CC nx-ce serve 状态指示 + 手动连接按钮
    setupServeControls(() => currentMode);

    // CC /skill 自动补全
    setupCcSkillAutocomplete(() => currentMode);

    // 初始进入时探测（如果已在 CC 模式）
    if (currentMode === MODES.CLAUDE_CODE) refreshServeStatus();
  } catch (error) {
    console.error("初始化popup失败:", error);
  }
});

// ==================== 拖放 ====================

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
