/**
 * @fileoverview Boss直聘主按钮点击测试
 *
 * @scenario    Boss直聘职位详情页测试用
 * @feature     尝试用CSS/XPath双选择器点击主操作按钮
 * @effect      模拟点击"立即沟通"按钮
 * @category    自动化点击
 * @platform    boss直聘
 * @entry       自动执行
 */
(async function() {
    // --- 实用工具函数 ---

    // 延迟函数，用于等待元素加载或动画完成
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 获取元素函数，支持 CSS 选择器和 XPath
    const getElement = (selector, isXPath = false) => {
        if (isXPath) {
            try {
                // 使用 document.evaluate 解析 XPath
                const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return result.singleNodeValue;
            } catch (e) {
                console.error("XPath 查找失败:", e);
                return null;
            }
        } else {
            // 使用 document.querySelector 解析 CSS Selector
            return document.querySelector(selector);
        }
    };

    // 模拟点击函数，确保元素存在
    const simulateClick = (element, name = '元素') => {
        if (element) {
            try {
                element.click();
                console.log(`✅ 成功点击: ${name}`);
                return true;
            } catch (e) {
                console.error(`❌ 点击 ${name} 时发生错误:`, e);
                return false;
            }
        } else {
            console.warn(`⚠️ 无法找到 ${name}，跳过点击。`);
            return false;
        }
    };

    // --- 执行点击操作 ---

    console.log("🚀 开始执行自动化点击脚本...");

    // 1. 点击主操作按钮 (我们优先使用清晰的 CSS 选择器: .op-btn-chat)
    // 同时也尝试您提供的第一个 XPath 作为备选 (//*[@id="wrap"]/div[2]/div[3]/div/div/div[2]/div[1]/div[1]/div[2]/a[2])
    const primaryButtonSelector = "#wrap > div.page-jobs-main > div.job-recommend-result > div > div > div.job-detail-container > div.job-detail-box > div.job-detail-header > div.job-detail-op.clearfix > a.op-btn.op-btn-chat";
    const primaryButtonXPath = '//*[@id="wrap"]/div[2]/div[3]/div/div/div[2]/div[1]/div[1]/div[2]/a[2]';
    
    let primaryButton = getElement(primaryButtonSelector);
    if (!primaryButton) {
        // 如果 CSS 选择器未找到，尝试使用 XPath
        primaryButton = getElement(primaryButtonXPath, true);
    }
    
    simulateClick(primaryButton, '主操作/聊天按钮');
    
    // 2. 暂停 500 毫秒，等待弹窗出现
    await delay(500);

    // 3. 点击弹窗中的取消/关闭按钮 (我们优先使用清晰的 CSS 选择器: .cancel-btn)
    // 同时也尝试您提供的第二个 XPath 作为备选 (/html/body/div[13]/div[2]/div[3]/a[1])
    const dialogCancelSelector = "body > div.greet-boss-dialog > div.greet-boss-container > div.greet-boss-footer > a.default-btn.cancel-btn";
    const dialogCancelXPath = '/html/body/div[13]/div[2]/div[3]/a[1]';

    let cancelButton = getElement(dialogCancelSelector);
    if (!cancelButton) {
        // 如果 CSS 选择器未找到，尝试使用 XPath
        cancelButton = getElement(dialogCancelXPath, true);
    }

    simulateClick(cancelButton, '弹窗取消按钮');

    console.log("✅ 脚本执行完毕。");
})();