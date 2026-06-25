// mainUtils.js - 核心popup功能模块
import { populateOptimizer, initAliasShortcut } from "./prompts/promptsUI.js";
import { PROMPT_TEMPLATES } from "./prompts/prompts.js";
import {
  STORAGE_KEYS,
  saveMessageContent,
  savePlatformStates,
  saveOptimizerSetting,
  loadStoredData as loadData,
  addToHistory
} from "./modules/storage.js";
import {
  loadPlatformVisibilitySettings,
  applyPlatformVisibilitySettings,
  getVisiblePlatformCheckboxes,
  areAllVisiblePlatformsChecked,
  setupPlatformVisibilityMessageListener
} from "./modules/platformVisibility.js";
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
} from "./modules/uiHelpers.js";

// DOM 元素缓存
let elements = {};

// 保存相关变量
let saveTimeout;
let lastSavedContent = "";
let isSaving = false;

/**
 * 防抖保存消息内容
 */
async function debouncedSaveMessage(content) {
  // 避免重复保存相同内容
  if (content === lastSavedContent) {
    return;
  }

  // 如果正在保存，等待完成
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
  elements = {
    platformCheckboxes: document.querySelectorAll(
      '.platform-icon-option input[type="checkbox"]'
    ),
    messageInput: document.getElementById("message-input"),
    sendButton: document.getElementById("send-button"),
    closeTabsButton: document.getElementById("close-tabs-button"),
    selectAllButton: document.getElementById("select-all"),
    historySelect: document.getElementById("history-select"),
    promptOptimizerSelect: document.getElementById("prompt-optimizer-select"),
    openOptionsButton: document.getElementById("open-options"),
  };

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
  elements.platformCheckboxes.forEach((cb) => {
    if (platformStates.hasOwnProperty(cb.dataset.platform)) {
      togglePlatformCheckbox(cb, platformStates[cb.dataset.platform]);
    }
  });
  updateSelectAllButton();
}

/**
 * 设置所有事件监听器
 */
export function setupEventListeners() {
  // 监听来自options页面的平台可见性更新消息
  setupPlatformVisibilityMessageListener((settings) => {
    showTempMessage('平台显示设置已更新');
    updateSelectAllButton();
  });

  // 输入框内容变化时实时保存
  elements.messageInput.addEventListener("input", () => {
    const currentContent = elements.messageInput.value;

    // 清除之前的定时器
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // 根据文本长度动态调整保存延迟
    const delay = currentContent.length > 1000 ? 300 : 500;

    // 设置新的定时器
    saveTimeout = setTimeout(async () => {
      await debouncedSaveMessage(currentContent);
    }, delay);
  });

  // 监听输入框失去焦点事件，立即保存
  elements.messageInput.addEventListener("blur", async () => {
    // 立即清除定时器并保存
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    await debouncedSaveMessage(elements.messageInput.value);
  });

  // 监听输入框获得焦点事件，确保内容同步
  elements.messageInput.addEventListener("focus", async () => {
    try {
      const result = await loadData(STORAGE_KEYS.LAST_MESSAGE);
      if (
        result[STORAGE_KEYS.LAST_MESSAGE] &&
        result[STORAGE_KEYS.LAST_MESSAGE] !== elements.messageInput.value
      ) {
        elements.messageInput.value = result[STORAGE_KEYS.LAST_MESSAGE];
        lastSavedContent = result[STORAGE_KEYS.LAST_MESSAGE];
      }
    } catch (error) {
      console.error("同步消息内容失败:", error);
    }
  });

  // 监听键盘快捷键（Ctrl+S 手动保存）
  elements.messageInput.addEventListener("keydown", async (e) => {
    if (e.ctrlKey && e.key === "s") {
      e.preventDefault();
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }
      await debouncedSaveMessage(elements.messageInput.value);
      showTempMessage("内容已手动保存");
    }
  });

  // 监听页面关闭前保存
  window.addEventListener("beforeunload", async () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    await debouncedSaveMessage(elements.messageInput.value);
  });

  // 历史记录选择
  elements.historySelect.addEventListener("change", () => {
    if (elements.historySelect.value) {
      elements.messageInput.value = elements.historySelect.value;
      elements.messageInput.dispatchEvent(new Event("input"));
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
  elements.platformCheckboxes.forEach((cb) => {
    cb.addEventListener("change", async () => {
      togglePlatformCheckbox(cb, cb.checked);
      try {
        await savePlatformStates(elements.platformCheckboxes);
      } catch (error) {
        console.error("保存平台状态失败:", error);
      }
      updateSelectAllButton();
    });
  });

  // 全选/取消全选按钮
  elements.selectAllButton.addEventListener("click", toggleSelectAll);

  // 发送按钮
  elements.sendButton.addEventListener("click", startSending);

  // 关闭AI标签页按钮
  elements.closeTabsButton.addEventListener("click", closeAllAITabs);

  // 打开设置页面按钮
  elements.openOptionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // 打开侧边栏按钮
  elements.openSidepanelButton = document.getElementById("open-sidepanel-btn");
  if (elements.openSidepanelButton) {
    elements.openSidepanelButton.addEventListener("click", async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.sidePanel.open({ tabId: tab.id });
          window.close();
        }
      } catch (error) {
        console.error("打开侧边栏失败:", error);
      }
    });
  }
}

/**
 * 更新全选按钮
 */
function updateSelectAllButton() {
  const buttonText = updateSelectAllTextUI(elements.platformCheckboxes);
  elements.selectAllButton.textContent = buttonText;
}

/**
 * 切换全选/取消全选状态
 */
async function toggleSelectAll() {
  const visibleCheckboxes = getVisiblePlatformCheckboxes(elements.platformCheckboxes);

  if (visibleCheckboxes.length === 0) {
    return;
  }

  const allChecked = areAllVisiblePlatformsChecked(visibleCheckboxes);

  // 只切换可见的复选框
  visibleCheckboxes.forEach((checkbox) => {
    togglePlatformCheckbox(checkbox, !allChecked);
  });

  updateSelectAllButton();

  try {
    await savePlatformStates(elements.platformCheckboxes);
  } catch (error) {
    console.error("保存平台状态失败:", error);
  }
}

/**
 * 关闭所有AI标签页
 */
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

    // 短暂延迟后重置按钮状态
    setTimeout(() => {
      resetButtonState(elements.closeTabsButton, "关闭AI标签页");
      elements.closeTabsButton.style.cursor = 'pointer';
    }, 1500);
  });
}

/**
 * 发送消息逻辑（优化版：支持并发并显示进度）
 */
async function startSending() {
    // 确保最新的输入被保存
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    await debouncedSaveMessage(elements.messageInput.value);

    // 从selectedValue中直接获取当前选中的模板
    const selectedValue =
        elements.promptOptimizerSelect.querySelector(".selected-value");
    const templateKey = selectedValue.dataset.value;
    const templateContent = selectedValue.dataset.template;

    const originalMessage = elements.messageInput.value;
    let finalMessage = originalMessage;

    if (templateKey && templateContent) {
        if (templateContent.includes("%s")) {
            // 有 %s 占位符，用用户输入替换（可为空）
            finalMessage = templateContent.replace("%s", originalMessage);
        } else {
            // 无 %s 占位符，直接使用模板作为短指令
            finalMessage = templateContent;
            if (originalMessage.trim()) {
                showTempMessage(`使用模板: ${templateContent.substring(0, 20)}...`);
            }
        }
    } else {
        // 无模板，用户输入不能为空
        const trimmed = validateMessageInput(originalMessage);
        if (!trimmed) {
            return;
        }
    }

    // 只获取可见且被勾选的平台
    const selectedPlatforms = Array.from(elements.platformCheckboxes)
        .filter((checkbox) => {
            const option = checkbox.closest('.platform-icon-option');
            return option && option.style.display !== 'none' && checkbox.checked;
        })
        .map((checkbox) => checkbox.dataset.platform);

    if (!validatePlatformSelection(selectedPlatforms)) {
        return;
    }

    // 检查文本长度，如果超过400则复制到剪切板
    if (finalMessage.length > 400) {
        setButtonLoadingState(elements.sendButton, "复制中...");

        const copySuccess = await copyToClipboard(finalMessage);

        if (copySuccess) {
            showTempMessage(`内容已复制到剪切板（${finalMessage.length}字符）`);
        } else {
            showTempMessage("复制失败，但将继续发送");
        }

        // 短暂延迟让用户看到提示
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // 显示初始进度
    setButtonLoadingState(
        elements.sendButton,
        `处理中 (0/${selectedPlatforms.length})`
    );

    try {
        // 1. 并行保存数据
        await Promise.all([
            savePlatformStates(elements.platformCheckboxes),
            addToHistory(originalMessage)
        ]);

        // 2. 构造任务队列
        const actionsQueue = selectedPlatforms.map((platform) => ({
            platform,
            message: finalMessage,
        }));

        // 3. 发送任务到 background（使用 Promise 包装）
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    action: "processTaskQueue",
                    source: "popup",
                    queue: actionsQueue,
                    config: {
                        maxConcurrent: 3,      // 最多同时处理3个平台
                        batchDelay: 300,       // 批次间延迟300ms
                        tabLoadTimeout: 8000,  // 页面加载超时8秒
                        scriptTimeout: 5000    // 脚本执行超时5秒
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

        // 4. 处理响应结果
        console.log("任务处理完成:", response);

        if (response && response.status === "completed") {
            // 显示处理结果
            const successMsg = `处理完成: 成功 ${response.success}/${response.total}`;
            setButtonLoadingState(elements.sendButton, successMsg);
            showTempMessage(successMsg, 2000);

            // 清空输入框并清除持久化的 lastMessage，避免下次打开弹窗时旧消息回来
            elements.messageInput.value = "";
            lastSavedContent = "";
            try { chrome.storage.local.remove(STORAGE_KEYS.LAST_MESSAGE); } catch (e) { /* ignore */ }

            // 如果有失败的任务，显示详细信息
            if (response.failed > 0) {
                const failedPlatforms = response.results
                    .filter(r => r.status === 'rejected')
                    .map(r => {
                        const match = r.reason?.message?.match(/^(\w+):/);
                        return match ? match[1] : '未知';
                    })
                    .join(', ');

                console.warn("失败的平台:", failedPlatforms);
                setTimeout(() => {
                    showTempMessage(`失败: ${failedPlatforms}`, 3000);
                }, 2000);
            }
        } else if (response && response.status === "error") {
            throw new Error(response.error || "处理失败");
        } else {
            showTempMessage("发送完成");
        }

        // 5. 短暂延迟后关闭窗口
        await new Promise((resolve) => setTimeout(resolve, 2500));
        window.close();

    } catch (error) {
        console.error("发送消息失败:", error);
        showTempMessage("发送失败，请重试");

        // 恢复按钮状态
        resetButtonState(elements.sendButton, "发送消息");
    }
}
