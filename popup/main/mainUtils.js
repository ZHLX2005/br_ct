// mainUtils.js - 核心popup功能模块
import { populateOptimizer, initAliasShortcut } from "./prompts/promptsUI.js";
import { PROMPT_TEMPLATES } from "./prompts/prompts.js";
import { createImageOcrController } from "../../shared/imageOcr.js";
import { createDebouncedSaver } from "../../shared/debouncedSave.js";
import { attachMessageInputPersistence } from "../../shared/inputPersistence.js";
import {
  buildFinalMessage,
  getSelectedPlatformIds,
  closeAllAITabs as closeAllAITabsShared,
  saveMessageHistory,
} from "../../shared/sendMessage.js";
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

// 图片 OCR 控制器（依赖注入 shared/imageOcr.js）
let ocrController = null;
function getOcrController() {
  if (!ocrController) {
    ocrController = createImageOcrController({
      // scope 到当前视图根（initializePopup 时绑定）；shell 接管后 rootEl 由 viewController 注入
      getPreviewContainer: () => viewRoot && viewRoot.querySelector("#image-preview-area"),
      showTempMessage: (msg) => showTempMessage(msg),
      onChange: () => {},
    });
  }
  return ocrController;
}

// DOM 元素缓存
let elements = {};

// 视图根元素（init 时绑定；事件处理函数与 OCR 回调中查询使用，参照 translation.js 模式）
let viewRoot = null;

// init 链中注册的 cleanup 函数集合（populateOptimizer / initAliasShortcut /
// setupPlatformVisibilityMessageListener 等返回的 document 级监听与 popup 清理）。
// 由 teardownView() 在视图卸载时统一调用，避免多次挂载累积监听与 DOM。
let viewCleanups = [];

// 输入持久化 saver（shared 原语；module-level 以便 startSending 调用 flush）
let messageSaver = null;

/**
 * 注册全局回调（dragDropHandler 调用）
 */
window.__onImagePasted = ({ dataUrl, fileName }) => {
  getOcrController().addImage({ dataUrl, fileName });
};

/**
 * 初始化弹窗，获取并缓存 DOM 元素 + 绑定一次性行为（按 rootEl 作用域）。
 * 一次性 init 中可放心执行的工作：DOM 缓存、元素级事件绑定、输入持久化、平台可见性的
 * storage 读取与样式应用。这些查询都在 rootEl 内，缓存的 viewRoot 之后被 onActivate
 * 取代（后者每次 mount 都重新绑定）。
 *
 * ⚠️ 注意：document 级副作用（document.addEventListener / document.body.appendChild popup /
 * chrome.runtime.onMessage.addListener）必须放在 registerDocumentSideEffects(rootEl)
 * 中，由 main.js 的 onActivate 在每次 mount 时调用——首次 mount 也会调，在 init 之后。
 *
 * @param {Element} rootEl 视图根元素（viewController 注入的 .view.view-main 或直开 mainView.html 时的 document.body）
 */
export async function initializePopup(rootEl) {
  viewRoot = rootEl;
  // 每次 mount 重置 cleanup 集合（防止上一轮 teardown 异常遗留）。
  // 即使 initializePopup 现在不再注册 document 副作用，注册 module 仍可能在 registerDocumentSideEffects
  // 之前调用——故保持「先清零」以便统一管理。
  viewCleanups = [];
  elements = {
    platformCheckboxes: rootEl.querySelectorAll(
      '.platform-icon-option input[type="checkbox"]'
    ),
    messageInput: rootEl.querySelector("#message-input"),
    sendButton: rootEl.querySelector("#send-button"),
    closeTabsButton: rootEl.querySelector("#close-tabs-button"),
    selectAllButton: rootEl.querySelector("#select-all"),
    historySelect: rootEl.querySelector("#history-select"),
    promptOptimizerSelect: rootEl.querySelector("#prompt-optimizer-select"),
  };

  // 自动聚焦输入框
  focusInputAndSetCursor(elements.messageInput);

  // 加载并应用平台可见性设置（一次性的 storage 读取；onActivate 不需要重复做）。
  await loadPlatformVisibilitySettings();
}

/**
 * 注册 main 视图的 document 级副作用：每次 mount 都调用（首次 mount 也调）。
 * 与 init 的差别：副作用登记必须在视图「可见」后（attach 之后）才注册，以便用户在当前视图内
 * 触发的事件能立即命中监听；同时要求每次 mount 都重新注册——避免上一轮 teardown 移除了监听、
 * 当前轮缺位导致功能静默失效（这就是 fix round 1 暴露的缺陷）。
 *
 * init 链中注册的 cleanup 推入 viewCleanups；teardownView 调用时按 LIFO 顺序清理。
 *
 * @param {Element} rootEl 视图根元素
 */
export function registerDocumentSideEffects(rootEl) {
  viewRoot = rootEl;

  // 初始化 /alias 快捷输入（返回 cleanup：移除 document 监听 + 移除 alias popup）
  const aliasCleanup = initAliasShortcut(elements.messageInput, PROMPT_TEMPLATES, elements.promptOptimizerSelect);
  if (typeof aliasCleanup === "function") viewCleanups.push(aliasCleanup);

  // 初始化优化器下拉框（返回 cleanup：移除 document 监听）
  const optimizerCleanup = populateOptimizer(elements.promptOptimizerSelect, PROMPT_TEMPLATES);
  if (typeof optimizerCleanup === "function") viewCleanups.push(optimizerCleanup);

  // 监听来自 options 页面的平台可见性更新消息（返回 cleanup：移除 onMessage 监听）
  const visibilityCleanup = setupPlatformVisibilityMessageListener((settings) => {
    showTempMessage('平台显示设置已更新');
    updateSelectAllButton();
  });
  if (typeof visibilityCleanup === "function") viewCleanups.push(visibilityCleanup);
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
 * 设置所有事件监听器（rootEl 元素级，每次 mount 由 setupEventListeners 调用前需 elements 已注入，
 * 并要求 document 级副作用已通过 registerDocumentSideEffects 登记）。
 *
 * 注意：platformVisibility 的 onMessage 监听已迁出至 registerDocumentSideEffects——
 * 它是 document 级（chrome.runtime），不依赖 rootEl 的 DOM 节点，每次 mount 都要重新注册。
 */
export function setupEventListeners() {
  // 输入框持久化（shared 原语）
  messageSaver = createDebouncedSaver(async (text) => {
    await saveMessageContent(text);
  });
  attachMessageInputPersistence(elements.messageInput, messageSaver, {
    onShowMessage: (msg) => showTempMessage(msg),
    getStoredValue: async () => {
      const result = await loadData(STORAGE_KEYS.LAST_MESSAGE);
      return result[STORAGE_KEYS.LAST_MESSAGE] || "";
    },
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

  // 注：`#open-options`（设置）与 `#open-sidepanel-btn`（侧边栏）属于 shell nav（.header 内），
  // 不在 mainView 中，改由 shell 绑定（见 Task 5）。
}

/**
 * 视图拆解：调用 init 链中各模块注册的 cleanup，移除 document 级监听与 alias popup，
 * 释放对旧 rootEl 的引用。由 main.js teardown 调用。
 * view 内的元素监听随 DOM detach 自动失效，无需在此处理。
 */
export function teardownView() {
  for (const cleanup of viewCleanups) {
    try {
      cleanup();
    } catch (e) {
      console.error("main teardown cleanup 失败:", e);
    }
  }
  viewCleanups = [];
  viewRoot = null;
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

  closeAllAITabsShared((status, payload) => {
    if (status === "failed") {
      console.error("关闭AI标签页时出错:", payload);
      showTempMessage("关闭标签页失败");
    } else {
      showTempMessage("正在关闭AI标签页");
    }
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
    if (messageSaver) {
        await messageSaver.flush(elements.messageInput.value);
    }

    // 从selectedValue中直接获取当前选中的模板
    const selectedValue =
        elements.promptOptimizerSelect.querySelector(".selected-value");
    const templateKey = selectedValue.dataset.value;
    const templateContent = selectedValue.dataset.template;

    const originalMessage = elements.messageInput.value;
    let finalMessage = originalMessage;

    if (templateKey && templateContent) {
        // 走 shared/sendMessage.buildFinalMessage
        const imageInfo = getOcrController().buildImageInfo();
        const composed = buildFinalMessage({
            templateContent,
            hasTemplate: true,
            userMessage: originalMessage,
            imageInfo,
        });
        // popup UX 特殊：模板无占位符且无图片时，直接使用模板作为短指令
        const hasSOrI = templateContent.includes("%s") || templateContent.includes("%i");
        if (!hasSOrI && !imageInfo) {
            finalMessage = templateContent;
            if (originalMessage.trim()) {
                showTempMessage(`使用模板: ${templateContent.substring(0, 20)}...`);
            }
        } else {
            finalMessage = composed;
        }
    } else {
        // 无模板，用户输入不能为空
        const trimmed = validateMessageInput(originalMessage);
        if (!trimmed) {
            return;
        }
    }

    // 只获取可见且被勾选的平台（shared 原语）
    const selectedPlatforms = getSelectedPlatformIds(elements.platformCheckboxes);

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
            saveMessageHistory(originalMessage, addToHistory)
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
