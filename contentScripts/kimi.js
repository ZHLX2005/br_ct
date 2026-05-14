(function() {
if (window.__kimiScriptInjected) {
  console.log("[Kimi] 脚本已注入，跳过重复初始化");
  return;
}
window.__kimiScriptInjected = true;

/**
 * @fileoverview
 * Kimi 平台内容脚本 (https://www.kimi.com/)
 *
 * 特点：
 * - 使用 Lexical 编辑器 (contenteditable)
 * - 需要触发 beforeinput 事件来更新编辑器状态
 */

// ==========================================================
//                     平台配置参数
// ==========================================================

const PLATFORM_CONFIG = {
  name: 'kimi',
  hostname: 'kimi.com',
  clickMode: 'click',
  inputMode: 'value',
  contenteditableInputMode: 'beforeinput',
  needActivateInput: true,
  activateDelay: 200,
  inputDelay: 200,
  clickDelay: 200,
  elementTimeout: 5000,
  retryInterval: 100,
  verboseLogging: true,
  enableSmartDiscovery: true,
  findButtonNearInput: false,
  buttonEnableRetry: {
    enabled: true,
    maxRetries: 5,
    retryInterval: 300,
  },
};

// ==========================================================
//                     选择器配置
// ==========================================================

const INPUT_SELECTORS = [
  { type: 'css', value: 'div.chat-input-editor[contenteditable="true"]' },
  { type: 'css', value: 'div.chat-input-editor[data-lexical-editor="true"]' },
  { type: 'css', value: 'div.chat-input div[contenteditable="true"][role="textbox"]' },
];

const BUTTON_SELECTORS = [
  { type: 'css', value: 'div.send-button-container' },
  { type: 'css', value: 'div.send-button-container .send-icon' },
  { type: 'xpath', value: '//div[contains(@class, "send-button-container")]//svg[contains(@class, "send-icon")]' },
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
          const result = document.evaluate(selector.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          element = result.singleNodeValue;
          break;
        default:
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
        if (PLATFORM_CONFIG.enableSmartDiscovery) {
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
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && isElementVisible(element)) {
      logInfo(`兜底机制找到输入元素: ${selector}`);
      return element;
    }
  }
  return null;
}

function findButtonElementIntelligently() {
  logInfo("选择器失败，启动兜底机制查找按钮元素...");
  const selectors = [
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

async function simulateContenteditableInput(element, text) {
  if (!element || !text) return false;
  logInfo(`Lexical beforeinput 模式输入，长度: ${text.length}`);

  element.focus();
  await delay(50);

  // 全选现有内容
  document.execCommand('selectAll', false, null);
  await delay(30);

  // 只发 beforeinput 让 Lexical 插入，input 只通知不附带 data
  const beforeInputEvent = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: text,
  });
  element.dispatchEvent(beforeInputEvent);

  element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));

  logInfo("Lexical beforeinput 模式输入完成");
  return true;
}

async function setInputValue(element, value) {
  if (!element) return false;

  const isContentEditable = element.isContentEditable || element.getAttribute('contenteditable') === 'true';

  if (isContentEditable) {
    return await simulateContenteditableInput(element, value.trim());
  }

  element.value = value.trim();
  return true;
}

function triggerInputEvents(element) {
  if (!element) return false;
  try {
    const events = [
      new Event('focus', { bubbles: true }),
      new Event('input', { bubbles: true, cancelable: true }),
      new Event('change', { bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter' }),
    ];
    events.forEach((event) => element.dispatchEvent(event));
    return true;
  } catch (e) {
    logError("触发输入事件失败", e);
    return false;
  }
}

function activateInput(element) {
  if (!element) return false;
  try {
    element.click();
    element.focus();
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
  if (!element) return false;
  if (element.offsetParent === null) return false;
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
      return true;
    } catch (e2) {
      logError("MouseEvent 点击也失败", e2);
      return false;
    }
  }
}

// ==========================================================
//                     延时 & 日志
// ==========================================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logInfo(message) {
  if (PLATFORM_CONFIG.verboseLogging) console.log(`[${PLATFORM_CONFIG.name}] ${message}`);
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
  const listener = window.__responseListenerInstances && window.__responseListenerInstances.kimi;
  if (!listener || typeof listener.reset !== 'function') return;
  logInfo(`Kimi 手动发送，回收回复监听: ${reason}`);
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
    // 查找输入框
    const inputElement = await waitForElement(INPUT_SELECTORS, PLATFORM_CONFIG.elementTimeout);
    if (!inputElement) {
      logError("未找到输入框");
      return false;
    }

    // 激活输入框
    if (PLATFORM_CONFIG.needActivateInput) {
      activateInput(inputElement);
      await delay(PLATFORM_CONFIG.activateDelay);
    }

    // 设置输入值（setInputValue 已包含 contenteditable 的完整事件流程，无需再 triggerInputEvents）
    const inputResult = await setInputValue(inputElement, message);
    if (!inputResult) {
      logError("设置输入值失败");
      return false;
    }

    await delay(PLATFORM_CONFIG.inputDelay);

    // 查找发送按钮
    const buttonElement = await waitForElement(BUTTON_SELECTORS, PLATFORM_CONFIG.elementTimeout, 'button');
    if (!buttonElement) {
      logError("未找到发送按钮");
      return false;
    }

    // 等待按钮启用
    if (PLATFORM_CONFIG.buttonEnableRetry.enabled) {
      const buttonReady = await waitForButtonEnabled(buttonElement, inputElement, message.trim());
      if (!buttonReady) {
        logError("发送按钮未能启用");
        return false;
      }
    } else {
      await delay(PLATFORM_CONFIG.clickDelay);
    }

    // 点击发送
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
    logWarning(`等待按钮启用... (${i + 1}/${maxRetries})`);
    // 只触发 input 事件，不重新插入文本（模拟编辑器内容未变但触发了事件）
    inputElement.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
    }));
    await delay(retryInterval);
    if (checkButtonEnabled()) {
      logInfo(`按钮在第 ${i + 1} 次重试后启用`);
      return true;
    }
  }
  logError(`按钮在 ${maxRetries} 次重试后仍禁用`);
  return false;
}

// ==========================================================
//                     消息监听
// ==========================================================

if (!window.location.hostname.includes(PLATFORM_CONFIG.hostname)) {
  logWarning(`当前页面不是 ${PLATFORM_CONFIG.hostname}，脚本未激活`);
} else {
  logInfo(`Kimi 内容脚本已加载并激活`);

  if (!window.__kimiManualRecycleBound) {
    window.__kimiManualRecycleBound = true;

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
          sendResponse({ status: success ? 'success' : 'failed', platform: PLATFORM_CONFIG.name, timestamp: Date.now() });
        })
        .catch((error) => {
          logError("消息处理异常", error);
          sendResponse({ status: 'error', platform: PLATFORM_CONFIG.name, error: error.message, timestamp: Date.now() });
        });
      return true;
    }
    sendResponse({ status: 'unknown_action' });
  });
}
})();
