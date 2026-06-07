// uiHelpers.js - UI交互和消息显示模块

import { getVisiblePlatformCheckboxes, areAllVisiblePlatformsChecked } from './platformVisibility.js';

/**
 * 复制文本到剪切板
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // 如果现代API失败，使用传统的execCommand方法作为备选
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      return successful;
    } catch (fallbackErr) {
      console.error("复制到剪切板失败:", fallbackErr);
      return false;
    }
  }
}

/**
 * 显示临时提示信息
 */
export function showTempMessage(message, duration = 2000) {
  // 创建提示元素
  let messageEl = document.getElementById("temp-message");
  if (!messageEl) {
    messageEl = document.createElement("div");
    messageEl.id = "temp-message";
    messageEl.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #2d2d2d;
      color: #e5e5e5;
      padding: 8px 16px;
      border-radius: 8px;
      z-index: 10000;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      pointer-events: none;
      transition: opacity 0.25s ease;
      white-space: nowrap;
    `;
    document.body.appendChild(messageEl);
  }

  messageEl.textContent = message;
  messageEl.style.opacity = "1";
  messageEl.style.display = "block";

  // 自动隐藏
  setTimeout(() => {
    messageEl.style.opacity = "0";
    setTimeout(() => {
      messageEl.style.display = "none";
    }, 300);
  }, duration);
}

/**
 * 渲染历史消息
 * @param {HTMLSelectElement} historySelect - 历史记录下拉框元素
 * @param {Array} history - 历史记录数组
 * @param {number} maxDisplay - 最多显示的条数，默认5条
 */
export function populateHistory(historySelect, history, maxDisplay = 5) {
  historySelect.innerHTML = `<option value="">选择历史消息</option>`;

  // 只显示最近的几条历史记录
  const displayHistory = history.slice(0, maxDisplay);

  displayHistory.forEach((msg) => {
    const opt = document.createElement("option");
    opt.value = msg;
    opt.textContent = msg.length > 40 ? msg.slice(0, 40) + "..." : msg;
    historySelect.appendChild(opt);
  });
}

/**
 * 更新全选按钮文本
 */
export function updateSelectAllText(platformCheckboxes) {
  // 只考虑可见的平台复选框
  const visibleCheckboxes = getVisiblePlatformCheckboxes(platformCheckboxes);

  if (visibleCheckboxes.length === 0) {
    return "全选";
  }

  const allChecked = areAllVisiblePlatformsChecked(visibleCheckboxes);
  return allChecked ? "取消全选" : "全选";
}

/**
 * 切换平台复选框选中状态
 */
export function togglePlatformCheckbox(checkbox, isChecked) {
  checkbox.checked = isChecked;
  const iconWrapper = checkbox
    .closest(".platform-icon-option")
    .querySelector(".icon-wrapper");
  if (iconWrapper) {
    iconWrapper.classList.toggle("checked", isChecked);
  }
}

/**
 * 设置按钮状态
 */
export function setButtonState(button, text, disabled = false) {
  if (button) {
    button.disabled = disabled;
    button.textContent = text;
  }
}

/**
 * 设置按钮加载状态
 */
export function setButtonLoadingState(button, loadingText) {
  if (button) {
    button.disabled = true;
    button.textContent = loadingText;
  }
}

/**
 * 重置按钮状态
 */
export function resetButtonState(button, normalText) {
  if (button) {
    button.disabled = false;
    button.textContent = normalText;
  }
}

/**
 * 聚焦输入框并设置光标位置
 */
export function focusInputAndSetCursor(inputElement) {
  if (inputElement) {
    setTimeout(() => {
      inputElement.focus();
      const len = inputElement.value.length;
      inputElement.setSelectionRange(len, len);
    }, 100);
  }
}

/**
 * 验证消息输入
 */
export function validateMessageInput(message) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    showTempMessage("请输入消息内容");
    return false;
  }
  return trimmedMessage;
}

/**
 * 验证平台选择
 */
export function validatePlatformSelection(selectedPlatforms) {
  if (selectedPlatforms.length === 0) {
    showTempMessage("请至少选择一个平台");
    return false;
  }
  return true;
}