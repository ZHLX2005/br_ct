(function() {
if (window.__zaiScriptBootstrapInjected) {
  console.log("[Zai] 脚本已注入，跳过重复初始化");
  return;
}
window.__zaiScriptBootstrapInjected = true;

/**
 * @fileoverview
 * Zai AI 平台内容脚本
 *
 * 平台特征：
 * - 输入框：textarea#chat-input
 * - 发送按钮：button#send-message-button
 * - 使用 Tailwind CSS 样式
 * - 普通点击模式即可
 */

// ==========================================================
//                     平台配置参数
// ==========================================================

const PLATFORM_CONFIG = {
  name: 'Zai',
  hostname: 'chat.z.ai',
  clickMode: 'click',
  inputMode: 'value',
  contenteditableInputMode: 'auto',
  needActivateInput: false,
  activateDelay: 100,
  inputDelay: 100,
  clickDelay: 100,
  elementTimeout: 5000,
  retryInterval: 100,
  verboseLogging: true,
  enableSmartDiscovery: true,
  buttonEnableRetry: {
    enabled: false,
    maxRetries: 5,
    retryInterval: 200,
  },
};

// ==========================================================
//                     选择器配置
// ==========================================================

const INPUT_SELECTORS = [
  // 主选择器：通过 ID 定位 textarea
  { type: 'css', value: 'textarea#chat-input' },

  // 备选选择器：通过 placeholder 定位
  { type: 'css', value: 'textarea[placeholder*="帮您"]' },

  // 通过父容器定位
  { type: 'css', value: 'div.overflow-hidden.relative.py-3.px-1 textarea' },

  // XPath 备选
  { type: 'xpath', value: '//textarea[@id="chat-input"]' },
];

const BUTTON_SELECTORS = [
  // 主选择器：通过 ID 定位按钮
  { type: 'css', value: 'button#send-message-button' },

  // 通过类名定位
  { type: 'css', value: 'button.sendMessageButton' },

  // XPath 备选
  { type: 'xpath', value: '//button[@id="send-message-button"]' },
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
            selector.value,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
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
    'input:not([type]):not([readonly]):not([disabled])'
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
    '[role="button"]:not([aria-disabled="true"])'
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

async function simulateContenteditableInput(element, text, mode = 'beforeinput') {
  if (!element || !text) {
    logWarning("元素或文本为空");
    return false;
  }

  logInfo(`使用 ${mode} 模式输入到 contenteditable 元素，长度: ${text.length}`);

  element.focus();
  await delay(50);

  document.execCommand('selectAll', false, null);
  await delay(20);
  document.execCommand('delete', false, null);
  await delay(50);

  switch (mode) {
    case 'beforeinput':
      return await inputWithBeforeInput(element, text);

    case 'typing':
      return await inputWithTyping(element, text);

    case 'direct':
      return inputDirectly(element, text);

    default:
      logWarning(`未知的 contenteditable 输入模式: ${mode}`);
      return false;
  }
}

async function inputWithBeforeInput(element, text) {
  try {
    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    });
    element.dispatchEvent(beforeInputEvent);

    const success = document.execCommand('insertText', false, text);

    if (!success) {
      logWarning("execCommand 失败，降级到直接设置");
      element.textContent = text;
    }

    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));

    logInfo("✅ beforeinput 模式输入完成");
    return true;
  } catch (e) {
    logError("beforeinput 模式失败", e);
    return false;
  }
}

async function inputWithTyping(element, text, charDelay = 30) {
  try {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const keyCode = char.charCodeAt(0);

      element.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: char,
        keyCode: keyCode,
        which: keyCode,
      }));

      element.dispatchEvent(new KeyboardEvent('keypress', {
        bubbles: true,
        cancelable: true,
        key: char,
        keyCode: keyCode,
        which: keyCode,
        charCode: keyCode,
      }));

      document.execCommand('insertText', false, char);

      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: char,
      }));

      element.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: char,
        keyCode: keyCode,
        which: keyCode,
      }));

      await delay(charDelay);
    }

    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));

    logInfo("✅ 逐字符输入模式完成");
    return true;
  } catch (e) {
    logError("逐字符输入模式失败", e);
    return false;
  }
}

function inputDirectly(element, text) {
  try {
    element.textContent = text;
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    logInfo("✅ 直接设置模式完成");
    return true;
  } catch (e) {
    logError("直接设置模式失败", e);
    return false;
  }
}

async function setInputValue(element, value) {
  if (!element) {
    logWarning("输入元素不存在");
    return false;
  }

  const isContentEditable = element.isContentEditable ||
                           element.getAttribute('contenteditable') === 'true';

  if (isContentEditable) {
    const mode = PLATFORM_CONFIG.contenteditableInputMode;

    if (mode === 'auto') {
      logInfo("contenteditable 自动模式：尝试 beforeinput");
      const result = await simulateContenteditableInput(element, value.trim(), 'beforeinput');
      if (!result) {
        logWarning("beforeinput 失败，降级到直接设置");
        return inputDirectly(element, value.trim());
      }
      return result;
    } else if (mode === 'beforeinput' || mode === 'typing' || mode === 'direct') {
      return await simulateContenteditableInput(element, value.trim(), mode);
    } else {
      logWarning(`未知的 contenteditable 模式: ${mode}，使用默认方式`);
      element.textContent = value.trim();
      return true;
    }
  }

  try {
    const trimmedValue = value.trim();

    switch (PLATFORM_CONFIG.inputMode) {
      case 'value':
        element.value = trimmedValue;
        break;

      case 'nativeSetter':
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;

        if (nativeSetter) {
          nativeSetter.call(element, trimmedValue);
        } else {
          element.value = trimmedValue;
        }
        break;

      case 'custom':
      default:
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          element.value = trimmedValue;
        } else {
          element.textContent = trimmedValue;
        }
        break;
    }

    logInfo("输入值已设置");
    return true;
  } catch (e) {
    logError("设置输入值失败", e);
    return false;
  }
}

function triggerInputEvents(element) {
  if (!element) {
    logWarning("输入元素不存在，无法触发事件");
    return false;
  }

  try {
    const events = [
      new Event('focus', { bubbles: true }),
      new Event('input', { bubbles: true, cancelable: true }),
      new Event('change', { bubbles: true, cancelable: true }),
    ];

    events.forEach((event) => element.dispatchEvent(event));

    logInfo("输入事件已触发");
    return true;
  } catch (e) {
    logError("触发输入事件失败", e);
    return false;
  }
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

// ==========================================================
//                     点击工具
// ==========================================================

function triggerClick(element) {
  if (!element) {
    logWarning("点击元素不存在");
    return false;
  }

  if (element.offsetParent === null) {
    logWarning("元素不可见，无法点击");
    return false;
  }

  if (element.disabled) {
    logWarning("元素已禁用，无法点击");
    return false;
  }

  const clickMode = PLATFORM_CONFIG.clickMode;

  try {
    switch (clickMode) {
      case 'mouseup':
        return triggerMouseUpClick(element);

      case 'click':
        return triggerNormalClick(element);

      case 'both':
        if (triggerNormalClick(element)) {
          return true;
        }
        logInfo("普通点击失败，尝试 mouseup 模式");
        return triggerMouseUpClick(element);

      default:
        logWarning(`未知的点击模式: ${clickMode}`);
        return false;
    }
  } catch (e) {
    logError("点击失败", e);
    return false;
  }
}

function triggerNormalClick(element) {
  try {
    element.click();
    logInfo("原生点击成功");
    return true;
  } catch (e) {
    logWarning("原生点击失败，尝试 MouseEvent");

    try {
      const rect = element.getBoundingClientRect();
      const mouseEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      });
      element.dispatchEvent(mouseEvent);
      logInfo("MouseEvent 点击成功");
      return true;
    } catch (e2) {
      logError("MouseEvent 点击也失败", e2);
      return false;
    }
  }
}

function triggerMouseUpClick(element) {
  try {
    const rect = element.getBoundingClientRect();

    const mousedownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    element.dispatchEvent(mousedownEvent);

    const mouseupEvent = new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    element.dispatchEvent(mouseupEvent);

    logInfo("MouseUp 点击成功（GLM 模式）");
    return true;
  } catch (e) {
    logError("MouseUp 点击失败", e);
    return false;
  }
}

// ==========================================================
//                     延时工具
// ==========================================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
const MANUAL_INPUT_SELECTORS = INPUT_SELECTORS.filter((selector) => selector.type === 'css').map((selector) => selector.value);
const MANUAL_BUTTON_SELECTORS = BUTTON_SELECTORS.filter((selector) => selector.type === 'css').map((selector) => selector.value);

function recycleResponseListener(reason) {
  const listener = window.__responseListenerInstances && window.__responseListenerInstances.zai;
  if (!listener || typeof listener.reset !== 'function') return;
  logInfo(`Zai 手动发送，回收回复监听: ${reason}`);
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

async function waitForButtonEnabled(buttonElement, inputElement, message) {
  const { maxRetries, retryInterval } = PLATFORM_CONFIG.buttonEnableRetry;

  const checkButtonEnabled = () => {
    const buttonClass = buttonElement.className || '';
    return !buttonClass.includes('disabled') &&
           !buttonClass.includes('Disabled') &&
           !buttonElement.disabled;
  };

  if (checkButtonEnabled()) {
    logInfo("发送按钮已启用");
    return true;
  }

  for (let i = 0; i < maxRetries; i++) {
    logWarning(`发送按钮仍处于禁用状态，等待启用... (${i + 1}/${maxRetries})`);

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
//                     消息监听 & 环境检查
// ==========================================================

// 防止重复注入
if (window.zaiInjected) {
  logInfo("Zai 脚本已注入，跳过重复加载");
} else {
  window.zaiInjected = true;

  if (!window.location.hostname.includes(PLATFORM_CONFIG.hostname)) {
    logWarning(`当前页面不是 ${PLATFORM_CONFIG.hostname}，脚本未激活`);
  } else {
    logInfo(`${PLATFORM_CONFIG.hostname} 内容脚本已加载并激活`);

    if (!window.__zaiManualRecycleBound) {
      window.__zaiManualRecycleBound = true;

      document.addEventListener('click', (event) => {
        if (isSending) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (matchesAnySelector(target, MANUAL_BUTTON_SELECTORS)) {
          recycleResponseListener('button-click');
        }
      }, true);

      document.addEventListener('keydown', (event) => {
        if (isSending) return;
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
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
}

// ==========================================================
//                     调试工具
// ==========================================================

if (typeof window !== 'undefined') {
  window.__zaiScript = {
    config: PLATFORM_CONFIG,
    sendChatMessage,
    findElementBySelectors,
    waitForElement,
    findInputElementIntelligently,
    findButtonElementIntelligently,
    isElementVisible,
    triggerClick,
    triggerNormalClick,
    triggerMouseUpClick,
    setInputValue,
    simulateContenteditableInput,
    inputWithBeforeInput,
    inputWithTyping,
    inputDirectly,
    activateInput,
    triggerInputEvents,
    waitForButtonEnabled,
  };
  logInfo("调试工具已暴露到 window.__zaiScript");
}
})();
