// html_text_reader/index.js - 页面文本提取服务
// 使用 Mozilla Readability 提取当前页面的纯文本

const READABILITY_JS = "funcs/mods/html_text_reader/Readability.js";
const EXTRACTOR_JS = "funcs/mods/html_text_reader/pageTextExtractor.js";

/**
 * 提取当前活动标签页的页面文本
 */
function extractPageText(sendResponse) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
            sendResponse({ status: "failed", message: "未找到活跃的标签页。" });
            return;
        }

        const tabId = tabs[0].id;

        // 先注入 Readability.js，再注入 pageTextExtractor.js
        chrome.scripting.executeScript(
            {
                target: { tabId: tabId },
                files: [READABILITY_JS, EXTRACTOR_JS],
            },
            () => {
                if (chrome.runtime.lastError) {
                    console.error("[HtmlTextReader] 脚本注入失败:", chrome.runtime.lastError.message);
                    sendResponse({
                        status: "failed",
                        message: chrome.runtime.lastError.message,
                    });
                    return;
                }

                // 调用 pageTextExtractor 的 main() 函数
                chrome.scripting.executeScript(
                    {
                        target: { tabId: tabId },
                        func: () => {
                            if (typeof main === "function") {
                                const result = main();
                                return { status: "success", result: result };
                            }
                            return { status: "failed", message: "未找到 main() 函数。" };
                        },
                    },
                    (results) => {
                        if (chrome.runtime.lastError || !results || results[0].result.status === "failed") {
                            const errorMsg = chrome.runtime.lastError?.message || results?.[0]?.result?.message;
                            console.error("[HtmlTextReader] main() 执行失败:", errorMsg);
                            sendResponse({ status: "failed", message: errorMsg });
                        } else {
                            console.log("[HtmlTextReader] 页面文本提取成功");
                            sendResponse({
                                status: "success",
                                result: results[0].result.result,
                            });
                        }
                    }
                );
            }
        );
    });
}

/**
 * 设置消息监听器
 */
export function setupHtmlTextReaderListener() {
    console.log("[Background] setupHtmlTextReaderListener 注册页面文本提取监听器");

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "extractPageText") {
            extractPageText(sendResponse);
            return true;
        }

        return false;
    });
}
