/**
 * 剪贴板捕获核心引擎
 *
 * 通过 chrome.scripting.executeScript({ files }) 注入，不支持 ES module。
 * 用全局变量 window.ClipboardCapture 暴露。
 *
 * 用法：
 *   const capture = ClipboardCapture.create(config);
 *   capture.installHooks();
 *   capture.autoCapture(turnRoot);
 */
(function() {
  if (window.ClipboardCapture) return;

  const DEFAULT_WINDOW_MS = 6000;

  function createClipboardCapture(config) {
    // ---------- state ----------
    let lastContext = null;
    let hooksInstalled = false;
    let onCapture = null;
    var _capturingIds = new Set(); // dedup: skip duplicate autoCapture for same message
    var _recentCaptureSignatures = new Map();

    function log(label, data) {
      if (config.debug !== false) {
        console.log('[' + config.name + ' Copy Capture] ' + label, data);
      }
    }

    // ==================== extract text ====================
    function extractTextFrom(root) {
      if (!(root instanceof Element)) return '';
      var skipTags = config.skipTags || new Set();
      var blockTags = new Set([
        'P','DIV','BR','LI','TR','PRE','BLOCKQUOTE','H1','H2','H3','H4','H5','H6'
      ]);
      var text = '';

      function visit(node) {
        if (node.nodeType === Node.TEXT_NODE) { text += node.textContent || ''; return; }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        var el = node;
        if (el.getAttribute('aria-hidden') === 'true' || skipTags.has(el.tagName)) return;
        if (el.tagName === 'A' || el.tagName === 'PRE' || el.tagName === 'CODE') {
          text += el.textContent || '';
          return;
        }
        if (el.tagName === 'BR') { text += '\n'; return; }
        var isBlock = blockTags.has(el.tagName);
        if (isBlock && text && !text.endsWith('\n')) text += '\n';
        for (var i = 0; i < el.childNodes.length; i++) visit(el.childNodes[i]);
        if (isBlock && !text.endsWith('\n')) text += '\n';
      }

      visit(root);
      return text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/ /g, ' ')
        .trim();
    }

    // ==================== capture guard (引用计数) ====================
    // 支持多个 autoCapture 并发：每个 autoCapture 调用 setCaptureActive(true) 增加计数，
    // 各自的 cleanup timeout 调用 setCaptureActive(false) 减少计数。
    // 仅当计数归零时才清除 DOM dataset flag，避免并发 autoCapture 相互覆盖。
    var _captureActive = false;
    var _guardCount = 0;

    function setCaptureActive(active) {
      if (active) {
        _guardCount++;
        _captureActive = true;
        document.documentElement.dataset.ccCaptureActive = '1';
      } else {
        _guardCount = Math.max(0, _guardCount - 1);
        if (_guardCount === 0) {
          _captureActive = false;
          delete document.documentElement.dataset.ccCaptureActive;
        }
      }
    }

    function resetState() {
      lastContext = null;
      onCapture = null;
      _capturingIds.clear();
      _recentCaptureSignatures.clear();
      _guardCount = 0;
      _captureActive = false;
      delete document.documentElement.dataset.ccCaptureActive;
      log('state.reset');
    }

    // ==================== hooks ====================
    function installHooks() {
      if (hooksInstalled) return;
      hooksInstalled = true;

      // 1. 注入主世界脚本（CSP-safe：chrome.runtime.getURL）
      if (!document.getElementById('__ccCaptureHookScript')) {
        var s = document.createElement('script');
        s.id = '__ccCaptureHookScript';
        s.src = chrome.runtime.getURL('contentScripts/clipboardCapture/mainWorldHook.js');
        document.documentElement.appendChild(s);
        s.remove();
      }

      // 2. 监听主世界发来的 postMessage
      window.addEventListener('message', function(e) {
        if (e.data && e.data.source === 'cc-capture-hook' && e.data.type === 'clipboard-data') {
          _capture(e.data.payload || {});
        }
      });

      // 3. DataTransfer.setData hook（prototype 共享，可直接 hook）
      var origSetData = window.DataTransfer && window.DataTransfer.prototype && window.DataTransfer.prototype.setData;
      if (typeof origSetData === 'function') {
        window.DataTransfer.prototype.setData = function(type, data) {
          if ((type === 'text/html' || type === 'text/plain') && _captureActive) {
            _capture({
              html: type === 'text/html' ? String(data || '') : null,
              text: type === 'text/plain' ? String(data || '') : null,
              source: 'dt.setData'
            });
          }
          return origSetData.call(this, type, data);
        };
      }

      log('hooks.installed');
    }

    // ==================== context ====================
    function openContext(turnElement, sourceTarget) {
      var conversationId = config.getConversationId();
      var messageId = config.getMessageId ? config.getMessageId(turnElement) : null;
      messageId = messageId || ('unknown-' + conversationId);
      lastContext = {
        turnElement: turnElement,
        conversationId: conversationId,
        messageId: messageId,
        sourceTarget: sourceTarget,
        openedAt: Date.now()
      };
      log('context.open', { conversationId: conversationId, messageId: messageId, sourceTarget: sourceTarget });
    }

    function getActiveContext() {
      if (!lastContext) return null;
      if (Date.now() - lastContext.openedAt > (config.contextWindowMs || DEFAULT_WINDOW_MS)) {
        lastContext = null;
        return null;
      }
      return lastContext;
    }

    // ==================== capture pipeline ====================
    function normalizeText(text) {
      return text.replace(/\r\n/g, '\n').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }

    function _normalize(payload) {
      var html = typeof payload.html === 'string' ? payload.html.trim() || null : null;
      var rawText = typeof payload.text === 'string' ? payload.text : null;
      var text = rawText && rawText.trim() ? normalizeText(rawText) : null;
      if (!html && !text) return null;

      var ctx = getActiveContext();
      return {
        platform: config.name,
        conversationId: ctx ? ctx.conversationId : config.getConversationId(),
        messageId: ctx ? ctx.messageId : null,
        html: html,
        text: text,
        htmlMissing: !html,
        source: payload.source || 'unknown',
        timestamp: Date.now()
      };
    }

    function _capture(payload) {
      var n = _normalize(payload);
      if (!n) return;
      var signature = [
        n.messageId || '',
        n.source || '',
        n.text || '',
        n.html || ''
      ].join('::');
      var lastTs = _recentCaptureSignatures.get(signature);
      if (lastTs && Date.now() - lastTs < 1500) {
        log('capture.skip', { reason: 'duplicate payload', messageId: n.messageId, source: n.source });
        return;
      }
      _recentCaptureSignatures.set(signature, Date.now());
      log('capture', n);
      if (typeof onCapture === 'function') {
        try {
          onCapture(n);
        } catch (err) {
          console.error('[' + config.name + ' Copy Capture] onCapture failed:', err);
        }
      }
      chrome.runtime.sendMessage({ action: config.action, data: n }).catch(function(err) {
        if (err && err.message && err.message.indexOf('Receiving end does not exist') === -1) {
          console.error('[' + config.name + ' Copy Capture] sendMessage failed:', err);
        }
      });
    }

    // ==================== DOM helpers ====================
    function getSearchRoot(turnRoot) {
      if (typeof config.getCopyBtnRoot === 'function') {
        var custom = config.getCopyBtnRoot(turnRoot);
        if (custom instanceof Element) return custom;
      }
      return turnRoot;
    }

    function findCopyBtn(turnRoot, options) {
      if (!(turnRoot instanceof Element)) return null;

      // 角色感知的复制按钮查找（由平台 config 按需实现）
      var role = options && options.role;
      if (role && typeof config.getCopyBtnForRole === 'function') {
        var roleBtn = config.getCopyBtnForRole(turnRoot, role);
        if (roleBtn) return roleBtn;
      }

      var root = getSearchRoot(turnRoot);
      var selectors = config.copyBtnSelectors;
      for (var i = 0; i < selectors.length; i++) {
        if (config.copyBtnFindLast) {
          // Notion AI 等平台在同一个 turn 容器内有多个相同 aria-label 的复制按钮，
          // querySelector 总是返回第一个（最早的消息），取最后一个匹配最新消息。
          var all = root.querySelectorAll(selectors[i]);
          if (all.length > 0) return all[all.length - 1];
        } else {
          var btn = root.querySelector(selectors[i]);
          if (btn) return btn;
        }
      }
      return null;
    }

    function getContentRoot(turnRoot) {
      if (!(turnRoot instanceof Element)) return null;
      return config.getContentRoot ? config.getContentRoot(turnRoot) : turnRoot;
    }

    function deriveHtmlFallback(turnRoot) {
      var root = getContentRoot(turnRoot);
      return root instanceof Element ? root.innerHTML : null;
    }

    function deriveTextFallback(turnRoot) {
      var root = getContentRoot(turnRoot);
      return root ? extractTextFrom(root) : null;
    }

    // ==================== auto capture ====================

    // 事件驱动等待复制按钮出现（MutationObserver），代替固定间隔轮询。
    // 按钮一旦渲染到 DOM 立即触发回调，零延迟、零浪费。
    function waitForCopyBtn(turnRoot, callback, timeoutMs, options) {
      // 先同步查一次——可能按钮已经渲染好了
      var btn = findCopyBtn(turnRoot, options);
      if (btn) { callback(btn); return; }

      // 事件驱动：监听 DOM 变化，按钮一出现就触发
      var root = getSearchRoot(turnRoot);
      if (!(root instanceof Element)) return;

      var observer = new MutationObserver(function() {
        var found = findCopyBtn(turnRoot, options);
        if (found) {
          observer.disconnect();
          callback(found);
        }
      });
      observer.observe(root, { childList: true, subtree: true });

      // 安全网：超时后放弃，防止 observer 常驻泄漏
      if (timeoutMs > 0) {
        setTimeout(function() { observer.disconnect(); }, timeoutMs);
      }
    }

    // 直接从 content script 世界 dispatch click，不再依赖主世界脚本重新查找元素。
    // React 事件委托会在 document root 捕获冒泡事件，页面 handler 调用 clipboard.write，
    // 主世界 hook 拦截并 postMessage 回传数据。
    // 避免因 React 重渲染导致 DOM 节点被替换，标记失效的问题。
    function triggerDirectCopy(btn) {
      if (!(btn instanceof Element)) return;
      log('triggerDirectCopy', { tag: btn.tagName, label: btn.getAttribute('aria-label') });

      // Gemini: btn.click() avoids Angular BardChatUi "No ID or name found" error
      if (window.location.hostname.indexOf('gemini.google.com') !== -1) {
        btn.focus();
        btn.click();
        return;
      }

      var target = btn;
      var child = target;
      while (child.firstElementChild) {
        var next = child.firstElementChild;
        if (next.tagName && next.tagName.toLowerCase() === 'svg') break;
        child = next;
      }
      target = child;
      if (target === btn) {
        var leaf = btn.querySelector('span, i, svg, img, button, a, [class*="icon"], [onclick]');
        if (leaf) target = leaf;
      }

      target.focus();
      var rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        target = btn;
        rect = btn.getBoundingClientRect();
        target.focus();
      }

      var x = rect.left + rect.width / 2;
      var y = rect.top + rect.height / 2;
      target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    }

    // fallback：通过 postMessage 通知主世界脚本查找并点击按钮
    // 适用于 click dispatch 被 isTrusted 检查拦截的平台
    function triggerMarkerCopy(btn) {
      var markerId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      btn.setAttribute('data-cc-marker', markerId);
      window.postMessage({
        source: 'cc-capture-hook',
        type: 'trigger-copy',
        selector: '[data-cc-marker="' + markerId + '"]',
        markerId: markerId
      }, '*');
    }

    function autoCapture(turnRoot, options) {
      // 规范化 options
      options = options || {};

      // Dedup: 防止同一个 turn 被多次 autoCapture
      // 场景：simulateCopy 触发 DOM 变化 → MutationObserver → handleResponseUpdate → autoCapture 循环
      var dedupId = null;
      if (turnRoot instanceof Element) {
        if (config.getMessageId) {
          dedupId = config.getMessageId(turnRoot);
        }
        if (!dedupId && turnRoot.dataset && turnRoot.dataset.testid) {
          dedupId = turnRoot.dataset.testid;
        }
      }
      if (dedupId && _capturingIds.has(dedupId)) {
        log('autoCapture.skip', { reason: 'already capturing', messageId: dedupId });
        return;
      }
      if (dedupId) {
        _capturingIds.add(dedupId);
      }

      openContext(turnRoot, null);

      // Enable capture guard: only our programmatic clicks will be intercepted
      // 使用引用计数确保即使多个 autoCapture 并发也不互相干扰
      setCaptureActive(true);

      // Observer 安全网超时（4500ms）+ 缓冲后清理 dedup 和 capture guard
      // ⚠️ 始终调度清理（无论 dedupId 是否为空），防止 guard 永久锁定
      setTimeout(function() {
        if (dedupId) _capturingIds.delete(dedupId);
        setCaptureActive(false);
      }, 5000);

      // 确保 turn 有 data-testid（用于调试识别和 triggerMarkerCopy 兜底）
      var turnEl = (turnRoot.closest && turnRoot.closest('[data-testid^="conversation-turn-"]')) || turnRoot;
      var turnTestId = turnEl.getAttribute('data-testid');
      if (!turnTestId) {
        turnTestId = dedupId && typeof dedupId === 'string' ? dedupId : ('cc-turn-' + Date.now());
        turnEl.setAttribute('data-testid', turnTestId);
      }

      // 事件驱动等待复制按钮出现（Observer），不再固定间隔轮询
      waitForCopyBtn(turnRoot, function(btn) {
        log('autoCopy.triggerSent', { hasBtn: true, role: options.role });
        triggerDirectCopy(btn);
      }, 4500, options); // 略小于 dedup 超时（5000ms），避免 capture guard 先于检索清理

      // DOM 兜底（Angular 虚拟滚动平台内容不在 DOM 中，通过 skipDomFallback 跳过）
      if (!config.skipDomFallback) {
        var html = deriveHtmlFallback(turnRoot);
        var text = deriveTextFallback(turnRoot);
        if (html) {
          _capture({ html: html, text: text || null, source: 'dom.auto' });
        } else {
          log('autoCopy.skip', { reason: 'dom html fallback missing' });
        }
      } else {
        log('autoCopy.skip', { reason: 'skipDomFallback enabled' });
      }

      // 不立即清除 lastContext，让 contextWindowMs 超时机制自动清理，
      // 确保异步到达的 clipboard write 数据能获取到正确的 messageId
    }

    // ==================== public API ====================
    return {
      installHooks: installHooks,
      autoCapture: autoCapture,
      openContext: openContext,
      reset: resetState,
      setOnCapture: function(handler) { onCapture = typeof handler === 'function' ? handler : null; },
      _capture: _capture,
    };
  }

  window.ClipboardCapture = { create: createClipboardCapture };
})();
