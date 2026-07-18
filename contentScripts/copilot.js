/**
 * @fileoverview
 * AI 平台内容脚本通用模板
 *
 * 使用说明：
 * 1. 修改 PLATFORM_CONFIG 中的配置参数
 * 2. 根据平台特性调整 CLICK_MODE（普通平台用 'click'，GLM 用 'mouseup'）
 * 3. 修改选择器列表（inputSelectors 和 buttonSelectors）
 *
 * 兜底机制：
 * - 当选择器失败时，自动查找第一个可用的输入框/按钮
 * - 无需复杂配置，开箱即用
 *
 * 特殊场景处理：
 *
 * 【Slate/ProseMirror 等现代编辑器】
 * 场景：使用 contenteditable 的富文本编辑器，按钮状态不会随 DOM 操作变化
 * 原因：这些编辑器依赖 beforeinput 事件来更新内部状态
 * 解决方案：
 *   - 设置 contenteditableInputMode: 'beforeinput' 或 'auto'
 *   - 启用 buttonEnableRetry.enabled: true
 *   - 示例：通义千问 (Tongyi)
 *
 * 【GLM 平台】
 * 场景：点击按钮只需要 mouseup 事件
 * 原因：GLM 的特殊事件绑定机制
 * 解决方案：设置 clickMode: 'mouseup'
 *
 * 【React 受控组件】
 * 场景：直接设置 value 不会触发状态更新
 * 原因：React 覆盖了原生的 value setter
 * 解决方案：设置 inputMode: 'nativeSetter'
 *
 * 【Enter 键发送】
 * 场景：某些平台（如 Coze）使用 Enter 键发送消息，而非点击按钮
 * 原因：编辑器型输入框，Enter 键是默认发送快捷键
 * 解决方案：
 *   - 不查找发送按钮，直接在输入框上模拟 Enter 键事件
 *   - 设置 clickMode: 'enter' 启用此模式
 *   - 示例：Coze (coze.cn)
 */

// 防止 chrome.scripting 重复注入时注册多个消息监听器。
if (window.__copilotContentScriptInjected) {
  console.log('[Copilot] 内容脚本已注入，跳过重复初始化');
} else {
  window.__copilotContentScriptInjected = true;

// ==========================================================
//                     平台配置参数
// ==========================================================

/**
 * 平台配置对象 - 所有平台相关参数在此声明
 * 修改此配置以适配不同平台
 */
const PLATFORM_CONFIG = {
  // 平台标识（用于日志和响应）
  name: 'Copilot',

  // 域名检查（支持部分匹配）
  hostname: 'copilot.microsoft.com',

  // 点击模式：'click' | 'mouseup' | 'both' | 'enter'
  // - 'click': 普通点击（ChatGPT, Claude, Gemini, Doubao, Tongyi 等）
  // - 'mouseup': GLM 特殊模式（只需 mouseup，不需要 click）
  // - 'both': 同时尝试两种方式
  // - 'enter': 使用 Enter 键发送（Coze 等编辑器型平台）
  clickMode: 'click',

  // 输入模式：'value' | 'textContent' | 'nativeSetter' | 'custom'
  // - 'value': 用于 input/textarea 元素
  // - 'textContent': 用于 contenteditable 元素
  // - 'nativeSetter': 使用原生 setter（React 受控组件）
  // - 'custom': 自定义逻辑
  inputMode: 'nativeSetter',

  // Contenteditable 特殊处理模式（针对 Slate、ProseMirror 等现代编辑器）
  // 使用场景：
  // - 通义千问：使用 Slate 编辑器，按钮状态不会随 DOM 操作变化
  // - 原因：这些编辑器需要 beforeinput 事件来触发内部状态更新
  // 解决方案：
  // - 'beforeinput': 触发 beforeinput 事件 + execCommand('insertText')
  // - 'typing': 逐字符模拟键盘输入（较慢，但最真实）
  // - 'direct': 直接设置 textContent（可能不触发状态更新）
  // - 'auto': 自动检测（优先使用 beforeinput，失败则降级）
  contenteditableInputMode: 'auto',

  // 是否需要先激活输入框（点击 + focus）
  needActivateInput: false,

  // 激活后延迟时间（毫秒）
  activateDelay: 100,

  // 输入后延迟时间（毫秒）
  inputDelay: 100,

  // 点击后延迟时间（毫秒）
  clickDelay: 100,

  // 元素查找超时时间（毫秒）
  elementTimeout: 5000,

  // 元素查找重试间隔（毫秒）
  retryInterval: 100,

  // 是否输出详细日志
  verboseLogging: true,

  // 是否启用智能元素发现（当预定义选择器失败时自动查找）
  enableSmartDiscovery: true,

  // 是否在输入框附近查找发送按钮（当页面上有多个相似按钮时使用）
  // 使用场景：
  // - DeepSeek：页面上有侧边栏按钮、工具栏按钮等多个相似元素
  // - 原因：通用选择器可能匹配到错误位置的按钮
  // - 解决方案：从输入框向上查找公共容器，在容器内定位发送按钮
  findButtonNearInput: false,

  // 按钮状态等待重试（针对 Slate 编辑器等异步状态更新的平台）
  // 使用场景：
  // - 通义千问：输入后按钮状态需要时间更新
  // - 原因：编辑器内部状态是异步更新的
  // - 解决方案：等待按钮启用，最多重试 N 次
  buttonEnableRetry: {
    enabled: false,          // 是否启用按钮启用重试
    maxRetries: 5,           // 最大重试次数
    retryInterval: 200,      // 重试间隔（毫秒）
  },
};

// ==========================================================
//                     选择器配置
// ==========================================================

/**
 * 输入框选择器列表（按优先级排序）
 * 支持类型：'css', 'xpath', 'id'
 * 选择器会按数组顺序依次尝试，找到第一个即返回
 */
const INPUT_SELECTORS = [
  // 优先使用 Copilot 提供的稳定 id 与 data-testid。
  { type: 'css', value: 'textarea#userInput[data-testid="composer-input"]' },
  { type: 'css', value: 'textarea[data-testid="composer-input"]' },
  { type: 'id', value: 'userInput' },
  { type: 'css', value: 'textarea[placeholder="Message Copilot"]' },
  { type: 'xpath', value: '//textarea[@role="textbox" and @data-testid="composer-input"]' },
  { type: 'css', value: 'textarea:not([readonly]):not([disabled])' },
];

/**
 * 发送按钮选择器列表（按优先级排序）
 * 支持类型：'css', 'xpath', 'id'
 */
const BUTTON_SELECTORS = [
  // 优先使用稳定的 data-testid，aria-label 作为语义兜底。
  { type: 'css', value: 'button[data-testid="submit-button"]' },
  { type: 'css', value: 'button[aria-label="Submit message"]' },
  { type: 'xpath', value: '//button[@data-testid="submit-button"]' },
  { type: 'xpath', value: '//button[@aria-label="Submit message"]' },
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
 * 异步等待元素出现 - 支持超时和重试，超时后使用兜底机制
 * @param {Array<Object>} selectors - 选择器配置数组
 * @param {number} timeout - 超时时间（毫秒）
 * @param {string} elementType - 元素类型 ('input' | 'button')
 * @returns {Promise<Element|null>} 找到的元素或超时后的 null
 */
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

        // 尝试兜底机制
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

/**
 * 兜底机制：查找第一个可用的输入元素
 * 当预定义选择器失败时自动调用
 * @returns {Element|null} 找到的第一个可输入元素
 */
function findInputElementIntelligently() {
  logInfo("选择器失败，启动兜底机制查找输入元素...");

  // 按优先级查找：textarea > contenteditable > input
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
 * 当预定义选择器失败时自动调用
 * @returns {Element|null} 找到的第一个可点击元素
 */
function findButtonElementIntelligently() {
  logInfo("选择器失败，启动兜底机制查找按钮元素...");

  // 按优先级查找：带发送相关属性的按钮 > 普通按钮
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
 * 在输入框附近查找发送按钮
 *
 * 使用场景：
 * - DeepSeek：页面上有侧边栏按钮、工具栏按钮、输入区按钮等多个相似元素
 * - 原因：通用选择器可能匹配到错误位置的按钮
 * - 解决方案：从输入框向上查找公共容器，在容器内定位发送按钮
 *
 * 使用方式：
 * 1. 在 sendChatMessage 中调用此函数替代 waitForElement
 * 2. 或者设置 findButtonNearInput: true 启用自动查找
 *
 * @param {Element} inputElement - 输入框元素
 * @param {number} maxParentLevels - 最大向上查找层数（默认 8）
 * @param {string} buttonSelector - 按钮选择器（默认 'button:not([disabled]), [role="button"][aria-disabled="false"]'）
 * @returns {Element|null} 找到的按钮元素或 null
 */
function findSendButtonNearInput(inputElement, maxParentLevels = 8, buttonSelector = null) {
  if (!inputElement) {
    logWarning("输入框元素为空");
    return null;
  }

  const selectors = buttonSelector
    ? [buttonSelector]
    : [
      'button:not([disabled])',
      '[role="button"][aria-disabled="false"]',
      'div.ds-icon-button[role="button"][aria-disabled="false"]',
    ];

  // 从输入框向上遍历父级
  let container = inputElement;
  for (let i = 0; i < maxParentLevels; i++) {
    container = container.parentElement;
    if (!container) break;

    for (const selector of selectors) {
      try {
        // 查找所有匹配的按钮
        const buttons = container.querySelectorAll(selector);
        for (const btn of buttons) {
          if (isElementVisible(btn)) {
            logInfo(`在输入框第 ${i + 1} 层父级找到发送按钮: ${selector}`);
            return btn;
          }
        }
      } catch (e) {
        // 选择器无效，跳过
      }
    }
  }

  logWarning("未在输入框附近找到发送按钮");
  return null;
}

/**
 * 检查元素是否可见（简化版）
 * @param {Element} element - 要检查的元素
 * @returns {boolean} 是否可见
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

// ==========================================================
//                     输入工具
// ==========================================================

/**
 * 模拟 Contenteditable 元素输入（现代编辑器专用）
 *
 * 使用场景：
 * - 通义千问（Tongyi）：使用 Slate 编辑器，DOM 操作不会触发按钮状态更新
 * - 其他使用 Slate/ProseMirror 等现代编辑器的平台
 *
 * 原因：
 * - 现代编辑器使用 beforeinput 事件来捕获用户输入意图
 * - 直接修改 textContent 不会触发编辑器的内部状态更新
 * - 编辑器需要完整的输入事件链来更新 UI 状态（如按钮启用/禁用）
 *
 * @param {Element} element - contenteditable 元素
 * @param {string} text - 要输入的文本
 * @param {string} mode - 输入模式：'beforeinput' | 'typing' | 'direct'
 * @returns {Promise<boolean>}
 */
async function simulateContenteditableInput(element, text, mode = 'beforeinput') {
  if (!element || !text) {
    logWarning("元素或文本为空");
    return false;
  }

  logInfo(`使用 ${mode} 模式输入到 contenteditable 元素，长度: ${text.length}`);

  // 1. 清空现有内容（移除 placeholder/提示词层）
  element.textContent = '';
  element.dispatchEvent(new Event('input', { bubbles: true }));

  // 2. 确保元素有焦点
  element.focus();
  await delay(50);

  // 3. 将光标移到开头
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  switch (mode) {
    case 'beforeinput':
      // ========== beforeinput 模式（推荐） ==========
      // 适用：Slate、ProseMirror 等现代编辑器
      // 原理：触发 beforeinput 事件，让编辑器知道即将有文本输入
      return await inputWithBeforeInput(element, text);

    case 'typing':
      // ========== 逐字符输入模式 ==========
      // 适用：beforeinput 失败时的备选方案
      // 原理：模拟真实用户逐字输入，最真实但较慢
      return await inputWithTyping(element, text);

    case 'direct':
      // ========== 直接设置模式 ==========
      // 适用：不需要触发编辑器状态的场景
      // 原理：先全选再替换，模拟用户输入行为
      return inputDirectly(element, text);

    default:
      logWarning(`未知的 contenteditable 输入模式: ${mode}`);
      return false;
  }
}

/**
 * 使用 beforeinput 事件输入（现代编辑器推荐）
 * 先全选内容，再输入替换（模拟用户真实输入行为）
 * @param {Element} element - 目标元素
 * @param {string} text - 输入文本
 * @returns {Promise<boolean>}
 */
async function inputWithBeforeInput(element, text) {
  try {
    // 1. Ctrl+A 全选内容（替换提示词/已有内容）
    element.focus();
    document.execCommand('selectAll', false, null);
    await delay(30);

    // 2. 触发 beforeinput 事件（现代编辑器标准）
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
      logWarning("execCommand 失败，降级到直接设置");
      element.textContent = text;
    }

    // 4. 触发后续事件确保状态同步
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
 * 逐字符模拟键盘输入（备选方案）
 * @param {Element} element - 目标元素
 * @param {string} text - 输入文本
 * @param {number} charDelay - 每个字符间延迟（毫秒）
 * @returns {Promise<boolean>}
 */
async function inputWithTyping(element, text, charDelay = 30) {
  try {
    // 逐字符输入
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const keyCode = char.charCodeAt(0);

      // keydown 事件
      element.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: char,
        keyCode: keyCode,
        which: keyCode,
      }));

      // keypress 事件
      element.dispatchEvent(new KeyboardEvent('keypress', {
        bubbles: true,
        cancelable: true,
        key: char,
        keyCode: keyCode,
        which: keyCode,
        charCode: keyCode,
      }));

      // 插入字符
      document.execCommand('insertText', false, char);

      // input 事件
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: char,
      }));

      // keyup 事件
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

/**
 * 直接设置文本内容 - 先全选再替换（模拟用户输入行为）
 * 适用于 Notion AI 等现代编辑器
 * @param {Element} element - 目标元素
 * @param {string} text - 输入文本
 * @returns {boolean}
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
 * 设置输入元素的值（根据配置的 inputMode）
 * @param {Element} element - 输入元素
 * @param {string} value - 要设置的值
 * @returns {Promise<boolean>|boolean} contenteditable 模式返回 Promise
 */
async function setInputValue(element, value) {
  if (!element) {
    logWarning("输入元素不存在");
    return false;
  }

  // 检测是否为 contenteditable 元素
  const isContentEditable = element.isContentEditable ||
                           element.getAttribute('contenteditable') === 'true';

  if (isContentEditable) {
    // ========== Contenteditable 元素特殊处理 ==========
    const mode = PLATFORM_CONFIG.contenteditableInputMode;

    if (mode === 'auto') {
      // 自动模式：优先使用 beforeinput，失败则降级
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

  // ========== 普通 input/textarea 元素处理 ==========
  try {
    const trimmedValue = value.trim();

    switch (PLATFORM_CONFIG.inputMode) {
      case 'value':
        // 用于 input/textarea 元素
        element.value = trimmedValue;
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
      default:
        // 默认：根据元素类型自动选择
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

      case 'enter':
        // Enter 键模式：应该在 sendChatMessage 中处理，这里不应被调用
        logWarning("Enter 模式不应调用 triggerClick，请使用 sendWithEnterKey");
        return false;

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
 * GLM 只需要 mouseup 事件，不需要完整的 click
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

    // 模拟鼠标抬起（GLM 关键点：mouseup 就能触发）
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
//                     键盘工具 (Enter 键发送)
// ==========================================================

/**
 * 模拟 Enter 键发送消息
 *
 * 使用场景：
 * - Coze (coze.cn)：使用 CodeMirror 编辑器，Enter 键是发送快捷键
 * - 原因：编辑器型输入框，平台设计使用 Enter 发送而非按钮点击
 *
 * 使用方式：
 * 1. 设置 PLATFORM_CONFIG.clickMode = 'enter'
 * 2. 确保输入框已聚焦
 * 3. 调用 triggerEnterKey(inputElement)
 *
 * @param {Element} element - 输入框元素（需要先聚焦）
 * @returns {boolean} 是否成功
 */
function triggerEnterKey(element) {
  if (!element) {
    logWarning("元素为空，无法模拟 Enter 键");
    return false;
  }

  try {
    // 确保元素聚焦
    element.focus();

    // 获取元素位置（用于事件坐标）
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // 1. keydown 事件
    element.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      view: window,
      key: 'Enter',
      keyCode: 13,
      which: 13,
      code: 'Enter',
      location: 0,
      clientX: centerX,
      clientY: centerY,
    }));

    // 2. keypress 事件
    element.dispatchEvent(new KeyboardEvent('keypress', {
      bubbles: true,
      cancelable: true,
      view: window,
      key: 'Enter',
      keyCode: 13,
      which: 13,
      code: 'Enter',
      location: 0,
    }));

    // 3. keyup 事件
    element.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      view: window,
      key: 'Enter',
      keyCode: 13,
      which: 13,
      code: 'Enter',
      location: 0,
    }));

    logInfo("Enter 键事件链已触发");
    return true;
  } catch (e) {
    logError("Enter 键模拟失败", e);
    return false;
  }
}

/**
 * 使用 Enter 键发送消息（替代按钮点击）
 * 调用此函数替代 triggerClick
 *
 * @param {Element} inputElement - 输入框元素
 * @returns {boolean} 是否成功
 */
function sendWithEnterKey(inputElement) {
  if (!inputElement) {
    logWarning("输入框为空，无法发送");
    return false;
  }

  logInfo("使用 Enter 键发送消息");

  // 确保输入框聚焦
  inputElement.focus();
  delay(50); // 等待聚焦生效

  // 触发 Enter 键
  return triggerEnterKey(inputElement);
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

    // 5. 设置输入值（可能是异步的，如 contenteditable 逐字符输入）
    logInfo("正在设置输入值...");
    const inputResult = await setInputValue(inputElement, message);
    if (!inputResult) {
      logError("设置输入值失败");
      return false;
    }

    // 6. 触发输入事件
    if (!triggerInputEvents(inputElement)) {
      logError("触发输入事件失败");
      return false;
    }

    // 7. 输入后延迟（contenteditable 模式可能需要更长延迟）
    await delay(PLATFORM_CONFIG.inputDelay);

    // 8. 查找发送按钮
    logInfo("正在查找发送按钮...");
    const buttonElement = await waitForElement(BUTTON_SELECTORS, PLATFORM_CONFIG.elementTimeout, 'button');
    if (!buttonElement) {
      logError("未找到发送按钮");
      return false;
    }

    // 9. 等待按钮启用（针对 Slate 编辑器等异步状态更新的平台）
    if (PLATFORM_CONFIG.buttonEnableRetry.enabled) {
      const buttonReady = await waitForButtonEnabled(buttonElement, inputElement, message.trim());
      if (!buttonReady) {
        logError("发送按钮未能启用");
        return false;
      }
    } else {
      // 普通延迟
      await delay(PLATFORM_CONFIG.clickDelay);
    }

    // 10. 发送消息（根据 clickMode 选择方式）
    const clickMode = PLATFORM_CONFIG.clickMode;

    if (clickMode === 'enter') {
      // Enter 键发送模式（Coze 等编辑器型平台）
      logInfo("使用 Enter 键发送模式...");
      if (sendWithEnterKey(inputElement)) {
        logInfo("消息发送成功");
        return true;
      } else {
        logError("Enter 键发送失败");
        return false;
      }
    } else {
      // 普通按钮点击模式
      logInfo("正在点击发送按钮...");
      if (triggerClick(buttonElement)) {
        logInfo("消息发送成功");
        return true;
      } else {
        logError("点击发送按钮失败");
        return false;
      }
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
 * 等待按钮启用（针对异步状态更新的编辑器）
 *
 * 使用场景：
 * - 通义千问（Tongyi）：Slate 编辑器状态是异步更新的
 * - 原因：编辑器需要时间处理输入并更新 UI 状态
 * - 解决方案：轮询检查按钮是否启用，超时则重试触发输入事件
 *
 * @param {Element} buttonElement - 按钮元素
 * @param {Element} inputElement - 输入元素（用于重新触发事件）
 * @param {string} message - 消息内容（用于重新触发事件）
 * @returns {Promise<boolean>} 按钮是否启用
 */
async function waitForButtonEnabled(buttonElement, inputElement, message) {
  const { maxRetries, retryInterval } = PLATFORM_CONFIG.buttonEnableRetry;

  // 检查按钮是否启用的函数
  const checkButtonEnabled = () => {
    const buttonClass = buttonElement.className || '';
    return !buttonClass.includes('disabled') &&
           !buttonClass.includes('Disabled') &&
           !buttonElement.disabled;
  };

  // 如果已经启用，直接返回
  if (checkButtonEnabled()) {
    logInfo("发送按钮已启用");
    return true;
  }

  // 轮询等待按钮启用
  for (let i = 0; i < maxRetries; i++) {
    logWarning(`发送按钮仍处于禁用状态，等待启用... (${i + 1}/${maxRetries})`);

    // 尝试重新触发 input 事件来刷新编辑器状态
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
    // 配置
    config: PLATFORM_CONFIG,

    // 主函数
    sendChatMessage,

    // 查找工具
    findElementBySelectors,
    waitForElement,
    findInputElementIntelligently,   // 输入框兜底
    findButtonElementIntelligently,  // 按钮兜底
    findSendButtonNearInput,        // 输入框附近查找按钮
    isElementVisible,

    // 点击工具
    triggerClick,
    triggerNormalClick,
    triggerMouseUpClick,

    // 键盘工具
    triggerEnterKey,
    sendWithEnterKey,

    // 输入工具
    setInputValue,
    simulateContenteditableInput,
    inputWithBeforeInput,
    inputWithTyping,
    inputDirectly,

    // 其他工具
    activateInput,
    triggerInputEvents,
    waitForButtonEnabled,
  };
  logInfo("调试工具已暴露到 window.__platformScript");
}
}
