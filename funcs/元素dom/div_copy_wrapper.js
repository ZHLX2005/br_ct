/**
 * @fileoverview 蒙版选区复制工具
 *
 * @scenario    需要从页面蒙版选区中复制文本
 * @feature     蒙版高亮选中区域，复制对应文本到剪贴板
 * @effect      注入蒙版高亮DOM，复制选中区域文本到剪贴板
 * @category    DOM创建
 * @platform    通用
 * @entry       main()
 */

// 蒙版+复制 

function main() {
  // 封装一个使用 document.execCommand 的回退函数
  function fallbackCopyTextToClipboard(textToCopy, tooltipEl) {
    const textArea = document.createElement("textarea");
    textArea.value = textToCopy;

    // 避免滚动到页面的底部，避免用户看到
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0"; // 隐藏

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select(); // 选中文本

    try {
      const successful = document.execCommand("copy");
      if (successful) {
        tooltipEl.innerText = "文本已复制到剪贴板！(Fallback)";
      } else {
        tooltipEl.innerText = "无法自动复制文本。请手动复制。";
      }
    } catch (err) {
      tooltipEl.innerText = "无法自动复制文本。请手动复制。";
    }

    document.body.removeChild(textArea);
  }

  (() => {
    // 创建高亮框
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.border = "2px solid red";
    overlay.style.background = "rgba(255,0,0,0.1)";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "999999";
    document.body.appendChild(overlay);

    // 创建提示框
    const tooltip = document.createElement("div");
    tooltip.style.position = "fixed";
    tooltip.style.background = "black";
    tooltip.style.color = "white";
    tooltip.style.fontSize = "12px";
    tooltip.style.padding = "2px 6px";
    tooltip.style.borderRadius = "3px";
    tooltip.style.zIndex = "1000000";
    tooltip.style.pointerEvents = "none";
    document.body.appendChild(tooltip);

    function onMove(e) {
      let el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === overlay || el === tooltip) return;

      const rect = el.getBoundingClientRect();
      overlay.style.top = rect.top + window.scrollY + "px";
      overlay.style.left = rect.left + window.scrollX + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";

      tooltip.style.top = rect.top + window.scrollY - 24 + "px";
      tooltip.style.left = rect.left + window.scrollX + "px";
      tooltip.innerText = `<${el.tagName.toLowerCase()}>`;
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();

      let el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;

      // 获取元素文字
      let text = (el.innerText || el.textContent || "").trim();

      // 处理：去掉连续空格和连续空行
      text = text
        .replace(/[ \t]+/g, " ") // 多个空格合并成一个
        .replace(/\n\s*\n+/g, "\n"); // 多个空行合并成一个

      // *** 修复 BUG 的核心逻辑开始 ***
      const clipboardAPI = navigator.clipboard && navigator.clipboard.writeText;

      if (clipboardAPI) {
        // 1. 优先使用 Clipboard API (需要安全上下文/HTTPS)
        navigator.clipboard
          .writeText(text)
          .then(() => {
            tooltip.innerText = "文本已复制到剪贴板！(API)";
          })
          .catch((err) => {
            // 如果因权限等原因失败，回退
            console.warn("Clipboard API 复制失败，尝试回退。", err);
            fallbackCopyTextToClipboard(text, tooltip);
          });
      } else {
        // 2. 如果 API 不存在 (如 HTTP 页面)，使用回退方案
        console.warn("Clipboard API 不存在，使用 Fallback 方案。");
        fallbackCopyTextToClipboard(text, tooltip);
      }
      // *** 修复 BUG 的核心逻辑结束 ***

      // 点击一次后立即清理
      cleanup();
      console.log("元素拾取已完成并关闭");
    }

    function cleanup() {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      overlay.remove();
      tooltip.remove();
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);

    // 给全局留一个清理接口
    window.__pickerCleanup = cleanup;

    console.log("元素拾取已开启（点击一次后自动关闭，复制文字）");
  })();
}
