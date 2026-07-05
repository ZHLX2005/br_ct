/**
 * shared/inputPersistence.js
 *
 * 输入框持久化事件绑定 — popup 与 sidebar 复用。
 *
 * 自动绑定：
 *   - input: 防抖保存
 *   - blur: 立即 flush 保存
 *   - Ctrl+S: 立即 flush + toast
 *   - beforeunload: flush
 *   - focus: 同步 storage 中保存的内容（防止多 tab 冲突）
 *
 * 使用：
 *   const saver = createDebouncedSaver(saveFn);
 *   attachMessageInputPersistence(textarea, saver, {
 *     onInput: (text) => autoResize(textarea),
 *     onShowMessage: (msg) => showToast(msg),
 *   });
 */

export function attachMessageInputPersistence(textarea, saver, options = {}) {
  const onInput = options.onInput || (() => {});
  const onShowMessage = options.onShowMessage || (() => {});
  const getStoredValue = options.getStoredValue; // optional: focus sync source

  // 1. input — 防抖保存
  textarea.addEventListener("input", () => {
    const current = textarea.value;
    saver.schedule(current);
    onInput(current);
  });

  // 2. blur — 立即 flush
  textarea.addEventListener("blur", async () => {
    await saver.flush(textarea.value);
  });

  // 3. Ctrl+S — 手动保存 + toast
  textarea.addEventListener("keydown", async (e) => {
    if (e.ctrlKey && e.key === "s") {
      e.preventDefault();
      await saver.flush(textarea.value);
      onShowMessage("内容已手动保存");
    }
  });

  // 4. beforeunload — 离开前 flush
  window.addEventListener("beforeunload", async () => {
    await saver.flush(textarea.value);
  });

  // 5. focus — 同步 storage 内容（多 tab 场景）
  //    注意：仅在 stored 是真实"有内容"时覆盖 textarea（空字符串视为无值）
  if (typeof getStoredValue === "function") {
    textarea.addEventListener("focus", async () => {
      try {
        const stored = await getStoredValue();
        if (stored !== null && stored !== undefined && stored !== "" && stored !== textarea.value) {
          textarea.value = stored;
        }
      } catch (e) {
        console.error("[inputPersistence] focus sync failed:", e);
      }
    });
  }
}
