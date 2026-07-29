/**
 * @fileoverview Boss直聘加载+打招呼合并脚本
 *
 * @scenario    Boss直聘推荐职位列表页（需先滚到底部触发懒加载，再逐条点击打招呼）
 * @feature     自动滚动到底部加载全部职位，再遍历列表点击"立即沟通"并关闭弹窗
 * @effect      触发页面动态内容加载直至滚到底部，随后模拟批量点击操作
 * @category    自动化点击
 * @platform    boss直聘
 * @entry       main()
 *
 * @test_url    推荐列表页（滚动+点击）：https://www.zhipin.com/web/geek/job-recommend
 */

// ===================================
// 1. 配置参数
// ===================================

// 核心选择器
const CONTAINER_SELECTOR = "#wrap > div.page-jobs-main > div.job-recommend-result > div > div > div.job-list-container";
const ITEM_SELECTOR = "ul > div > div > li > div:first-child"; // 列表项的通用相对路径

// 随机延迟范围（毫秒）：最小延迟 1秒，最大延迟 3秒
const MIN_DELAY = 1000;
const MAX_DELAY = 3000;

// 滚动参数
const SCROLL_STEP = 500;          // 每次滚动的步长（像素）
const SCROLL_INTERVAL = 300;      // 每次滚动的间隔时间（毫秒）
const SCROLL_BOTTOM_HOLD = 3000;  // 到达底部后停留时间（毫秒）
const SCROLL_BOTTOM_THRESHOLD = 100; // 视口底部与页面总高度的容差（像素）

// 滚动完成后，遍历点击前的缓冲（毫秒），等 DOM 稳定
const POST_SCROLL_BUFFER = 2000;

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
// 3. 脚本1：滚动到页面底部，触发懒加载
// ===================================

/**
 * 滚动到页面底部（支持动态加载内容），并停留 3 秒后停止，返回 Promise。
 * @param {number} step - 每次滚动的步长（像素）
 * @param {number} interval - 每次滚动的间隔时间（毫秒）
 * @param {number} bottomHold - 到达底部后停留时间（毫秒）
 * @param {number} threshold - 视口底部与页面总高度的容差（像素）
 * @returns {Promise<void>}
 */
function scrollToBottomAndWait(
    step = SCROLL_STEP,
    interval = SCROLL_INTERVAL,
    bottomHold = SCROLL_BOTTOM_HOLD,
    threshold = SCROLL_BOTTOM_THRESHOLD
) {
    return new Promise((resolve) => {
        // 记录上一次的页面总高度，用于检测是否有新内容加载
        let lastScrollHeight = document.documentElement.scrollHeight;
        // 滚动锁，防止重复执行滚动
        let isScrolling = true;

        // 滚动函数
        const scrollStep = () => {
            if (!isScrolling) return;

            // 滚动页面（每次滚动指定步长）
            window.scrollBy(0, step);

            // 等待一小段时间，让动态内容加载
            setTimeout(() => {
                // 获取当前页面的总高度
                const currentScrollHeight = document.documentElement.scrollHeight;
                // 获取当前视口底部的位置
                const currentViewportBottom = window.innerHeight + window.scrollY;

                // 判断是否到达页面底部：
                // 1. 视口底部接近页面总高度（误差 threshold 像素，避免因微小差异判断错误）
                // 2. 页面高度不再变化（说明没有新内容加载）
                const isBottom = currentViewportBottom >= currentScrollHeight - threshold && currentScrollHeight === lastScrollHeight;

                if (isBottom) {
                    // 到达底部后，停留 3 秒
                    console.log(`已到达页面底部，将停留 ${bottomHold / 1000} 秒后停止`);
                    setTimeout(() => {
                        isScrolling = false;
                        console.log('停留结束，已停止滚动');
                        resolve();
                    }, bottomHold);
                } else {
                    // 更新上一次的页面高度
                    lastScrollHeight = currentScrollHeight;
                    // 继续滚动
                    scrollStep();
                }
            }, interval);
        };

        // 启动滚动
        scrollStep();
    });
}

// ===================================
// 4. 脚本2：遍历列表项点击打招呼
// ===================================

/**
 * 遍历列表项，点击左侧条目 → 点击右侧"立即沟通" → 关闭弹窗。
 * @returns {Promise<{total: number, clicked: number}>}
 */
async function runGreet() {
    console.log("\n================================");
    console.log("🚀 开始执行自动化点击脚本（含随机延迟）...");
    console.log("================================");

    // 获取父容器
    const container = getElement(CONTAINER_SELECTOR);

    if (!container) {
        console.error("错误：未找到指定的列表容器！请检查选择器是否正确。");
        return { total: 0, clicked: 0 };
    }

    // 查找所有要点击的列表项
    const jobItems = container.querySelectorAll(ITEM_SELECTOR);

    if (jobItems.length === 0) {
        console.warn("警告：在容器中未找到任何列表条目。");
        return { total: 0, clicked: 0 };
    }

    console.log(`👉 找到了 ${jobItems.length} 个条目，开始逐一处理...`);

    let clicked = 0;

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
        if (simulateClick(primaryButton, '主操作/聊天按钮')) {
            clicked++;
        }

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
    console.log(`🎉 所有条目处理完成。共点击 ${clicked} / ${jobItems.length} 个"立即沟通"。`);
    console.log("================================");

    return { total: jobItems.length, clicked };
}

// ===================================
// 5. 主流程：先滚后点
// ===================================

async function main() {
    console.log("▶️ 阶段 1/2：滚动到页面底部，加载全部职位...");
    await scrollToBottomAndWait();
    console.log("✅ 阶段 1/2 完成。");

    // 缓冲：等 DOM 稳定
    console.log(`⏸️ 等待 ${POST_SCROLL_BUFFER / 1000} 秒缓冲...`);
    await delay(POST_SCROLL_BUFFER);

    console.log("\n▶️ 阶段 2/2：开始遍历点击打招呼...");
    const result = await runGreet();

    console.log("\n🏁 合并脚本执行完毕。");
    return { scrollDone: true, ...result };
}