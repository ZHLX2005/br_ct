/**
 * 边栏切换模块
 */
console.log('[SidebarToggle] 模块加载');

let sidebarOpenTabs = new Set();

const MAIN_PATH = 'sidebar/main/main.html';
const CLOSED_PATH = 'sidebar/closed.html';

// 初始化 - 恢复状态
chrome.storage.session.get('sidebarOpenTabs').then(result => {
  if (result.sidebarOpenTabs) {
    sidebarOpenTabs = new Set(result.sidebarOpenTabs);
    console.log('[SidebarToggle] 恢复状态:', Array.from(sidebarOpenTabs));
  }
});

// 保存状态
async function saveState() {
  await chrome.storage.session.set({
    sidebarOpenTabs: Array.from(sidebarOpenTabs)
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

// 监听快捷键
chrome.commands.onCommand.addListener((command, tab) => {
  console.log('[SidebarToggle] 收到命令:', command, 'tab:', tab?.id);
  if (command === 'toggle_sidebar') {
    toggleSidebar(tab?.id);
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

console.log('[SidebarToggle] 监听器已注册');

// 导出
export function setupSidebarCommandListener() {
  console.log('[SidebarToggle] setupSidebarCommandListener 被调用');
}
