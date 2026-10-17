/**
 * @fileoverview Boss直聘列表逐项点击测试
 *
 * @scenario    Boss直聘职位列表页测试用
 * @feature     按固定延迟依次点击列表中所有职位项
 * @effect      模拟点击列表项切换右侧详情
 * @category    自动化点击
 * @platform    boss直聘
 * @entry       自动执行
 */
(function() {
    // 1. 定义核心选择器
    const CONTAINER_SELECTOR = "#wrap > div.page-jobs-main > div.job-recommend-result > div > div > div.job-list-container";
    const ITEM_SELECTOR = "ul > div > div > li > div:first-child"; // 列表项的通用相对路径

    // 2. 获取父容器
    const container = document.querySelector(CONTAINER_SELECTOR);

    if (!container) {
        console.error("错误：未找到指定的日志容器！请检查选择器是否正确。");
        return;
    }

    // 3. 查找所有要点击的列表项
    // 使用 querySelectorAll 在父容器内查找所有符合条件的子元素
    const jobItems = container.querySelectorAll(ITEM_SELECTOR);
    
    if (jobItems.length === 0) {
        console.warn("警告：在容器中未找到任何列表条目。");
        return;
    }

    console.log(`找到了 ${jobItems.length} 个条目，开始逐一点击...`);

    let index = 0;
    const clickDelay = 500; // 每次点击之间的延迟（毫秒）

    /**
     * 递归函数：依次处理列表项
     */
    function processNextItem() {
        if (index < jobItems.length) {
            const item = jobItems[index];
            
            console.log(`正在点击第 ${index + 1} 个条目...`);
            
            try {
                // 执行点击操作
                item.click(); 
                console.log(`第 ${index + 1} 个条目点击成功.`);
                
            } catch (error) {
                console.error(`点击第 ${index + 1} 个条目时发生错误:`, error);
                // 即使失败，也尝试继续下一个
            }
            
            index++;
            
            // 设置延迟，然后处理下一个元素
            setTimeout(processNextItem, clickDelay);
            
        } else {
            console.log("================================");
            console.log("所有条目点击完成。");
            console.log("================================");
        }
    }

    // 开始执行
    processNextItem();

})();