// ==========================================================
//                     通用查找器 (支持 CSS + XPath)
// ==========================================================
function findElementBySelectors(selectors) {
  for (const selector of selectors) {
    try {
      let element = null;
      if (selector.type === "css") {
        element = document.querySelector(selector.value);
      } else if (selector.type === "xpath") {
        const result = document.evaluate(
          selector.value,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        element = result.singleNodeValue;
      }

      if (element) {
        console.log(`成功成功找到元素: ${selector.type} -> ${selector.value}`);
        return element;
      }
    } catch (e) {
      console.warn(`选择器无效: ${selector.type} -> ${selector.value}`, e);
    }
  }
  console.warn("所有选择器都未找到元素");
  return null;
}

// 等待元素出现，支持重试机制，默认 3 秒超时
async function waitForElement(selectors, timeout = 3000, retryInterval = 100) {
  const start = Date.now();
  let attemptCount = 0;

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      attemptCount++;
      const element = findElementBySelectors(selectors);

      if (element) {
        clearInterval(timer);
        console.log(`元素在第 ${attemptCount} 次尝试中找到`);
        resolve(element);
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        console.warn(`元素查找超时，共尝试 ${attemptCount} 次`);
        resolve(null);
      }
    }, retryInterval);
  });
}

// ==========================================================
//                     输入 & 点击工具
// ==========================================================
function triggerInputEvents(element) {
  if (!element) {
    console.warn("输入元素不存在，无法触发事件");
    return false;
  }

  try {
    const events = [
      new Event("input", { bubbles: true, cancelable: true }),
      new Event("change", { bubbles: true, cancelable: true }),
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
      new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    ];

    events.forEach((event) => element.dispatchEvent(event));
    console.log("输入事件触发成功");
    return true;
  } catch (e) {
    console.error("触发输入事件失败", e);
    return false;
  }
}

/**
 * 向 ProseMirror / TipTap / Slate 等现代 contenteditable 编辑器注入文本。
 * 旧 textarea 走原生 value setter 路径。
 */
function injectMessageIntoInput(element, text) {
  if (!element || !text) {
    console.warn("元素或文本为空");
    return false;
  }

  const isContentEditable =
    element.isContentEditable ||
    element.getAttribute("contenteditable") === "true";

  if (!isContentEditable) {
    // 旧版 textarea / input 兼容
    const nativeSetter =
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set ||
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;

    if (nativeSetter) {
      nativeSetter.call(element, text);
    } else {
      element.value = text;
    }

    element.dispatchEvent(
      new Event("input", { bubbles: true, cancelable: true })
    );
    element.dispatchEvent(
      new Event("change", { bubbles: true, cancelable: true })
    );
    return true;
  }

  // contenteditable：ProseMirror / TipTap 路径
  element.focus();
  // 清空现有内容（保留占位 p 节点的 placeholder 行为由编辑器自己恢复）
  element.textContent = "";

  // beforeinput 是现代编辑器的标准钩子
  element.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text,
    })
  );

  // execCommand 已被 deprecated 但 ProseMirror 仍兼容
  let inserted = false;
  try {
    inserted = document.execCommand("insertText", false, text);
  } catch (e) {
    console.warn("execCommand insertText 抛错", e);
  }

  if (!inserted) {
    // 回退：直接写 textContent（部分 ProseMirror 配置会监听 mutation 兜底）
    console.warn("execCommand 失败，回退到 textContent 注入");
    element.textContent = text;
  }

  element.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: text,
    })
  );
  element.dispatchEvent(
    new Event("change", { bubbles: true, cancelable: true })
  );
  document.dispatchEvent(
    new Event("selectionchange", { bubbles: true })
  );

  console.log("✅ contenteditable 输入完成");
  return true;
}

function triggerClick(element) {
  if (!element) {
    console.warn("点击元素不存在");
    return false;
  }

  if (element.offsetParent === null) {
    console.warn("元素不可见，无法点击", element);
    return false;
  }

  if (element.disabled) {
    console.warn("元素已禁用，无法点击", element);
    return false;
  }

  try {
    element.click();
    console.log("点击成功");
    return true;
  } catch (e) {
    console.warn("普通点击失败，尝试鼠标事件", e);

    try {
      const mouseEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      element.dispatchEvent(mouseEvent);
      console.log("鼠标事件点击成功");
      return true;
    } catch (e2) {
      console.error("所有点击方式都失败", e2);
      return false;
    }
  }
}

// ==========================================================
//                     Doubao 输入框 & 按钮选择器
// ==========================================================
const inputSelectors = [
  // ==========================================================
  // 👇 【2026-08 新版】豆包改用 TipTap / ProseMirror contenteditable 编辑器
  // ==========================================================
  // 1. 最稳定：通过 guidance-input-content 容器 + contenteditable
  {
    type: "css",
    value: 'div.guidance-input-content div[contenteditable="true"]',
  },
  // 2. 通过 ProseMirror / TipTap class 定位
  {
    type: "css",
    value: 'div.guidance-input-content div.tiptap.ProseMirror',
  },
  // 3. role="textbox" 语义属性（与 Tongyi 一致的现代编辑器约定）
  {
    type: "css",
    value: 'div.guidance-input-content div[role="textbox"][contenteditable="true"]',
  },
  // 4. 不限定容器，直接找全局 contenteditable textbox（兜底）
  {
    type: "css",
    value: 'div[role="textbox"][contenteditable="true"].ProseMirror',
  },
  // 5. 用户提供的 jsPath（备选）
  {
    type: "css",
    value: 'div#input-engine-container div[contenteditable="true"]',
  },
  // 6. 通过 placeholder 文本定位
  {
    type: "xpath",
    value: '//div[@data-placeholder="发消息..."]',
  },

  // ==========================================================
  // 👇 旧版 textarea（保留，优先级最低，DOM 未升级场景兜底）
  // ==========================================================
  {
    type: "xpath",
    value:
      '//*[@id="chat-route-layout"]/div/main/div/div/div[2]/div/div/div[2]/div[2]/div[2]/div[1]/div[2]/div[2]/div[1]/div/textarea',
  },
  { type: "css", value: "#chat-route-layout textarea" },
];

const buttonSelectors = [
  // Doubao 发送按钮（id 仍然稳定）
  { type: "xpath", value: '//*[@id="flow-end-msg-send"]' },
  { type: "css", value: "#flow-end-msg-send" },
];

// ==========================================================
//                     主逻辑
// ==========================================================
let isSending = false; // 状态锁

function recycleResponseListener(reason) {
  const listener = window.__responseListenerInstances && window.__responseListenerInstances.doubao;
  if (!listener || typeof listener.reset !== "function") return;
  console.log(`Doubao 手动发送，回收回复监听: ${reason}`);
  listener.reset();
}

async function sendChatMessage(message) {
  if (isSending) {
    console.warn("正在发送中，请勿重复操作");
    return false;
  }

  if (!message || typeof message !== "string" || message.trim() === "") {
    console.error("消息内容无效");
    return false;
  }

  isSending = true;
  console.log("开始发送流程，已锁定发送状态");

  try {
    console.log("正在查找输入框...");

    const inputElement = await waitForElement(inputSelectors, 5000, 100);
    if (!inputElement) {
      console.error("未找到输入框，发送失败");
      return false;
    }

    // 增加200ms等待，确保元素状态稳定
    console.log("等待200ms后开始输入...");
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log("开始输入文本内容...");
    const finalMessage = message.trim();
    if (!injectMessageIntoInput(inputElement, finalMessage)) {
      console.error("注入文本失败");
      return false;
    }
    console.log("文本输入完成");

    console.log("等待编辑器处理输入事件...");
    await new Promise((resolve) => setTimeout(resolve, 400));

    console.log("正在查找发送按钮...");
    const buttonElement = await waitForElement(buttonSelectors, 5000, 100);
    if (!buttonElement) {
      console.error("未找到发送按钮");
      return false;
    }

    // 检查按钮是否被禁用（contenteditable 输入后按钮可能延迟启用）
    let retryCount = 0;
    const maxRetries = 5;
    while (
      retryCount < maxRetries &&
      (buttonElement.disabled ||
        buttonElement.getAttribute("aria-disabled") === "true" ||
        buttonElement.classList.contains("is-disabled"))
    ) {
      console.warn(
        `发送按钮仍处于禁用状态，等待启用... (${retryCount + 1}/${maxRetries})`
      );
      // 再补一次 input 事件，触发按钮启用
      inputElement.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: finalMessage,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      retryCount++;
    }

    // 增加200ms等待，确保输入已被处理
    console.log("等待200ms后准备发送...");
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (triggerClick(buttonElement)) {
      console.log("消息发送成功");
      return true;
    } else {
      console.error("点击发送失败");
      return false;
    }
  } catch (e) {
    console.error("发送流程异常", e);
    return false;
  } finally {
    isSending = false;
    console.log("发送流程结束，已解锁发送状态");
  }
}

// ==========================================================
//                     消息监听 & 环境检查
// ==========================================================
if (!window.location.hostname.includes("doubao")) {
  console.warn("当前页面不是 Doubao，脚本未激活");
} else {
  console.log("Doubao 内容脚本已加载并激活");

  if (!window.__doubaoManualRecycleBound) {
    window.__doubaoManualRecycleBound = true;

    document.addEventListener("click", (event) => {
      if (isSending) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("#flow-end-msg-send")) {
        recycleResponseListener("button-click");
      }
    }, true);

    document.addEventListener("keydown", (event) => {
      if (isSending) return;
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // 新版编辑器是 contenteditable div，旧版是 textarea，二者都要兼容
      const isInputTarget =
        target instanceof HTMLTextAreaElement || target.isContentEditable;
      if (!isInputTarget) return;
      if (
        target.closest("#chat-route-layout") ||
        target.closest("div.guidance-input-content")
      ) {
        recycleResponseListener("enter-key");
      }
    }, true);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sendMessage") {
      if (request.source === "background") {
        window.__doubaoLastSendTime = Date.now();
      }
      console.log(`收到消息发送请求: "${request.message}"`);

      sendChatMessage(request.message)
        .then((success) => {
          sendResponse({
            status: success ? "success" : "failed",
            platform: "doubao",
            timestamp: Date.now(),
          });
          console.log(`消息处理完成，状态: ${success ? "success" : "failed"}`);
        })
        .catch((error) => {
          console.error("消息处理异常", error);
          sendResponse({
            status: "error",
            platform: "doubao",
            error: error.message,
            timestamp: Date.now(),
          });
        });

      return true; // 异步响应
    }

    console.warn("收到未知的消息类型", request);
    sendResponse({ status: "unknown_action" });
  });
}

/**
 * @fileoverview
 * Doubao 聊天机器人内容脚本
 * 适配 Doubao 输入框和发送按钮
 *
 * 2026-08 修复：豆包把编辑器从 <textarea> 改为 TipTap / ProseMirror contenteditable
 *   - 新选择器链：div.guidance-input-content div[contenteditable="true"]
 *   - 输入方式：beforeinput 事件 + execCommand('insertText') 一次性注入
 *              （与 Tongyi Slate 编辑器同源方案）
 *   - 按钮启用重试：input 事件触发后按钮 aria-disabled 可能短暂为 true，
 *     增加 5×200ms 重试机制，必要时补 dispatch input 推动按钮启用
 *   - keydown 监听：兼容 textarea 与 contenteditable 两种目标
 *
 * 保留完整错误处理、事件触发、点击备用方案、状态锁及异步消息监听
 * 输入前和点击前各增加 200ms 等待时间，提高操作稳定性
 */
