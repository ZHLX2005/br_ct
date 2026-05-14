// mainUtils.js - 核心popup功能模块（单页全屏版）
import { populateOptimizer, initAliasShortcut } from "../../popup/main/prompts/promptsUI.js";
import { PROMPT_TEMPLATES } from "../../popup/main/prompts/prompts.js";
import {
  STORAGE_KEYS,
  saveMessageContent,
  savePlatformStates,
  saveOptimizerSetting,
  loadStoredData as loadData,
  addToHistory
} from "../../popup/main/modules/storage.js";
import {
  loadPlatformVisibilitySettings,
  applyPlatformVisibilitySettings,
  getVisiblePlatformCheckboxes,
  areAllVisiblePlatformsChecked,
  setupPlatformVisibilityMessageListener
} from "../../popup/main/modules/platformVisibility.js";
import {
  copyToClipboard,
  showTempMessage,
  populateHistory as populateHistoryUI,
  updateSelectAllText as updateSelectAllTextUI,
  togglePlatformCheckbox,
  setButtonLoadingState,
  resetButtonState,
  focusInputAndSetCursor,
  validateMessageInput,
  validatePlatformSelection
} from "../../popup/main/modules/uiHelpers.js";

import { PLATFORM_CONFIG } from "../../config/platformConfig.js";

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

// + 菜单状态
let isPlusMenuOpen = false;

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
    closeTabsButton: document.getElementById("close-tabs-button"),
    selectAllButton: document.getElementById("select-all"),
    historySelect: document.getElementById("history-select"),
    promptOptimizerSelect: document.getElementById("prompt-optimizer-select"),
    plusButton: document.getElementById("chat-btn-plus"),
    plusMenu: document.getElementById("plus-menu"),
    plusOverlay: document.getElementById("plus-menu-overlay"),
    platformTabs: document.getElementById("platform-tabs"),
    openOptionsButton: document.getElementById("open-options"),
  };

  // 提取页面文本相关元素
  extractButton = document.getElementById("extract-text-button");
  extractResult = document.getElementById("extract-result");
  extractTitle = document.getElementById("extract-title");
  extractUrl = document.getElementById("extract-url");
  extractContent = document.getElementById("extract-content");
  closeResult = document.getElementById("close-result");

  // 自动聚焦输入框
  focusInputAndSetCursor(elements.messageInput);

  // 初始化 /alias 快捷输入
  initAliasShortcut(elements.messageInput, PROMPT_TEMPLATES, elements.promptOptimizerSelect);

  // 初始化优化器下拉框
  populateOptimizer(elements.promptOptimizerSelect, PROMPT_TEMPLATES);

  // 加载并应用平台可见性设置
  await loadPlatformVisibilitySettings();
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

    // 恢复历史记录
    if (result[STORAGE_KEYS.HISTORY]) {
      populateHistoryUI(elements.historySelect, result[STORAGE_KEYS.HISTORY]);
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
  const checkboxes = document.querySelectorAll('.platform-icon-option input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    if (platformStates.hasOwnProperty(cb.dataset.platform)) {
      togglePlatformCheckbox(cb, platformStates[cb.dataset.platform]);
    }
  });
  updateSelectAllButton();
  renderPlatformTabs();
}

/**
 * 设置所有事件监听器
 */
export function setupEventListeners() {
  // + 菜单切换
  elements.plusButton?.addEventListener("click", togglePlusMenu);
  elements.plusOverlay?.addEventListener("click", closePlusMenu);

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

  // 历史记录选择
  elements.historySelect.addEventListener("change", () => {
    if (elements.historySelect.value) {
      elements.messageInput.value = elements.historySelect.value;
      elements.messageInput.dispatchEvent(new Event("input"));
      closePlusMenu();
    }
  });

  // 优化器选择
  elements.promptOptimizerSelect.addEventListener("change", async (e) => {
    const value = e.detail.value;
    try {
      await saveOptimizerSetting(value);
    } catch (error) {
      console.error("保存优化器设置失败:", error);
    }
  });

  // 平台复选框变化
  const checkboxes = document.querySelectorAll('.platform-icon-option input[type="checkbox"]');
  checkboxes.forEach((cb) => {
    cb.addEventListener("change", async () => {
      togglePlatformCheckbox(cb, cb.checked);
      try {
        await savePlatformStates(document.querySelectorAll('.platform-icon-option input[type="checkbox"]'));
      } catch (error) {
        console.error("保存平台状态失败:", error);
      }
      updateSelectAllButton();
      renderPlatformTabs();

      // 自动切换到该平台
      if (cb.checked) {
        const platforms = getCheckedPlatforms();
        activePlatformId = platforms[0];
        renderCurrentPlatform();
      }
    });
  });

  // 全选/取消全选按钮
  elements.selectAllButton?.addEventListener("click", toggleSelectAll);

  // 发送按钮
  elements.sendButton?.addEventListener("click", startSending);

  // 关闭AI标签页按钮
  elements.closeTabsButton?.addEventListener("click", closeAllAITabs);

  // 提取页面文本按钮
  if (extractButton) {
    extractButton.addEventListener("click", extractPageText);
  }

  // 关闭提取结果
  if (closeResult) {
    closeResult.addEventListener("click", () => {
      if (extractResult) extractResult.style.display = "none";
    });
  }

  // 打开设置页面
  elements.openOptionsButton?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

// ==================== + 菜单 ====================

function togglePlusMenu() {
  if (isPlusMenuOpen) {
    closePlusMenu();
  } else {
    openPlusMenu();
  }
}

function openPlusMenu() {
  isPlusMenuOpen = true;
  elements.plusMenu.style.display = "block";
  elements.plusOverlay.style.display = "block";
  elements.plusButton.classList.add("active");
}

function closePlusMenu() {
  isPlusMenuOpen = false;
  elements.plusMenu.style.display = "none";
  elements.plusOverlay.style.display = "none";
  elements.plusButton.classList.remove("active");
}

// ==================== 输入框自动调整 ====================

function autoResizeInput(el) {
  if (!el) return;
  el.style.height = "auto";
  const newHeight = Math.min(el.scrollHeight, 120);
  el.style.height = newHeight + "px";
}

function updateSendButton() {
  if (!elements.sendButton || !elements.messageInput) return;
  const hasText = elements.messageInput.value.trim().length > 0;
  elements.sendButton.classList.remove("is-busy", "is-done");
  const labelEl = elements.sendButton.querySelector(".chat-btn-send-label");
  if (labelEl) labelEl.textContent = "";
  elements.sendButton.disabled = !hasText;
}

// ==================== 平台标签 ====================

function renderPlatformTabs() {
  if (!elements.platformTabs) return;
  const platforms = getCheckedPlatforms();

  if (platforms.length === 0) {
    elements.platformTabs.innerHTML = "";
    return;
  }

  elements.platformTabs.innerHTML = platforms.map(id => {
    const config = PLATFORM_CONFIG[id];
    const name = config?.name || id;
    const color = config?.color || "#666";
    const icon = config?.shortIcon || config?.icon || id[0]?.toUpperCase() || "?";
    const activeClass = activePlatformId === id ? " active" : "";
    return `<button class="platform-tab${activeClass}" data-platform="${id}" style="--tab-color:${color}">${icon} ${name}</button>`;
  }).join("");

  elements.platformTabs.querySelectorAll(".platform-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      activePlatformId = tab.dataset.platform;
      renderPlatformTabs();
      renderCurrentPlatform();
    });
  });
}

// ==================== 发送逻辑 ====================

async function startSending() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  await debouncedSaveMessage(elements.messageInput.value);

  const originalMessage = validateMessageInput(elements.messageInput.value);
  if (!originalMessage) return;

  const selectedValue = elements.promptOptimizerSelect.querySelector(".selected-value");
  const templateKey = selectedValue.dataset.value;
  const templateContent = selectedValue.dataset.template;

  let finalMessage = originalMessage;
  if (templateKey && templateContent) {
    finalMessage = templateContent.includes("%s")
      ? templateContent.replace("%s", originalMessage)
      : originalMessage + " " + templateContent;
  }

  const selectedPlatforms = Array.from(document.querySelectorAll('.platform-icon-option input[type="checkbox"]'))
    .filter((checkbox) => {
      const option = checkbox.closest('.platform-icon-option');
      return option && option.style.display !== 'none' && checkbox.checked;
    })
    .map((checkbox) => checkbox.dataset.platform);

  if (!validatePlatformSelection(selectedPlatforms)) return;

  const sendTimestamp = Date.now();
  selectedPlatforms.forEach((platformId) => {
    const ps = getPlatformState(platformId);
    const conversationId = ps.activeConvId || DEFAULT_CONVERSATION_ID;
    appendUserMessage(platformId, conversationId, originalMessage, sendTimestamp);
  });

  if (!activePlatformId || !selectedPlatforms.includes(activePlatformId)) {
    activePlatformId = selectedPlatforms[0];
  }
  renderCurrentPlatform();
  renderPlatformTabs();
  scrollToBottom(true);

  // 长文本复制到剪贴板
  if (finalMessage.length > 400) {
    setSidebarSendButtonState("busy", "复制");
    const copySuccess = await copyToClipboard(finalMessage);
    if (copySuccess) {
      showTempMessage(`内容已复制到剪切板（${finalMessage.length}字符）`);
    } else {
      showTempMessage("复制失败，但将继续发送");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  setSidebarSendButtonState("busy", "处理中");

  try {
    await Promise.all([
      savePlatformStates(document.querySelectorAll('.platform-icon-option input[type="checkbox"]')),
      addToHistory(originalMessage)
    ]);

    const actionsQueue = selectedPlatforms.map((platform) => ({
      platform,
      message: finalMessage,
    }));

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "processTaskQueue",
          source: "sidebar",
          queue: actionsQueue,
          config: {
            maxConcurrent: 3,
            batchDelay: 300,
            tabLoadTimeout: 8000,
            scriptTimeout: 5000
          }
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });

    console.log("任务处理完成:", response);

    if (response && response.status === "completed") {
      const successMsg = `处理完成: 成功 ${response.success}/${response.total}`;
      setSidebarSendButtonState("done", "✓");
      showTempMessage(successMsg, 2000);

      if (response.failed > 0) {
        const failedPlatforms = response.results
          .filter(r => r.status === 'rejected')
          .map(r => {
            const match = r.reason?.message?.match(/^(\w+):/);
            return match ? match[1] : '未知';
          })
          .join(', ');
        console.warn("失败的平台:", failedPlatforms);
        setTimeout(() => { showTempMessage(`失败: ${failedPlatforms}`, 3000); }, 2000);
      }
    } else if (response && response.status === "error") {
      throw new Error(response.error || "处理失败");
    } else {
      showTempMessage("发送完成");
    }

    // 清空输入框
    elements.messageInput.value = "";
    autoResizeInput(elements.messageInput);
    updateSendButton();

    await new Promise((resolve) => setTimeout(resolve, 1500));
    updateSendButton();

  } catch (error) {
    console.error("发送消息失败:", error);
    showTempMessage("发送失败，请重试");
    updateSendButton();
  }
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

function appendUserMessage(platformId, conversationId, content, timestamp = Date.now()) {
  const convState = getConvState(platformId, conversationId);
  const messageId = `user-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  const messageKey = buildMessageKey("user", messageId);

  convState.messages.push({
    role: "user",
    messageId,
    content: String(content || ""),
    timestamp,
    collapsed: false,
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
  if (message.role === "user") {
    return renderMarkdownText(message.content || "");
  }

  const html = typeof message.html === "string" ? message.html : "";
  const text = typeof message.content === "string" ? message.content : "";
  if (html && !isBareHtmlContainer(html, text)) {
    return html;
  }
  return renderMarkdownText(text);
}

function isNearBottom(el, threshold = 72) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function getCheckedPlatforms() {
  return Array.from(document.querySelectorAll('.platform-icon-option input[type="checkbox"]:checked'))
    .map(cb => cb.dataset.platform);
}

function renderCurrentPlatform() {
  if (!responseContent) return;

  if (!activePlatformId) {
    responseContent.innerHTML = '<div class="response-placeholder">暂无回复内容</div>';
    responseContent.classList.remove("streaming");
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

  responseContent.innerHTML = '<div class="response-placeholder">暂无回复内容</div>';
  responseContent.classList.remove("streaming");
  if (responseStatus) responseStatus.style.display = "flex";
  updateResponseStatus(true);
}

function renderPlatformMessages(convState) {
  if (!responseContent) return;

  responseContent.innerHTML = "";

  const root = document.createElement("div");
  root.className = "notion-chat";

  convState.messages.forEach((message) => {
    const config = PLATFORM_CONFIG[activePlatformId];
    const platformName = config?.name || activePlatformId;
    const platformColor = config?.color || "#666";
    const platformIcon = config?.shortIcon || config?.icon || activePlatformId[0]?.toUpperCase() || "?";
    const isUser = message.role === "user";

    const msgRow = document.createElement("div");
    msgRow.className = `notion-chat-message ${isUser ? "notion-chat-message--user" : "notion-chat-message--ai"}`;

    let avatar = null;
    if (!isUser) {
      avatar = document.createElement("div");
      avatar.className = "notion-chat-avatar";
      avatar.style.background = platformColor;
      avatar.textContent = platformIcon;
    }

    const bubble = document.createElement("div");
    bubble.className = `notion-chat-bubble ${isUser ? "notion-chat-bubble--user" : "notion-chat-bubble--ai"}`;

    const header = document.createElement("div");
    header.className = "notion-chat-bubble-header";

    const nameEl = document.createElement("span");
    nameEl.className = "notion-chat-bubble-name";
    nameEl.style.color = isUser ? "#475569" : platformColor;
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

    actions.appendChild(copyBtn);
    actions.appendChild(toggleBtn);

    header.appendChild(nameEl);
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
    root.appendChild(msgRow);
  });

  responseContent.appendChild(root);
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

    return false;
  });

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

  renderPlatformTabs();

  const platforms = getCheckedPlatforms();
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
    }
    setTimeout(() => {
      resetButtonState(elements.closeTabsButton, "关闭AI标签页");
      elements.closeTabsButton.style.cursor = 'pointer';
    }, 1500);
  });
  closePlusMenu();
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
        if (extractResult) extractResult.style.display = "block";
        if (extractTitle) extractTitle.textContent = data.title || "未获取到标题";
        if (extractUrl) extractUrl.textContent = data.url || "";
        if (extractContent) extractContent.textContent = data.text || "未获取到内容";
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
  closePlusMenu();
}

// ==================== 向后兼容 ====================

/** @deprecated 单页模式不再需要切换视图 */
export function showResponseContainer() {}
/** @deprecated 单页模式不再需要切换视图 */
export function hideResponseContainer() {}

/** 重置回复展示 */
export function resetResponseDisplay() {
  platformStates.clear();
  activePlatformId = null;
  if (responseContent) {
    responseContent.innerHTML = '<div class="response-placeholder">暂无回复内容</div>';
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
