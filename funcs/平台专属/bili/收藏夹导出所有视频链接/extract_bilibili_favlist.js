/**
 * Bilibili 视频链接提取脚本（通用版）
 * 支持：收藏夹 / UP主空间投稿页 / 合集页
 * 使用方法：在目标页面打开浏览器控制台(F12)，粘贴此脚本并回车执行
 */

function main(){
(async function extractBilibiliVideos() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const results = new Map();

    /**
     * 滚动加载当前页全部内容（B站投稿页懒加载）
     */
    async function scrollLoad() {
        for (let i = 0; i < 5; i++) {
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(800);
        }
        window.scrollTo(0, 0);
        await sleep(300);
    }

    /**
     * 从当前页面提取视频链接
     */
    function extractPage() {
        const links = document.querySelectorAll('a[href*="/video/BV"]');
        let pageNew = 0;
        links.forEach(a => {
            const href = a.getAttribute('href') || '';
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
     * 获取"下一页"按钮
     * 关键修复：不能用 querySelector 取第一个非 disabled 的 btn-side，
     * 因为第2页开始"上一页"也不是 disabled，会误匹配。
     */
    function getNextPageBtn() {
        const btns = document.querySelectorAll('.vui_pagenation--btn-side:not([disabled])');
        for (const btn of btns) {
            if (btn.textContent.includes('下一页')) {
                return btn;
            }
        }
        // 兜底：部分页面用不同类名
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
            if (btn.textContent.includes('下一页') && !btn.disabled) {
                return btn;
            }
        }
        return null;
    }

    function hasNextPage() {
        return !!getNextPageBtn();
    }

    function clickNextPage() {
        const btn = getNextPageBtn();
        if (btn) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            btn.click();
            return true;
        }
        return false;
    }

    /**
     * 获取当前页码信息
     */
    function getCurrentPageInfo() {
        const activeBtn = document.querySelector('.vui_pagenation--btn-num.vui_button--active');
        const totalSpan = document.querySelector('.vui_pagenation-go__count');
        const totalText = totalSpan ? totalSpan.textContent.trim() : '';
        // 部分页面 total 格式为 "共 XX 页"
        const totalMatch = totalText.match(/(\d+)/);
        return {
            current: activeBtn ? activeBtn.textContent.trim() : '?',
            total: totalMatch ? totalMatch[1] : totalText
        };
    }

    // ===== 主流程 =====
    console.log('%c[开始提取] ', 'color: #00a1d6; font-weight: bold;', 'Bilibili 视频链接提取');

    let pageNum = 1;
    const MAX_PAGES = 50;

    while (true) {
        const info = getCurrentPageInfo();
        const beforeCount = results.size;

        // 先滚动加载确保懒加载内容出来
        await scrollLoad();

        // 提取当前页
        const newCount = extractPage();
        console.log(`第 ${pageNum} 页提取完成 | 本页新增: ${newCount} | 累计: ${results.size} | 页码: ${info.current} / ${info.total}`);

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

        // 等待 SPA 页面更新
        await sleep(3000);
        pageNum++;

        // 安全限制
        if (pageNum > MAX_PAGES) {
            console.log('%c[安全限制] ', 'color: orange; font-weight: bold;', `超过最大页数 ${MAX_PAGES}，终止`);
            break;
        }
    }

    // ===== 输出结果 =====
    const urls = Array.from(results.values());
    console.log('%c[提取完成] ', 'color: #00a1d6; font-size: 14px; font-weight: bold;', `共 ${urls.length} 个唯一视频`);

    console.log('%c===== 链接列表（每行一个）=====','color: #00a1d6;');
    urls.forEach((url, idx) => console.log(`${idx + 1}. ${url}`));

    console.log('%c===== JSON 数组格式 =====','color: #00a1d6;');
    console.log(JSON.stringify(urls, null, 2));

    console.log('%c===== 纯文本格式（直接复制）=====','color: #00a1d6;');
    console.log(urls.join('\n'));

    window.__bilibiliFavUrls = urls;
    return urls;
})();
}
