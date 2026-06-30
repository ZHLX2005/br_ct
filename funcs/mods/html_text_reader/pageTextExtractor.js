/**
 * @fileoverview Readability 阅读模式文本提取器
 *
 * @scenario    启用页面阅读模式或提取正文时
 * @feature     基于 Mozilla Readability 解析 Document 抽取正文
 * @effect      返回标题、摘要、纯文本内容，不修改页面 DOM
 * @category    数据提取
 * @platform    通用
 * @entry       main()
 */

// pageTextExtractor.js - 使用 Mozilla Readability 提取页面纯文本
// 依赖: Readability.js (需先注入)

/**
 * 清理文本
 */
function cleanText(text) {
    if (!text) return "";
    return text
        .trim()
        .replace(/(\n){4,}/g, "\n\n\n")
        .replace(/ {3,}/g, "  ")
        .replace(/\t/g, "")
        .replace(/\n+(\s*\n)*/g, "\n");
}

/**
 * 使用 Mozilla Readability 提取页面内容（不修改原始 DOM）
 */
function main() {
    try {
        // 获取标题
        let title = document.title || "";

        // 获取 meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        let description = metaDesc ? metaDesc.getAttribute("content") || "" : "";

        let textContent = "";

        // 使用 Readability 提取主要内容
        if (typeof Readability !== "undefined") {
            // 用 DOMParser 解析完整页面副本
            const parser = new DOMParser();
            const doc = parser.parseFromString(
                "<!DOCTYPE html>" + document.documentElement.outerHTML,
                "text/html"
            );

            // Readability 接收完整 Document
            const reader = new Readability(doc);
            const article = reader.parse();

            if (article && article.textContent) {
                textContent = cleanText(article.textContent);
                if (!title && article.title) {
                    title = article.title;
                }
                if (article.excerpt) {
                    description = article.excerpt;
                }
            }
        } else {
            // Readability 不可用时回退到简单提取
            console.warn("Readability 未加载，使用回退方案");
            const contentEl = document.querySelector("article") || document.querySelector("main") || document.body;
            const clone = contentEl.cloneNode(true);
            textContent = cleanText(clone.innerText || clone.textContent || "");
        }

        // 限制长度（14,500 字符）
        const maxLength = 14500;
        let truncated = false;
        if (textContent.length > maxLength) {
            textContent = textContent.slice(0, maxLength);
            truncated = true;
        }

        if (truncated) {
            textContent += "\n\n[文本已被截断至 14,500 字符]";
        }

        return {
            title: title,
            description: description,
            text: textContent,
            url: window.location.href,
            extracted: true,
            method: typeof Readability !== "undefined" ? "readability" : "fallback"
        };
    } catch (error) {
        console.error("页面文本提取失败:", error);
        return {
            title: document.title || "",
            description: "",
            text: "",
            url: window.location.href,
            extracted: false,
            error: error.message
        };
    }
}
