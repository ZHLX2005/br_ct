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

        // 划词提取结果 — 先存到 session storage，再打开 sidebar 并转发
        if (request.action === "sideSelExtracted") {
            // 1) 存到 session storage（可靠：sidebar 加载后自己来取）
            chrome.storage.session.set({
                pendingSelection: {
                    text: request.text,
                    title: request.title,
                    url: request.url,
                }
            }).catch(() => {});

            // 2) 打开 sidebar（如果没开）
            const windowId = sender.tab?.windowId;
            if (windowId) {
                chrome.sidePanel.open({ windowId }).catch(() => {});
            }

            // 3) 也尝试直接转发（sidebar 已经开着的情况，快速路径）
            chrome.runtime.sendMessage({
                action: "sidebarSelectionResult",
                text: request.text,
                title: request.title,
                url: request.url,
            }).catch(() => {});
            sendResponse({ status: "success" });
            return true;
        }

        return false;
    });
}
