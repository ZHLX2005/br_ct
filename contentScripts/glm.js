(function() {
if (window.__glmScriptInjected) {
  console.log("[GLM] 脚本已注入，跳过重复初始化");
  return;
}
window.__glmScriptInjected = true;

// ==========================================================
//                     通用查找器
// ==========================================================

/**
 * 通过一组 XPath 表达式查找页面中的第一个匹配元素
 * @param {string[]} xpaths - XPath 表达式数组
 * @returns {Element|null} - 找到的元素或 null
 */
function findElementByXPaths(xpaths) {
  for (const xpath of xpaths) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const element = result.singleNodeValue;
      if (element) {
        console.log(`成功找到元素: ${xpath}`);
        return element;
      }
    } catch (e) {
      console.warn(`XPath 表达式无效: ${xpath}`, e);
    }
  }
  return null;
}

/**
 * 等待元素出现，默认 3 秒超时
 * @param {string[]} xpaths - XPath 表达式数组
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Element|null>} - 返回找到的元素或超时后的 null
 */
async function waitForElement(xpaths, timeout = 3000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const element = findElementByXPaths(xpaths);
      if (element) {
        clearInterval(timer);
        resolve(element);
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        resolve(null);
      }
    }, 100); // 每 100ms 检查一次
  });
}

// ==========================================================
//                     输入 & 点击工具
// ==========================================================

/**
 * 触发元素的 input 事件，以通知框架内容已更改
 * @param {Element} element - 目标输入元素
 */
function triggerInputEvents(element) {
  if (!element) return;
  const inputEvent = new Event("input", { bubbles: true, cancelable: true });
  element.dispatchEvent(inputEvent);
}

/**
 * 安全地点击一个元素，使用视口坐标模拟真实点击
 * @param {Element} element - 目标点击元素
 * @returns {boolean} - 点击是否成功
 */
function triggerClick(element) {
  if (!element) {
    console.warn("点击元素不存在");
    return false;
  }
  
  // 检查元素是否可见
  if (element.offsetParent === null) {
    console.warn("元素不可见 (offsetParent 为 null)，无法点击", element);
    return false;
  }

  // 检查元素是否被 CSS 的 pointer-events 属性禁用
  const computedStyle = window.getComputedStyle(element);
  if (computedStyle.pointerEvents === 'none') {
    console.warn("元素被 CSS pointer-events: none 禁用，无法点击", element);
    return false;
  }
  
  if (element.disabled) {
    console.warn("元素已禁用，无法点击", element);
    return false;
  }
  
  try {
    // 获取元素在视口中的位置信息
    const rect = element.getBoundingClientRect();
    
    // 计算元素中心点坐标（视口内坐标）
    const clickX = rect.left + rect.width / 2;
    const clickY = rect.top + rect.height / 2;
    
    // 模拟「鼠标按下」事件
    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: clickX,    // 鼠标在视口中的X坐标
      clientY: clickY,    // 鼠标在视口中的Y坐标
      bubbles: true,      // 事件冒泡
      cancelable: true,
      view: window
    });
    
    
    // 按真实操作顺序触发事件（mousedown → mouseup → click）
    element.dispatchEvent(mousedownEvent);
   
    
    console.log(`已在视口坐标 (${clickX}, ${clickY}) 模拟完整点击`);
    return true;
  } catch (e) {
    console.error("模拟点击失败", e);
    return false;
  }
}

// ==========================================================
//                     主逻辑
// ==========================================================

let isSending = false; // 状态锁，防止重复发送

const MANUAL_INPUT_SELECTORS = [
  "#search-input-box textarea",
  "textarea[placeholder]",
  "textarea",
];

const MANUAL_BUTTON_SELECTORS = [
  "#search-input-box .enter-icon-container",
  "#search-input-box div[role=\"button\"]",
];

function recycleResponseListener(reason) {
  const listener = window.__responseListenerInstances && window.__responseListenerInstances.glm;
  if (!listener || typeof listener.reset !== "function") return;
  console.log(`GLM 手动发送，回收回复监听: ${reason}`);
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

if (!window.__glmManualRecycleBound) {
  window.__glmManualRecycleBound = true;

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
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return;
    if (matchesAnySelector(target, MANUAL_INPUT_SELECTORS)) {
      recycleResponseListener("enter-key");
    }
  }, true);
}

/**
 * 发送聊天消息的完整流程
 * @param {string} message - 要发送的消息内容
 * @returns {Promise<boolean>} - 发送是否成功
 */
async function sendChatMessage(message) {
  if (isSending) {
    console.warn("正在发送中，请勿重复操作");
    return false;
  }

  isSending = true;
  console.log("开始发送流程，已锁定发送状态");

  // ====== [GLM] - 输入框 XPath ======
  const inputXPaths = [
    '//*[@id="search-input-box"]/div/div[1]/textarea', // 精确路径
    '//textarea[@placeholder="和我聊聊天吧"]',         // 通过 placeholder 属性查找
    '//textarea[contains(@class, "scroll-display-none")]', // 通过 class 属性查找
  ];

  // ====== [GLM] - 发送按钮 XPath ======
  const buttonXPaths = [
    '//*[@id="search-input-box"]/div/div[2]/div[2]/div/div',
    '//div[contains(@class, "enter-icon-container")]'
  ];

  // 1. 找输入框
  const inputElement = await waitForElement(inputXPaths, 3000);
  if (!inputElement) {
    console.error("未找到输入框");
    isSending = false;
    return false;
  }

  // 2. 输入内容
  try {
    inputElement.value = message;
    triggerInputEvents(inputElement);
    console.log("文本输入完成");
  } catch (e) {
    console.error("输入文本失败", e);
    isSending = false;
    return false;
  }

  // 3. 等待按钮出现
  const buttonElement = await waitForElement(buttonXPaths, 3000);
  if (!buttonElement) {
    console.error("未找到发送按钮");
    isSending = false;
    return false;
  }

  // 4. 延时点击
  setTimeout(() => {
    if (triggerClick(buttonElement)) {
      console.log("消息发送成功");
    } else {
      console.error("点击发送失败");
    }
    isSending = false;
    console.log("发送流程结束，已解锁发送状态");
  }, 100);

  return true;
}

// ==========================================================
//                     消息监听
// ==========================================================

/**
 * 监听来自 Chrome Extension background 或 popup 的消息
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "sendMessage") {
    console.log(`收到消息发送请求: ${request.message}`);
    sendChatMessage(request.message).then((success) => {
      sendResponse({
        status: success ? "success" : "failed"
      });
    });
    return true; // 保持消息通道开放以进行异步响应
  }
});

})();
