(function() {
if (window.__notionaiScriptInjected) {
  console.log("[NotionAI] 脚本已注入，跳过重复初始化");
  return;
}
window.__notionaiScriptInjected = true;

/**
 * @fileoverview Notion AI 平台内容脚本
 * @platform Notion AI
 * @url https://www.notion.so/ai
 */

// ==========================================================
//                     平台配置
// ==========================================================

const PLATFORM_CONFIG = {
  name: 'NotionAI',
  hostname: 'notion.so',

  // 点击模式：普通点击
  clickMode: 'click',

  // 输入模式：contenteditable 使用 textContent
  inputMode: 'textContent',

  // Contenteditable 特殊处理模式
  // Notion AI 使用现代编辑器，可能需要 beforeinput 模式
  contenteditableInputMode: 'auto',

  // 需要先激活输入框
  needActivateInput: true,

  // 激活后延迟时间（毫秒）
  activateDelay: 150,

  // 输入后延迟时间（毫秒）
  inputDelay: 200,

  // 点击后延迟时间（毫秒）
  clickDelay: 150,

  // 元素查找超时时间（毫秒）
  elementTimeout: 8000,

  // 元素查找重试间隔（毫秒）
  retryInterval: 150,

  // 是否输出详细日志
  verboseLogging: true,

  // 是否启用智能元素发现
  enableSmartDiscovery: true,

  // 按钮状态等待重试（Notion AI 按钮可能需要时间激活）
  buttonEnableRetry: {
    enabled: true,
    maxRetries: 10,
    retryInterval: 200,
  },
};

// ==========================================================
//                     选择器配置
// ==========================================================

/**
 * 输入框选择器列表（按优先级排序）
 */
const INPUT_SELECTORS = [
  // data-content-editable-leaf + role（最可靠）
  { type: 'css', value: 'div[data-content-editable-leaf="true"][role="textbox"]' },

  // placeholder + contenteditable
  { type: 'css', value: 'div[contenteditable="true"][placeholder*="AI"]' },

  // class（实际 class 名是 content-editable-leaf-rtl）
  { type: 'css', value: 'div.content-editable-leaf-rtl[contenteditable="true"]' },

  // XPath: role + contenteditable
  { type: 'xpath', value: '//div[@role="textbox"][@contenteditable="true"]' },
];

/**
 * 发送按钮选择器列表（按优先级排序）
 */
const BUTTON_SELECTORS = [
  // data-testid（最可靠）
  { type: 'css', value: 'div[data-testid="agent-send-message-button"]' },

  // aria-label + role
  { type: 'css', value: 'div[role="button"][aria-label="提交 AI 消息"]' },

  // XPath 备选
  { type: 'xpath', value: '//div[@data-testid="agent-send-message-button"]' },
];

// ==========================================================
//                     通用查找器
// ==========================================================

/**
 * 统一的元素查找器 - 支持多种选择器类型
 */
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

// ==========================================================
//                     智能元素发现（兜底机制）
// ==========================================================

/**
 * 兜底机制：查找第一个可用的输入元素
 */
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

/**
 * 兜底机制：查找第一个可用的按钮元素
 */
function findButtonElementIntelligently() {
  logInfo("选择器失败，启动兜底机制查找按钮元素...");

  const selectors = [
    'button[aria-label*="send" i], button[aria-label*="submit" i], button[aria-label*="发送" i], button[aria-label*="提交" i]',
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

/**
 * 检查元素是否可见
 */
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

/**
 * 异步等待元素出现
 */
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

        // 启用智能发现兜底机制
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
//                     输入工具
// ==========================================================

/**
 * 模拟 Contenteditable 元素输入
 * Notion 等现代编辑器：先清空内容，再聚焦输入
 * 避免输入到 placeholder 层
 */
async function simulateContenteditableInput(element, text, mode = 'beforeinput') {
  if (!element || !text) {
    logWarning("元素或文本为空");
    return false;
  }

  logInfo(`使用 ${mode} 模式输入到 contenteditable 元素，长度: ${text.length}`);

  // 1. 清空现有内容（移除 placeholder）
  element.textContent = '';
  element.dispatchEvent(new Event('input', { bubbles: true }));

  // 2. 确保元素有焦点
  element.focus();
  await delay(50);

  // 3. 将光标移到开头（清空后默认位置）
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

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

/**
 * 使用 beforeinput 事件输入
 * 先全选内容，再输入替换（模拟用户真实输入行为）
 */
async function inputWithBeforeInput(element, text) {
  try {
    // 1. Ctrl+A 全选内容（替换提示词/已有内容）
    element.focus();
    document.execCommand('selectAll', false, null);
    await delay(30);

    // 2. 触发 beforeinput 事件
    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    });
    element.dispatchEvent(beforeInputEvent);

    // 3. 使用 execCommand 替换选中的内容
    const success = document.execCommand('insertText', false, text);

    if (!success) {
      logWarning("execCommand 失败，尝试直接设置");
      element.textContent = text;
    }

    // 4. 触发后续事件
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));

    logInfo("beforeinput 模式输入完成");
    return true;
  } catch (e) {
    logError("beforeinput 模式失败", e);
    return false;
  }
}

/**
 * 逐字符模拟键盘输入
 */
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

    logInfo("逐字符输入模式完成");
    return true;
  } catch (e) {
    logError("逐字符输入模式失败", e);
    return false;
  }
}

/**
 * 直接设置文本内容 - 先全选再替换（模拟用户输入行为）
 */
function inputDirectly(element, text) {
  try {
    // 1. 全选内容
    element.focus();
    document.execCommand('selectAll', false, null);

    // 2. 使用 execCommand 替换选中的内容
    const success = document.execCommand('insertText', false, text);
    if (!success) {
      // 如果失败，直接设置 textContent
      element.textContent = text;
    }

    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    logInfo("直接设置模式完成");
    return true;
  } catch (e) {
    logError("直接设置模式失败", e);
    return false;
  }
}

/**
 * 设置输入元素的值
 */
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

  // 普通 input/textarea 元素
  try {
    element.value = value.trim();
    logInfo("输入值已设置");
    return true;
  } catch (e) {
    logError("设置输入值失败", e);
    return false;
  }
}

/**
 * 触发输入元素的完整事件序列
 */
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
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter' }),
    ];

    events.forEach((event) => element.dispatchEvent(event));

    logInfo("输入事件已触发");
    return true;
  } catch (e) {
    logError("触发输入事件失败", e);
    return false;
  }
}

/**
 * 激活输入框（点击 + 聚焦）
 */
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

/**
 * 触发元素点击
 */
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

  try {
    element.click();
    logInfo("原生点击成功");
    return true;
  } catch (e) {
    logError("点击失败", e);
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
  const listener = window.__responseListenerInstances && window.__responseListenerInstances.notionai;
  if (!listener || typeof listener.reset !== 'function') return;
  logInfo(`NotionAI 手动发送，回收回复监听: ${reason}`);
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

/**
 * 发送聊天消息的完整流程
 */
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
    // 1. 查找输入框
    logInfo("正在查找输入框...");
    const inputElement = await waitForElement(INPUT_SELECTORS, PLATFORM_CONFIG.elementTimeout);
    if (!inputElement) {
      logError("未找到输入框，发送失败");
      return false;
    }

    // 2. 激活输入框
    if (PLATFORM_CONFIG.needActivateInput) {
      logInfo("正在激活输入框...");
      activateInput(inputElement);
      await delay(PLATFORM_CONFIG.activateDelay);
    }

    // 3. 设置输入值
    logInfo("正在设置输入值...");
    const inputResult = await setInputValue(inputElement, message);
    if (!inputResult) {
      logError("设置输入值失败");
      return false;
    }

    // 4. 触发输入事件
    if (!triggerInputEvents(inputElement)) {
      logError("触发输入事件失败");
      return false;
    }

    // 5. 输入后延迟
    await delay(PLATFORM_CONFIG.inputDelay);

    // 6. 查找发送按钮
    logInfo("正在查找发送按钮...");
    const buttonElement = await waitForElement(BUTTON_SELECTORS, PLATFORM_CONFIG.elementTimeout);
    if (!buttonElement) {
      logError("未找到发送按钮");
      return false;
    }

    // 7. 等待按钮启用
    if (PLATFORM_CONFIG.buttonEnableRetry.enabled) {
      const buttonReady = await waitForButtonEnabled(buttonElement, inputElement, message.trim());
      if (!buttonReady) {
        logError("发送按钮未能启用");
        return false;
      }
    } else {
      await delay(PLATFORM_CONFIG.clickDelay);
    }

    // 8. 点击发送前设置时间戳，通知 response listener 不要触发 autoCapture
    window.__notionaiLastSendTime = Date.now();
    logInfo("正在点击发送按钮...");
    if (triggerClick(buttonElement)) {
      // 3.5s 后触发 DOM 突变，唤醒 response listener 检查 isGenerating 是否已变为 false
      // 用于 3s 缓冲过期后 AI 响应已完成但无新 DOM 变化导致捕获丢失的边界情况
      setTimeout(function() {
        var root = document.querySelector('.layout-content, [class*="layout-content"]');
        if (root) {
          var marker = document.createElement('div');
          marker.style.display = 'none';
          marker.setAttribute('data-cc-wake', Date.now());
          root.appendChild(marker);
          root.removeChild(marker);
        }
      }, 4000);
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

/**
 * 等待按钮启用
 */
async function waitForButtonEnabled(buttonElement, inputElement, message) {
  const { maxRetries, retryInterval } = PLATFORM_CONFIG.buttonEnableRetry;

  const checkButtonEnabled = () => {
    const buttonClass = buttonElement.className || '';
    const ariaDisabled = buttonElement.getAttribute('aria-disabled');
    return !buttonClass.includes('disabled') &&
           !buttonClass.includes('Disabled') &&
           !buttonElement.disabled &&
           ariaDisabled !== 'true';
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

// 环境检查
if (!window.location.hostname.includes(PLATFORM_CONFIG.hostname)) {
  logWarning(`当前页面不是 ${PLATFORM_CONFIG.hostname}，脚本未激活`);
} else {
  logInfo(`${PLATFORM_CONFIG.hostname} 内容脚本已加载并激活`);

  if (!window.__notionaiManualRecycleBound) {
    window.__notionaiManualRecycleBound = true;

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

// ==========================================================
//                     调试工具
// ==========================================================

if (typeof window !== 'undefined') {
  window.__platformScript = {
    config: PLATFORM_CONFIG,
    sendChatMessage,
    findElementBySelectors,
    waitForElement,
    setInputValue,
    simulateContenteditableInput,
    triggerClick,
    activateInput,
    triggerInputEvents,
    waitForButtonEnabled,
  };
  logInfo("调试工具已暴露到 window.__platformScript");
}
})();
