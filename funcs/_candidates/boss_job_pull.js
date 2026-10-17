/**
 * @fileoverview Boss直聘页面自动滚动加载
 *
 * @scenario    Boss直聘长列表页触发懒加载
 * @feature     分步滚动到底部并等待3秒后停止
 * @effect      触发页面动态内容加载直至滚到底部
 * @category    自动化点击
 * @platform    boss直聘
 * @entry       scrollToBottomAndWait()
 */

/**
 * 滚动到页面底部（支持动态加载内容），并停留3秒后停止
 * @param {number} step - 每次滚动的步长（像素）
 * @param {number} interval - 每次滚动的间隔时间（毫秒），用于等待动态内容加载
 */
function scrollToBottomAndWait(step = 500, interval = 300) {
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
            // 1. 视口底部接近页面总高度（误差100像素，避免因微小差异判断错误）
            // 2. 页面高度不再变化（说明没有新内容加载）
            const isBottom = currentViewportBottom >= currentScrollHeight - 100 && currentScrollHeight === lastScrollHeight;

            if (isBottom) {
                // 到达底部后，停留3秒
                console.log('已到达页面底部，将停留3秒后停止');
                setTimeout(() => {
                    isScrolling = false;
                    console.log('停留结束，已停止滚动');
                }, 3000);
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
}

// 执行函数（可调整步长和间隔，步长越大滚动越快，间隔越大越适合慢加载的页面）
function main(){
    scrollToBottomAndWait(500, 300);
}