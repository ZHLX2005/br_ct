// backgroudtask/banner_starter.js
// 启动横幅：Chrome 启动后,在用户打开的第一个可注入标签页飘一次激励语,
//当天不重复;刷新页面 / 后续开 tab 都不会再触发。
//
// 设计要点：
// 1) 监听器在 setupBannerStarter 顶层同步注册,只要 SW 被任何事件唤醒,
//    就能保证监听器在位 —— 即使 SW 短唤醒不会重跑顶层 import,模块已
//    经执行过 → addListener 已经被调用过一次。
// 2) onStartup / onInstalled 兜底重置跨日标记。
// 3) 不可注入页 (chrome://newtab/ 等) 直接跳过,不写"今天已飘"。
// 4) onUpdated 兜底处理 onCreated 时 tab.url 尚未填充的情况。

const BANNER_STORAGE_KEY = 'banner_starter_last_date';
const BANNER_SCRIPT_FILE = 'funcs/x/111/title.js';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// SW 内存里的当日抑制标记 —— 避免每次新 tab 都读 storage
let suppressToday = false;

// 兜底:模块被求值就立刻打 log,便于确认 SW 是否真的加载了本文件
console.log('[BannerStarter] module loaded at', new Date().toISOString());

const wasShownToday = async () => {
  try {
    const { [BANNER_STORAGE_KEY]: lastDate } = await chrome.storage.local.get(BANNER_STORAGE_KEY);
    return lastDate === todayStr();
  } catch (e) {
    console.error('[BannerStarter] 读取 storage 失败:', e);
    return false;
  }
};

const markShownToday = async () => {
  try {
    await chrome.storage.local.set({ [BANNER_STORAGE_KEY]: todayStr() });
    suppressToday = true;
    console.log('[BannerStarter] 已写入今日标记');
  } catch (e) {
    console.error('[BannerStarter] 写入 storage 失败:', e);
  }
};

const injectBanner = async (tabId) => {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      files: [BANNER_SCRIPT_FILE],
    });
    if (chrome.runtime.lastError) {
      console.warn(
        `[BannerStarter] lastError 注入失败 (tab ${tabId}):`,
        chrome.runtime.lastError.message
      );
      return false;
    }
    console.log(`[BannerStarter] 已在 tab ${tabId} 注入横幅`, result);
    return true;
  } catch (e) {
    try {
      const t = await chrome.tabs.get(tabId);
      console.warn(
        `[BannerStarter] 注入失败 (tab ${tabId} url=${t?.url}):`,
        e?.message || e
      );
    } catch {
      console.warn(`[BannerStarter] 注入失败 (tab ${tabId}) 且 tabs.get 也失败:`, e?.message || e);
    }
    return false;
  }
};

// 只允许 http(s) 页,chrome://newtab/ / about:blank / 扩展页一律跳过
const isInjectableUrl = (url) => {
  if (!url) return false;
  if (/^(chrome|edge|about|moz-extension|chrome-extension|devtools|view-source):/i.test(url)) return false;
  return /^https?:\/\//i.test(url);
};

// 核心逻辑:在 tab 上尝试注入一次横幅
const tryShowOnTab = async (tab) => {
  if (suppressToday) return;
  if (!tab || tab.id == null) return;
  if (!isInjectableUrl(tab.url)) {
    // 不可注入页(特权页/扩展页/新标签页)静默跳过 —— 不输出日志,减少噪音
    return;
  }
  if (await wasShownToday()) {
    suppressToday = true;
    return;
  }
  const ok = await injectBanner(tab.id);
  // 只有真的注入成功才写当日标记 —— 这样特权页失败时不会锁死今天
  if (ok) await markShownToday();
};

// onCreated:tab.url 可能尚未填充
const onTabCreated = (tab) => {
  console.log('[BannerStarter] onTabCreated:', tab?.id, tab?.url ?? '(no url yet)');
  // tab.url 未填充时直接返回,由 onUpdated 兜底
  if (!tab?.url) return;
  tryShowOnTab(tab);
};

// onUpdated 兜底:url 已确定且 status=complete 时再尝试一次
// 同时覆盖 "用户在 chrome://newtab 里手动输入网址跳转" 的场景
const onTabUpdated = (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.url) return;
  console.log('[BannerStarter] onTabUpdated complete:', tabId, tab.url);
  tryShowOnTab(tab);
};

// onActivated 兜底:用户切换到某个 tab 时,如果是可注入页且今天还没飘,补一次
// —— 解决 "用户一直停在 chrome://newtab 直接输入网址" 的场景
const onTabActivated = async (activeInfo) => {
  if (suppressToday) return;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab?.url) return;
    console.log('[BannerStarter] onTabActivated:', tab.id, tab.url);
    await tryShowOnTab(tab);
  } catch (e) {
    // tab 可能已关闭
  }
};

const setupBannerStarter = () => {
  // 监听器在 SW 每次启动时同步注册,常驻 —— MV3 SW 重启时会重跑顶层代码
  chrome.tabs.onCreated.addListener(onTabCreated);
  chrome.tabs.onUpdated.addListener(onTabUpdated);
  chrome.tabs.onActivated.addListener(onTabActivated);
  console.log('[BannerStarter] listeners registered (onCreated/onUpdated/onActivated)');

  // 跨日重置
  chrome.runtime.onStartup.addListener(async () => {
    console.log('[BannerStarter] onStartup fired');
    const { [BANNER_STORAGE_KEY]: lastDate } = await chrome.storage.local.get(BANNER_STORAGE_KEY);
    if (lastDate && lastDate !== todayStr()) {
      await chrome.storage.local.remove(BANNER_STORAGE_KEY);
      suppressToday = false;
      console.log('[BannerStarter] 跨日,清除标记');
    } else if (lastDate === todayStr()) {
      suppressToday = true;
      console.log('[BannerStarter] 今日已飘过,抑制标记');
    }
  });

  // 首次安装/更新:同步 SW 内标记与 storage 一致
  chrome.runtime.onInstalled.addListener(async () => {
    console.log('[BannerStarter] onInstalled fired');
    if (await wasShownToday()) {
      suppressToday = true;
    } else {
      suppressToday = false;
    }
  });

  // SW 启动时主动同步一次标记状态 —— 防止 SW 重启后 suppressToday 被重置
  (async () => {
    if (await wasShownToday()) suppressToday = true;
    console.log('[BannerStarter] init sync, suppressToday=', suppressToday);
  })();
};

export { setupBannerStarter };