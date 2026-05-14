/**
 * Zai 剪贴板捕获配置
 * 通过 chrome.scripting.executeScript 注入，不使用 ES module。
 *
 * 已验证：2026-05-10，可跳过登录直接使用对话。
 *
 * DOM 结构特征：
 * - SvelteKit + Tailwind CSS，运行时 svelte-xxx 类名
 * - Turn 容器: div.group（含 user-message 和 message-{uuid} 子元素）
 * - 用户消息: .user-message > .chat-user.markdown-prose
 * - AI 回复: .message-{uuid} > .chat-assistant.markdown-prose
 * - Markdown 使用 .markdown-prose（非 .markdown-body）
 * - 复制按钮: div[aria-label="复制"] > button（中文 aria-label）
 * - 复制按钮仅 hover 可见
 */
(function() {
  if (window.zaiCaptureConfig) return;

  window.zaiCaptureConfig = {
    name: 'zai',
    action: 'zaiCopyCapture',

    copyBtnPrimarySelector: 'div[aria-label="复制"] button',
    copyBtnSelectors: [
      'div[aria-label="复制"] button',
      '[aria-label="复制"]',
      'button[aria-label*="copy" i]',
    ],

    getContentRoot: function(turnRoot) {
      var el = turnRoot.querySelector('.chat-assistant.markdown-prose') ||
               turnRoot.querySelector('.chat-user.markdown-prose') ||
               turnRoot.querySelector('.markdown-prose');
      if (el) return el;
      return turnRoot;
    },

    getConversationId: function() {
      try {
        var parts = window.location.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '__default__';
      } catch(e) {}
      return '__default__';
    },

    getMessageId: function(element) {
      if (!element) return null;
      if (!element.dataset.testid) {
        var turns = document.querySelectorAll('.group');
        var index = Array.prototype.indexOf.call(turns, element);
        element.dataset.testid = 'zai-turn-' + (index >= 0 ? index + 1 : 'unknown');
      }
      return element.dataset.testid;
    },

    detectTurn: function(target) {
      if (!(target instanceof Element)) return null;
      // Zai 使用 div.group 作为 turn 容器（含 .user-message 和 .message-*）
      return target.closest('.group');
    },

    isCopyControl: function(element) {
      if (!(element instanceof Element)) return false;
      var aria = element.getAttribute('aria-label') || '';
      if (/copy|复制/i.test(aria)) return true;
      var label = [
        element.getAttribute('title'),
        element.textContent,
      ].filter(Boolean).join(' ').toLowerCase();
      return /copy|复制/.test(label);
    },

    skipTags: new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'PATH']),
    skipDomFallback: true,
    contextWindowMs: 2500,
    debug: true,
  };
})();
