// ==========================================================
//                     Helper Functions
// ==========================================================

// 通过 XPath 获取元素
function getElementByXpath(xpath) {
  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch (e) {
    console.error(`XPath 表达式无效: ${xpath}`, e);
    return null;
  }
}

// 触发输入元素的完整事件序列
function triggerInputEvents(element) {
  if (!element) {
    console.warn("尝试对空元素触发输入事件。");
    return;
  }
  const inputEvent = new Event('input', {
    bubbles: true,
    cancelable: true
  });
  element.dispatchEvent(inputEvent);
}

// 更可靠的点击方法（支持 Angular Material 等现代框架）
function triggerClick(element) {
  if (!element) {
    console.warn('尝试点击空元素。');
    return false;
  }
  // 对于 aria-disabled 的按钮，disabled property 可能为 false，但应允许点击尝试
  // 仅当原生 disabled 为 true 时才阻止
  if (element.disabled === true) {
    console.warn('元素已被禁用。', element);
    return false;
  }
  try {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + window.screenX,
      screenY: y + window.screenY,
    };

    // 完整事件序列以触发 Angular/React 等框架的绑定
    element.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mousedown', eventInit));
    element.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseup', eventInit));
    element.dispatchEvent(new MouseEvent('click', eventInit));
    return true;
  } catch (e) {
    console.error('点击事件失败:', e);
    // 兜底：直接调用 click()
    try {
      element.click();
      return true;
    } catch (e2) {
      console.error('兜底 click() 也失败:', e2);
      return false;
    }
  }
}

// ==========================================================
//                     Element Finders
// ==========================================================

/**
 * 按优先级尝试多个选择器来查找输入框
 */
function findInputElement() {
  const xpaths = [
    // 最佳选择：定位在 rich-textarea 组件内的 p 标签 (最稳定)
    '//rich-textarea/div[1]/p',
    // 备选方案1：通过 ARIA role 属性定位 (非常稳定)
    "//div[@role='textbox'][@contenteditable='true']/p",
    // 备选方案2：通过可能的父容器 class 定位 (比较稳定)
    "//div[contains(@class, 'input-area')]//p[@contenteditable='true']",
    // 最后的备用方案：您的原始 XPath
    '//*[@id="app-root"]/main/side-navigation-v2/mat-sidenav-container/mat-sidenav-content/div/div[2]/chat-window/div/input-container/div/input-area-v2/div/div/div[1]/div/div/rich-textarea/div[1]/p'
  ];

  for (const xpath of xpaths) {
    const element = getElementByXpath(xpath);
    if (element) {
      console.log(`使用 XPath 成功找到输入框: ${xpath}`);
      return element;
    }
  }

  return null;
}

/**
 * 按优先级尝试多个选择器来查找发送按钮
 */
function findSendButton() {
  const xpaths = [
    // 最新 UI：中文 aria-label
    "//button[@aria-label='发送']",
    // 旧版英文 aria-label
    "//button[@aria-label='Send message']",
    // 通过 send-button class 定位 gem-icon-button 内部的 button
    "//gem-icon-button[contains(@class,'send-button')]//button",
    "//button[contains(@class, 'send-button')]",
    // 通过 data-test-id 定位容器内的 button
    "//*[@data-test-id='send-button-container']//button",
    // 通用备选方案：通过按钮内的文本内容定位
    "//button[.//span[contains(text(),'Send')]]",
    // 最后的备用方案：依赖于完整的 DOM 路径
    '//*[@id="app-root"]/main/side-navigation-v2/mat-sidenav-container/mat-sidenav-content/div/div[2]/chat-window/div/input-container/div/input-area-v2/div/div/div[3]/div/div[2]/button'
  ];

  for (const xpath of xpaths) {
    const element = getElementByXpath(xpath);
    // 检查找到的元素是否是按钮或其父元素
    if (element) {
        // 如果找到的是子元素，尝试返回其父元素，直到找到 <button> 标签
        let button = element;
        while (button && button.tagName !== 'BUTTON') {
            button = button.parentElement;
        }
        if (button) {
            console.log(`使用 XPath 成功找到发送按钮: ${xpath}`);
            return button;
        }
    }
  }

  return null;
}

// ==========================================================
//                     Main Logic
// ==========================================================

// 使用状态锁防止重复点击
let isSending = false;

const MANUAL_INPUT_SELECTORS = [
  "rich-textarea",
  "div[role=\"textbox\"][contenteditable=\"true\"]",
  "div[contenteditable=\"true\"]",
];

const MANUAL_BUTTON_SELECTORS = [
  "button[aria-label=\"发送\"]",
  "button[aria-label=\"Send message\"]",
  "button[type=\"submit\"]",
  "gem-icon-button.send-button button",
];

function recycleResponseListener(reason) {
  const listener = window.__responseListenerInstances && window.__responseListenerInstances.gemini;
  if (!listener || typeof listener.reset !== "function") return;
  console.log(`Gemini 手动发送，回收回复监听: ${reason}`);
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

if (!window.__geminiManualRecycleBound) {
  window.__geminiManualRecycleBound = true;

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

/**
 * 主函数：输入文本并发送
 * @param {string} message 要发送的文本
 * @returns {boolean} 操作是否成功
 */
function sendChatMessage(message) {
  // 检查状态锁，如果正在发送则直接退出
  if (isSending) {
    console.warn("正在发送消息，请勿重复操作。");
    return false;
  }

  const inputElement = findInputElement();
  if (!inputElement) {
    console.error("未找到输入框元素。");
    return false;
  }

  // 1. 设置状态锁为 true，表示开始发送
  isSending = true;
  console.log("开始发送流程，已锁定发送状态。");

  // 2. 输入文本
  try {
    inputElement.textContent = message;
    triggerInputEvents(inputElement);
    console.log("文本输入成功，已触发输入事件。");
  } catch (e) {
    console.error('输入文本失败:', e);
    isSending = false; // 失败时解锁
    return false;
  }

  // 3. 查找发送按钮
  const buttonElement = findSendButton();
  if (!buttonElement) {
    console.error("未找到发送按钮。");
    isSending = false; // 失败时解锁
    return false;
  }

  // 4. 延时后执行点击，确保输入事件被处理
  setTimeout(() => {
    if (triggerClick(buttonElement)) {
      console.log("消息发送成功！");
    } else {
      console.error("发送失败。");
    }
    // 5. 无论成功与否，发送流程结束，解锁
    isSending = false;
    console.log("发送流程结束，已解锁发送状态。");
  }, 100);

  return true;
}

// ==========================================================
//                     Message Listener
// ==========================================================

// 监听插件消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "sendMessage") {
    console.log(`收到消息发送请求: "${request.message}"`);
    const success = sendChatMessage(request.message);
    sendResponse({
      status: success ? "success" : "failed"
    });
  }
  // 异步响应时需要返回 true
  return true;
});
