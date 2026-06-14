export function getPlatformScriptFiles(platform) {
  if (platform === "chatgpt") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/chatgpt.js",
      "contentScripts/chatgpt.js",
    ];
  }

  if (platform === "doubao") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/doubao.js",
      "contentScripts/doubao.js",
    ];
  }

  if (platform === "claude") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/claude.js",
      "contentScripts/claude.js",
    ];
  }

  if (platform === "gemini") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/gemini.js",
      "contentScripts/gemini.js",
    ];
  }

  if (platform === "deepseek") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/deepseek.js",
      "contentScripts/deepseek.js",
    ];
  }

  if (platform === "grok") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/grok.js",
      "contentScripts/grok.js",
    ];
  }

  if (platform === "glm") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/glm.js",
      "contentScripts/glm.js",
    ];
  }

  if (platform === "kimi") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/kimi.js",
      "contentScripts/kimi.js",
    ];
  }

  if (platform === "yuanbao") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/yuanbao.js",
      "contentScripts/yuanbao.js",
    ];
  }

  if (platform === "tongyi") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/tongyi.js",
      "contentScripts/tongyi.js",
    ];
  }

  if (platform === "googlestudio") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/googlestudio.js",
      "contentScripts/googlestudio.js",
    ];
  }

  if (platform === "notionai") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/notionai.js",
      "contentScripts/notionai.js",
    ];
  }

  if (platform === "coze") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/coze.js",
      "contentScripts/coze.js",
    ];
  }

  if (platform === "coderqwen") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/coderqwen.js",
      "contentScripts/coderqwen.js",
    ];
  }

  if (platform === "zai") {
    return [
      "contentScripts/clipboardCapture/core.js",
      "contentScripts/clipboardCapture/configs/zai.js",
      "contentScripts/zai.js",
    ];
  }

  if (platform === "xiaomi") {
    return [
      "contentScripts/xiaomi.js",
    ];
  }

  return [`contentScripts/${platform}.js`];
}

// 获取回复监听脚本（用于发送消息成功后再注入）
export function getResponseListenerFiles(platform) {
  if (platform === "chatgpt") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/chatgptResponseListener.js",
    ];
  }

  if (platform === "doubao") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/doubaoResponseListener.js",
    ];
  }

  if (platform === "claude") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/claudeResponseListener.js",
    ];
  }

  if (platform === "gemini") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/geminiResponseListener.js",
    ];
  }

  if (platform === "deepseek") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/deepseekResponseListener.js",
    ];
  }

  if (platform === "grok") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/grokResponseListener.js",
    ];
  }

  if (platform === "glm") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/glmResponseListener.js",
    ];
  }

  if (platform === "kimi") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/kimiResponseListener.js",
    ];
  }

  if (platform === "yuanbao") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/yuanbaoResponseListener.js",
    ];
  }

  if (platform === "tongyi") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/tongyiResponseListener.js",
    ];
  }

  if (platform === "googlestudio") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/googlestudioResponseListener.js",
    ];
  }

  if (platform === "notionai") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/notionaiResponseListener.js",
    ];
  }

  if (platform === "coze") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/cozeResponseListener.js",
    ];
  }

  if (platform === "coderqwen") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/coderqwenResponseListener.js",
    ];
  }

  if (platform === "zai") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/zaiResponseListener.js",
    ];
  }

  if (platform === "xiaomi") {
    return [
      "contentScripts/chatResponse/responseListenerCore.js",
      "contentScripts/chatResponse/xiaomiResponseListener.js",
    ];
  }

  return [];
}
