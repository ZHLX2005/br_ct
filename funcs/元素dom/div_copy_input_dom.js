/**
 * @fileoverview DOM输入解析复制工具
 *
 * @scenario    需要从HTML/文本中识别内容并复制
 * @feature     解析输入框内容并复制到剪贴板，带状态提示
 * @effect      注入解析输入框DOM，复制解析结果到剪贴板
 * @category    DOM创建
 * @platform    通用
 * @entry       main()
 */

// 创建一个dom 输入html 识别对应的内容

function main() {
  // --- 剪贴板复制回退函数 (与之前相同，确保兼容性) ---
  function fallbackCopyTextToClipboard(textToCopy, statusEl) {
    const textArea = document.createElement("textarea");
    textArea.value = textToCopy;

    // 隐藏和定位，避免视觉和交互干扰
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";
    textArea.style.zIndex = "-1";

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (successful) {
        statusEl.innerText = "✅ 文本已复制到剪贴板！(Fallback execCommand)";
        return true;
      } else {
        statusEl.innerText = "❌ 自动复制失败，请手动在下方框内复制。";
        // 最终回退：提示用户手动操作
        prompt("自动复制失败。请手动全选并复制以下文本:", textToCopy);
        return false;
      }
    } catch (err) {
      document.body.removeChild(textArea);
      statusEl.innerText = "❌ 复制操作发生错误，请手动在下方框内复制。";
      prompt("复制操作发生错误。请手动全选并复制以下文本:", textToCopy);
      return false;
    }
  }

  // --- 核心逻辑：DOM/文本解析和复制 ---
  function parseAndCopy() {
    // 获取 UI 元素
    const textarea = document.getElementById("domParserTextarea");
    const statusEl = document.getElementById("parserStatus");
    const rawContent = textarea.value;

    if (!rawContent.trim()) {
      statusEl.innerText = "⚠️ 请先粘贴内容到输入框。";
      return;
    }

    // 1. DOM/HTML 解析：通过创建临时 div 来提取纯文本
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = rawContent;

    // 优先使用 textContent，它能获取元素的纯文本内容，忽略标签。
    let cleanText = tempDiv.textContent || tempDiv.innerText || "";

    // 2. 文本清洗：与旧逻辑相同，处理连续空格和多余空行
    cleanText = cleanText
      .trim()
      .replace(/[ \t]+/g, " ") // 多个空格合并成一个
      .replace(/\n\s*\n+/g, "\n"); // 多个空行合并成一个

    // 3. 复制到剪贴板 (优先使用 Clipboard API)
    const clipboardAPI = navigator.clipboard && navigator.clipboard.writeText;

    if (clipboardAPI) {
      statusEl.innerText = "🔄 正在使用 API 复制...";
      navigator.clipboard
        .writeText(cleanText)
        .then(() => {
          statusEl.innerText = "✅ 文本已复制到剪贴板！(Clipboard API)";
        })
        .catch((err) => {
          // Clipboard API 失败，降级到 execCommand
          console.warn("Clipboard API 复制失败，尝试回退到 execCommand。", err);
          fallbackCopyTextToClipboard(cleanText, statusEl);
        });
    } else {
      // Clipboard API 不存在，直接降级到 execCommand
      statusEl.innerText = "🔄 正在使用 Fallback 复制...";
      fallbackCopyTextToClipboard(cleanText, statusEl);
    }
  }

  // --- UI 注入和初始化 ---
  (function initUI() {
    // 移除旧的拾取器清理接口（如果存在）
    if (window.__pickerCleanup) {
      window.__pickerCleanup();
    }

    // 创建主容器
    const container = document.createElement("div");
    container.id = "clipboardParserContainer";
    container.style.cssText = `
        position: fixed; 
        top: 10px; 
        left: 10px; 
        z-index: 1000000; 
        background: #f8f8f8; 
        border: 1px solid #ccc; 
        padding: 10px; 
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        max-width: 350px;
    `;

    container.innerHTML = `
      <h4 style="margin: 0 0 10px; font-size: 14px; color: #333;">DOM/文本解析器</h4>
      <textarea id="domParserTextarea" rows="10" placeholder="请在此粘贴 DOM 结构或大量文本..." style="width: 100%; box-sizing: border-box; margin-bottom: 8px;"></textarea>
      <button id="copyButton" style="width: 100%; padding: 8px; background: #007bff; color: white; border: none; cursor: pointer; border-radius: 4px;">解析并复制纯文本</button>
      <p id="parserStatus" style="margin: 8px 0 0; font-size: 12px; min-height: 14px; color: #555;">状态：等待输入...</p>
    `;

    document.body.appendChild(container);

    // 绑定事件
    document
      .getElementById("copyButton")
      .addEventListener("click", parseAndCopy);

    console.log("DOM/文本解析器已开启。");
  })();
}
