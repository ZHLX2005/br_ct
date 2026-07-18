/**
 * 边栏切换模块
 */
console.log('[SidebarToggle] 模块加载');

let sidebarOpenTabs = new Set();

const MAIN_PATH = 'sidebar/main/main.html';
const CLOSED_PATH = 'sidebar/closed.html';

// Tab 切换状态（持久化）
const TAB_CYCLE_STATE_KEY = "sidebar_tab_cycle_state";
let currentTabIndex = -1;  // -1 表示 AI 平台
let workspaceTabs = [];    // 工作区标签列表
let platformTabCache = {}; // AI 平台标签缓存

// 初始化 - 恢复状态
chrome.storage.session.get('sidebarOpenTabs').then(result => {
  if (result.sidebarOpenTabs) {
    sidebarOpenTabs = new Set(result.sidebarOpenTabs);
    console.log('[SidebarToggle] 恢复状态:', Array.from(sidebarOpenTabs));
  }
});

// 恢复 Tab 轮询状态
chrome.storage.local.get([TAB_CYCLE_STATE_KEY]).then(result => {
  if (result[TAB_CYCLE_STATE_KEY]) {
    currentTabIndex = result[TAB_CYCLE_STATE_KEY].currentIndex ?? -1;
    console.log('[SidebarToggle] 恢复 Tab 轮询状态:', currentTabIndex);
  }
});

// 保存状态
async function saveState() {
  await chrome.storage.session.set({
    sidebarOpenTabs: Array.from(sidebarOpenTabs)
  });
}

// 保存 Tab 轮询状态
async function saveTabCycleState() {
  await chrome.storage.local.set({
    [TAB_CYCLE_STATE_KEY]: {
      currentIndex: currentTabIndex,
      timestamp: Date.now()
    }
  });
}

// 打开边栏 - 使用 open() 方法
async function openSidebar(tabId) {
  try {
    console.log('[SidebarToggle] 打开边栏，tab:', tabId);
    // 先打开边栏
    await chrome.sidePanel.open({ tabId });
    // 再设置路径
    await chrome.sidePanel.setOptions({
      tabId,
      path: MAIN_PATH
    });
    sidebarOpenTabs.add(tabId);
    await saveState();
    console.log('[SidebarToggle] 打开成功');
  } catch (e) {
    console.error('[SidebarToggle] 打开失败:', e);
  }
}

// 关闭边栏 - 使用 close() 方法真正关闭
async function closeSidebar(tabId) {
  try {
    console.log('[SidebarToggle] 关闭边栏，tab:', tabId);
    await chrome.sidePanel.close({ tabId });
    sidebarOpenTabs.delete(tabId);
    await saveState();
    console.log('[SidebarToggle] 关闭成功');
  } catch (e) {
    console.error('[SidebarToggle] 关闭失败:', e);
  }
}

// 切换
async function toggleSidebar(tabId) {
  if (!tabId || tabId === -1) {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) tabId = tab.id;
    if (!tabId || tabId === -1) {
      console.log('[SidebarToggle] 无法获取标签页 ID');
      return;
    }
  }

  console.log('[SidebarToggle] 切换，tab:', tabId, '状态:', sidebarOpenTabs.has(tabId) ? '打开' : '关闭');

  if (sidebarOpenTabs.has(tabId)) {
    await closeSidebar(tabId);
  } else {
    await openSidebar(tabId);
  }
}

// ==================== Tab 切换逻辑（核心） ====================

// 工作区标签存储键名
const WORKSPACE_STORAGE_KEY = 'sidebar_workspace_tabs';
let workspaceTabCounter = 0;

// AI 平台 URL 列表（按顺序，用于自动打开）
const PLATFORM_HOSTNAMES = [
  { id: 'yuanbao', hostname: 'yuanbao.tencent.com', url: 'https://yuanbao.tencent.com/chat/' },
  { id: 'gemini', hostname: 'gemini.google.com', url: 'https://gemini.google.com/app' },
  { id: 'chatgpt', hostname: 'chatgpt.com', url: 'https://chatgpt.com' },
  { id: 'claude', hostname: 'claude.ai', url: 'https://claude.ai' },
  { id: 'doubao', hostname: 'www.doubao.com', url: 'https://www.doubao.com/chat/' },
  { id: 'glm', hostname: 'chatglm.cn', url: 'https://chatglm.cn/main/alltoolsdetail' },
  { id: 'googlestudio', hostname: 'aistudio.google.com', url: 'https://aistudio.google.com/' },
  { id: 'tongyi', hostname: 'www.qianwen.com', url: 'https://www.qianwen.com' },
  { id: 'grok', hostname: 'grok.com', url: 'https://grok.com' },
  { id: 'notionai', hostname: 'www.notion.so', url: 'https://www.notion.so/chat' },
  { id: 'zai', hostname: 'chat.z.ai', url: 'https://chat.z.ai/' },
  { id: 'deepseek', hostname: 'chat.deepseek.com', url: 'https://chat.deepseek.com/' },
  { id: 'kimi', hostname: 'www.kimi.com', url: 'https://www.kimi.com/' },
  { id: 'coderqwen', hostname: 'coder.qwen.ai', url: 'https://coder.qwen.ai/' },
  { id: 'coze', hostname: 'www.coze.cn', url: 'https://www.coze.cn/' },
  { id: 'xiaomi', hostname: 'aistudio.xiaomimimo.com', url: 'https://aistudio.xiaomimimo.com/#/c' },
];

// 简化的 hostname 列表用于匹配
const PLATFORM_HOSTNAME_LIST = PLATFORM_HOSTNAMES.map(p => p.hostname);

/**
 * 判断给定 URL 是否属于某个 AI 平台页面
 */
function isAiWebUrl(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return PLATFORM_HOSTNAME_LIST.some(h => hostname.includes(h));
  } catch {
    return false;
  }
}

/**
 * 添加/移除当前页面到工作区（Alt+W 切换）
 * - 已存在 → 移除
 * - 不存在 → 添加
 */
async function addCurrentPageToWorkspace(tabId) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) tabId = tab.id;
  }

  if (!tabId) {
    console.log('[SidebarToggle] 无法获取标签页 ID');
    return { success: false, reason: 'no_tab' };
  }

  try {
    const tab = await chrome.tabs.get(tabId);

    // 排除 AI 平台页面
    if (isAiWebUrl(tab.url)) {
      console.log('[SidebarToggle] AI 平台页面无需添加到工作区');
      return { success: false, reason: 'ai_platform', title: tab.title };
    }

    // 获取当前工作区列表
    const result = await chrome.storage.session.get(WORKSPACE_STORAGE_KEY);
    let workspaceTabs = result[WORKSPACE_STORAGE_KEY] || [];

    // 检查是否已存在（切换：移除）
    const existingIndex = workspaceTabs.findIndex(t => t.tabId === tabId);
    if (existingIndex >= 0) {
      workspaceTabs.splice(existingIndex, 1);
      await chrome.storage.session.set({ [WORKSPACE_STORAGE_KEY]: workspaceTabs });
      console.log('[SidebarToggle] 已从工作区移除:', tab.title);
      return { success: true, action: 'removed', title: tab.title };
    }

    // 添加到工作区
    workspaceTabCounter++;
    workspaceTabs.push({
      localId: workspaceTabCounter,
      tabId: tab.id,
      title: tab.title || '新标签页',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
    });

    await chrome.storage.session.set({ [WORKSPACE_STORAGE_KEY]: workspaceTabs });

    console.log('[SidebarToggle] 已添加到工作区:', tab.title);
    return { success: true, action: 'added', title: tab.title };

  } catch (err) {
    console.error('[SidebarToggle] 添加到工作区失败:', err);
    return { success: false, reason: 'error' };
  }
}


/**
 * 获取所有可切换的 Tab 列表（工作区 + 已勾选的AI平台）
 */
async function getAllTabs() {
  const tabs = [];

  // 添加工作区标签
  try {
    const result = await chrome.storage.session.get('sidebar_workspace_tabs');
    if (result.sidebar_workspace_tabs) {
      workspaceTabs = result.sidebar_workspace_tabs;
      workspaceTabs.forEach((tab, index) => {
        tabs.push({ type: 'workspace', index, tab });
      });
    }
  } catch (e) {
    console.warn('[SidebarToggle] 获取工作区标签失败:', e);
  }

  // 添加已勾选的 AI 平台（每个平台作为一个独立节点）
  try {
    const statesResult = await chrome.storage.local.get(PLATFORM_STATES_KEY);
    const platformStates = statesResult[PLATFORM_STATES_KEY] || {};
    PLATFORM_HOSTNAMES.forEach((platform, index) => {
      if (platformStates[platform.id] !== false) {
        tabs.push({ type: 'platform', index, name: platform.id, platform });
      }
    });
  } catch (e) {
    console.warn('[SidebarToggle] 获取平台勾选状态失败:', e);
  }

  return tabs;
}

/**
 * 切换到指定的 AI 平台（按用户勾选列表，未打开则自动打开）
 */
async function switchToPlatform(platform) {
  if (!platform) return;

  // 检查目标平台是否已打开
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const existingTab = allTabs.find(tab => {
    if (!tab.url) return false;
    try {
      return new URL(tab.url).hostname.includes(platform.hostname);
    } catch {
      return false;
    }
  });

  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
    console.log('[SidebarToggle] 已切换到 AI 平台:', existingTab.title);
  } else {
    const tab = await chrome.tabs.create({
      url: platform.url,
      active: true
    });
    console.log('[SidebarToggle] 已打开 AI 平台:', platform.id, tab.title);
  }
}

/**
 * 切换到指定索引的工作区标签
 */
async function switchToWorkspaceTab(tabInfo) {
  const tab = tabInfo.tab;
  try {
    // 验证标签页是否存在
    await chrome.tabs.get(tab.tabId);
    // 直接切换到标签页
    await chrome.tabs.update(tab.tabId, { active: true });
    console.log('[SidebarToggle] 已切换到工作区标签:', tab.title);
  } catch (err) {
    // 标签页已关闭，移除并保存
    console.warn('[SidebarToggle] 工作区标签页已关闭:', tab.tabId);
    workspaceTabs = workspaceTabs.filter(t => t.tabId !== tab.tabId);
    await chrome.storage.session.set({ sidebar_workspace_tabs: workspaceTabs });
  }
}

/**
 * 切换到下一个 AI 平台（按用户选中顺序，未打开则自动打开）
 */
async function switchToNextPlatform() {
  // 读取用户勾选状态
  const statesResult = await chrome.storage.local.get(PLATFORM_STATES_KEY);
  const platformStates = statesResult[PLATFORM_STATES_KEY] || {};

  // 按 PLATFORM_HOSTNAMES 顺序，过滤出已勾选的平台
  const checkedPlatforms = PLATFORM_HOSTNAMES.filter(p => platformStates[p.id] !== false);

  if (checkedPlatforms.length === 0) {
    console.log('[SidebarToggle] 没有勾选任何 AI 平台');
    return;
  }

  // 获取当前活动标签
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = currentTab?.url || '';
  let currentPlatformIdx = -1;
  try {
    const currentHostname = new URL(currentUrl).hostname;
    currentPlatformIdx = checkedPlatforms.findIndex(p => currentHostname.includes(p.hostname));
  } catch (e) {
    // ignore
  }

  // 计算下一个平台索引
  const nextIdx = (currentPlatformIdx + 1) % checkedPlatforms.length;
  const nextPlatform = checkedPlatforms[nextIdx];

  // 检查目标平台是否已打开
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const existingTab = allTabs.find(tab => {
    if (!tab.url) return false;
    try {
      return new URL(tab.url).hostname.includes(nextPlatform.hostname);
    } catch {
      return false;
    }
  });

  if (existingTab) {
    // 已打开，直接切换
    await chrome.tabs.update(existingTab.id, { active: true });
    console.log('[SidebarToggle] 已切换到 AI 平台:', existingTab.title);
  } else {
    // 未打开，自动创建
    const tab = await chrome.tabs.create({
      url: nextPlatform.url,
      active: true
    });
    console.log('[SidebarToggle] 已打开 AI 平台:', nextPlatform.id, tab.title);
  }
}

/**
 * 获取已打开的 AI 平台标签页
 */
async function getOpenPlatformTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.filter(tab => {
      if (!tab.url) return false;
      try {
        const hostname = new URL(tab.url).hostname;
        return PLATFORM_HOSTNAME_LIST.some(h => hostname.includes(h));
      } catch {
        return false;
      }
    });
  } catch (e) {
    console.warn('[SidebarToggle] 获取平台标签失败:', e);
    return [];
  }
}

// 平台勾选状态存储键名
const PLATFORM_STATES_KEY = 'platformStates';

/**
 * 自动打开第一个已勾选的候选平台
 * @returns {Promise<{tabId: number, title: string}>}
 */
async function openFirstCandidatePlatform() {
  try {
    // 从 storage 读取平台勾选状态
    const result = await chrome.storage.local.get(PLATFORM_STATES_KEY);
    const platformStates = result[PLATFORM_STATES_KEY] || {};

    // 从 PLATFORM_HOSTNAMES 列表中按顺序找到第一个已勾选的平台
    for (const platform of PLATFORM_HOSTNAMES) {
      // 检查该平台是否已勾选（true 或未设置都算勾选）
      const isChecked = platformStates[platform.id] !== false;

      if (isChecked) {
        // 检查是否已存在该平台的标签页
        const existingTabs = await chrome.tabs.query({ currentWindow: true });
        const existingTab = existingTabs.find(tab => {
          if (!tab.url) return false;
          try {
            return new URL(tab.url).hostname.includes(platform.hostname);
          } catch {
            return false;
          }
        });

        if (!existingTab) {
          // 创建新标签页
          const tab = await chrome.tabs.create({
            url: platform.url,
            active: true
          });
          console.log('[SidebarToggle] 自动打开已勾选平台:', platform.id, platform.url);
          return { tabId: tab.id, title: tab.title || platform.id };
        }
      }
    }

    // 如果所有已勾选的平台都已打开，尝试打开第一个
    console.log('[SidebarToggle] 所有已勾选平台都已打开，尝试打开第一个候选');
    for (const platform of PLATFORM_HOSTNAMES) {
      const existingTabs = await chrome.tabs.query({ currentWindow: true });
      const existingTab = existingTabs.find(tab => {
        if (!tab.url) return false;
        try {
          return new URL(tab.url).hostname.includes(platform.hostname);
        } catch {
          return false;
        }
      });

      if (!existingTab) {
        const tab = await chrome.tabs.create({
          url: platform.url,
          active: true
        });
        console.log('[SidebarToggle] 打开第一个候选平台:', platform.id);
        return { tabId: tab.id, title: tab.title || platform.id };
      }
    }

    console.log('[SidebarToggle] 所有平台标签页都已打开');
    return null;
  } catch (e) {
    console.error('[SidebarToggle] 打开平台标签失败:', e);
    return null;
  }
}

/**
 * Tab 轮询切换：依次在所有 tab 间切换
 */
async function switchSelectedTab() {
  const allTabs = await getAllTabs();
  if (allTabs.length === 0) {
    console.log('[SidebarToggle] 没有可切换的标签');
    return;
  }

  // 计算下一个索引
  const nextIndex = (currentTabIndex + 1) % allTabs.length;
  const nextTab = allTabs[nextIndex];

  // 更新当前索引并保存
  currentTabIndex = nextIndex;
  await saveTabCycleState();

  // 执行切换
  if (nextTab.type === 'workspace') {
    await switchToWorkspaceTab(nextTab);
  } else {
    // 切换到对应的 AI 平台
    await switchToPlatform(nextTab.platform);
  }

  console.log('[SidebarToggle] Tab 切换完成，当前索引:', currentTabIndex);
}

// 监听快捷键
chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log('[SidebarToggle] 收到命令:', command, 'tab:', tab?.id);

  if (command === 'toggle_sidebar') {
    toggleSidebar(tab?.id);
  }

  if (command === 'add_to_workspace') {
    await addCurrentPageToWorkspace(tab?.id);
  }
});

// 监听标签页
chrome.tabs.onRemoved.addListener((tabId) => {
  sidebarOpenTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    sidebarOpenTabs.delete(tabId);
  }
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sidebarTabSwitch') {
    // Background 作为大脑，直接处理切换逻辑
    switchSelectedTab()
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('[SidebarToggle] Tab 切换失败:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // 异步响应
  }

  if (request.action === 'addToWorkspace') {
    // 添加当前页面到工作区
    addCurrentPageToWorkspace()
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[SidebarToggle] 添加到工作区失败:', err);
        sendResponse({ success: false, reason: 'error' });
      });
    return true; // 异步响应
  }

  if (request.action === 'getTabCycleState') {
    // 返回当前轮询状态
    sendResponse({
      currentIndex: currentTabIndex,
      workspaceTabs: workspaceTabs
    });
    return false;
  }

  return false;
});

console.log('[SidebarToggle] 监听器已注册');

// 导出
export function setupSidebarCommandListener() {
  console.log('[SidebarToggle] setupSidebarCommandListener 被调用');
}
