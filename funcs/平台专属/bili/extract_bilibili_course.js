/**
 * Bilibili 课程合集视频链接提取
 * 目标页面：B站课程/合集播放页右侧的 "视频选集" 区域
 * 定位方式：div.video-pod__body
 * 格式：单个 bvid + 分P参数
 */

function main() {
  // 获取当前视频的 bvid
  var bvid = '';
  var state = window.__INITIAL_STATE__;
  if (state && state.videoData && state.videoData.bvid) {
    bvid = state.videoData.bvid;
  }

  // 从 DOM 侧边栏提取
  var container = document.querySelector('div.video-pod__body');
  if (!container) {
    console.error('%c[错误] ', 'color: red; font-weight: bold;', '未找到视频选集容器');
    return { status: 'failed', message: '未找到视频选集容器' };
  }

  var items = container.querySelectorAll('.video-pod__item');
  if (items.length === 0) {
    console.error('%c[错误] ', 'color: red; font-weight: bold;', '未找到任何视频项');
    return { status: 'failed', message: '未找到视频项' };
  }

  if (!bvid) {
    console.error('%c[错误] ', 'color: red; font-weight: bold;', '未获取到 bvid');
    return { status: 'failed', message: '未获取到 bvid' };
  }

  var results = [];
  var summary = [];

  items.forEach(function(item, i) {
    var cid = item.getAttribute('data-key');
    var titleEl = item.querySelector('.title-txt');
    var title = titleEl ? titleEl.textContent.trim() : '';

    // 使用 bvid + p 参数生成 URL
    var url = 'https://www.bilibili.com/video/' + bvid + '?p=' + (i + 1);
    results.push(url);
    summary.push({
      index: i + 1,
      cid: cid,
      title: title,
      url: url
    });
  });

  // 保存到全局变量
  window.__bilibiliCourseUrls = results;
  window.__bilibiliCourseSummary = summary;

  // 输出结果
  console.log('%c[提取完成] ', 'color: #00a1d6; font-size: 14px; font-weight: bold;',
    '共 ' + summary.length + ' 个视频链接');

  console.log('%c===== 明细 =====', 'color: #00a1d6;');
  summary.forEach(function(s) {
    console.log('#' + s.index + ' ' + s.title);
  });

  console.log('%c===== 链接列表（每行一个，直接复制） =====', 'color: #00a1d6;');
  console.log(results.join('\n'));

  console.log('%c===== JSON 数组格式 =====', 'color: #00a1d6;');
  console.log(JSON.stringify(results, null, 2));

  console.log('%c===== 使用提示 =====', 'color: #fb7299;');
  console.log('所有链接已保存到 window.__bilibiliCourseUrls');
  console.log('明细对象已保存到 window.__bilibiliCourseSummary');
  console.log('复制纯文本：copy(window.__bilibiliCourseUrls.join("\\n"))');

  return {
    status: 'success',
    count: results.length,
    summary: summary
  };
}
