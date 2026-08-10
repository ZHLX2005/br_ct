/**
 * shared/sendMessage.js
 *
 * popup 与 sidebar 发送流程的共享原语。
 *
 * 提供 4 个无状态函数，消除 popup 与 sidebar 各自维护的重复逻辑：
 *   1. buildFinalMessage()      — 模板拼接（统一走 applyPromptTemplate 决策树）
 *   2. getSelectedPlatformIds() — 从 DOM 提取可见+勾选的平台 ID
 *   3. closeAllAITabs()         — 关闭所有 AI 标签页（封装 chrome.runtime.sendMessage 回调）
 *   4. saveMessageHistory()     — 保存历史（统一错误处理）
 *
 * 设计原则：
 *   - 无状态 / 无副作用（除 chrome API 调用）
 *   - 不持有 DOM 引用（参数传入 checkboxes）
 *   - 不区分 popup vs sidebar（caller 自己负责调用哪个 background action）
 *
 * 不进 shared 的（caller 特有）：
 *   - processTaskQueue vs directSend（不同的 background action 和并发策略）
 *   - 按钮 loading 状态管理（DOM API 差异）
 *   - getExtractedContentText（sidebar 特有）
 */

import { applyPromptTemplate } from "./prompts/promptsCore.js";

/**
 * 模板拼接核心。统一走 promptsCore.applyPromptTemplate 决策树，
 * 由 caller 决定是否提供 extractedText / imageInfo（undefined 视为空）。
 *
 * @param {Object} opts
 * @param {string} [opts.templateContent] — 模板字符串（undefined 视为无模板）
 * @param {boolean} opts.hasTemplate — caller 判断是否有模板
 * @param {string} opts.userMessage — 用户输入
 * @param {string} [opts.extractedText] — 提取的页面文本（sidebar 传入，popup 不传）
 * @param {string} [opts.imageInfo] — OCR 图片信息（v2 引入）
 * @returns {string} 最终发送给 LLM 的字符串
 */
export function buildFinalMessage({
  templateContent,
  hasTemplate,
  userMessage,
  extractedText = "",
  imageInfo = "",
}) {
  if (!hasTemplate || !templateContent) {
    return userMessage || "";
  }
  // 走 promptsCore 决策树：统一处理 %s / %v / %i / good_eg / bad_eg / image_info
  return applyPromptTemplate(templateContent, {
    userMessage: userMessage || "",
    extractedText: extractedText || "",
    imageInfo: imageInfo || "",
  });
}

/**
 * 从 checkbox 列表中提取"可见且被勾选"的平台 ID。
 * 适用于 popup 的平台选择区（每个平台 checkbox 套在 .platform-icon-option 中，
 * 通过 display:none 隐藏不可见平台）。
 *
 * @param {NodeListOf<HTMLInputElement> | HTMLInputElement[]} checkboxes
 * @returns {string[]} 平台 ID 数组（dataset.platform）
 */
export function getSelectedPlatformIds(checkboxes) {
  return Array.from(checkboxes)
    .filter((checkbox) => {
      const option = checkbox.closest(".platform-icon-option");
      return option && option.style.display !== "none" && checkbox.checked;
    })
    .map((checkbox) => checkbox.dataset.platform);
}

/**
 * 关闭所有 AI 标签页的 chrome.runtime.sendMessage 封装。
 *
 * @param {(status: 'success'|'failed', payload?: any) => void} [onStatus]
 *   状态回调（caller 用于触发按钮 loading / toast）
 * @returns {Promise<any>} background 返回的 response
 */
export function closeAllAITabs(onStatus) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "closeAllAITabs" }, (response) => {
      if (chrome.runtime.lastError) {
        onStatus?.("failed", chrome.runtime.lastError.message);
      } else {
        onStatus?.("success", response);
      }
      resolve(response);
    });
  });
}

/**
 * 异步保存消息到历史。统一 try/catch + console.warn，
 * caller 不必再写 try/catch。
 *
 * @param {string} originalMessage
 * @param {(msg: string) => Promise<void>} addToHistoryFn
 *   caller 提供的 history 保存函数（popup 用 popup/modules/storage.js 的 addToHistory，
 *   sidebar 用 aichatUtils 自己的 addToHistory）
 */
export async function saveMessageHistory(originalMessage, addToHistoryFn) {
  try {
    await addToHistoryFn(originalMessage);
  } catch (e) {
    console.warn("[shared/sendMessage] save history failed:", e);
  }
}