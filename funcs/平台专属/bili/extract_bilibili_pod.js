/**
 * @fileoverview B站播放页分P链接提取（pod 优先 + 单层 fallback）
 *
 * @scenario    B站合集/课程/视频列表播放页右侧"视频选集"区域使用
 * @feature     1) 多层级课程：每个 pod 项独立 BV，每项下多个分P
 *              2) 单层级合集：同一 BV 多分P，自动从 window.__INITIAL_STATE__ 取 bvid
 * @effect      返回 { count, summary, results }，明细含每项 BV/标题/分P数
 * @category    平台专属
 * @platform    bilibili
 * @entry       main()
 *
 * @test_url    多层课程（pod 模式）：https://www.bilibili.com/video/BV1NMk6BbE2B/?spm_id_from=333.337.search-card.all.click&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2
 * @test_url    单层课程（flat 模式）：https://www.bilibili.com/video/BV16R4y177pL/?spm_id_from=333.788.videopod.episodes&vd_source=b00eb5ad0e31d2629f81cb48d7fab1f2&p=2
 */

/**
 * Bilibili 播放页分P链接提取（合并版）
 * 目标页面：B站播放页右侧 "视频选集" 区域
 *
 * 两种场景自动识别：
 *  1) 多层课程：.pod-item.video-pod__item（每项含独立 BV + 子分P）
 *  2) 单层合集：.video-pod__item（同一 BV 的多个分P）
 */

function main() {
  const container = document.querySelector('div.video-pod__body');

  // ============================================================
  // 场景 1：多层课程（pod 版）— 每项独立 BV
  // ============================================================
  // 优先尝试，命中就走 pod 模式
  const podItems = container
    ? container.querySelectorAll('.pod-item.video-pod__item')
    : [];
  if (podItems.length > 0) {
    return extractPodMode(podItems);
  }

  // ============================================================
  // 场景 2：单层合集（course 版）— 同一 BV 的分P
  // ============================================================
  const flatItems = container
    ? container.querySelectorAll('.video-pod__item')
    : [];
  if (flatItems.length > 0) {
    return extractFlatMode(flatItems);
  }

  // ============================================================
  // 兜底：连容器都找不到
  // ============================================================
  console.error('%c[错误] ', 'color: red; font-weight: bold;',
    '未找到视频选集容器 (.video-pod__body) 或视频项，请确认当前在 B 站播放页');
  return { status: 'failed', message: '未找到视频选集容器或视频项' };
}

// ------------------------------------------------------------
// 模式 1：多层课程（pod 模式）
//   每个 pod-item 独立 BV；每项下可有多个分P
// ------------------------------------------------------------
function extractPodMode(items) {
  const results = [];
  const summary = [];

  items.forEach((item, index) => {
    const bv = item.getAttribute('data-key');
    if (!bv) return;

    // 取每项的标题（pod 容器通常有 .title 或 .title-txt）
    const titleEl = item.querySelector('.title-txt, .title, .pod-item__title');
    const title = titleEl ? titleEl.textContent.trim() : '';

    // 取分P数量：.page-list.simple > .page-item.sub
    const pageList = item.querySelector('.page-list.simple');
    const subItems = pageList ? pageList.querySelectorAll('.page-item.sub') : [];
    const pageCount = subItems.length || 1;

    const links = [];
    for (let p = 1; p <= pageCount; p++) {
      links.push(`https://www.bilibili.com/video/${bv}?p=${p}`);
    }

    results.push(...links);
    summary.push({
      index: index + 1,
      bv: bv,
      title: title,
      pages: pageCount,
      links: links
    });
  });

  printResults('pod', summary, results);
  return { status: 'success', mode: 'pod', count: results.length, summary, results };
}

// ------------------------------------------------------------
// 模式 2：单层合集（flat 模式）
//   同一 BV 的多个分P
// ------------------------------------------------------------

/**
 * 多路径探测 bvid（B 站 INITIAL_STATE 结构经常改）
 * 优先级从高到低，命中即返回
 */
function findBvidFromState() {
  // 路径 0：从当前 URL 提取（最稳 — 页面打开时 URL 一定存在）
  const url = window.location.href;
  const urlMatch = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // 路径 1：window.__INITIAL_STATE__.videoData.bvid（旧版常见）
  const state = window.__INITIAL_STATE__;
  if (state && state.videoData && state.videoData.bvid) {
    return state.videoData.bvid;
  }

  // 路径 2：window.__INITIAL_STATE__.bvid（部分页面）
  if (state && typeof state.bvid === 'string' && state.bvid.startsWith('BV')) {
    return state.bvid;
  }

  // 路径 3：window.__INITIAL_DATA__.videoData.bvid
  const initialData = window.__INITIAL_DATA__;
  if (initialData && initialData.videoData && initialData.videoData.bvid) {
    return initialData.videoData.bvid;
  }

  // 路径 4：递归搜索 INITIAL_STATE / INITIAL_DATA 里所有 bvid 字段
  const fromSearch = deepFindBvid(state) || deepFindBvid(initialData);
  if (fromSearch) return fromSearch;

  // 路径 5：从 og:url meta 提取
  const og = document.querySelector('meta[property="og:url"]');
  if (og && og.content) {
    const ogMatch = og.content.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    if (ogMatch) return ogMatch[1];
  }

  return '';
}

/**
 * 递归搜索对象树，找第一个匹配 /^BV[a-zA-Z0-9]+$/ 的字符串字段
 * 兜底中的兜底，应对 B 站又改结构
 */
function deepFindBvid(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return '';
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindBvid(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string' && /^BV[a-zA-Z0-9]+$/.test(val)) {
      return val;
    }
    if (typeof val === 'object') {
      const found = deepFindBvid(val, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function extractFlatMode(items) {
  // 从多个可能的路径取 bvid（B 站 INITIAL_STATE 结构经常变）
  const bvid = findBvidFromState();
  if (!bvid) {
    console.error('%c[错误] ', 'color: red; font-weight: bold;',
      '单层合集模式需要 bvid，从 window.__INITIAL_STATE__ / window.__INITIAL_DATA__ / 链接 URL 都未取到');
    return { status: 'failed', message: '未获取到 bvid' };
  }
  console.log('%c[flat 模式] ', 'color: #00a1d6;', `使用 bvid: ${bvid}`);

  const results = [];
  const summary = [];

  items.forEach((item, i) => {
    const cid = item.getAttribute('data-key');
    const titleEl = item.querySelector('.title-txt');
    const title = titleEl ? titleEl.textContent.trim() : '';

    // 单层合集：每项就是 1 个分P，URL = bvid + p 参数
    const url = `https://www.bilibili.com/video/${bvid}?p=${i + 1}`;
    results.push(url);
    summary.push({
      index: i + 1,
      bv: bvid,
      cid: cid,
      title: title,
      pages: 1,
      links: [url]
    });
  });

  printResults('flat', summary, results);
  return { status: 'success', mode: 'flat', count: results.length, summary, results };
}

// ------------------------------------------------------------
// 统一输出格式（与原两个版本兼容）
// ------------------------------------------------------------
function printResults(mode, summary, results) {
  const isMultiPod = mode === 'pod';

  console.log('%c[提取完成] ', 'color: #00a1d6; font-size: 14px; font-weight: bold;',
    isMultiPod
      ? `共 ${summary.length} 个主视频，${results.length} 个分P链接`
      : `共 ${summary.length} 个分P链接`);

  console.log('%c===== 明细 =====', 'color: #00a1d6;');
  summary.forEach(s => {
    if (isMultiPod) {
      console.log(`#${s.index} ${s.bv}「${s.title}」: ${s.pages} 个切片`);
    } else {
      console.log(`#${s.index} ${s.title}`);
    }
  });

  console.log('%c===== 链接列表（每行一个，直接复制） =====', 'color: #00a1d6;');
  console.log(results.join('\n'));

  console.log('%c===== JSON 数组格式 =====', 'color: #00a1d6;');
  console.log(JSON.stringify(results, null, 2));

  // 同时存两个全局变量，兼容旧调用方
  window.__bilibiliPodUrls = results;
  window.__bilibiliPodSummary = summary;
  window.__bilibiliCourseUrls = results;
  window.__bilibiliCourseSummary = summary;

  console.log('%c===== 使用提示 =====', 'color: #fb7299;');
  console.log('所有链接已保存到 window.__bilibiliPodUrls / window.__bilibiliCourseUrls');
  console.log('明细对象已保存到 window.__bilibiliPodSummary / window.__bilibiliCourseSummary');
  console.log('复制纯文本：copy(window.__bilibiliPodUrls.join("\\n"))');
}
