/**
 * Xiaomi (小米 MiMo AI Studio) 平台内容脚本
 *
 * 平台特征（https://aistudio.xiaomimimo.com/#/c）：
 * - React + Tailwind CSS 单页应用（hash 路由，#root 挂载点）
 * - 输入框：普通 <textarea>，placeholder="有问题，尽管问，Shift + Enter 换行"
 * - 发送按钮：<button data-track-id="home_send_btn" data-track-name="home_send_message">
 *   禁用态通过原生 disabled 属性控制（disabled="disabled"）
 *
 * 关键适配点：
 * 1. textarea 是 React 受控组件 → 用 nativeSetter 写入 value，否则 React 状态不更新、
 *    发送按钮不会启用。
 * 2. 发送按钮的 className 始终包含 Tailwind 的 disabled:opacity-40 / disabled:cursor-not-allowed
 *    变体类（无论启用/禁用），因此不能像模板那样用 className.includes('disabled') 判断状态，
 *    必须只读原生 disabled 属性。
 */

// 防止重复注入
if (window.xiaomiInjected) {
  console.log("[Xiaomi] 脚本已注入，跳过重复初始化");
} else {
  window.xiaomiInjected = true;

  // ==========================================================
  //                     平台配置参数
  // ==========================================================

  const PLATFORM_CONFIG = {
    name: 'Xiaomi',
    hostname: 'aistudio.xiaomimimo.com',
    clickMode: 'click',
    // React 受控 textarea：直接 element.value=x 不会触发 onChange，
    // 必须用原生 setter 走 value tracker，再 dispatch input 事件。
    inputMode: 'nativeSetter',
    contenteditableInputMode: 'auto',
    needActivateInput: true,
    activateDelay: 100,
    inputDelay: 150,
    clickDelay: 200,
    elementTimeout: 5000,
    retryInterval: 100,
    verboseLogging: true,
    enableSmartDiscovery: true,
    // React 异步处理输入后才会启用发送按钮，需要轮询等待。
    buttonEnableRetry: {
      enabled: true,
      maxRetries: 10,
      retryInterval: 250,
    },
  };

  // ==========================================================
  //                     选择器配置
  // ==========================================================

  const INPUT_SELECTORS = [
    // 主选择器：placeholder 含「尽管问」（首页输入框唯一特征）
    { type: 'css', value: 'textarea[placeholder*="尽管问"]' },
    { type: 'css', value: 'textarea[placeholder*="换行"]' },
    { type: 'css', value: 'textarea[placeholder*="问题"]' },
    // 兜底：任意可编辑 textarea
    { type: 'css', value: 'textarea:not([readonly]):not([disabled])' },
  ];

  const BUTTON_SELECTORS = [
    // 主选择器：埋点属性 data-track-id / data-track-name（稳定）
    { type: 'css', value: 'button[data-track-id="home_send_btn"]' },
    { type: 'css', value: 'button[data-track-name="home_send_message"]' },
    // 兼容对话页可能改用 chat_send_btn 等命名
    { type: 'css', value: 'button[data-track-id$="send_btn"]' },
    { type: 'css', value: 'button[data-track-name$="send_message"]' },
    { type: 'xpath', value: '//button[@data-track-id="home_send_btn"]' },
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

  // ==========================================================
  //                     智能元素发现（兜底机制）
  // ==========================================================

  function findInputElementIntelligently() {
    logInfo("选择器失败，启动兜底机制查找输入元素...");
    const selectors = [
      'textarea:not([readonly]):not([disabled])',
      '[contenteditable="true"]:not([readonly])',
      'input[type="text"]:not([readonly]):not([disabled])',
      'input[type="search"]:not([readonly]):not([disabled])',
      'input:not([type]):not([readonly]):not([disabled])',
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
      'button[type="submit"]:not([disabled])',
      'button[aria-label*="send" i], button[aria-label*="submit" i], button[aria-label*="发送" i]',
      'button:not([disabled])',
      '[role="button"]:not([aria-disabled="true"])',
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

  function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
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

  /**
   * 设置输入值（React 受控 textarea 专用：nativeSetter）
   * 直接 element.value=x 会被 React 的 value tracker 忽略，onChange 不触发，
   * 发送按钮因此不会启用。nativeSetter 走原生 setter写入，配合 input 事件即可。
   */
  async function setInputValue(element, value) {
    if (!element) {
      logWarning("输入元素不存在");
      return false;
    }
    try {
      const trimmedValue = value.trim();
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(element, trimmedValue);
      } else {
        element.value = trimmedValue;
      }
      logInfo("输入值已设置（nativeSetter）");
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

  // ==========================================================
  //                     点击工具
  // ==========================================================

  function triggerClick(element) {
    if (!element) {
      logWarning("点击元素不存在");
      return false;
    }
    if (element.offsetParent === null && window.getComputedStyle(element).display !== 'contents') {
      logWarning("元素不可见，无法点击");
      return false;
    }
    // 小米发送按钮用原生 disabled 属性控制状态
    if (element.disabled) {
      logWarning("元素已禁用，无法点击");
      return false;
    }
    const ariaDisabled = element.getAttribute('aria-disabled');
    if (ariaDisabled === 'true') {
      logWarning("元素 aria-disabled，无法点击");
      return false;
    }

    try {
      element.focus();
      const rect = element.getBoundingClientRect();
      const clickX = rect.left + rect.width / 2;
      const clickY = rect.top + rect.height / 2;
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

  /**
   * 等待发送按钮启用（React 异步状态更新）
   *
   * ⚠️ 与模板不同：不能检查 className.includes('disabled')。
   * 小米按钮 className 始终含 Tailwind 的 disabled:opacity-40 / disabled:cursor-not-allowed
   * 变体类（这些类名在启用时也存在），只读 className 会永远判定为禁用。
   * 这里只检查原生 disabled 属性 + aria-disabled。
   */
  async function waitForButtonEnabled(buttonElement, inputElement, message) {
    const { maxRetries, retryInterval } = PLATFORM_CONFIG.buttonEnableRetry;

    const checkButtonEnabled = () => {
      if (buttonElement.disabled) return false;
      if (buttonElement.getAttribute('aria-disabled') === 'true') return false;
      return true;
    };

    if (checkButtonEnabled()) {
      logInfo("发送按钮已启用");
      return true;
    }

    for (let i = 0; i < maxRetries; i++) {
      logWarning(`发送按钮仍处于禁用状态，等待启用... (${i + 1}/${maxRetries})`);

      // 重新触发 input 事件，推动 React 更新状态以启用按钮
      inputElement.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: message,
      }));

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
  const MANUAL_BUTTON_SELECTORS = BUTTON_SELECTORS
    .filter((selector) => selector.type === 'css')
    .map((selector) => selector.value);

  function recycleResponseListener(reason) {
    const listener = window.__responseListenerInstances && window.__responseListenerInstances.xiaomi;
    if (!listener || typeof listener.reset !== "function") return;
    logInfo(`Xiaomi 手动发送，回收回复监听: ${reason}`);
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

      logInfo("正在查找发送按钮...");
      const buttonElement = await waitForElement(BUTTON_SELECTORS, PLATFORM_CONFIG.elementTimeout, 'button');
      if (!buttonElement) {
        logError("未找到发送按钮");
        return false;
      }

      if (PLATFORM_CONFIG.buttonEnableRetry.enabled) {
        const buttonReady = await waitForButtonEnabled(buttonElement, inputElement, message.trim());
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

    if (!window.__xiaomiManualRecycleBound) {
      window.__xiaomiManualRecycleBound = true;

      // 用户手动点击发送按钮 → 重置回复监听，确保捕获新回复
      document.addEventListener("click", (event) => {
        if (isSending) return;
        if (isCaptureClickInProgress()) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (matchesAnySelector(target, MANUAL_BUTTON_SELECTORS)) {
          recycleResponseListener('button-click');
        }
      }, true);

      // 用户手动按 Enter 发送 → 同上
      document.addEventListener("keydown", (event) => {
        if (isSending) return;
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const isInputTarget = target instanceof HTMLTextAreaElement || target.isContentEditable;
        if (!isInputTarget) return;
        if (matchesAnySelector(target, MANUAL_INPUT_SELECTORS)) {
          recycleResponseListener('enter-key');
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
    window.__xiaomiScript = {
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
      waitForButtonEnabled,
    };
    logInfo("调试工具已暴露到 window.__xiaomiScript");
  }
}
