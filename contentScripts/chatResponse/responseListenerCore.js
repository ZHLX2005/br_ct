/**
 * 响应监听核心引擎
 *
 * 通过 chrome.scripting.executeScript 注入，不支持 ES module。
 * 使用全局变量 window.ResponseListenerCore 暴露。
 *
 * 用法：
 *   const listener = ResponseListenerCore.createResponseListener({
 *     platform: 'chatgpt',
 *     responseSelectors: [...],
 *     ...
 *   });
 */
(function() {
  if (window.ResponseListenerCore) return;
  window.__responseListenerInstances = window.__responseListenerInstances || {};

  function createResponseListener(config) {
    const {
      platform,
      responseSelectors,
      skipTags = new Set(),
      minUpdateInterval = 100,
      captureConfig,
      getConversationId,
      getMessageId,
      isGenerating,
      settleTimeMs = 0,
    } = config;

    // ==================== 常量 ====================

    const ConversationMode = { INITIAL: 'initial', LIVE: 'live' };
    const MessagePhase = { PENDING: 'pending', SETTLING: 'settling', CAPTURED: 'captured' };
    const MODE_LIVE_DELAY_MS = 1200; // 新对话创建多久后从 INITIAL → LIVE

    // ==================== 状态管理 ====================

    let observer = null;
    let initialCheckTimeout = null;
    let pendingUpdateTimeout = null;
    let isMonitoring = false;
    let startupBaseline = null;
    const conversationStateById = new Map();
    var _lastTrackedConversation = null;
    var _convSwitchTimers = {}; // conversationId → setTimeout, for SPA flip

    // ==================== 工具函数 ====================

    function extractTextContent(element, options) {
      const st = (options && options.skipTags) || new Set();
      const blockTags = new Set([
        'P', 'DIV', 'BR', 'LI', 'TR', 'PRE', 'BLOCKQUOTE',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
      ]);
      var text = '';

      if (!element) return '';

      function visit(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || '';
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        var el = node;
        if (el.getAttribute('aria-hidden') === 'true' || st.has(el.tagName)) return;

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

      visit(element);

      return text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/ /g, ' ')
        .trim();
    }

    function normalizeText(text) {
      return text
        .replace(/\r\n/g, '\n')
        .replace(/ /g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function getConversationState(conversationId) {
      var key = conversationId || '__default__';
      if (!conversationStateById.has(key)) {
        conversationStateById.set(key, {
          mode: ConversationMode.INITIAL,
          _firstSeen: Date.now(),
          lastUpdateTime: 0,
          processedMessageKeys: new Set(),
          lastSnapshotByMessageId: new Map(),
          // Phase state machine per message
          messages: new Map(), // messageKey → { phase, content, lastSnapshot, role, settleTimer }
        });
      }
      return conversationStateById.get(key);
    }

    function getMessageTracker(state, messageKey, container) {
      if (!state.messages.has(messageKey)) {
        state.messages.set(messageKey, {
          phase: MessagePhase.PENDING,
          content: '',
          lastSnapshot: '',
          role: container ? getMessageRole(container) : null,
          settleTimer: null,
        });
      }
      return state.messages.get(messageKey);
    }

    function getMessageRole(container) {
      if (typeof config.getRole === 'function') return config.getRole(container);
      return null;
    }

    function getMessageKey(conversationId, messageId) {
      return (conversationId || '__default__') + '::' + (messageId || 'unknown');
    }

    function captureStartupBaseline() {
      var conversationId = getConversationId();
      var container = getLatestResponseContainer();
      if (!container) {
        startupBaseline = null;
        return;
      }

      var msgId = getMessageId ? getMessageId(container) : null;
      var stableMessageId = msgId || ('unknown-' + conversationId);
      var content = normalizeText(readResponseContent(container));
      if (!content) {
        startupBaseline = null;
        return;
      }

      var generating = isGenerating ? isGenerating() : false;
      startupBaseline = {
        conversationId: conversationId,
        messageKey: getMessageKey(conversationId, stableMessageId),
        snapshot: content + '::' + (generating ? '1' : '0'),
      };
    }

    // ==================== 获取容器 & 内容 ====================

    function getLatestResponseContainer() {
      for (var i = 0; i < responseSelectors.length; i++) {
        var containers = document.querySelectorAll(responseSelectors[i]);
        if (containers.length > 0) {
          return containers[containers.length - 1];
        }
      }
      return null;
    }

    function readResponseContent(container) {
      if (!container) return '';

      var contentRoot =
        container.querySelector('[data-message-content]') ||
        container.querySelector('.markdown') ||
        container.querySelector('.prose') ||
        container;

      return extractTextContent(contentRoot, { skipTags: skipTags });
    }

    // ==================== 发送消息 ====================

    function sendResponseToSidebar(content, messageId, isComplete, conversationId) {
      if (isComplete === undefined) isComplete = false;
      if (conversationId === undefined) conversationId = getConversationId();

      var payload = {
        action: platform + 'Response',
        data: {
          platform: platform,
          conversationId: conversationId,
          role: 'assistant',
          content: content,
          messageId: messageId,
          isComplete: !!isComplete,
          timestamp: Date.now()
        }
      };

      chrome.runtime.sendMessage(payload).catch(function(err) {
        var msg = String((err && err.message) || err || '');
        if (msg.indexOf('Extension context invalidated') !== -1) {
          stopMonitoring();
          return;
        }
        if (msg.indexOf('Receiving end does not exist') === -1) {
          console.error('[' + platform + ' Response Listener] sendMessage failed:', err);
        }
      });
    }

    function scheduleResponseUpdate() {
      if (pendingUpdateTimeout !== null) return;
      pendingUpdateTimeout = window.setTimeout(function() {
        pendingUpdateTimeout = null;
        handleResponseUpdate();
      }, 50);
    }

    // ==================== 核心处理逻辑 ====================

    function handleResponseUpdate() {
      var conversationId = getConversationId();
      var state = getConversationState(conversationId);
      var now = Date.now();

      // ── 自动翻转 INITIAL → LIVE（覆盖 SPA 切对话场景） ──
      if (state.mode === ConversationMode.INITIAL && state._firstSeen) {
        if (now - state._firstSeen >= MODE_LIVE_DELAY_MS) {
          state.mode = ConversationMode.LIVE;
        }
      }

      if (now - state.lastUpdateTime < minUpdateInterval) return;

      var container = getLatestResponseContainer();
      if (!container) return;

      var msgId = getMessageId ? getMessageId(container) : null;
      var stableMessageId = msgId || ('unknown-' + conversationId);
      var messageKey = getMessageKey(conversationId, stableMessageId);

      var tracker = getMessageTracker(state, messageKey, container);

      var content = normalizeText(readResponseContent(container));
      if (!content) return;

      var generating = isGenerating ? isGenerating() : false;
      var snapshot = content + '::' + (generating ? '1' : '0');

      if (
        startupBaseline &&
        startupBaseline.conversationId === conversationId &&
        startupBaseline.messageKey === messageKey &&
        startupBaseline.snapshot === snapshot
      ) {
        tracker.lastSnapshot = snapshot;
        tracker.content = content;
        state.lastUpdateTime = now;
        return;
      }

      if (tracker.lastSnapshot === snapshot) return;
      tracker.lastSnapshot = snapshot;

      sendResponseToSidebar(content, stableMessageId, !generating, conversationId);

      // ── INITIAL：仅同步侧边栏，不 autoCapture ──
      if (state.mode === ConversationMode.INITIAL) {
        tracker.content = content;
        state.lastUpdateTime = now;
        return;
      }

      // ── LIVE：Phase 状态机 ──
      switch (tracker.phase) {
        case MessagePhase.PENDING:
          if (!generating) {
            enterSettling(state, tracker, container);
          }
          break;

        case MessagePhase.SETTLING:
          if (content !== tracker.content) {
            // 内容在 settle 期间变化 → 重新计时
            tracker.content = content;
            enterSettling(state, tracker, container);
          }
          break;

        case MessagePhase.CAPTURED:
          if (content !== tracker.content) {
            // 内容变化（regenerate/编辑）→ 重新进入 PENDING
            tracker.phase = MessagePhase.PENDING;
            tracker.content = content;
            if (!generating) {
              enterSettling(state, tracker, container);
            }
          }
          break;
      }

      tracker.content = content;
      state.lastUpdateTime = now;
    }

    function findTurnRootFromContainer(container) {
      if (!(container instanceof Element)) return null;
      // 优先使用平台专用的 turnSelectors（定位包含操作栏的完整 turn 容器）
      var turnSelectors = config.turnSelectors || config.responseSelectors;
      for (var i = 0; i < turnSelectors.length; i++) {
        var turn = container.closest(turnSelectors[i]);
        if (turn) return turn;
      }
      return container;
    }

    // ==================== 剪贴板捕获 ====================

    var _captureInstance = null;

    function tryGetCapture() {
      if (!captureConfig) return null;
      if (_captureInstance) return _captureInstance;
      var name = typeof captureConfig === 'string' ? captureConfig : null;
      if (!name) return null;
      var cfg = window[name];
      if (!cfg || !window.ClipboardCapture) return null;
      _captureInstance = window.ClipboardCapture.create(cfg);
      return _captureInstance;
    }

    function watchCaptureCompletion(capture, stableMessageId) {
      if (!capture || typeof capture.setOnCapture !== 'function') return;
      capture.setOnCapture(function(payload) {
        if (!payload) return;
        if (payload.source === 'dom.auto') return;
        if (payload.messageId !== stableMessageId) return;
        capture.setOnCapture(null);
        resetListener();
      });
    }

    // ==================== 内容稳定后捕获（per-tracker） ====================

    function clearSettleTimer(tracker) {
      if (tracker && tracker.settleTimer !== null) {
        clearTimeout(tracker.settleTimer);
        tracker.settleTimer = null;
      }
    }

    function resetCaptureState() {
      if (_captureInstance && typeof _captureInstance.reset === 'function') {
        _captureInstance.reset();
      }
    }

    function resetConversationState() {
      conversationStateById.forEach(function(state) {
        state.messages.forEach(function(tracker) {
          clearSettleTimer(tracker);
        });
      });
      conversationStateById.clear();
      _lastTrackedConversation = null;
      startupBaseline = null;
    }

    function enterSettling(state, tracker, container) {
      clearSettleTimer(tracker);
      tracker.phase = MessagePhase.SETTLING;
      tracker.settleTimer = setTimeout(function() {
        tracker.settleTimer = null;
        tracker.phase = MessagePhase.CAPTURED;

        var capture = tryGetCapture();
        if (!capture) return;
        var turnRoot = findTurnRootFromContainer(container);
        if (turnRoot) {
          watchCaptureCompletion(capture, getMessageId(turnRoot) || getMessageId(container) || ('unknown-' + getConversationId()));
          capture.autoCapture(turnRoot, { role: tracker.role });
        }
      }, settleTimeMs || 0);
    }

    // ==================== MutationObserver ====================

    function ensureConversationLive(conversationId) {
      // 确保新对话在 stabilization 后翻转 to LIVE
      // 覆盖 SPA 切对话场景（无页面加载，无 startMonitoring 的 500ms 检查）
      if (_convSwitchTimers[conversationId]) return;
      var state = getConversationState(conversationId);
      if (state.mode !== ConversationMode.INITIAL) return;
      _convSwitchTimers[conversationId] = setTimeout(function() {
        delete _convSwitchTimers[conversationId];
        var s = getConversationState(conversationId);
        if (s && s.mode === ConversationMode.INITIAL) {
          s.mode = ConversationMode.LIVE;
          scheduleResponseUpdate();
        }
      }, MODE_LIVE_DELAY_MS);
    }

    function handleMutations(mutations) {
      // 检测 SPA 对话切换
      var convId = getConversationId();
      if (convId !== _lastTrackedConversation) {
        _lastTrackedConversation = convId;
        ensureConversationLive(convId);
      }

      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          scheduleResponseUpdate();
          break;
        }
      }
    }

    // ==================== 启动 / 停止 ====================

    function startMonitoring() {
      if (isMonitoring) {
        console.log('【回复监听】' + platform + ' 已在运行中');
        return;
      }

      if (!document.body) {
        initialCheckTimeout = window.setTimeout(function() {
          initialCheckTimeout = null;
          startMonitoring();
        }, 100);
        return;
      }

      console.log('【回复监听】' + platform + ' 启动监听');
      captureStartupBaseline();

      var capture = tryGetCapture();
      if (capture) {
        capture.installHooks();
      }

      observer = new MutationObserver(handleMutations);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      isMonitoring = true;

      // 初始 500ms 检查：同步侧边栏，不 autoCapture（mode === INITIAL）
      initialCheckTimeout = window.setTimeout(function() {
        initialCheckTimeout = null;
        scheduleResponseUpdate();

        // 翻转 INITIAL → LIVE：后续 observer 触发的 autoCapture 正常执行
        var state = getConversationState(getConversationId());
        if (state.mode === ConversationMode.INITIAL) {
          state.mode = ConversationMode.LIVE;
        }
      }, 500);
    }

    function stopMonitoring() {
      console.log('【回复监听】' + platform + ' 停止监听');
      if (initialCheckTimeout !== null) {
        window.clearTimeout(initialCheckTimeout);
        initialCheckTimeout = null;
      }
      if (pendingUpdateTimeout !== null) {
        window.clearTimeout(pendingUpdateTimeout);
        pendingUpdateTimeout = null;
      }
      // 清理所有 SPA 对话切换计时器
      Object.keys(_convSwitchTimers).forEach(function(k) {
        clearTimeout(_convSwitchTimers[k]);
      });
      _convSwitchTimers = {};
      // 清理所有 message settle 计时器
      conversationStateById.forEach(function(state) {
        state.messages.forEach(function(tracker) {
          clearSettleTimer(tracker);
        });
      });
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      isMonitoring = false;
      startupBaseline = null;
      console.log('【回复监听】' + platform + ' 已停止');
    }

    function resetListener() {
      stopMonitoring();
      resetConversationState();
      resetCaptureState();
      console.log('【回复监听】' + platform + ' 已重置');
    }

    window.addEventListener('pagehide', stopMonitoring, { once: true });

    // ==================== 手动启动（等待 background 发消息） ====================
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "startResponseListener") {
        startMonitoring();
        sendResponse({ status: "started" });
      }
      if (request.action === "stopResponseListener") {
        stopMonitoring();
        sendResponse({ status: "stopped" });
      }
      if (request.action === "resetResponseListener") {
        resetListener();
        sendResponse({ status: "reset" });
      }
    });

    return {
      startMonitoring: startMonitoring,
      stopMonitoring: stopMonitoring,
      reset: resetListener
    };
  }

  window.ResponseListenerCore = {
    createResponseListener: function(config) {
      var instance = createResponseListener(config);
      if (config && config.platform) {
        window.__responseListenerInstances[config.platform] = instance;
      }
      return instance;
    }
  };
})();
