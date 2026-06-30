/**
 * @fileoverview ChatGPT最新回答CDP复制
 *
 * @scenario    通过 popup 调用复制ChatGPT页面最新回答
 * @feature     发送消息触发后台执行CDP复制命令
 * @effect      把ChatGPT最新回答写入系统剪贴板
 * @category    平台专属
 * @platform    chatgpt
 * @entry       main()
 */
export async function main() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'chatgptCdpCopyLatest' }, (resp) => {
      resolve({
        success: !chrome.runtime.lastError && resp?.status !== 'error',
        resp,
        lastError: chrome.runtime.lastError?.message || null
      });
    });
  });
}
