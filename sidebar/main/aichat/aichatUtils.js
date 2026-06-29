// aichatUtils.js - AI Chat 核心功能模块（原 mainUtils.js）
// 100% AI Chat 代码，无任何 Claude Code 逻辑
import { populateOptimizer, initAliasShortcut } from "../../../popup/main/prompts/promptsUI.js";
import { PROMPT_TEMPLATES } from "../../../popup/main/prompts/prompts.js";
import { applyPromptTemplate } from "../../../popup/main/prompts/promptsCore.js";
import * as promptEditor from "./promptEditor.js";
import {
  STORAGE_KEYS,
  saveMessageContent,
  savePlatformStates,
  saveOptimizerSetting,
  loadStoredData as loadData,
  addToHistory,
  addMessageTabContext,
  getMessageTabContext,
  removeMessageFromTabContext,
  removeTabContextUrl
} from "../../../popup/main/modules/storage.js";
import {
  loadPlatformVisibilitySettings,
  applyPlatformVisibilitySettings,
  getVisiblePlatformCheckboxes,
  areAllVisiblePlatformsChecked,
  setupPlatformVisibilityMessageListener
} from "../../../popup/main/modules/platformVisibility.js";
import {
  copyToClipboard,
  showTempMessage,
  updateSelectAllText as updateSelectAllTextUI,
  togglePlatformCheckbox,
  setButtonLoadingState,
  resetButtonState,
  focusInputAndSetCursor,
  validateMessageInput,
  validatePlatformSelection
} from "../../../popup/main/modules/uiHelpers.js";

import { PLATFORM_CONFIG } from "../../../config/platformConfig.js";

// DOM 元素缓存
let elements = {};

// 保存相关变量
let saveTimeout;
let lastSavedContent = "";
let isSaving = false;

// 提取页面文本相关变量
let extractButton;
let extractResult;
let extractTitle;
let extractUrl;
let extractContent;
let closeResult;

// 提取/划词文本缓存（不依赖 DOM 状态，确保发送时能取到）
let _extractedTextCache = "";

// 平台选择面板状态
let isPlatformPanelOpen = false;

// 工作区标签
let workspaceTabs = [];         // { localId, tabId, title, url, favIconUrl }
let workspaceTabCounter = 0;

// 右键菜单
let contextMenuTarget = null;   // 当前右键点击的目标索引

// 直接发送模式（默认启用，可切换）
let isDirectMode = true;
const MODE_STORAGE_KEY = "sidebar_send_mode";

// AI Chat 设置（存储在 chrome.storage.sync，支持跨会话同步）
const AICHAT_SETTINGS_KEY = "aichat_settings";
let aichatSettings = { captureOnSend: false, addTabToWorkspaceOnSend: false, blockOnSend: false, selectionMode: false };

// 待发送消息队列（问题阻塞模式）
let pendingMessages = [];
const PENDING_STORAGE_KEY = "aichat_pending_messages";

async function loadAichatSettings() {
  try {
    const result = await chrome.storage.sync?.get(AICHAT_SETTINGS_KEY);
    if (result?.[AICHAT_SETTINGS_KEY]) {
      aichatSettings = { ...aichatSettings, ...result[AICHAT_SETTINGS_KEY] };
    }
  } catch (e) { /* ignore */ }
  updateSettingsUI();
  // 应用划词模式持久化状态（静默同步内存状态，content script 启动时自读 storage）
  isSelectionMode = !!aichatSettings.selectionMode;
  await chrome.storage.local.set({ sidebarSelectionEnabled: isSelectionMode });
}

async function saveAichatSettings() {
  try {
    await chrome.storage.sync?.set({ [AICHAT_SETTINGS_KEY]: aichatSettings });
  } catch (e) { /* ignore */ }
}

// 设置项 checkbox id → aichatSettings 字段名
const SETTING_CHECKBOX_MAP = {
  "setting-capture-on-send": "captureOnSend",
  "setting-add-tab-on-send": "addTabToWorkspaceOnSend",
  "setting-block-on-send": "blockOnSend",
  "setting-selection-mode": "selectionMode",
};

// 划词快捷提问（AI 平台页面增强）——与 aichat_settings (sync) 是两套独立契约：
// 该开关存于 chrome.storage.local，由 content script (runjs/translation/selection-ask.js)
// 通过 getSelectionAskSettings 消息读取 + storage.onChanged 实时响应。故单独读写，不并入 aichatSettings。
const SELECTION_ASK_KEY = "selectionAskSettings";

async function loadSelectionAskSetting() {
  try {
    const result = await chrome.storage.local?.get(SELECTION_ASK_KEY);
    const enabled = result?.[SELECTION_ASK_KEY]?.enabled !== false; // 默认启用
    const cb = document.getElementById("setting-selection-ask");
    if (cb) cb.checked = enabled;
  } catch (e) { /* ignore */ }
}

async function saveSelectionAskSetting(enabled) {
  const settings = { enabled };
  try {
    await chrome.storage.local?.set({ [SELECTION_ASK_KEY]: settings });
  } catch (e) { /* ignore */ }
  // content script 已通过 storage.onChanged 自动响应；此处再通知 background 同步，保持与原 options 行为一致
  try {
    const p = chrome.runtime?.sendMessage?.({ action: "selectionAskSettingsUpdated", settings });
    p?.catch?.(() => {});
  } catch (e) { /* ignore */ }
}

function updateSettingsUI() {
  for (const [id, key] of Object.entries(SETTING_CHECKBOX_MAP)) {
    const cb = document.getElementById(id);
    if (cb) cb.checked = !!aichatSettings[key];
  }
}

function openSettingsModal() {
  const modal = document.getElementById("aichat-settings-modal");
  if (modal) modal.style.display = "flex";
}

function closeSettingsModal() {
  const modal = document.getElementById("aichat-settings-modal");
  if (modal) modal.style.display = "none";
}

async function loadSendMode() {
  try {
    const result = await chrome.storage.session?.get(MODE_STORAGE_KEY);
    if (result?.[MODE_STORAGE_KEY] !== undefined) {
      isDirectMode = result[MODE_STORAGE_KEY];
      updateModeToggleUI();
    }
  } catch (e) { /* ignore */ }
}

function toggleSendMode() {
  isDirectMode = !isDirectMode;
  updateModeToggleUI();
  try {
    chrome.storage.session?.set({ [MODE_STORAGE_KEY]: isDirectMode });
  } catch (e) { /* ignore */ }
  showTempMessage(isDirectMode ? "已切换为直发模式" : "已切换为复制模式");
}

function updateModeToggleUI() {
  if (!elements.modeToggle) return;
  elements.modeToggle.textContent = isDirectMode ? "直发" : "复制";
  elements.modeToggle.classList.toggle("active", isDirectMode);
}

// AI 平台 -> 真实标签页映射缓存
let platformTabCache = {};      // platform -> { tabId, title, url }

// 保存的平台状态（页面加载时从 storage 恢复，供 platform panel 使用）
let savedPlatformStates = {};

// 划词选择模式
let isSelectionMode = false;

/**
 * 防抖保存消息内容
 */
async function debouncedSaveMessage(content) {
  if (content === lastSavedContent) return;
  if (isSaving) {
    return new Promise((resolve) => {
      const checkSaving = setInterval(() => {
        if (!isSaving) {
          clearInterval(checkSaving);
          debouncedSaveMessage(content).then(resolve);
        }
      }, 50);
    });
  }

  isSaving = true;
  try {
    await saveMessageContent(content);
    lastSavedContent = content;
  } catch (error) {
    console.error("保存消息内容失败:", error);
  } finally {
    isSaving = false;
  }
}

/**
 * 初始化弹窗，获取并缓存 DOM 元素
 */
export async function initializePopup() {
  // 主元素
  elements = {
    messageInput: document.getElementById("chat-input"),
    sendButton: document.getElementById("chat-btn-send"),
    closeTabsButton: document.getElementById("toolbar-close-ai"),
    selectAllButton: document.getElementById("panel-select-all"),
    promptOptimizerSelect: document.getElementById("prompt-optimizer-select"),
    workspaceTabs: document.getElementById("workspace-tabs"),
    workspaceTabAdd: document.getElementById("workspace-tab-add"),
    platformPanel: document.getElementById("platform-panel"),
    platformSelectorBtn: document.getElementById("platform-selector-btn"),
    platformCount: document.getElementById("platform-count"),
    platformOptionsRow: document.getElementById("platform-options-row"),
    platformPills: document.getElementById("platform-pills"),
    contextMenu: document.getElementById("tab-context-menu"),
    promptBar: document.getElementById("prompt-bar"),
    promptBarName: document.getElementById("prompt-bar-name"),
    promptBarAlias: document.getElementById("prompt-bar-alias"),
    promptBarClear: document.getElementById("prompt-bar-clear"),
    promptBarEdit: document.getElementById("prompt-bar-edit"),
    promptEditorClose: document.getElementById("prompt-editor-close"),
    promptEditorBody: document.getElementById("prompt-editor-body"),
    pagePromptEditor: document.getElementById("page-prompt-editor"),
    footHistoryBtn: document.getElementById("foot-history-btn"),
    footSourceBtn: document.getElementById("foot-source-btn"),
    sourcePanel: document.getElementById("source-panel"),
    sourcePanelClose: document.getElementById("source-panel-close"),
    sourcePanelBody: document.getElementById("source-panel-body"),
    modeToggle: document.getElementById("mode-toggle"),
    pendingSendBar: document.getElementById("pending-send-bar"),
    pendingSendCount: document.getElementById("pending-send-count"),
    pendingSendBtn: document.getElementById("pending-send-btn"),
  };

  // 提取页面文本相关元素
  extractButton = document.getElementById("toolbar-extract");
  extractResult = document.getElementById("extract-result");
  extractTitle = document.getElementById("extract-title");
  extractUrl = document.getElementById("extract-url");
  extractContent = document.getElementById("extract-content");
  closeResult = document.getElementById("close-result");

  // 历史消息区元素
  elements.historySection = document.getElementById("history-section");
  elements.conversationSection = document.getElementById("conversation-section");

  elements.clearChatBtn = document.getElementById("toolbar-clear-chat");

  // 自动聚焦输入框
  focusInputAndSetCursor(elements.messageInput);

  // 初始化 /alias 快捷输入
  initAliasShortcut(elements.messageInput, PROMPT_TEMPLATES, elements.promptOptimizerSelect);

  // 初始化优化器下拉框（隐藏，仅用于 /alias 功能）
  populateOptimizer(elements.promptOptimizerSelect, PROMPT_TEMPLATES);

  // 加载并应用平台可见性设置
  await loadPlatformVisibilitySettings();

  // 初始化工作区标签
  initWorkspaceTabs();

  // 同步平台计数
  updatePlatformCount();

  // 恢复发送模式
  loadSendMode();

  // 加载 AI Chat 设置
  await loadAichatSettings();
  // 加载划词快捷提问设置（与 aichat_settings 独立存储，契约不同）
  await loadSelectionAskSetting();

  // 恢复待发送队列
  await loadPendingMessages();

  // 同步当前提示词指示器
  syncPromptIndicator();

  // 刷新平台标签页状态
  refreshPlatformTabStatus();
}

/**
 * 加载存储的数据
 */
export async function loadStoredData() {
  try {
    const result = await loadData();

    // 恢复最后输入的消息
    if (result[STORAGE_KEYS.LAST_MESSAGE]) {
      elements.messageInput.value = result[STORAGE_KEYS.LAST_MESSAGE];
      lastSavedContent = result[STORAGE_KEYS.LAST_MESSAGE];
      console.log("已恢复历史输入内容，长度:", result[STORAGE_KEYS.LAST_MESSAGE].length);
      autoResizeInput(elements.messageInput);
      updateSendButton();
    }

    // 恢复平台选择状态
    if (result[STORAGE_KEYS.PLATFORM_STATES]) {
      restorePlatformStates(result[STORAGE_KEYS.PLATFORM_STATES]);
    }

    // 缓存历史记录（点击"历史"按钮时才渲染）
    if (result[STORAGE_KEYS.HISTORY]) {
      _historyCache = result[STORAGE_KEYS.HISTORY];
    }

    // 恢复优化器选择
    if (result[STORAGE_KEYS.OPTIMIZER]) {
      elements.promptOptimizerSelect.value = result[STORAGE_KEYS.OPTIMIZER];
    }

    // 恢复提示词选择
    if (result[STORAGE_KEYS.LAST_PROMPT_TEMPLATE]) {
      const template = PROMPT_TEMPLATES[result[STORAGE_KEYS.LAST_PROMPT_TEMPLATE]];
      if (template) {
        const selectedValue =
          elements.promptOptimizerSelect.querySelector(".selected-value");
        selectedValue.textContent = template.label;
        selectedValue.dataset.value = result[STORAGE_KEYS.LAST_PROMPT_TEMPLATE];
        selectedValue.dataset.template = template.template;
      }
    }
  } catch (error) {
    console.error("加载存储数据失败:", error);
  }
}

/**
 * 恢复平台选择状态
 */
function restorePlatformStates(platformStates) {
  savedPlatformStates = { ...platformStates };
  const checkboxes = document.querySelectorAll('.platform-icon-option input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    if (platformStates.hasOwnProperty(cb.dataset.platform)) {
      togglePlatformCheckbox(cb, platformStates[cb.dataset.platform]);
    }
  });
  updateSelectAllButton();
  updatePlatformCount();
}

/**
 * 设置所有事件监听器
 */
export function setupEventListeners() {
  // 平台选择按钮展开/收起
  elements.platformSelectorBtn?.addEventListener("click", togglePlatformPanel);

  // 监听来自options页面的平台可见性更新消息
  setupPlatformVisibilityMessageListener((settings) => {
    showTempMessage('平台显示设置已更新');
    updateSelectAllButton();
  });

  // 输入框内容变化时实时保存 + 自动调整高度 + 发送按钮状态
  elements.messageInput.addEventListener("input", () => {
    const currentContent = elements.messageInput.value;

    autoResizeInput(elements.messageInput);
    updateSendButton();

    if (saveTimeout) clearTimeout(saveTimeout);
    const delay = currentContent.length > 1000 ? 300 : 500;
    saveTimeout = setTimeout(async () => {
      await debouncedSaveMessage(currentContent);
    }, delay);
  });

  // 输入框失去焦点
  elements.messageInput.addEventListener("blur", async () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    await debouncedSaveMessage(elements.messageInput.value);
  });

  // Ctrl+Enter 发送
  elements.messageInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      startSending();
    }
    if (e.ctrlKey && e.key === "s") {
      e.preventDefault();
      if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }
      await debouncedSaveMessage(elements.messageInput.value);
      showTempMessage("内容已手动保存");
    }
  });

  // 页面关闭前保存
  window.addEventListener("beforeunload", async () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    await debouncedSaveMessage(elements.messageInput.value);
  });

  // 平台复选框变化（在 platform panel 里）
  const panelCheckboxes = () => document.querySelectorAll('#platform-panel .platform-icon-option input[type="checkbox"]');
  elements.platformPanel?.addEventListener("change", async (e) => {
    if (e.target.matches('.platform-icon-option input[type="checkbox"]')) {
      togglePlatformCheckbox(e.target, e.target.checked);
      try {
        await savePlatformStates(panelCheckboxes());
      } catch (error) {
        console.error("保存平台状态失败:", error);
      }
      updateSelectAllButton();
      updatePlatformCount();
    }
  });

  // 全选/取消全选按钮
  elements.selectAllButton?.addEventListener("click", toggleSelectAll);

  // 发送按钮
  elements.sendButton?.addEventListener("click", startSending);

  // 关闭AI标签页按钮
  elements.closeTabsButton?.addEventListener("click", closeAllAITabs);

  // 清空聊天内容
  elements.clearChatBtn?.addEventListener("click", () => {
    resetResponseDisplay();
    showTempMessage("聊天内容已清空");
  });

  // 设置按钮与设置弹窗
  document.getElementById("toolbar-settings")?.addEventListener("click", openSettingsModal);
  document.getElementById("aichat-settings-close")?.addEventListener("click", closeSettingsModal);
  document.querySelector(".aichat-settings-backdrop")?.addEventListener("click", closeSettingsModal);
  // 设置项 checkbox：写入 aichatSettings + 持久化 + 可选 after 钩子
  const settingAfterHooks = {
    "setting-block-on-send": () => updatePendingSendBar(),
    "setting-selection-mode": (v) => setSelectionMode(v),
  };
  for (const [id, key] of Object.entries(SETTING_CHECKBOX_MAP)) {
    document.getElementById(id)?.addEventListener("change", (e) => {
      aichatSettings[key] = e.target.checked;
      saveAichatSettings();
      settingAfterHooks[id]?.(e.target.checked);
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettingsModal();
  });

  // 划词快捷提问（独立于 aichatSettings，存于 chrome.storage.local）
  document.getElementById("setting-selection-ask")?.addEventListener("change", (e) => {
    saveSelectionAskSetting(e.target.checked);
  });

  // 提取页面文本按钮
  if (extractButton) {
    extractButton.addEventListener("click", extractPageText);
  }

  // 关闭提取结果
  if (closeResult) {
    closeResult.addEventListener("click", () => {
      if (extractResult) extractResult.style.display = "none";
      _extractedTextCache = "";
    });
  }

  // 清除提示词
  elements.promptBarClear?.addEventListener("click", clearSelectedPrompt);

  // 编辑当前提示词
  elements.promptBarEdit?.addEventListener("click", (e) => {
    e.stopPropagation();
    openPromptEditor();
  });
  elements.promptEditorClose?.addEventListener("click", closePromptEditor);

  // 点击提示词条展开/收起简易模板选择器
  const promptBar = elements.promptBar || document.getElementById("prompt-bar");
  let promptPicker = null; // 当前打开的 picker 浮层

  function closePromptPicker() {
    if (promptPicker) { promptPicker.remove(); promptPicker = null; }
  }

  function buildPromptPicker() {
    closePromptPicker();
    const barRect = promptBar.getBoundingClientRect();
    const container = document.createElement("div");
    container.id = "__sidebar_prompt_picker__";
    container.style.cssText = `
      position:fixed; z-index:10001;
      top:${barRect.bottom + 4}px; left:8px; right:8px;
      background:#fff; border:1px solid #d1d5db; border-radius:8px;
      box-shadow:0 8px 24px rgba(15,23,42,0.12);
      max-height:280px; font-size:12px; display:flex; overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif;
    `;

    // 按分组整理
    const groups = {};
    const groupNames = [];
    for (const key in PROMPT_TEMPLATES) {
      const t = PROMPT_TEMPLATES[key];
      const g = t.group || "其他";
      if (!groups[g]) { groups[g] = []; groupNames.push(g); }
      groups[g].push({ key, label: t.label, template: t.template, alias: t.alias });
    }

    if (groupNames.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "暂无提示词模板";
      empty.style.cssText = "padding:32px 10px;color:#9ca3af;text-align:center;font-size:11px;flex:1;";
      container.appendChild(empty);
      document.body.appendChild(container);
      promptPicker = container;
      registerOutsideClose(container);
      return;
    }

    // === 左侧分组列 ===
    const leftCol = document.createElement("div");
    leftCol.style.cssText = "width:85px;flex-shrink:0;overflow-y:auto;background:#f9fafb;border-right:1px solid #f0f0f0;";

    // === 右侧模板列 ===
    const rightCol = document.createElement("div");
    rightCol.style.cssText = "flex:1;overflow-y:auto;";

    let activeGroup = groupNames[0];

    function renderGroupOptions(groupName) {
      rightCol.innerHTML = "";
      const items = groups[groupName] || [];
      items.forEach((tpl) => {
        const item = document.createElement("div");
        const aliasText = tpl.alias ? `  <span style="color:#9ca3af;font-size:10px">/${tpl.alias}</span>` : "";
        item.innerHTML = `<span>${tpl.label}</span>${aliasText}`;
        item.style.cssText = "padding:7px 10px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f3f4f6;";
        item.addEventListener("mouseenter", () => { item.style.background = "#f3f4f6"; });
        item.addEventListener("mouseleave", () => { item.style.background = ""; });
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          const sel = elements.promptOptimizerSelect?.querySelector(".selected-value");
          if (sel) {
            sel.textContent = tpl.label;
            sel.dataset.value = tpl.key;
            sel.dataset.template = tpl.template;
          }
          chrome.storage.sync.set({ lastPromptTemplate: tpl.key });
          elements.promptOptimizerSelect?.dispatchEvent(
            new CustomEvent("change", { detail: { value: tpl.key, template: tpl.template, label: tpl.label } })
          );
          syncPromptIndicator();
          closePromptPicker();
        });
        rightCol.appendChild(item);
      });
    }

    // 左侧分组列表
    groupNames.forEach((gName) => {
      const gItem = document.createElement("div");
      gItem.textContent = gName;
      gItem.style.cssText = `padding:7px 8px;cursor:pointer;font-size:11px;transition:background 0.1s;${gName === activeGroup ? "background:#e6f7ff;color:#4361ee;font-weight:600;" : "color:#374151;"}`;
      gItem.addEventListener("mouseenter", () => {
        leftCol.querySelectorAll("div").forEach(el => { el.style.background = ""; el.style.color = "#374151"; el.style.fontWeight = ""; });
        gItem.style.background = "#e6f7ff";
        gItem.style.color = "#4361ee";
        gItem.style.fontWeight = "600";
        activeGroup = gName;
        renderGroupOptions(gName);
      });
      leftCol.appendChild(gItem);
    });

    container.appendChild(leftCol);
    container.appendChild(rightCol);
    renderGroupOptions(activeGroup);

    function registerOutsideClose(el) {
      const closeFn = (ev) => {
        if (!el.contains(ev.target) && !promptBar.contains(ev.target)) {
          closePromptPicker();
          document.removeEventListener("click", closeFn);
        }
      };
      setTimeout(() => document.addEventListener("click", closeFn), 0);
    }

    document.body.appendChild(container);
    promptPicker = container;
    registerOutsideClose(container);
  }

  if (promptBar) {
    promptBar.addEventListener("click", (e) => {
      if (e.target.closest(".prompt-bar-clear")) return;
      if (promptPicker) {
        closePromptPicker();
      } else {
        buildPromptPicker();
      }
    });
  }

  // 历史按钮：切换显示/隐藏历史
  elements.footHistoryBtn?.addEventListener("click", toggleHistoryView);

  // 来源按钮：切换显示/隐藏有来源的消息面板
  elements.footSourceBtn?.addEventListener("click", toggleSourcePanel);
  elements.sourcePanelClose?.addEventListener("click", closeSourcePanel);

  // 统一发送按钮
  elements.pendingSendBtn?.addEventListener("click", copyBlockedAsLinks);

  // 直发/复制模式切换
  elements.modeToggle?.addEventListener("click", toggleSendMode);

  // 顶部 + 按钮 → 添加工作区
  elements.workspaceTabAdd?.addEventListener("click", () => {
    addCurrentPageToWorkspace();
  });

  // 右键菜单事件
  elements.contextMenu?.addEventListener("click", (e) => {
    const item = e.target.closest(".context-menu-item");
    if (!item || contextMenuTarget === null) return;
    const action = item.dataset.action;
    handleContextMenuAction(action, contextMenuTarget);
    hideContextMenu();
  });

  // 点击空白区域关闭右键菜单 & 平台面板
  document.addEventListener("click", (e) => {
    if (elements.contextMenu && !elements.contextMenu.contains(e.target)) {
      hideContextMenu();
    }
    // 点击面板外关闭平台面板
    if (isPlatformPanelOpen
      && !elements.platformSelectorBtn?.contains(e.target)
      && !elements.platformPanel?.contains(e.target)) {
      closePlatformPanel();
    }
  });

  // 阻止右键默认菜单（仅在工作区标签区域）
  elements.workspaceTabs?.addEventListener("contextmenu", (e) => {
    const tabEl = e.target.closest(".workspace-tab");
    if (tabEl) {
      e.preventDefault();
      const idx = parseInt(tabEl.dataset.index);
      if (!isNaN(idx)) {
        showContextMenu(e.clientX, e.clientY, idx);
      }
    }
  });

  // 监听提示词优化器变化，同步指示器
  elements.promptOptimizerSelect?.addEventListener("change", (e) => {
    syncPromptIndicator();
  });

  // 定时刷新平台标签页状态
  // 不刷新 renderPlatformTabs 了，因为已经没有那个 UI 了
  setInterval(() => {
    refreshPlatformTabStatus();
    updatePlatformCount();
  }, 15000);
}

// ==================== 平台选择面板 ====================

function togglePlatformPanel() {
  if (isPlatformPanelOpen) {
    closePlatformPanel();
  } else {
    openPlatformPanel();
  }
}

function openPlatformPanel() {
  isPlatformPanelOpen = true;
  elements.platformSelectorBtn?.classList.add("active");
  elements.platformPanel?.classList.add("open");
  // 填充平台选项（如果还没填充）
  if (elements.platformOptionsRow && !elements.platformOptionsRow.children.length) {
    renderPlatformOptions();
  }
}

function closePlatformPanel() {
  isPlatformPanelOpen = false;
  elements.platformSelectorBtn?.classList.remove("active");
  elements.platformPanel?.classList.remove("open");
}

function renderPlatformOptions() {
  if (!elements.platformOptionsRow) return;

  const order = Object.keys(PLATFORM_CONFIG);

  elements.platformOptionsRow.innerHTML = order.map(id => {
    const config = PLATFORM_CONFIG[id];
    if (!config) return '';
    const name = config.shortName || config.name || id;
    const icon = config.shortIcon || config.icon || '?';
    const color = config.color || '#4361ee';
    // 通过已加载的 savedPlatformStates 决定初始勾选状态
    const checked = savedPlatformStates[id] !== false;
    return `
      <label class="platform-icon-option">
        <input type="checkbox" data-platform="${id}" ${checked ? 'checked' : ''}>
        <div class="icon-wrapper" style="border-color:${color};color:${checked ? 'white' : color};background:${checked ? color : '#f0f4ff'}">${icon}</div>
        <span class="platform-label">${name}</span>
      </label>`;
  }).join('');

  // 让 checkbox 的视觉和状态同步
  elements.platformOptionsRow.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    const wrapper = cb.closest('.platform-icon-option')?.querySelector('.icon-wrapper');
    if (!wrapper) return;
    const color = wrapper.style.borderColor || '#4361ee';
    const updateVisual = () => {
      wrapper.style.background = cb.checked ? color : '#f0f4ff';
      wrapper.style.color = cb.checked ? 'white' : color;
    };
    cb.addEventListener('change', updateVisual);
    updateVisual();
  });
}

function updatePlatformCount() {
  if (!elements.platformCount) return;
  const count = document.querySelectorAll('#platform-panel .platform-icon-option input[type="checkbox"]:checked').length;
  elements.platformCount.textContent = count;
  renderPlatformPills();
}

/**
 * 渲染已勾选平台的快捷按钮（pills）
 * 每个 pill 点击直接映射到对应的浏览器标签页
 */
function renderPlatformPills() {
  if (!elements.platformPills) return;

  // 确定已勾选的平台列表
  const checkboxes = document.querySelectorAll('#platform-panel .platform-icon-option input[type="checkbox"]');
  let activePlatforms;

  if (checkboxes.length > 0) {
    // 面板已渲染 → 从 DOM checkbox 读取
    activePlatforms = [];
    checkboxes.forEach(cb => { if (cb.checked) activePlatforms.push(cb.dataset.platform); });
  } else {
    // 面板还没渲染 → 用 savedPlatformStates 推断
    const savedKeys = Object.keys(savedPlatformStates);
    if (savedKeys.length > 0) {
      activePlatforms = savedKeys.filter(id => savedPlatformStates[id] !== false);
    } else {
      // 从未保存过 → 默认全部
      activePlatforms = Object.keys(PLATFORM_CONFIG);
    }
  }

  if (activePlatforms.length === 0) {
    elements.platformPills.innerHTML = '';
    return;
  }

  elements.platformPills.innerHTML = '';
  activePlatforms.forEach(platformId => {
    const config = PLATFORM_CONFIG[platformId];
    if (!config) return;
    const name = config.shortName || config.name || platformId;

    const pill = document.createElement('button');
    pill.className = 'platform-pill';
    pill.dataset.platform = platformId;
    pill.title = `切换到 ${name}`;
    pill.textContent = name;

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      // 先切换侧边栏显示（更新 activePlatformId + 渲染消息）
      activePlatformId = platformId;
      renderCurrentPlatform();
      renderPlatformTabs();
      scrollToBottom(true);
      // 再切浏览器标签页
      switchToPlatformTab(platformId);
    });

    elements.platformPills.appendChild(pill);
  });
}

// ==================== 提示词指示器 ====================

function syncPromptIndicator() {
  if (!elements.promptBar) return;
  const selectedValue = elements.promptOptimizerSelect?.querySelector('.selected-value');
  const value = selectedValue?.dataset?.value;
  const label = selectedValue?.textContent || '';

  if (value && value !== '' && label !== '不使用优化') {
    let alias = '';
    for (const key in PROMPT_TEMPLATES) {
      if (key === value && PROMPT_TEMPLATES[key].alias) {
        alias = '/' + PROMPT_TEMPLATES[key].alias;
        break;
      }
    }
    elements.promptBarName.textContent = label;
    elements.promptBarName.style.opacity = '1';
    elements.promptBarAlias.textContent = alias || '';
    elements.promptBarAlias.style.display = '';
    const labelEl = elements.promptBar.querySelector('.prompt-bar-label');
    if (labelEl) labelEl.textContent = '提示词:';
    if (elements.promptBarEdit) elements.promptBarEdit.style.display = '';
  } else {
    elements.promptBarName.textContent = '选择提示词';
    elements.promptBarName.style.opacity = '0.5';
    elements.promptBarAlias.textContent = '';
    elements.promptBarAlias.style.display = 'none';
    const labelEl = elements.promptBar.querySelector('.prompt-bar-label');
    if (labelEl) labelEl.textContent = '';
    if (elements.promptBarEdit) elements.promptBarEdit.style.display = 'none';
  }
  elements.promptBar.style.display = '';
}

function clearSelectedPrompt() {
  const selectedValue = elements.promptOptimizerSelect?.querySelector('.selected-value');
  if (selectedValue) {
    selectedValue.textContent = '不使用优化';
    selectedValue.dataset.value = '';
    selectedValue.dataset.template = '';
  }
  // 触发 change 事件
  const event = new CustomEvent('change', { detail: { value: '', template: '', label: '不使用优化' } });
  elements.promptOptimizerSelect?.dispatchEvent(event);
  syncPromptIndicator();
}

// ==================== 提示词编辑器（内嵌面板） ====================

/**
 * 打开当前选中提示词的编辑面板。
 * 触发条件：syncPromptIndicator 检测到有选中模板。
 */
async function openPromptEditor() {
  const selectedValue = elements.promptOptimizerSelect?.querySelector('.selected-value');
  if (!selectedValue) return;
  const key = selectedValue.dataset.value;
  if (!key) return;

  const tpl = PROMPT_TEMPLATES[key];
  if (!tpl) {
    console.warn('[aichat] 当前提示词不在 PROMPT_TEMPLATES 中:', key);
    return;
  }

  await promptEditor.open(
    {
      key,
      label: tpl.label,
      alias: tpl.alias || '',
      group: tpl.group,
      template: tpl.template,
    },
    onPromptSaved,
  );
}

function closePromptEditor() {
  promptEditor.close();
}

/**
 * 保存成功回调：直接更新内存中的 PROMPT_TEMPLATES，
 * 让后续 %s 替换立刻走新模板，并把提示词栏 UI 同步刷新。
 */
function onPromptSaved({ key, label, alias, template }) {
  if (PROMPT_TEMPLATES[key]) {
    PROMPT_TEMPLATES[key].label = label;
    PROMPT_TEMPLATES[key].alias = alias;
    PROMPT_TEMPLATES[key].template = template;
  }

  // 把 select 的 dataset.template 也更新，保持 promptPicker 等读取路径一致
  const selectedValue = elements.promptOptimizerSelect?.querySelector('.selected-value');
  if (selectedValue && selectedValue.dataset.value === key) {
    selectedValue.dataset.template = template;
    selectedValue.dataset.alias = alias;
  }
  syncPromptIndicator();
}

// ==================== 历史消息（IM 风格，内嵌在聊天流中） ====================

const HISTORY_PAGE_SIZE = 10;
let _historyCache = [];           // 全部历史（由 loadStoredData 填充）
let _historyRendered = 0;         // 已渲染的条数

/**
 * 渲染历史气泡，顶部有"加载更多"按钮
 */
function renderHistorySection() {
  if (!elements.historySection) return;
  if (_historyCache.length === 0) {
    elements.historySection.innerHTML = '<div class="history-empty-tip">暂无历史消息</div>';
    return;
  }

  // 从 0 到 _historyRendered + PAGE_SIZE，累加渲染
  const end = Math.min(_historyRendered + HISTORY_PAGE_SIZE, _historyCache.length);
  const batch = _historyCache.slice(0, end);

  let html = '';

  // 顶部加载更多按钮
  const hasMore = _historyRendered + HISTORY_PAGE_SIZE < _historyCache.length;
  if (hasMore) {
    const remaining = _historyCache.length - (_historyRendered + HISTORY_PAGE_SIZE);
    html += `<div class="history-load-more" id="history-load-more">加载更早 ${Math.min(HISTORY_PAGE_SIZE, remaining)} 条</div>`;
  }

  // 历史气泡：batch=[最新..最旧]，倒序渲染（旧在上，新在下）
  for (let i = batch.length - 1; i >= 0; i--) {
    const msg = batch[i];
    const preview = msg.length > 80 ? msg.slice(0, 80) + '…' : msg;
    html += `<div class="history-item" data-msg="${escapeHtml(msg)}">
      <div class="history-bubble">
        <div class="history-bubble-text">${escapeHtml(preview)}</div>
      </div>
    </div>`;
  }

  // 分隔线
  if (batch.length > 0) {
    html += `<div class="history-section-header"><span class="history-section-header-text">历史消息</span></div>`;
  }

  // 全部加载完了显示标记
  if (!hasMore && _historyCache.length > 0) {
    html += `<div class="history-end-marker">—— 共 ${_historyCache.length} 条 ——</div>`;
  }

  elements.historySection.innerHTML = html;

  // 点击气泡填充到输入框
  elements.historySection.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const msg = el.dataset.msg;
      if (msg) {
        elements.messageInput.value = msg;
        elements.messageInput.dispatchEvent(new Event('input'));
        focusInputAndSetCursor(elements.messageInput);
      }
    });
  });

  // 加载更多按钮
  const loadMore = elements.historySection.querySelector('#history-load-more');
  if (loadMore) {
    loadMore.addEventListener('click', () => {
      _historyRendered += HISTORY_PAGE_SIZE;
      renderHistorySection();
    });
  }
}

/**
 * "历史"按钮：点击显示最近 10 条 / 再点隐藏
 */
function toggleHistoryView() {
  if (!elements.historySection) return;
  if (_historyCache.length === 0) { showTempMessage('暂无历史消息'); return; }

  const sec = elements.historySection;
  const isVisible = sec.classList.contains('visible');

  if (isVisible) {
    sec.classList.remove('visible');
    scrollToBottom(true);
  } else {
    // 首次显示，渲染最近 10 条
    if (!sec._loaded) {
      _historyRendered = 0;
      renderHistorySection();
      sec._loaded = true;
    }
    sec.classList.add('visible');
    responseContent?.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/**
 * 发送成功后刷新缓存（如果历史正显示则重绘）
 */
export function refreshHistoryCache() {
  chrome.storage.local.get(STORAGE_KEYS.HISTORY, (result) => {
    const oldLen = _historyCache.length;
    _historyCache = result[STORAGE_KEYS.HISTORY] || [];
    const sec = elements.historySection;
    if (sec && sec.classList.contains('visible') && _historyCache.length !== oldLen) {
      _historyRendered = 0;
      renderHistorySection();
      fillHistoryIfNeeded();
    }
  });
}

// ==================== 有来源的消息面板 ====================

let _sourcePanelOpen = false;

function closeSourcePanel() {
  _sourcePanelOpen = false;
  if (elements.sourcePanel) {
    elements.sourcePanel.classList.remove("open");
    elements.sourcePanel.style.display = "none";
  }
  if (elements.footSourceBtn) elements.footSourceBtn.classList.remove("active");
  // 恢复对话视图
  if (elements.conversationSection) elements.conversationSection.style.display = "";
  if (elements.historySection) elements.historySection.style.display = "";
  if (responseContent) responseContent.classList.remove("source-open");
}

async function toggleSourcePanel() {
  if (_sourcePanelOpen) {
    closeSourcePanel();
    return;
  }

  // 关闭历史视图（如果开着）
  if (elements.historySection?.classList.contains("visible")) {
    elements.historySection.classList.remove("visible");
  }

  _sourcePanelOpen = true;
  if (elements.sourcePanel) {
    elements.sourcePanel.style.display = "flex";
    elements.sourcePanel.classList.add("open");
  }
  if (elements.footSourceBtn) elements.footSourceBtn.classList.add("active");

  // 隐藏对话/历史区，避免滚动冲突
  if (elements.conversationSection) elements.conversationSection.style.display = "none";
  if (elements.historySection) elements.historySection.style.display = "none";
  if (responseContent) responseContent.classList.add("source-open");

  await renderSourcePanel();
}

async function renderSourcePanel() {
  if (!elements.sourcePanelBody) return;

  let data;
  try {
    data = await getMessageTabContext();
  } catch (e) {
    data = {};
  }

  const urls = Object.keys(data);
  if (urls.length === 0) {
    elements.sourcePanelBody.innerHTML = '<div class="source-empty-tip">暂无带来源的消息</div>';
    return;
  }

  // 按消息数量降序，数量相同按 URL 字母序
  urls.sort((a, b) => {
    const countDiff = (data[b]?.length || 0) - (data[a]?.length || 0);
    if (countDiff !== 0) return countDiff;
    return a.localeCompare(b);
  });

  const frag = document.createDocumentFragment();
  urls.forEach((url) => {
    const messages = data[url] || [];
    if (messages.length === 0) return;

    const group = document.createElement("div");
    group.className = "source-group open";

    const header = document.createElement("div");
    header.className = "source-group-header";

    const toggle = document.createElement("span");
    toggle.className = "source-group-toggle";
    toggle.textContent = "▸";

    let hostname = "";
    try { hostname = new URL(url).hostname; } catch { /* ignore */ }

    const favicon = document.createElement("img");
    favicon.className = "source-group-favicon";
    favicon.src = hostname
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&size=16`
      : "";
    favicon.onerror = () => { favicon.style.display = "none"; };

    const urlEl = document.createElement("span");
    urlEl.className = "source-group-url";
    urlEl.title = url;
    urlEl.textContent = url;
    urlEl.addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        chrome.tabs.create({ url, active: false });
      } catch (err) {
        window.open(url, "_blank");
      }
    });

    const count = document.createElement("span");
    count.className = "source-group-count";
    count.textContent = messages.length;

    const removeUrlBtn = document.createElement("button");
    removeUrlBtn.className = "source-group-remove";
    removeUrlBtn.title = "删除该来源及所有消息";
    removeUrlBtn.innerHTML = "×";
    removeUrlBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeTabContextUrl(url);
      renderSourcePanel();
      showTempMessage("已删除来源");
    });

    header.appendChild(toggle);
    header.appendChild(favicon);
    header.appendChild(urlEl);
    header.appendChild(count);
    header.appendChild(removeUrlBtn);

    const list = document.createElement("div");
    list.className = "source-msg-list";
    messages.forEach((msg) => {
      const item = document.createElement("div");
      item.className = "source-msg";
      item.title = "点击填充到输入框";

      const text = document.createElement("span");
      text.className = "source-msg-text";
      text.textContent = msg;
      const removeMsgBtn = document.createElement("button");
      removeMsgBtn.className = "source-msg-remove";
      removeMsgBtn.title = "删除该消息";
      removeMsgBtn.innerHTML = "×";
      removeMsgBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await removeMessageFromTabContext(msg, url);
        renderSourcePanel();
        showTempMessage("已删除消息");
      });

      item.appendChild(text);
      item.appendChild(removeMsgBtn);
      item.addEventListener("click", () => {
        if (elements.messageInput) {
          elements.messageInput.value = msg;
          elements.messageInput.dispatchEvent(new Event("input"));
          focusInputAndSetCursor(elements.messageInput);
        }
        closeSourcePanel();
      });
      list.appendChild(item);
    });

    header.addEventListener("click", () => {
      group.classList.toggle("open");
    });

    group.appendChild(header);
    group.appendChild(list);
    frag.appendChild(group);
  });

  elements.sourcePanelBody.innerHTML = "";
  elements.sourcePanelBody.appendChild(frag);
}

// ==================== 输入框自动调整 ====================

function autoResizeInput(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function updateSendButton() {
  if (!elements.sendButton || !elements.messageInput) return;
  const hasText = elements.messageInput.value.trim().length > 0;
  elements.sendButton.classList.remove("is-busy", "is-done");
  const labelEl = elements.sendButton.querySelector(".chat-btn-send-label");
  if (labelEl) labelEl.textContent = "";
  elements.sendButton.disabled = !hasText;
}

// ==================== 平台标签（已迁移到 platform panel） ====================

// 旧的 renderPlatformTabs 已由 platform-panel 替代
// 保留一个空桩给旧调用点使用
function renderPlatformTabs() {
  // no-op: 平台选择现在在 platform-panel 中通过 checkbox 完成
}

// ==================== 发送逻辑 ====================

/**
 * 发送前钩子：根据设置自动执行页面捕获 / 添加到工作区。
 * 这些操作会复用现有逻辑，并把结果落入后续发送流程。
 */
async function runPreSendHooks() {
  if (aichatSettings.captureOnSend) {
    await extractPageText();
  }
  if (aichatSettings.addTabToWorkspaceOnSend) {
    await addCurrentPageToWorkspace();
  }
}

/**
 * 统一发送入口
 * - 直接发送模式（isDirectMode=true）：不展示阻塞态，直接发
 * - 阻塞模式：仅展示，不真正发送（等点击黄色气泡或点击统一发送时再走 dispatchMessageToPlatforms）
 */
async function startSending() {
  await runPreSendHooks();

  // 直接发送模式：不捕获回复，发送后跳转到 AI 页面
  if (isDirectMode) {
    await startDirectSend();
    return;
  }

  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  await debouncedSaveMessage(elements.messageInput.value);

  const originalMessage = validateMessageInput(elements.messageInput.value);
  if (!originalMessage) return;

  const selectedPlatforms = getSelectedPlatformIds();
  if (!validatePlatformSelection(selectedPlatforms)) return;

  const sendTimestamp = Date.now();
  const isBlocked = aichatSettings.blockOnSend;
  // 阻塞提交时把当前提取/划词内容绑定到消息上，重发时带上
  const boundExtracted = isBlocked ? getExtractedContentText() : "";
  selectedPlatforms.forEach((platformId) => {
    const ps = getPlatformState(platformId);
    const conversationId = ps.activeConvId || DEFAULT_CONVERSATION_ID;
    appendUserMessage(platformId, conversationId, originalMessage, sendTimestamp, isBlocked, boundExtracted);
  });

  if (!activePlatformId || !selectedPlatforms.includes(activePlatformId)) {
    activePlatformId = selectedPlatforms[0];
  }
  renderCurrentPlatform();
  updatePendingSendBar();
  renderPlatformTabs();
  scrollToBottom(true);

  // 清空输入框（提取内容延迟到发送读取后再清空，避免 dispatchMessageToPlatforms 读不到）
  elements.messageInput.value = "";
  autoResizeInput(elements.messageInput);
  updateSendButton();

  // 问题阻塞模式：仅展示，不真正发送（等点击黄色气泡或点击「双链复制」/统一发送时再走 dispatchMessageToPlatforms）
  if (isBlocked) {
    clearExtractedContent();
    try { await addToHistory(originalMessage); } catch (e) { /* ignore */ }
    try { await addMessageTabContext(originalMessage, await getCurrentActiveTabUrl()); } catch (e) { /* ignore */ }
    refreshHistoryCache();
    showTempMessage(`已阻塞 ${selectedPlatforms.length} 个平台的消息，点击消息发送`);
    return;
  }

  // 非阻塞：直接发，逻辑收敛到 dispatchMessageToPlatforms（携带提取文本和提示词模板）
  await dispatchMessageToPlatforms(originalMessage, selectedPlatforms);
  clearExtractedContent();
}

// ==================== 多平台回复展示 ====================

let responseContent;
let responseStatus;
let statusIndicator;
let statusText;

let shouldAutoScroll = true;

const DEFAULT_CONVERSATION_ID = "__default__";

const platformStates = new Map();
let activePlatformId = null;

function setSidebarSendButtonState(state, label = "") {
  const button = elements.sendButton;
  if (!button) return;

  const labelEl = button.querySelector(".chat-btn-send-label");
  if (labelEl) labelEl.textContent = label;

  button.classList.remove("is-busy", "is-done");

  if (state === "busy") {
    button.disabled = true;
    button.classList.add("is-busy");
    return;
  }

  if (state === "done") {
    button.disabled = true;
    button.classList.add("is-done");
    return;
  }

  button.disabled = !elements.messageInput || elements.messageInput.value.trim().length === 0;
}

function getPlatformState(platformId) {
  if (!platformStates.has(platformId)) {
    platformStates.set(platformId, {
      conversationStates: new Map(),
      activeConvId: DEFAULT_CONVERSATION_ID,
    });
  }
  return platformStates.get(platformId);
}

function getConvState(platformId, conversationId) {
  const ps = getPlatformState(platformId);
  const key = conversationId || DEFAULT_CONVERSATION_ID;
  if (!ps.conversationStates.has(key)) {
    ps.conversationStates.set(key, { messages: [], messageIndex: new Map() });
  }
  return ps.conversationStates.get(key);
}

function rebuildMessageIndex(convState) {
  convState.messageIndex.clear();
  convState.messages.forEach((message, index) => {
    const role = message.role || "assistant";
    convState.messageIndex.set(buildMessageKey(role, message.messageId), index);
  });
}

function moveDefaultConversationTo(platformId, targetConversationId) {
  const targetKey = targetConversationId || DEFAULT_CONVERSATION_ID;
  if (targetKey === DEFAULT_CONVERSATION_ID) return;

  const ps = getPlatformState(platformId);
  const defaultState = ps.conversationStates.get(DEFAULT_CONVERSATION_ID);
  if (!defaultState || defaultState.messages.length === 0) return;

  const targetState = getConvState(platformId, targetKey);
  if (targetState.messages.length > 0) return;

  targetState.messages = defaultState.messages;
  rebuildMessageIndex(targetState);
  ps.conversationStates.delete(DEFAULT_CONVERSATION_ID);
}

function buildMessageKey(role, id) {
  return `${role}::${id}`;
}

function appendUserMessage(platformId, conversationId, content, timestamp = Date.now(), blocked = false, extractedText = "") {
  const convState = getConvState(platformId, conversationId);
  const messageId = `user-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  const messageKey = buildMessageKey("user", messageId);

  convState.messages.push({
    role: "user",
    messageId,
    content: String(content || ""),
    // 阻塞提交时绑定的提取/划词上下文，重发时带上（避免多条阻塞消息上下文错位）
    extractedText: String(extractedText || ""),
    timestamp,
    collapsed: false,
    blocked: !!blocked,
  });
  convState.messageIndex.set(messageKey, convState.messages.length - 1);
  return messageId;
}

function upsertAssistantMessage(platformId, conversationId, payload) {
  const convState = getConvState(platformId, conversationId);
  const messageId = payload.messageId || `assistant-${Date.now()}`;
  const messageKey = buildMessageKey("assistant", messageId);
  const normalizedText = typeof payload.content === "string"
    ? payload.content
    : String(payload.content ?? payload.text ?? "");
  const normalizedHtml = typeof payload.html === "string" ? payload.html : null;
  const existingIndex = convState.messageIndex.get(messageKey);

  if (existingIndex == null) {
    convState.messages.push({
      role: "assistant",
      messageId,
      content: normalizedText,
      html: normalizedHtml,
      htmlMissing: !!payload.htmlMissing,
      isComplete: !!payload.isComplete,
      timestamp: payload.timestamp || Date.now(),
      collapsed: false,
    });
    convState.messageIndex.set(messageKey, convState.messages.length - 1);
    return convState.messages[convState.messages.length - 1];
  }

  const msg = convState.messages[existingIndex];
  msg.content = normalizedText;
  if (normalizedHtml != null) {
    msg.html = normalizedHtml;
  }
  if (payload.htmlMissing != null) {
    msg.htmlMissing = !!payload.htmlMissing;
  }
  if (payload.isComplete != null) {
    msg.isComplete = !!payload.isComplete;
  }
  msg.timestamp = payload.timestamp || msg.timestamp || Date.now();
  return msg;
}

function renderMessageBody(message) {
  if (message.role === "user" || message.role === "pending") {
    return renderMarkdownText(message.content || "");
  }

  const html = typeof message.html === "string" ? message.html : "";
  const text = typeof message.content === "string" ? message.content : "";
  if (html && !isBareHtmlContainer(html, text)) {
    return html;
  }
  return renderMarkdownText(text);
}

/**
 * 计算当前平台下所有被阻塞的消息总数
 */
function getSelectedPlatformIds() {
  return Array.from(document.querySelectorAll('.platform-icon-option input[type="checkbox"]'))
    .filter((checkbox) => {
      const option = checkbox.closest('.platform-icon-option');
      return option && option.style.display !== 'none' && checkbox.checked;
    })
    .map((checkbox) => checkbox.dataset.platform);
}

function countBlockedMessages() {
  const selectedPlatforms = new Set(getSelectedPlatformIds());
  let count = 0;
  platformStates.forEach((ps, platformId) => {
    if (!selectedPlatforms.has(platformId)) return;
    ps.conversationStates.forEach((convState) => {
      convState.messages.forEach((m) => {
        if (m.role === "user" && m.blocked) count++;
      });
    });
  });
  return count;
}

/**
 * 收集当前选中平台下的所有阻塞消息，并按 content 去重（保留最早时间戳及其绑定的提取上下文）
 * @returns {{ refs: object[], queue: {content:string,timestamp:number,extractedText:string}[] }}
 */
function collectBlockedMessages() {
  const selectedSet = new Set(getSelectedPlatformIds());
  const refs = [];
  const uniqueByContent = new Map();
  platformStates.forEach((ps, platformId) => {
    if (!selectedSet.has(platformId)) return;
    ps.conversationStates.forEach((convState) => {
      convState.messages.forEach((m) => {
        if (m.role !== "user" || !m.blocked) return;
        refs.push(m);
        const prev = uniqueByContent.get(m.content);
        if (!prev || prev.timestamp > m.timestamp) {
          uniqueByContent.set(m.content, {
            content: m.content,
            timestamp: m.timestamp,
            extractedText: m.extractedText,
          });
        }
      });
    });
  });
  const queue = Array.from(uniqueByContent.values()).sort((a, b) => a.timestamp - b.timestamp);
  return { refs, queue };
}

function isNearBottom(el, threshold = 72) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function renderCurrentPlatform() {
  const convContainer = elements.conversationSection;
  if (!convContainer) return;

  if (!activePlatformId) {
    convContainer.innerHTML = '<div class="response-placeholder">暂无回复内容</div>';
    if (responseContent) responseContent.classList.remove("streaming");
    if (responseStatus) responseStatus.style.display = "flex";
    updateResponseStatus(true);
    return;
  }

  const ps = getPlatformState(activePlatformId);
  const convState = ps.conversationStates.get(ps.activeConvId);

  const hasMessages = convState && convState.messages.length > 0;

  if (hasMessages) {
    renderPlatformMessages(convState);
    if (responseStatus) responseStatus.style.display = "flex";
    return;
  }

  convContainer.innerHTML = '<div class="response-placeholder">暂无回复内容</div>';
  if (responseContent) responseContent.classList.remove("streaming");
  if (responseStatus) responseStatus.style.display = "flex";
  updateResponseStatus(true);
}

function renderPlatformMessages(convState) {
  const convContainer = elements.conversationSection;
  if (!convContainer) return;

  convContainer.innerHTML = "";

  const root = document.createElement("div");
  root.className = "notion-chat";

  convState.messages.forEach((message) => {
    const config = PLATFORM_CONFIG[activePlatformId];
    const platformName = config?.name || activePlatformId;
    const platformColor = config?.color || "#666";
    const platformIcon = config?.shortIcon || config?.icon || activePlatformId[0]?.toUpperCase() || "?";
    const isUser = message.role === "user";
    const isPending = message.role === "pending";
    const isBlocked = isUser && message.blocked;

    const msgRow = document.createElement("div");
    msgRow.className = `notion-chat-message ${isUser || isPending ? "notion-chat-message--user" : "notion-chat-message--ai"}`;

    let avatar = null;
    if (!isUser && !isPending) {
      avatar = document.createElement("div");
      avatar.className = "notion-chat-avatar";
      avatar.style.background = platformColor;
      avatar.textContent = platformIcon;
    }

    const bubble = document.createElement("div");
    bubble.className = `notion-chat-bubble ${isBlocked ? "notion-chat-bubble--pending" : isUser ? "notion-chat-bubble--user" : "notion-chat-bubble--ai"}`;

    const header = document.createElement("div");
    header.className = "notion-chat-bubble-header";

    const nameEl = document.createElement("span");
    nameEl.className = "notion-chat-bubble-name";
    nameEl.style.color = isBlocked ? "#b45309" : isUser ? "#475569" : platformColor;
    nameEl.textContent = isUser ? "You" : platformName;

    const timeEl = document.createElement("span");
    timeEl.className = "notion-chat-bubble-time";
    timeEl.textContent = formatTime(message.timestamp);

    const actions = document.createElement("div");
    actions.className = "notion-chat-bubble-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "notion-chat-btn";
    copyBtn.title = "复制本条";
    copyBtn.textContent = "复制";
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(message.content || "");
        const orig = copyBtn.textContent;
        copyBtn.textContent = "✓";
        setTimeout(() => { copyBtn.textContent = orig; }, 1200);
      } catch (error) {
        console.error("复制失败:", error);
      }
    });

    actions.appendChild(copyBtn);

    if (isPending) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "notion-chat-btn";
      removeBtn.title = "移除";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removePendingMessage(message.messageId);
      });
      actions.appendChild(removeBtn);
    } else {
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "notion-chat-btn";
      toggleBtn.title = message.collapsed ? "展开" : "折叠";
      toggleBtn.textContent = message.collapsed ? "▸" : "▾";
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        message.collapsed = !message.collapsed;
        contentEl.style.display = message.collapsed ? "none" : "block";
        toggleBtn.textContent = message.collapsed ? "▸" : "▾";
        toggleBtn.title = message.collapsed ? "展开" : "折叠";
      });
      actions.appendChild(toggleBtn);
    }
    header.appendChild(timeEl);
    header.appendChild(actions);

    const contentEl = document.createElement("div");
    contentEl.className = "notion-chat-bubble-content";
    contentEl.style.display = message.collapsed ? "none" : "block";
    contentEl.innerHTML = renderMessageBody(message);

    bubble.appendChild(header);
    bubble.appendChild(contentEl);

    if (avatar) msgRow.appendChild(avatar);
    msgRow.appendChild(bubble);

    // 已阻塞消息点击发送
    if (isBlocked) {
      bubble.style.cursor = "pointer";
      bubble.title = "点击发送该消息";
      bubble.addEventListener("click", (e) => {
        if (e.target.closest(".notion-chat-bubble-actions")) return;
        sendBlockedMessage(message);
      });
    }

    root.appendChild(msgRow);
  });

  convContainer.appendChild(root);
}

/**
 * 更新回复状态
 */
function isBareHtmlContainer(html, text) {
  if (!html) return true;
  const stripped = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const normalizedText = (text || '').replace(/\s+/g, ' ').trim();
  if (stripped === normalizedText) return true;
  if (/<(table|ol|ul|img|h[1-6]|blockquote|iframe)\b/i.test(html)) return false;
  return true;
}

function updateResponseStatus(isComplete) {
  if (!statusIndicator || !statusText) return;

  statusIndicator.classList.remove("generating", "completed", "error");

  if (isComplete) {
    statusIndicator.classList.add("completed");
    statusText.textContent = "回复完成";
  } else {
    statusIndicator.classList.add("generating");
    statusText.textContent = "正在生成...";
  }

  if (responseContent) {
    responseContent.classList.toggle("streaming", !isComplete);
  }
}

/**
 * 处理平台回复（流式）
 */
function handlePlatformResponse(platformId, data) {
  const { content, messageId, isComplete, timestamp, conversationId } = data || {};
  if (!messageId) return;

  const ps = getPlatformState(platformId);
  const key = conversationId || DEFAULT_CONVERSATION_ID;

  if (!activePlatformId || activePlatformId === platformId) {
    activePlatformId = platformId;
  }

  moveDefaultConversationTo(platformId, key);
  ps.activeConvId = key;
  upsertAssistantMessage(platformId, key, {
    messageId,
    content,
    isComplete,
    timestamp,
  });

  if (activePlatformId === platformId) {
    updateResponseStatus(isComplete);
    renderCurrentPlatform();
    scrollToBottom();
  }

  renderPlatformTabs();
}

/**
 * 处理平台 copy capture
 */
function handlePlatformCapture(platformId, data) {
  if (!data) return;

  const ps = getPlatformState(platformId);
  const key = data.conversationId || DEFAULT_CONVERSATION_ID;
  moveDefaultConversationTo(platformId, key);
  ps.activeConvId = key;
  upsertAssistantMessage(platformId, key, {
    messageId: data.messageId,
    content: data.text || "",
    html: data.html || null,
    htmlMissing: data.htmlMissing,
    isComplete: true,
    timestamp: data.timestamp || Date.now(),
  });

  activePlatformId = platformId;

  renderCurrentPlatform();
  scrollToBottom();
  renderPlatformTabs();
}

/**
 * 初始化多平台回复展示
 */
export function initializeResponseDisplay() {
  responseContent = document.getElementById("response-content");
  responseStatus = document.getElementById("response-status");
  statusIndicator = responseStatus?.querySelector(".status-indicator");
  statusText = responseStatus?.querySelector(".status-text");

  if (!responseContent || !responseStatus) {
    console.warn("回复展示区元素未找到");
    return;
  }

  // 上滑阈值检测：上拉到阈值区松开后加载历史
  let _pullReady = false;
  responseContent.addEventListener("scroll", () => {
    shouldAutoScroll = isNearBottom(responseContent);
  });

  chrome.runtime.onMessage.addListener((request) => {
    const responseMatch = request.action?.match(/^(\w+)Response$/);
    if (responseMatch) {
      const platformId = responseMatch[1];
      console.log(`[Sidebar] ${platformId}Response received`, request.data);
      handlePlatformResponse(platformId, request.data);
    }

    const captureMatch = request.action?.match(/^(\w+)CopyCapture$/);
    if (captureMatch) {
      const platformId = captureMatch[1];
      console.log(`[Sidebar] ${platformId}CopyCapture received`, request.data);
      handlePlatformCapture(platformId, request.data);
    }

    // 划词选择结果
    if (request.action === "sidebarSelectionResult") {
      handleSidebarSelection(request.text, request.title, request.url);
      // 清除 storage 中的 pending 数据，避免下次加载时重复
      chrome.storage.session.remove("pendingSelection").catch(() => {});
    }

    return false;
  });

  // 加载时检查是否有 pending 的划词结果（sidebar 关闭时通过 storage 中转）
  chrome.storage.session.get("pendingSelection").then((data) => {
    if (data.pendingSelection) {
      handleSidebarSelection(data.pendingSelection.text, data.pendingSelection.title, data.pendingSelection.url);
      chrome.storage.session.remove("pendingSelection").catch(() => {});
    }
  }).catch(() => {});

  renderCurrentPlatform();
  console.log("多平台回复展示模块已初始化");
}

/**
 * 初始化 ChatGPT 回复展示（兼容旧入口）
 */
export function initializeChatGPTResponse() {
  initializeResponseDisplay();
}

// ==================== 更新全选按钮 ====================

function updateSelectAllButton() {
  const checkboxes = document.querySelectorAll('.platform-icon-option input[type="checkbox"]');
  const buttonText = updateSelectAllTextUI(checkboxes);
  if (elements.selectAllButton) elements.selectAllButton.textContent = buttonText;
}

async function toggleSelectAll() {
  const checkboxes = document.querySelectorAll('.platform-icon-option input[type="checkbox"]');
  const visibleCheckboxes = getVisiblePlatformCheckboxes(checkboxes);

  if (visibleCheckboxes.length === 0) return;

  const allChecked = areAllVisiblePlatformsChecked(visibleCheckboxes);

  visibleCheckboxes.forEach((checkbox) => {
    togglePlatformCheckbox(checkbox, !allChecked);
  });

  updateSelectAllButton();

  try {
    await savePlatformStates(document.querySelectorAll('.platform-icon-option input[type="checkbox"]'));
  } catch (error) {
    console.error("保存平台状态失败:", error);
  }

  updatePlatformCount();

  const platforms = getSelectedPlatformIds();
  if (platforms.length) {
    activePlatformId = platforms[0];
    renderCurrentPlatform();
  }
}

// ==================== 关闭AI标签页 ====================

function closeAllAITabs() {
  setButtonLoadingState(elements.closeTabsButton, "关闭中...");
  elements.closeTabsButton.style.cursor = 'not-allowed';

  chrome.runtime.sendMessage({ action: "closeAllAITabs" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("关闭AI标签页时出错:", chrome.runtime.lastError.message);
      showTempMessage("关闭标签页失败");
    } else {
      showTempMessage("正在关闭AI标签页");
      closePlatformPanel();
    }
    setTimeout(() => {
      resetButtonState(elements.closeTabsButton, "关闭AI");
      elements.closeTabsButton.style.cursor = 'pointer';
    }, 1500);
  });
}

// ==================== 提取页面文本 ====================

async function extractPageText() {
  if (!extractButton) return;

  const originalText = extractButton.textContent;
  extractButton.textContent = "提取中...";
  extractButton.disabled = true;

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "extractPageText" },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });

    if (response && response.status === "success" && response.result) {
      const data = response.result;
      if (data.extracted) {
        showExtractedContent({
          title: data.title || "未获取到标题",
          url: data.url || "",
          text: data.text || "未获取到内容",
        });
        showTempMessage(`已提取 ${data.text.length} 字符`, 2000);
      } else {
        showTempMessage("提取失败，请刷新页面后重试");
      }
    } else {
      showTempMessage(response?.message || "提取失败");
    }
  } catch (error) {
    console.error("提取页面文本失败:", error);
    showTempMessage("提取失败: " + (error.message || "未知错误"));
  } finally {
    extractButton.textContent = originalText;
    extractButton.disabled = false;
  }
}

// ==================== 划词选择模式 ====================

/**
 * 设置划词模式开关：写入 storage + 广播到所有标签页
 * 内容脚本始终注入，通过本开关控制激活/休眠（injected-dom-toggle-pattern）
 * 开关状态持久化在 aichatSettings.selectionMode（设置弹窗 checkbox）
 */
async function setSelectionMode(enabled) {
  isSelectionMode = !!enabled;
  await chrome.storage.local.set({ sidebarSelectionEnabled: isSelectionMode });
  // 广播到所有标签页
  try {
    const tabs = await chrome.tabs.query({});
    tabs.forEach(t => {
      chrome.tabs.sendMessage(t.id, { action: "sidebarSelectionToggle", enabled: isSelectionMode }).catch(() => {});
    });
  } catch (e) { /* ignore */ }
  showTempMessage(isSelectionMode ? "划词模式已开启，在页面上选择文本" : "划词模式已关闭");
}

/**
 * 处理划词选择结果 — 显示到提取结果面板（作为 %v 上下文）
 */
function handleSidebarSelection(text, title, url) {
  if (!text || !text.trim()) return;
  _extractedTextCache = text;
  showExtractedContent({
    title: `划词: ${title || "未获取到标题"}`,
    url: url || "",
    text,
  });
  showTempMessage(`已获取 ${text.length} 字符`, 2000);
}

// ==================== Prompt 占位符 ====================
// applyPromptTemplate 已收敛到 ../../../popup/main/prompts/promptsCore.js
// 本文件仅 import 调用，不再保留本地实现。

/**
 * 显示提取/划词结果到提取面板
 */
function showExtractedContent({ title = "", url = "", text = "" } = {}) {
  if (extractResult) extractResult.style.display = "block";
  if (extractTitle) extractTitle.textContent = title;
  if (extractUrl) extractUrl.textContent = url;
  if (extractContent) extractContent.textContent = text;
}

/**
 * 读取当前展示的"提取页面文本"结果，格式化为可注入 prompt 的字符串。
 * 没有可见的提取结果时返回空串。
 */
function getExtractedContentText() {
  if (!extractResult || extractResult.style.display === "none" || !extractContent) {
    return "";
  }
  const text = (extractContent.textContent || "").trim();
  if (!text || text === "未获取到内容") return "";
  const url = (extractUrl?.textContent || "").trim();
  return url ? `[来自: ${url}]\n${text}` : text;
}

function clearExtractedContent() {
  _extractedTextCache = "";
  if (extractContent) extractContent.textContent = "";
  if (extractResult) extractResult.style.display = "none";
  if (extractTitle) extractTitle.textContent = "";
  if (extractUrl) extractUrl.textContent = "";
}

// ==================== 工作区标签 ====================

const WORKSPACE_STORAGE_KEY = "sidebar_workspace_tabs";

async function initWorkspaceTabs() {
  // 从 storage 恢复持久化的工作区
  try {
    const result = await chrome.storage.session?.get(WORKSPACE_STORAGE_KEY);
    if (result?.[WORKSPACE_STORAGE_KEY]) {
      workspaceTabs = result[WORKSPACE_STORAGE_KEY].map(t => ({
        ...t,
        localId: ++workspaceTabCounter,
      }));
      // 过滤已关闭的标签页
      await refreshWorkspaceTabs();
    }
  } catch (e) {
    // session storage may not be available
  }
  renderWorkspaceTabs();
}

async function saveWorkspaceTabs() {
  try {
    const toSave = workspaceTabs.map(t => ({
      tabId: t.tabId,
      title: t.title,
      url: t.url,
      favIconUrl: t.favIconUrl,
    }));
    await chrome.storage.session?.set({ [WORKSPACE_STORAGE_KEY]: toSave });
  } catch (e) {
    // ignore
  }
}

function renderWorkspaceTabs() {
  if (!elements.workspaceTabs) return;

  elements.workspaceTabs.innerHTML = "";

  workspaceTabs.forEach((tab, i) => {
    const el = document.createElement("button");
    el.className = "workspace-tab";
    el.dataset.index = i;

    const favicon = tab.favIconUrl
      ? `<img class="workspace-tab-favicon" src="${escapeHtml(tab.favIconUrl)}" onerror="this.style.display='none'">`
      : `<span class="workspace-tab-favicon" style="background:#e5e7eb;border-radius:2px;"></span>`;

    const title = tab.title || "新标签页";
    const maxTitle = title.length > 20 ? title.slice(0, 20) + "…" : title;

    el.innerHTML = `
      ${favicon}
      <span class="workspace-tab-title">${escapeHtml(maxTitle)}</span>
      <span class="workspace-tab-close" data-index="${i}">×</span>
    `;

    el.addEventListener("click", (e) => {
      if (e.target.closest(".workspace-tab-close")) return;
      switchToWorkspaceTab(i);
    });

    el.querySelector(".workspace-tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      removeWorkspaceTab(i);
    });

    elements.workspaceTabs.appendChild(el);
  });
}

/**
 * 判断给定 URL 是否属于某个 AI 平台页面（origin 级比对）
 * AI 平台页面由平台 pill 系统管理，加入工作区会与之冲突，需排除
 */
function isAiWebUrl(url) {
  if (!url) return false;
  let origin;
  try { origin = new URL(url).origin; } catch { return false; }
  return Object.values(PLATFORM_CONFIG).some((cfg) => {
    try { return new URL(cfg.url).origin === origin; } catch { return false; }
  });
}

async function addCurrentPageToWorkspace() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getCurrentTabInfo" });
    if (response?.status === "success" && response.tab) {
      const tab = response.tab;
      // 排除 AI 平台页面：它们由平台 pill 系统管理，加入工作区会冲突
      if (isAiWebUrl(tab.url)) {
        showTempMessage("AI 平台页面无需添加到工作区");
        return;
      }
      // 去重
      if (workspaceTabs.some(t => t.tabId === tab.id)) {
        showTempMessage("该标签页已在工作区中");
        return;
      }
      workspaceTabs.push({
        localId: ++workspaceTabCounter,
        tabId: tab.id,
        title: tab.title || "新标签页",
        url: tab.url || "",
        favIconUrl: tab.favIconUrl || "",
      });
      renderWorkspaceTabs();
      saveWorkspaceTabs();
      showTempMessage("已添加到工作区");
    } else {
      showTempMessage("获取当前标签页失败");
    }
  } catch (err) {
    console.error("添加到工作区失败:", err);
    showTempMessage("添加到工作区失败");
  }
}

async function switchToWorkspaceTab(index) {
  const tab = workspaceTabs[index];
  if (!tab) return;
  try {
    // 验证 tab 是否还存在
    await chrome.tabs.get(tab.tabId);
    await chrome.runtime.sendMessage({ action: "switchToTab", tabId: tab.tabId });
  } catch (err) {
    // tab 已关闭，移除
    console.warn("工作区标签页已关闭，移除", tab.tabId);
    workspaceTabs.splice(index, 1);
    renderWorkspaceTabs();
    saveWorkspaceTabs();
    showTempMessage("该标签页已关闭");
  }
}

async function removeWorkspaceTab(index) {
  workspaceTabs.splice(index, 1);
  renderWorkspaceTabs();
  saveWorkspaceTabs();
}

async function refreshWorkspaceTabs() {
  const valid = [];
  for (const tab of workspaceTabs) {
    try {
      const t = await chrome.tabs.get(tab.tabId);
      tab.title = t.title;
      tab.url = t.url;
      tab.favIconUrl = t.favIconUrl;
      valid.push(tab);
    } catch (e) {
      // tab closed, drop it
    }
  }
  workspaceTabs = valid;
  return workspaceTabs;
}

// ==================== 右键菜单 ====================

function showContextMenu(x, y, index) {
  if (!elements.contextMenu) return;
  contextMenuTarget = index;
  elements.contextMenu.style.left = x + "px";
  elements.contextMenu.style.top = y + "px";
  elements.contextMenu.style.display = "block";
}

function hideContextMenu() {
  if (!elements.contextMenu) return;
  elements.contextMenu.style.display = "none";
  contextMenuTarget = null;
}

function handleContextMenuAction(action, index) {
  const tab = workspaceTabs[index];
  if (!tab) return;

  switch (action) {
    case "close":
      // 关闭标签页
      try {
        chrome.tabs.remove(tab.tabId);
      } catch (e) { /* ignore */ }
      removeWorkspaceTab(index);
      break;

    case "remove":
      // 仅移除工作区，不关闭标签页
      removeWorkspaceTab(index);
      break;
  }
}

/**
 * 直接发送入口 — 不捕获回复，发送后把消息展示到聊天框、切换到 AI 标签页
 * - 非阻塞模式：直接走 dispatchMessageToPlatforms 发送
 * - 阻塞模式（presetMessage 为空时）：仅展示阻塞气泡，等待用户点击发送
 */
async function startDirectSend(presetMessage = null, forcedPlatformIds = null) {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (!presetMessage) {
    await debouncedSaveMessage(elements.messageInput.value);
  }

  const originalMessage = presetMessage || validateMessageInput(elements.messageInput.value);
  if (!originalMessage) return;

  const selectedPlatforms = (forcedPlatformIds && forcedPlatformIds.length > 0)
    ? forcedPlatformIds
    : getSelectedPlatformIds();

  if (!validatePlatformSelection(selectedPlatforms)) return;

  // 先把用户消息写入聊天框（仅展示用，不等待回复）
  const sendTimestamp = Date.now();
  if (!activePlatformId || !selectedPlatforms.includes(activePlatformId)) {
    activePlatformId = selectedPlatforms[0];
  }

  // 如果是手动触发的新输入（非点击已阻塞消息），且开启了阻塞模式：仅展示，不真正发送
  const isNewInput = !presetMessage;
  const isBlocked = isNewInput && aichatSettings.blockOnSend;
  // 阻塞提交时把当前提取/划词内容绑定到消息上，重发时带上
  const boundExtracted = isBlocked ? getExtractedContentText() : "";

  selectedPlatforms.forEach((platformId) => {
    const ps = getPlatformState(platformId);
    const conversationId = ps.activeConvId || DEFAULT_CONVERSATION_ID;
    appendUserMessage(platformId, conversationId, originalMessage, sendTimestamp, isBlocked, boundExtracted);
  });
  renderCurrentPlatform();
  updatePendingSendBar();
  scrollToBottom(true);

  // 清空输入框（提取内容延迟到发送读取后再清空，避免 dispatchMessageToPlatforms 读不到）
  if (isNewInput) {
    elements.messageInput.value = "";
    autoResizeInput(elements.messageInput);
    updateSendButton();
  }

  if (isBlocked) {
    if (isNewInput) clearExtractedContent();
    try { await addToHistory(originalMessage); } catch (e) { /* ignore */ }
    try { await addMessageTabContext(originalMessage, await getCurrentActiveTabUrl()); } catch (e) { /* ignore */ }
    refreshHistoryCache();
    showTempMessage(`已阻塞 ${selectedPlatforms.length} 个平台的消息，点击消息发送`);
    return;
  }

  // 非阻塞：直接发，逻辑收敛到 dispatchMessageToPlatforms（携带提取文本和提示词模板）
  await dispatchMessageToPlatforms(originalMessage, selectedPlatforms);
  if (isNewInput) clearExtractedContent();
}

// ==================== 问题阻塞（待发送队列） ====================

async function loadPendingMessages() {
  // 旧逻辑废弃：pending 消息现在作为 blocked user 消息存在会话中
  renderPendingMessages();
}

async function savePendingMessages() {
  // 不再需要单独保存 pending 数组
}

function enqueuePendingMessage(message) {
  // 已废弃：由 startDirectSend/startSending 直接写入 blocked user 消息
}

function removePendingMessage(id) {
  // 已废弃
}

function updatePendingSendBar() {
  if (!elements.pendingSendBar || !elements.pendingSendCount) return;
  const count = countBlockedMessages();
  const visible = aichatSettings.blockOnSend && count > 0;
  elements.pendingSendBar.style.display = visible ? "flex" : "none";
  if (visible) {
    elements.pendingSendCount.textContent = `${count} 条消息待发送`;
  }
}

function renderPendingMessages() {
  // 阻塞消息已随会话渲染，无需额外处理
  updatePendingSendBar();
}

/**
 * 获取当前窗口激活标签页的 URL
 * 用于阻塞发送时给"标签页-消息"关联容器打标
 */
async function getCurrentActiveTabUrl() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.url || "";
  } catch (e) {
    return "";
  }
}

/**
 * 点击某条被阻塞的消息时，把该消息发送到当前选中的所有平台
 */
async function sendBlockedMessage(message) {
  if (!message || !message.blocked) return;

  const selectedPlatforms = getSelectedPlatformIds();
  if (selectedPlatforms.length === 0) return;

  // 在选中平台中找出所有同内容的阻塞消息，统一取消阻塞样式
  const refs = collectBlockedMessages().refs.filter((m) => m.content === message.content);
  if (refs.length === 0) return;

  // 标记为已发送（取消阻塞样式）
  refs.forEach((m) => { m.blocked = false; });
  renderCurrentPlatform();
  updatePendingSendBar();

  // 执行真正发送：当前选中的所有平台（携带该消息阻塞时绑定的提取/划词文本）
  await dispatchMessageToPlatforms(message.content, selectedPlatforms, { skipHistory: true, extractedText: message.extractedText });
}

/**
 * 统一发送当前所有被阻塞的消息
 * 去重阻塞队列中的消息后，统一发送到「当前选中的所有平台」，
 * 而不是发到消息阻塞时所属的平台——这样用户在阻塞期间调整平台勾选也能即时生效。
 */
async function flushPendingMessages() {
  const selectedPlatforms = getSelectedPlatformIds();
  if (selectedPlatforms.length === 0) return;

  const { refs, queue } = collectBlockedMessages();
  if (refs.length === 0) return;

  // 先把选中平台的所有阻塞消息标记为未阻塞（取消阻塞样式）
  refs.forEach((m) => { m.blocked = false; });
  renderCurrentPlatform();
  updatePendingSendBar();

  // 收敛发送逻辑：所有路径（直发、点击黄色气泡、阻塞后统一发送）都走 dispatchMessageToPlatforms
  for (const { content, extractedText } of queue) {
    await dispatchMessageToPlatforms(content, selectedPlatforms, { skipHistory: true, extractedText });
  }
}

/**
 * 收集当前所有阻塞消息，去重后以双链 [[消息]] 格式复制到剪贴板
 * （每条一行）。用于把阻塞下来的问题快速粘贴进笔记软件做双向链接。
 */
async function copyBlockedAsLinks() {
  const selectedPlatforms = getSelectedPlatformIds();
  if (selectedPlatforms.length === 0) {
    showTempMessage("未选中平台");
    return;
  }

  const { queue } = collectBlockedMessages();
  if (queue.length === 0) {
    showTempMessage("暂无可复制的阻塞消息");
    return;
  }

  const text = queue.map(({ content }) => `[[${content}]]`).join("\n");
  const ok = await copyToClipboard(text);
  showTempMessage(ok ? `已复制 ${queue.length} 条双链到剪贴板` : "复制失败");
}

/**
 * 将一条消息真正派发到指定平台（仅执行 background 发送，不写展示）
 * @param {string} originalMessage - 原始消息文本
 * @param {string[]} platformIds - 目标平台 id 列表
 * @param {Object} [options]
 * @param {boolean} [options.skipHistory=false] - 是否跳过入历史（阻塞路径已在阻塞阶段存过）
 */
async function dispatchMessageToPlatforms(originalMessage, platformIds, { skipHistory = false, extractedText = null } = {}) {
  const selectedValue = elements.promptOptimizerSelect.querySelector(".selected-value");
  const templateKey = selectedValue.dataset.value;
  const templateContent = selectedValue.dataset.template;

  // 优先用调用方传入的绑定文本（阻塞消息重发场景），否则读当前提取面板
  const extracted = extractedText !== null ? extractedText : getExtractedContentText();

  let finalMessage = originalMessage;
  if (templateKey && templateContent) {
    // applyPromptTemplate 决策树统一处理 %s / %v / good_eg / bad_eg / 提取文本兜底
    finalMessage = applyPromptTemplate(templateContent, { userMessage: originalMessage, extractedText: extracted });
  } else if (extracted) {
    finalMessage = extracted + "\n\n" + originalMessage;
  }

  setSidebarSendButtonState("busy", "直发");

  // 阻塞路径在阻塞阶段已存历史；非阻塞路径在这里补存
  if (!skipHistory) {
    try { await addToHistory(originalMessage); } catch(e) {}
    refreshHistoryCache();
  }

  let successCount = 0;
  try {
    for (const platform of platformIds) {
      const result = await chrome.runtime.sendMessage({
        action: "directSend",
        platform,
        message: finalMessage,
        switchToTab: true,
      });
      if (result?.status === "success") {
        successCount++;
        const tabInfo = await chrome.tabs.get(result.tabId);
        platformTabCache[platform] = {
          tabId: result.tabId,
          title: tabInfo.title,
          url: tabInfo.url,
        };
      } else {
        console.error(`[directSend] ${platform} 失败:`, result?.error);
      }
    }
    updatePlatformCount();
  } catch (error) {
    console.error("发送消息失败:", error);
  } finally {
    updateSendButton();
  }

  if (successCount > 0) {
    showTempMessage(`已发送到 ${successCount}/${platformIds.length} 个平台`);
  }
}

// ==================== AI 平台标签页映射 ====================

/**
 * 切换到 AI 平台的真实浏览器标签页
 * 无标签页时创建，有标签页时切换
 */
async function switchToPlatformTab(platformId) {
  const cached = platformTabCache[platformId];

  // 先查后台注入状态
  try {
    const status = await chrome.runtime.sendMessage({ action: "getPlatformTabStatus" });
    if (status?.status === "success" && status.tabs?.[platformId]?.length > 0) {
      const tabInfo = status.tabs[platformId][0];
      platformTabCache[platformId] = tabInfo;
      await chrome.runtime.sendMessage({ action: "switchToTab", tabId: tabInfo.id });
      return;
    }
  } catch (e) { /* fall through */ }

  // 无缓存 → 尝试直接查询当前打开的标签页
  if (cached) {
    try {
      await chrome.tabs.get(cached.tabId);
      await chrome.runtime.sendMessage({ action: "switchToTab", tabId: cached.tabId });
      return;
    } catch (e) {
      delete platformTabCache[platformId];
    }
  }

  // 通过 background 创建（不发送消息）
  await chrome.runtime.sendMessage({
    action: "openPlatformTab",
    platform: platformId,
  });
  // 更新缓存
  await refreshPlatformTabStatus();
}

/**
 * 查询后台各平台标签页状态并刷新缓存
 */
async function refreshPlatformTabStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getPlatformTabStatus" });
    if (response?.status === "success" && response.tabs) {
      for (const [platform, tabs] of Object.entries(response.tabs)) {
        if (tabs.length > 0) {
          platformTabCache[platform] = tabs[0];
        }
      }
      updatePlatformCount();
    }
  } catch (e) {
    // background may not be ready
  }
}

// ==================== 工具函数 ====================

// ==================== 向后兼容 ====================

/** @deprecated 单页模式不再需要切换视图 */
export function showResponseContainer() {}
/** @deprecated 单页模式不再需要切换视图 */
export function hideResponseContainer() {}

/** 重置回复展示 */
export function resetResponseDisplay() {
  platformStates.clear();
  activePlatformId = null;
  const convContainer = elements.conversationSection;
  if (convContainer) {
    convContainer.innerHTML = '<div class="response-placeholder">暂无回复内容</div>';
  }
  if (responseContent) {
    responseContent.classList.remove("streaming");
  }
  if (statusIndicator) {
    statusIndicator.classList.remove("generating", "completed", "error");
  }
  if (statusText) {
    statusText.textContent = "等待回复...";
  }
  renderPlatformTabs();
}

// ==================== 辅助函数 ====================

function renderMarkdownText(markdown) {
  const text = String(markdown || "");
  const md = convertTableTabsToPipes(text);

  if (window.marked?.parse) {
    const renderer = new window.marked.Renderer();
    renderer.html = () => "";
    try {
      return window.marked.parse(md, {
        gfm: true, breaks: true, renderer, mangle: false, headerIds: false
      });
    } catch (err) {
      console.warn("[Sidebar] marked.parse failed:", err);
    }
  }
  return escapeHtml(md).replace(/\n/g, "<br>");
}

function convertTableTabsToPipes(text) {
  if (!text || text.indexOf("\t") === -1) return text;
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return text;
  const tabCounts = lines.map(l => l.split("\t").length);
  const firstCount = tabCounts[0];
  if (firstCount < 2) return text;
  if (!tabCounts.every(c => c === firstCount)) return text;
  const pipeLines = lines.map(l => "| " + l.split("\t").map(c => c.trim()).join(" | ") + " |");
  const separator = "| " + Array(firstCount).fill("---").join(" | ") + " |";
  pipeLines.splice(1, 0, separator);
  return pipeLines.join("\n");
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(ts) {
  const date = new Date(ts || Date.now());
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom(force = false) {
  if (responseContent && (force || shouldAutoScroll)) {
    responseContent.scrollTop = responseContent.scrollHeight;
    shouldAutoScroll = true;
  }
}
