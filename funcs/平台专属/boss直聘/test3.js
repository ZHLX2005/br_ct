/**
 * @fileoverview Boss直聘随机延迟打招呼测试
 *
 * @scenario    Boss直聘职位详情页测试用
 * @feature     随机延迟点击主按钮+取消弹窗
 * @effect      模拟真人节奏批量打招呼
 * @category    自动化点击
 * @platform    boss直聘
 * @entry       自动执行
 */
(async function() {
    // ===================================
    // 1. 配置参数
    // ===================================
    
    // 核心选择器
    const CONTAINER_SELECTOR = "#wrap > div.page-jobs-main > div.job-recommend-result > div > div > div.job-list-container";
    const ITEM_SELECTOR = "ul > div > div > li > div:first-child"; // 列表项的通用相对路径

    // 随机延迟范围（毫秒）：最小延迟 1秒，最大延迟 3秒
    const MIN_DELAY = 1000;
    const MAX_DELAY = 3000;

    // 选择器：右侧详情面板的操作按钮和弹窗按钮
    const PRIMARY_BTN_SEL = "#wrap > div.page-jobs-main > div.job-recommend-result > div > div > div.job-detail-container > div.job-detail-box > div.job-detail-header > div.job-detail-op.clearfix > a.op-btn.op-btn-chat";
    const PRIMARY_BTN_XPATH = '//*[@id="wrap"]/div[2]/div[3]/div/div/div[2]/div[1]/div[1]/div[2]/a[2]'; // 备用

    const DIALOG_CANCEL_SEL = "body > div.greet-boss-dialog > div.greet-boss-container > div.greet-boss-footer > a.default-btn.cancel-btn";
    const DIALOG_CANCEL_XPATH = '/html/body/div[13]/div[2]/div[3]/a[1]'; // 备用

    // ===================================
    // 2. 实用工具函数
    // ===================================

    /**
     * 生成并返回一个随机延迟时间（毫秒）。
     * @returns {number} 随机延迟时间
     */
    const getRandomDelay = () => {
        // Math.random() * (max - min) + min
        return Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1)) + MIN_DELAY;
    };
    
    /**
     * 延迟函数，用于等待指定时间。
     * @param {number} ms - 延迟毫秒数
     */
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    /**
     * 获取元素函数，支持 CSS 选择器和 XPath。
     */
    const getElement = (selector, isXPath = false) => {
        if (isXPath) {
            try {
                const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return result.singleNodeValue;
            } catch (e) {
                return null;
            }
        } else {
            return document.querySelector(selector);
        }
    };

    /**
     * 模拟点击函数，确保元素存在。
     */
    const simulateClick = (element, name = '元素') => {
        if (element) {
            try {
                element.click();
                console.log(`\t✅ 成功点击: ${name}`);
                return true;
            } catch (e) {
                console.error(`\t❌ 点击 ${name} 时发生错误:`, e);
                return false;
            }
        } else {
            console.warn(`\t⚠️ 无法找到 ${name}，跳过点击。`);
            return false;
        }
    };

    // ===================================
    // 3. 初始化和主要流程
    // ===================================
    
    console.log("🚀 开始执行自动化点击脚本（含随机延迟）...");
    
    // 获取父容器
    const container = getElement(CONTAINER_SELECTOR);

    if (!container) {
        console.error("错误：未找到指定的列表容器！请检查选择器是否正确。");
        return;
    }

    // 查找所有要点击的列表项
    const jobItems = container.querySelectorAll(ITEM_SELECTOR);
    
    if (jobItems.length === 0) {
        console.warn("警告：在容器中未找到任何列表条目。");
        return;
    }

    console.log(`👉 找到了 ${jobItems.length} 个条目，开始逐一处理...`);

    // 遍历所有列表项
    for (let index = 0; index < jobItems.length; index++) {
        const item = jobItems[index];
        const currentNum = index + 1;

        console.log(`\n--- 正在处理第 ${currentNum} / ${jobItems.length} 个条目 ---`);
        
        // 1. 点击左侧列表项
        try {
            item.click(); 
            console.log(`\t✅ 列表项点击成功。等待详情加载...`);
        } catch (error) {
            console.error(`\t❌ 点击列表项时发生错误:`, error);
            // 即使失败，也尝试继续下一个
            continue;
        }
        
        // 引入 **随机延迟** 等待右侧详情加载
        let currentDelay = getRandomDelay();
        console.log(`\t⏸️ 等待 ${currentDelay}ms...`);
        await delay(currentDelay);

        // 2. 执行右侧详情面板操作 (模拟点击主按钮)
        let primaryButton = getElement(PRIMARY_BTN_SEL);
        if (!primaryButton) {
            primaryButton = getElement(PRIMARY_BTN_XPATH, true);
        }
        simulateClick(primaryButton, '主操作/聊天按钮');
        
        // 暂停 500 毫秒，等待弹窗出现（这个可以固定）
        await delay(500);

        // 3. 点击弹窗中的取消/关闭按钮
        let cancelButton = getElement(DIALOG_CANCEL_SEL);
        if (!cancelButton) {
            cancelButton = getElement(DIALOG_CANCEL_XPATH, true);
        }
        simulateClick(cancelButton, '弹窗取消按钮');

        // 引入 **随机延迟** 等待下一个循环
        currentDelay = getRandomDelay();
        console.log(`\t⏸️ 完成详情操作，等待 ${currentDelay}ms 后处理下一个条目...`);
        await delay(currentDelay);
    }

    console.log("\n================================");
    console.log("🎉 所有条目处理完成。");
    console.log("================================");
})();