/**
 * shared/debouncedSave.js
 *
 * 防抖保存状态机 — popup 与 sidebar 复用。
 *
 * 解决两个并发问题：
 *   1. 用户快速输入时合并连续保存请求
 *   2. 同一时刻只允许一个 saveFn 在飞，避免竞态覆盖
 *
 * 使用方法：
 *   const saver = createDebouncedSaver(async (text) => {
 *     await chrome.storage.local.set({ lastMessage: text });
 *   });
 *   textarea.addEventListener("input", () => saver.schedule(textarea.value));
 *   window.addEventListener("beforeunload", () => saver.flush(textarea.value));
 */

export function createDebouncedSaver(saveFn, options = {}) {
  const getDelay = options.getDelay || ((len) => (len > 1000 ? 300 : 500));

  let timeout = null;
  let lastSavedContent = "";
  let isSaving = false;
  let pendingWaiters = [];

  async function doSave(content) {
    if (isSaving) {
      // 已有保存进行中，等完成后再处理
      await new Promise((resolve) => {
        pendingWaiters.push(resolve);
      });
    }
    isSaving = true;
    try {
      await saveFn(content);
      lastSavedContent = content;
    } catch (e) {
      console.error("[debouncedSave] save failed:", e);
    } finally {
      isSaving = false;
      // 唤醒所有等待者
      const waiters = pendingWaiters;
      pendingWaiters = [];
      waiters.forEach((r) => r());
    }
  }

  function schedule(content) {
    // 与上次保存内容相同则跳过
    if (content === lastSavedContent) return;
    if (timeout) clearTimeout(timeout);
    const delay = getDelay(content.length);
    timeout = setTimeout(async () => {
      timeout = null;
      await doSave(content);
    }, delay);
  }

  async function flush(content) {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (content && content !== lastSavedContent) {
      await doSave(content);
    }
  }

  function cancel() {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  }

  return { schedule, flush, cancel };
}
