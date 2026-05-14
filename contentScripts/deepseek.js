/**
 * DeepSeek 平台内容脚本
 *
 * 平台特性：
 * - 使用普通 textarea 输入框
 * - 发送按钮需要先聚焦输入框才能点击
 */

// 防止重复注入
if (window.deepseekInjected) {
  console.log("[DeepSeek] 脚本已注入，跳过重复初始化");
} else {
  window.deepseekInjected = true;

  // ==========================================================
  //                     平台配置参数
  // ==========================================================

  const PLATFORM_CONFIG = {
    name: 'DeepSeek',
    hostname: 'chat.deepseek.com',
    clickMode: 'click',
    inputMode: 'value',
    contenteditableInputMode: 'auto',
    needActivateInput: true,
    activateDelay: 100,
    inputDelay: 100,
    clickDelay: 200,
    elementTimeout: 5000,
    retryInterval: 100,
    verboseLogging: true,
    enableSmartDiscovery: true,
    buttonEnableRetry: {
      enabled: true,
      maxRetries: 10,
      retryInterval: 300,
    },
  };

  // ==========================================================
  //                     选择器配置
  // ==========================================================

  const INPUT_SELECTORS = [
    { type: 'css', value: 'textarea._27c9245' },
    { type: 'css', value: 'textarea[name="search"]' },
    { type: 'css', value: 'textarea[placeholder*="DeepSeek"]' },
    { type: 'css', value: 'textarea[placeholder*="消息"]' },
  ];

  const BUTTON_SELECTORS = [
    // 这些选择器只在 findSendButton 中作为参考
    { type: 'css', value: 'div.ds-icon-button[role="button"][aria-disabled="false"]' },
  ];

  // ==========================================================
  //                     通用查找器
  // ==========================================================

  function findElementBySelectors(selectors) {
    for (const selector of selectors) {
      try {
        let element = null;
        switch (selector.type) {
          case 'id':
            element = document.getElementById(selector.value);
            break;
          case 'css':
            element = document.querySelector(selector.value);
            break;
          case 'xpath':
            const result = document.evaluate(
              selector.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            );
            element = result.singleNodeValue;
            break;
          default:
            logWarning(`未知的选择器类型: ${selector.type}`);
            continue;
        }
        if (element) {
          logInfo(`成功找到元素: ${selector.type} -> ${selector.value}`);
          return element;
        }
      } catch (e) {
        logWarning(`选择器无效: ${selector.type} -> ${selector.value}`, e);
      }
    }
    logWarning("所有选择器都未找到元素");
    return null;
  }

  async function waitForElement(selectors, timeout, elementType = 'input') {
    const startTime = Date.now();
    const endTime = startTime + timeout;
    let attemptCount = 0;
    const smartDiscovery = PLATFORM_CONFIG.enableSmartDiscovery;

    return new Promise((resolve) => {
      const checkElement = () => {
        attemptCount++;
        const element = findElementBySelectors(selectors);
        if (element) {
          logInfo(`元素在第 ${attemptCount} 次尝试中找到 (耗时: ${Date.now() - startTime}ms)`);
          resolve(element);
          return;
        }
        if (Date.now() >= endTime) {
          logWarning(`元素查找超时 (${timeout}ms)，共尝试 ${attemptCount} 次`);
          if (smartDiscovery) {
            logInfo("预定义选择器失败，启动兜底机制...");
            const fallbackElement = elementType === 'button'
              ? findButtonElementIntelligently()
              : findInputElementIntelligently();
            if (fallbackElement) {
              logInfo("兜底机制成功找到元素！");
              resolve(fallbackElement);
              return;
            }
          }
          resolve(null);
          return;
        }
        setTimeout(checkElement, PLATFORM_CONFIG.retryInterval);
      };
      checkElement();
    });
  }

  function findInputElementIntelligently() {
    logInfo("选择器失败，启动兜底机制查找输入元素...");
    const selectors = [
      'textarea:not([readonly]):not([disabled])',
      '[contenteditable="true"]:not([readonly])',
      'input[type="text"]:not([readonly]):not([disabled])',
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isElementVisible(element)) {
        logInfo(`兜底机制找到输入元素: ${selector}`);
        return element;
      }
    }
    logWarning("兜底机制未找到任何可输入元素");
    return null;
  }

  function findButtonElementIntelligently() {
    logInfo("选择器失败，启动兜底机制查找按钮元素...");
    const selectors = [
      'div.ds-icon-button[role="button"][aria-disabled="false"]',
      'div[role="button"][aria-disabled="false"]',
    ];
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (isElementVisible(element)) {
          logInfo(`兜底机制找到按钮元素: ${selector}`);
          return element;
        }
      }
    }
    logWarning("兜底机制未找到任何可点击按钮");
    return null;
  }

  /**
   * 在输入框附近查找发送按钮
   * DeepSeek 页面结构：
   *   公共父级
   *   ├── textarea（输入框）
   *   └── div（工具栏）
   *       ├── div[role="button"]（深度思考）
   *       ├── div[role="button"]（智能搜索）
   *       └── div.bf38813a（附件+发送区）
   *           ├── div.ds-icon-button（附件按钮）
   *           └── div[style="width: fit-content;"]
   *               └── div.ds-icon-button（发送按钮 ← 箭头上传图标）
   */
  function findSendButtonNearInput(inputElement) {
    if (!inputElement) return null;

    // 从输入框向上查找包含工具栏的公共容器
    let container = inputElement;
    for (let i = 0; i < 8; i++) {
      container = container.parentElement;
      if (!container) break;

      // 查找附件+发送区域容器
      const actionArea = container.querySelector('div.bf38813a');
      if (actionArea) {
        // 在此区域内找所有 ds-icon-button，最后一个就是发送按钮
        const buttons = actionArea.querySelectorAll('div.ds-icon-button[role="button"][aria-disabled="false"]');
        if (buttons.length > 0) {
          const sendBtn = buttons[buttons.length - 1];
          logInfo(`在输入框第 ${i + 1} 层父级的 bf38813a 容器中找到发送按钮（共 ${buttons.length} 个 icon-button，取最后一个）`);
          return sendBtn;
        }
      }

      // 兜底：直接查找 fit-content 容器内的按钮
      const fitContentBtn = container.querySelector('div[style*="fit-content"] div.ds-icon-button[role="button"][aria-disabled="false"]');
      if (fitContentBtn) {
        logInfo(`在输入框第 ${i + 1} 层父级中通过 fit-content 定位找到发送按钮`);
        return fitContentBtn;
      }
    }

    logWarning("未在输入框附近找到发送按钮");
    return null;
  }

  function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (!document.body.contains(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ==========================================================
  //                     输入工具
  // ==========================================================

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function activateInput(element) {
    if (!element) {
      logWarning("输入元素不存在，无法激活");
      return false;
    }
    try {
      element.click();
      element.focus();
      logInfo("输入框已激活");
      return true;
    } catch (e) {
      logError("激活输入框失败", e);
      return false;
    }
  }

  async function setInputValue(element, value) {
    if (!element) {
      logWarning("输入元素不存在");
      return false;
    }
    try {
      element.value = value.trim();
      logInfo("输入值已设置");
      return true;
    } catch (e) {
      logError("设置输入值失败", e);
      return false;
    }
  }

  function triggerInputEvents(element) {
    if (!element) return false;
    try {
      element.dispatchEvent(new Event('focus', { bubbles: true }));
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return true;
    } catch (e) {
      logError("触发输入事件失败", e);
      return false;
    }
  }

  function triggerClick(element) {
    if (!element) {
      logWarning("点击元素不存在");
      return false;
    }
    if (element.offsetParent === null && window.getComputedStyle(element).display !== 'contents') {
      logWarning("元素不可见，无法点击");
      return false;
    }

    // 检查 aria-disabled
    const ariaDisabled = element.getAttribute('aria-disabled');
    if (ariaDisabled === 'true') {
      logWarning("元素已禁用，无法点击");
      return false;
    }

    try {
      // 先尝试 focus
      element.focus();
      // 使用 MouseEvent 确保点击在可见区域内
      const rect = element.getBoundingClientRect();
      // 点击右下角四分之三的位置（避免边框）
      const clickX = rect.right - rect.width * 0.25;
      const clickY = rect.bottom - rect.height * 0.25;

      const mouseEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: clickX,
        clientY: clickY,
      });
      element.dispatchEvent(mouseEvent);
      logInfo("点击成功");
      return true;
    } catch (e) {
      logError("点击失败", e);
      return false;
    }
  }

  async function waitForButtonEnabled(buttonElement) {
    const { maxRetries, retryInterval } = PLATFORM_CONFIG.buttonEnableRetry;
    const checkButtonEnabled = () => {
      const ariaDisabled = buttonElement.getAttribute('aria-disabled');
      const buttonClass = buttonElement.className || '';
      const isDisabled = buttonElement.disabled ||
        buttonClass.includes('disabled') ||
        buttonClass.includes('Disabled') ||
        ariaDisabled === 'true';
      return !isDisabled;
    };
    if (checkButtonEnabled()) {
      logInfo("发送按钮已启用");
      return true;
    }
    for (let i = 0; i < maxRetries; i++) {
      logWarning(`发送按钮仍处于禁用状态，等待启用... (${i + 1}/${maxRetries})`);
      await delay(retryInterval);
      if (checkButtonEnabled()) {
        logInfo(`发送按钮在第 ${i + 1} 次重试后启用`);
        return true;
      }
    }
    logError(`发送按钮在 ${maxRetries} 次重试后仍处于禁用状态`);
    return false;
  }

  // ==========================================================
  //                     日志工具
  // ==========================================================

  function logInfo(message) {
    if (PLATFORM_CONFIG.verboseLogging) {
      console.log(`[${PLATFORM_CONFIG.name}] ${message}`);
    }
  }

  function logWarning(message, error) {
    console.warn(`[${PLATFORM_CONFIG.name}] ${message}`, error || '');
  }

  function logError(message, error) {
    console.error(`[${PLATFORM_CONFIG.name}] ${message}`, error || '');
  }

  // ==========================================================
  //                     主逻辑
  // ==========================================================

  let isSending = false;

  const MANUAL_INPUT_SELECTORS = INPUT_SELECTORS
    .filter((selector) => selector.type === 'css')
    .map((selector) => selector.value);
  function recycleResponseListener(reason) {
    const listener = window.__responseListenerInstances && window.__responseListenerInstances.deepseek;
    if (!listener || typeof listener.reset !== "function") return;
    logInfo(`DeepSeek 手动发送，回收回复监听: ${reason}`);
    listener.reset();
  }

  function matchesAnySelector(target, selectors) {
    return selectors.some((selector) => {
      try {
        return !!target.closest(selector);
      } catch (e) {
        return false;
      }
    });
  }

  function isCaptureClickInProgress() {
    return document.documentElement.dataset.ccCaptureActive === '1';
  }

  function isManualSendButtonClick(target) {
    if (!(target instanceof Element)) return false;
    const button = target.closest('div.ds-icon-button[role="button"]');
    if (!button) return false;
    const input = document.querySelector('textarea._27c9245');
    if (!(input instanceof Element)) return false;
    let container = input;
    for (let i = 0; i < 8; i++) {
      container = container.parentElement;
      if (!container) break;
      const actionArea = container.querySelector('div.bf38813a');
      if (!actionArea) continue;
      const buttons = actionArea.querySelectorAll('div.ds-icon-button[role="button"][aria-disabled="false"]');
      if (buttons.length > 0) return buttons[buttons.length - 1] === button;
    }
    return false;
  }

  async function sendChatMessage(message) {
    if (isSending) {
      logWarning("正在发送中，请勿重复操作");
      return false;
    }
    if (!message || typeof message !== 'string' || message.trim() === '') {
      logError("消息内容无效");
      return false;
    }

    isSending = true;
    logInfo(`开始发送流程，消息: "${message}"`);

    try {
      logInfo("正在查找输入框...");
      const inputElement = await waitForElement(INPUT_SELECTORS, PLATFORM_CONFIG.elementTimeout);
      if (!inputElement) {
        logError("未找到输入框，发送失败");
        return false;
      }

      if (PLATFORM_CONFIG.needActivateInput) {
        logInfo("正在激活输入框...");
        activateInput(inputElement);
        await delay(PLATFORM_CONFIG.activateDelay);
      }

      logInfo("正在设置输入值...");
      const inputResult = await setInputValue(inputElement, message);
      if (!inputResult) {
        logError("设置输入值失败");
        return false;
      }

      if (!triggerInputEvents(inputElement)) {
        logError("触发输入事件失败");
        return false;
      }

      await delay(PLATFORM_CONFIG.inputDelay);

      logInfo("正在查找发送按钮（在输入框附近）...");
      let buttonElement = findSendButtonNearInput(inputElement);

      if (!buttonElement) {
        logWarning("输入框附近未找到按钮，尝试全局查找...");
        buttonElement = await waitForElement(BUTTON_SELECTORS, PLATFORM_CONFIG.elementTimeout, 'button');
      }

      if (!buttonElement) {
        logError("未找到发送按钮");
        return false;
      }

      if (PLATFORM_CONFIG.buttonEnableRetry.enabled) {
        const buttonReady = await waitForButtonEnabled(buttonElement);
        if (!buttonReady) {
          logError("发送按钮未能启用");
          return false;
        }
      } else {
        await delay(PLATFORM_CONFIG.clickDelay);
      }

      logInfo("正在点击发送按钮...");
      if (triggerClick(buttonElement)) {
        logInfo("消息发送成功");
        return true;
      } else {
        logError("点击发送按钮失败");
        return false;
      }
    } catch (e) {
      logError("发送流程异常", e);
      return false;
    } finally {
      isSending = false;
      logInfo("发送流程结束，已解锁状态");
    }
  }

  // ==========================================================
  //                     消息监听 & 环境检查
  // ==========================================================

  if (!window.location.hostname.includes(PLATFORM_CONFIG.hostname)) {
    logWarning(`当前页面不是 ${PLATFORM_CONFIG.hostname}，脚本未激活`);
  } else {
    logInfo(`${PLATFORM_CONFIG.hostname} 内容脚本已加载并激活`);

    if (!window.__deepseekManualRecycleBound) {
      window.__deepseekManualRecycleBound = true;

      document.addEventListener("click", (event) => {
        if (isSending) return;
        if (isCaptureClickInProgress()) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (isManualSendButtonClick(target)) {
          recycleResponseListener("button-click");
        }
      }, true);

      document.addEventListener("keydown", (event) => {
        if (isSending) return;
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const isInputTarget = target instanceof HTMLTextAreaElement || target.isContentEditable;
        if (!isInputTarget) return;
        if (matchesAnySelector(target, MANUAL_INPUT_SELECTORS)) {
          recycleResponseListener("enter-key");
        }
      }, true);
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'sendMessage') {
        logInfo(`收到消息发送请求: "${request.message}"`);
        sendChatMessage(request.message)
          .then((success) => {
            sendResponse({
              status: success ? 'success' : 'failed',
              platform: PLATFORM_CONFIG.name,
              timestamp: Date.now(),
            });
            logInfo(`消息处理完成，状态: ${success ? 'success' : 'failed'}`);
          })
          .catch((error) => {
            logError("消息处理异常", error);
            sendResponse({
              status: 'error',
              platform: PLATFORM_CONFIG.name,
              error: error.message,
              timestamp: Date.now(),
            });
          });
        return true;
      }
      logWarning("收到未知的消息类型", request);
      sendResponse({ status: 'unknown_action' });
    });
  }

  // 暴露调试工具
  if (typeof window !== 'undefined') {
    window.__deepseekScript = {
      config: PLATFORM_CONFIG,
      sendChatMessage,
      findElementBySelectors,
      waitForElement,
      findInputElementIntelligently,
      findButtonElementIntelligently,
      isElementVisible,
      triggerClick,
      setInputValue,
      activateInput,
    };
    logInfo("调试工具已暴露到 window.__deepseekScript");
  }
}
