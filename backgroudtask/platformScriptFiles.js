export function getPlatformScriptFiles(platform) {
  if (platform === "chatgpt") {
    return ["contentScripts/chatgpt.js"];
  }

  if (platform === "doubao") {
    return ["contentScripts/doubao.js"];
  }

  if (platform === "claude") {
    return ["contentScripts/claude.js"];
  }

  if (platform === "gemini") {
    return ["contentScripts/gemini.js"];
  }

  if (platform === "deepseek") {
    return ["contentScripts/deepseek.js"];
  }

  if (platform === "grok") {
    return ["contentScripts/grok.js"];
  }

  if (platform === "glm") {
    return ["contentScripts/glm.js"];
  }

  if (platform === "kimi") {
    return ["contentScripts/kimi.js"];
  }

  if (platform === "yuanbao") {
    return ["contentScripts/yuanbao.js", "contentScripts/nav/yuanbao.js"];
  }

  if (platform === "tongyi") {
    return ["contentScripts/tongyi.js"];
  }

  if (platform === "googlestudio") {
    return ["contentScripts/googlestudio.js"];
  }

  if (platform === "notionai") {
    return ["contentScripts/notionai.js"];
  }

  if (platform === "coze") {
    return ["contentScripts/coze.js"];
  }

  if (platform === "coderqwen") {
    return ["contentScripts/coderqwen.js"];
  }

  if (platform === "zai") {
    return ["contentScripts/zai.js"];
  }

  if (platform === "xiaomi") {
    return ["contentScripts/xiaomi.js"];
  }

  return [`contentScripts/${platform}.js`];
}