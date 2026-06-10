/**
 * ccBgComms.js — Background 通信层
 *
 * 封装 chrome.runtime.sendMessage，提供 fire-and-forget 和 request-response 两种模式。
 */

// ==================== 通用发送 ====================

/**
 * 向 background 发送消息，返回 Promise。
 * - fire-and-forget（不需要响应）：直接 sendMessage 不包装 Promise。
 * - 请求-响应：包装为 Promise。
 */
export function sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp ?? { ok: true });
      }
    });
  });
}

/**
 * 发送带超时的请求-响应消息。
 * 用于 getSkills / getStatus / listSessions / closeSession 等。
 */
export function sendBgRequest(msg, timeout = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);
    chrome.runtime.sendMessage(msg, (resp) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp ?? { ok: false, error: 'no response' });
      }
    });
  });
}
