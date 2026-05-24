/**
 * Bilibili 收藏夹视频链接提取脚本
 * 使用方法：在收藏夹页面打开浏览器控制台(F12)，粘贴此脚本并回车执行
 * 支持自动翻页，自动去重，最终输出全部视频链接
 */


function main(){
(async function extractBilibiliFavlist() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const results = new Map(); // 使用 Map 保持顺序并去重

    /**
     * 从当前页面提取视频链接
     * 选择器说明：
     *   - a[href*="/video/BV"] : 所有包含 /video/BV 的链接
     *   - 通过正则 /BV[a-zA-Z0-9]+/ 提取 BV 号并拼接完整 URL
     */
    function extractPage() {
        const links = document.querySelectorAll('a[href*="/video/BV"]');
        let pageNew = 0;
        links.forEach(a => {
            const href = a.getAttribute('href');
            const match = href.match(/BV[a-zA-Z0-9]+/);
            if (match) {
                const bv = match[0];
                const fullUrl = 'https://www.bilibili.com/video/' + bv;
                if (!results.has(bv)) {
                    results.set(bv, fullUrl);
                    pageNew++;
                }
            }
        });
        return pageNew;
    }

    /**
     * 检查是否存在下一页按钮
     * 选择器：.vui_pagenation--btn-side:not([disabled])
     * 文本判断：包含 "下一页"
     */
    function hasNextPage() {
        const nextBtn = document.querySelector('.vui_pagenation--btn-side:not([disabled])');
        return nextBtn && nextBtn.textContent.includes('下一页');
    }

    /**
     * 点击下一页
     */
    function clickNextPage() {
        const nextBtn = document.querySelector('.vui_pagenation--btn-side:not([disabled])');
        if (nextBtn && nextBtn.textContent.includes('下一页')) {
            nextBtn.click();
            return true;
        }
        return false;
    }

    /**
     * 获取当前页码信息（调试用）
     */
    function getCurrentPageInfo() {
        const activeBtn = document.querySelector('.vui_pagenation--btn-num.vui_button--active');
        const totalSpan = document.querySelector('.vui_pagenation-go__count');
        return {
            current: activeBtn ? activeBtn.textContent.trim() : '?',
            totalText: totalSpan ? totalSpan.textContent.trim() : ''
        };
    }

    // ===== 主流程 =====
    console.log('%c[开始提取] ', 'color: #00a1d6; font-weight: bold;', 'Bilibili 收藏夹视频链接');

    let pageNum = 1;

    while (true) {
        const info = getCurrentPageInfo();
        const beforeCount = results.size;

        // 提取当前页
        const newCount = extractPage();
        console.log(`第 ${pageNum} 页提取完成 | 本页新增: ${newCount} | 累计: ${results.size} | 页码信息: ${info.current} / ${info.totalText}`);

        // 检查是否有下一页
        if (!hasNextPage()) {
            console.log('%c[无下一页] ', 'color: #fb7299; font-weight: bold;', '提取结束');
            break;
        }

        // 点击下一页
        const clicked = clickNextPage();
        if (!clicked) {
            console.log('%c[点击失败] ', 'color: red; font-weight: bold;', '终止提取');
            break;
        }

        // 等待 SPA 页面更新（B站收藏夹是异步加载）
        await sleep(2500);
        pageNum++;

        // 安全限制：最多翻 20 页
        if (pageNum > 20) {
            console.log('%c[安全限制] ', 'color: orange; font-weight: bold;', '超过最大页数，终止');
            break;
        }
    }

    // ===== 输出结果 =====
    const urls = Array.from(results.values());
    console.log('%c[提取完成] ', 'color: #00a1d6; font-size: 14px; font-weight: bold;', `共 ${urls.length} 个唯一视频`);

    // 以可复制的格式输出
    console.log('%c===== 链接列表（每行一个）=====','color: #00a1d6;');
    urls.forEach((url, idx) => console.log(`${idx + 1}. ${url}`));

    // 同时输出为数组格式，方便复制
    console.log('%c===== JSON 数组格式 =====','color: #00a1d6;');
    console.log(JSON.stringify(urls, null, 2));

    // 输出为纯文本（可直接复制粘贴到 txt）
    console.log('%c===== 纯文本格式（直接复制）=====','color: #00a1d6;');
    console.log(urls.join('\n'));

    // 返回结果（方便在控制台进一步操作）
    window.__bilibiliFavUrls = urls;
    return urls;
})();

}

