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

let ccSessionCounter = 1;       // 下一个会话编号

function createCcTab() {
  ccSessionCounter++;
  const id = `cc-session-${ccSessionCounter}`;
  const tabsEl = document.getElementById("cc-tabs");
  if (!tabsEl) return null;

  const tab = document.createElement("div");
  tab.className = "cc-tab";
  tab.dataset.ccSession = id;
  tab.innerHTML = `
    <span class="cc-tab-icon">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    </span>
    <span class="cc-tab-label">会话 ${ccSessionCounter}</span>
    <span class="cc-tab-close" title="关闭">×</span>
  `;

  // 插入到 + 按钮之前
  const addBtn = tabsEl.querySelector(".cc-tab-add");
  if (addBtn) {
    tabsEl.insertBefore(tab, addBtn);
  } else {
    tabsEl.appendChild(tab);
  }

  // 激活新 tab
  switchCcTab(tab);

  return tab;
}

function switchCcTab(tab) {
  const tabsEl = document.getElementById("cc-tabs");
  if (!tabsEl) return;
  tabsEl.querySelectorAll(".cc-tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");
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

    setupDragDrop();
  } catch (error) {
    console.error("初始化popup失败:", error);
  }
});

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
