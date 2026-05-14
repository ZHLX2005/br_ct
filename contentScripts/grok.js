(function() {
if (window.__grokScriptBootstrapInjected) {
  console.log("[Grok] 脚本已注入，跳过重复初始化");
  return;
}
window.__grokScriptBootstrapInjected = true;

/**
 * @fileoverview Grok AI 平台内容脚本
 *
 * 平台特征：
 * - 使用 TipTap/ProseMirror 编辑器
 * - contenteditable 输入框
 * - 域名: grok.com
 */

// ==========================================================
//                     平台配置参数
// ==========================================================

const PLATFORM_CONFIG = {
  // 平台标识
  name: 'grok',

  // 域名检查（支持部分匹配）
  hostname: 'grok.com',

  // 点击模式：普通点击
  clickMode: 'click',

  // 输入模式：textContent（contenteditable 元素）
  inputMode: 'textContent',

  // 是否需要先激活输入框
  needActivateInput: true,

  // 激活后延迟时间（毫秒）
  activateDelay: 100,

  // 输入后延迟时间（毫秒）
  inputDelay: 150,

  // 点击后延迟时间（毫秒）
  clickDelay: 100,

  // 元素查找超时时间（毫秒）
  elementTimeout: 5000,

  // 元素查找重试间隔（毫秒）
  retryInterval: 100,

  // 是否输出详细日志
  verboseLogging: true,
};

// ==========================================================
//                     选择器配置
// ==========================================================

/**
 * 输入框选择器列表（按优先级排序）
 */
const INPUT_SELECTORS = [
  // ProseMirror 编辑器（最稳定）
  { type: 'css', value: 'div.ProseMirror' },
  { type: 'css', value: 'div.tiptap.ProseMirror' },

  // 通过 placeholder 属性定位（备用）
  { type: 'xpath', value: '//p[@data-placeholder="What do you want to know?"]' },

  // 通过 contenteditable 属性定位（最后备选）
  { type: 'css', value: 'div[contenteditable="true"].ProseMirror' },
];

/**
 * 发送按钮选择器列表（按优先级排序）
 */
const BUTTON_SELECTORS = [
  // 通过常见的 aria-label 定位
  { type: 'xpath', value: '//button[@aria-label="Send message"]' },
  { type: 'xpath', value: '//button[@aria-label="Send"]' },

  // 通过图标定位（SVG）
  { type: 'xpath', value: '//button[.//svg]' },

  // 通过类名定位（需要根据实际页面调整）
  { type: 'css', value: 'button[type="submit"]' },

  // 完整路径（作为最后备选，最不稳定）
  { type: 'xpath', value: '/html/body/div[2]/div[2]/div[1]/div[1]/main[1]/div[2]/div[1]/div[2]/div[1]/div[1]/form[1]/div[1]/div[1]/div[2]/div[2]/div[1]/div[2]/div[2]' },
];

// ==========================================================
//                     通用查找器
// ==========================================================

/**
 * 统一的元素查找器 - 支持多种选择器类型
 * @param {Array<Object>} selectors - 选择器配置数组
 * @returns {Element|null} 找到的元素或 null
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

/**
 * 异步等待元素出现 - 支持超时和重试
 * @param {Array<Object>} selectors - 选择器配置数组
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Element|null>} 找到的元素或超时后的 null
 */
async function waitForElement(selectors, timeout) {
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
 * 设置输入元素的值（根据配置的 inputMode）
 * @param {Element} element - 输入元素
 * @param {string} value - 要设置的值
 * @returns {boolean} 是否成功
 */
function setInputValue(element, value) {
  if (!element) {
    logWarning("输入元素不存在");
    return false;
  }

  try {
    const trimmedValue = value.trim();

    switch (PLATFORM_CONFIG.inputMode) {
      case 'value':
        // 用于 input/textarea 元素
        element.value = trimmedValue;
        break;

      case 'textContent':
        // 用于 contenteditable 元素（ProseMirror）
        element.textContent = trimmedValue;
        break;

      case 'nativeSetter':
        // 使用原生 setter（React 受控组件）
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
        // 自定义逻辑，根据需要修改
        if (element.isContentEditable || element.contentEditable === 'true') {
          element.textContent = trimmedValue;
        } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          element.value = trimmedValue;
        } else {
          element.textContent = trimmedValue;
        }
        break;

      default:
        logWarning(`未知的输入模式: ${PLATFORM_CONFIG.inputMode}`);
        return false;
    }

    logInfo("输入值已设置");
    return true;
  } catch (e) {
    logError("设置输入值失败", e);
    return false;
  }
}

/**
 * 触发输入元素的完整事件序列
 * @param {Element} element - 目标元素
 * @returns {boolean} 是否成功
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
 * @param {Element} element - 输入元素
 * @returns {boolean} 是否成功
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
 * 触发元素点击 - 支持多种点击模式
 * @param {Element} element - 目标元素
 * @returns {boolean} 是否成功
 */
function triggerClick(element) {
  if (!element) {
    logWarning("点击元素不存在");
    return false;
  }

  // 检查元素状态
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
        // GLM 特殊模式：只用 mouseup 触发
        return triggerMouseUpClick(element);

      case 'click':
        // 普通点击模式
        return triggerNormalClick(element);

      case 'both':
        // 先尝试普通点击，失败后尝试 mouseup
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

/**
 * 普通点击模式（click 事件）
 * @param {Element} element - 目标元素
 * @returns {boolean} 是否成功
 */
function triggerNormalClick(element) {
  try {
    // 尝试原生 click()
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

/**
 * MouseUp 点击模式（GLM 特殊）
 * @param {Element} element - 目标元素
 * @returns {boolean} 是否成功
 */
function triggerMouseUpClick(element) {
  try {
    const rect = element.getBoundingClientRect();

    // 模拟鼠标按下
    const mousedownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    element.dispatchEvent(mousedownEvent);

    // 模拟鼠标抬起
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

/**
 * 延时指定毫秒数
 * @param {number} ms - 延时时间（毫秒）
 * @returns {Promise<void>}
 */
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

let isSending = false; // 状态锁，防止重复发送

const MANUAL_INPUT_SELECTORS = INPUT_SELECTORS
  .filter((selector) => selector.type === "css")
  .map((selector) => selector.value);
const MANUAL_BUTTON_SELECTORS = BUTTON_SELECTORS
  .filter((selector) => selector.type === "css")
  .map((selector) => selector.value);

function recycleResponseListener(reason) {
  const listener = window.__responseListenerInstances && window.__responseListenerInstances.grok;
  if (!listener || typeof listener.reset !== "function") return;
  logInfo(`Grok 手动发送，回收回复监听: ${reason}`);
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
 * @param {string} message - 要发送的消息内容
 * @returns {Promise<boolean>} 发送是否成功
 */
async function sendChatMessage(message) {
  // 1. 状态锁检查
  if (isSending) {
    logWarning("正在发送中，请勿重复操作");
    return false;
  }

  // 2. 消息验证
  if (!message || typeof message !== 'string' || message.trim() === '') {
    logError("消息内容无效");
    return false;
  }

  isSending = true;
  logInfo(`开始发送流程，消息: "${message}"`);

  try {
    // 3. 查找输入框
    logInfo("正在查找输入框...");
    const inputElement = await waitForElement(INPUT_SELECTORS, PLATFORM_CONFIG.elementTimeout);
    if (!inputElement) {
      logError("未找到输入框，发送失败");
      return false;
    }

    // 4. 激活输入框（如果需要）
    if (PLATFORM_CONFIG.needActivateInput) {
      logInfo("正在激活输入框...");
      activateInput(inputElement);
      await delay(PLATFORM_CONFIG.activateDelay);
    }

    // 5. 设置输入值
    logInfo("正在设置输入值...");
    if (!setInputValue(inputElement, message)) {
      logError("设置输入值失败");
      return false;
    }

    // 6. 触发输入事件
    if (!triggerInputEvents(inputElement)) {
      logError("触发输入事件失败");
      return false;
    }

    // 7. 输入后延迟
    await delay(PLATFORM_CONFIG.inputDelay);

    // 8. 查找发送按钮
    logInfo("正在查找发送按钮...");
    const buttonElement = await waitForElement(BUTTON_SELECTORS, PLATFORM_CONFIG.elementTimeout);
    if (!buttonElement) {
      logError("未找到发送按钮");
      return false;
    }

    // 9. 点击后延迟
    await delay(PLATFORM_CONFIG.clickDelay);

    // 10. 点击发送
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

// 防止重复注入
if (window.grokInjected) {
  logWarning("Grok 脚本已注入，跳过重复初始化");
} else {
  window.grokInjected = true;

  // 环境检查
  if (!window.location.hostname.includes(PLATFORM_CONFIG.hostname)) {
    logWarning(`当前页面不是 ${PLATFORM_CONFIG.hostname}，脚本未激活`);
  } else {
    logInfo(`${PLATFORM_CONFIG.hostname} 内容脚本已加载并激活`);

    if (!window.__grokManualRecycleBound) {
      window.__grokManualRecycleBound = true;

      document.addEventListener("click", (event) => {
        if (isSending) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (matchesAnySelector(target, MANUAL_BUTTON_SELECTORS)) {
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

        return true; // 异步响应
      }

      logWarning("收到未知的消息类型", request);
      sendResponse({ status: 'unknown_action' });
    });
  }

  // ==========================================================
  //                     调试工具（可选）
  // ==========================================================

  // 暴露到全局作用域，方便控制台调试
  if (typeof window !== 'undefined') {
    window.__platformScript = {
      config: PLATFORM_CONFIG,
      sendChatMessage,
      findElementBySelectors,
      waitForElement,
      triggerClick,
    };
    logInfo("调试工具已暴露到 window.__platformScript");
  }
}
})();
