// ai_platform_processor.js
// 1. setupTabUpdateListener: 监听页面 AI 平台 Tab 加载并注入基础脚本
// 2. processTaskQueueConcurrent: 扩展按钮触发发送时，复用或创建平台 Tab 并发送消息

import { getPlatformUrls } from '../config/platformConfig.js';
import { getPlatformScriptFiles, getResponseListenerFiles } from "./platformScriptFiles.js";

export const platformUrls = getPlatformUrls();

const injectedTabs = new Map(); // platform -> Set<tabId>

function markInjected(tabId, platform) {
  if (!injectedTabs.has(platform)) {
    injectedTabs.set(platform, new Set());
  }
  injectedTabs.get(platform).add(tabId);

  chrome.tabs.onRemoved.addListener(function closedListener(removedTabId) {
    if (removedTabId === tabId) {
      removeTab(tabId);
      chrome.tabs.onRemoved.removeListener(closedListener);
    }
  });
}

function removeTab(tabId) {
  for (const tabSet of injectedTabs.values()) {
    tabSet.delete(tabId);
  }
}

function hasInjected(platform) {
  return injectedTabs.has(platform) && injectedTabs.get(platform).size > 0;
}

function getInjectedTab(platform) {
  if (!hasInjected(platform)) return null;
  const tabIds = [...injectedTabs.get(platform)];
  return tabIds[0] || null;
}

function getPlatformFromUrl(url) {
  for (const [platform, platformUrl] of Object.entries(platformUrls)) {
    if (url.includes(platformUrl)) {
      return platform;
    }
  }
  return null;
}

function injectScript(tabId, platform) {
  return new Promise((resolve, reject) => {
    const files = getPlatformScriptFiles(platform);

    chrome.scripting.executeScript(
      {
        target: { tabId },
        files,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        markInjected(tabId, platform);
        resolve();
      }
    );
  });
}

function injectResponseListener(tabId, platform) {
  return new Promise((resolve, reject) => {
    const files = getResponseListenerFiles(platform);
    if (!files || files.length === 0) {
      resolve();
      return;
    }

    console.log(`【回复监听注入】Tab ${tabId} 开始注入 ${platform} 回复监听脚本`);

    chrome.scripting.executeScript(
      { target: { tabId }, files },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        console.log(`【回复监听注入】Tab ${tabId} 注入成功，发送启动消息`);
        chrome.tabs.sendMessage(tabId, { action: "startResponseListener" }, () => {
          if (chrome.runtime.lastError) {
            console.warn(`[${platform}] 启动回复监听失败:`, chrome.runtime.lastError.message);
          } else {
            console.log(`【回复监听注入】Tab ${tabId} ${platform} 回复监听已启动`);
          }
          resolve();
        });
      }
    );
  });
}

function sendMessage(tabId, message, source = "popup") {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: "sendMessage", message, source }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.status === 'failed') {
        reject(new Error('Content script 执行失败'));
        return;
      }
      resolve(response);
    });
  });
}

function cleanupResponseListener(tabId, platform) {
  return new Promise((resolve) => {
    console.log(`【回复监听重置】Tab ${tabId} 重置 ${platform} 回复监听状态`);
    chrome.tabs.sendMessage(tabId, { action: "resetResponseListener" }, () => {
      if (chrome.runtime.lastError) {
        console.warn(`[${platform}] 重置回复监听失败:`, chrome.runtime.lastError.message);
      } else {
        console.log(`【回复监听重置】Tab ${tabId} ${platform} 回复监听已重置`);
      }
      resolve();
    });
  });
}

function pageConsoleLog(tabId, platform, message) {
  chrome.tabs.sendMessage(tabId, { action: "consoleLog", message: `[${platform}] ${message}` }, () => {});
}

export function setupTabUpdateListener() {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;

    const platform = getPlatformFromUrl(tab.url);
    if (!platform) return;

    if (hasInjected(platform)) {
      console.log(`[${platform}] Tab ${tabId} 已注入，跳过`);
      return;
    }

    console.log(`[${platform}] Tab ${tabId} 加载完成，开始注入`);
    injectScript(tabId, platform)
      .then(() => console.log(`[${platform}] 注入成功`))
      .catch(err => console.error(`[${platform}] 注入失败:`, err.message));
  });
}

export function setupMessageListener() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "processTaskQueue") {
      const config = request.config || {
        maxConcurrent: 3,
        batchDelay: 300,
        tabLoadTimeout: 8000,
      };
      const source = request.source || "popup";

      processTaskQueueConcurrent(request.queue, config, source)
        .then(results => {
          const success = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          sendResponse({ status: "completed", total: results.length, success, failed, results });
        })
        .catch(error => {
          sendResponse({ status: "error", error: error.message });
        });
      return true;
    }

    if (request.action === "closeAllAITabs") {
      closeAllAITabs();
      sendResponse({ status: "closing_tabs" });
      return true;
    }
  });
}

export async function processTaskQueueConcurrent(queue, options = {}, source = "popup") {
  const { maxConcurrent = 3, batchDelay = 300 } = options;
  const results = [];
  const shouldListenResponses = source === "sidebar";

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const selectedPlatforms = queue.map(t => t.platform);
  const activeTabMatches = activeTab && selectedPlatforms.some(p => {
    const url = platformUrls[p];
    return url && activeTab.url && activeTab.url.includes(url);
  });

  for (let i = 0; i < queue.length; i += maxConcurrent) {
    const batch = queue.slice(i, i + maxConcurrent);
    const batchResults = await Promise.allSettled(
      batch.map((task, index) => processSingleTask(task, {
        isFirst: i === 0 && index === 0,
        shouldJump: !activeTabMatches,
        source,
        shouldListenResponses,
      }))
    );
    results.push(...batchResults);

    if (i + maxConcurrent < queue.length) {
      await new Promise(resolve => setTimeout(resolve, batchDelay));
    }
  }

  return results;
}

async function processSingleTask(task, opts = {}) {
  const { platform, message } = task;
  const tab = await findOrCreatePlatformTab(platform, opts.isFirst, opts.shouldJump);
  await waitForTabComplete(tab.id);

  await injectScript(tab.id, platform);
  if (opts.shouldListenResponses) {
    await cleanupResponseListener(tab.id, platform);
    await injectResponseListener(tab.id, platform);
  }

  try {
    const result = await trySend(tab.id, platform, message, opts.source, false);
    return result;
  } catch (firstErr) {
    console.warn(`[${platform}] 首次发送失败，尝试重注:`, firstErr.message);

    try {
      injectedTabs.get(platform)?.delete(tab.id);
      await injectScript(tab.id, platform);
      if (opts.shouldListenResponses) {
        await cleanupResponseListener(tab.id, platform);
        await injectResponseListener(tab.id, platform);
      }
      const result = await trySend(tab.id, platform, message, opts.source, true);
      return result;
    } catch (finalErr) {
      console.error(`[${platform}] 最终发送失败`, finalErr.message);
      throw finalErr;
    }
  }
}

async function trySend(tabId, platform, message, source, isRetry) {
  try {
    await sendMessage(tabId, message, source);
    return { platform, success: true, tabId, retried: isRetry };
  } catch (err) {
    throw err;
  }
}

async function findOrCreatePlatformTab(platform, isFirst = false, shouldJump = true) {
  const targetUrl = platformUrls[platform];
  if (!targetUrl) throw new Error(`未知平台: ${platform}`);

  const injectedTabId = getInjectedTab(platform);
  if (injectedTabId !== null) {
    try {
      const tab = await chrome.tabs.get(injectedTabId);
      if (shouldJump) await chrome.tabs.update(tab.id, { active: true });
      return tab;
    } catch (e) {
      // Tab 已失效，removeTab 会在 onRemoved 里清理
    }
  }

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url && tab.url.includes(targetUrl));
  if (existing) {
    if (shouldJump) await chrome.tabs.update(existing.id, { active: true });
    return existing;
  }

  return chrome.tabs.create({ url: targetUrl, active: isFirst });
}

function waitForTabComplete(tabId, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        cleanup();
        setTimeout(resolve, 800);
      }
    };
    timer = setTimeout(() => { cleanup(); reject(new Error('加载超时')); }, timeout);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, tab => {
      if (tab?.status === 'complete') {
        cleanup();
        setTimeout(resolve, 800);
      }
    });
  });
}

export function closeAllAITabs() {
  chrome.tabs.query({}, tabs => {
    const toClose = tabs
      .filter(tab => getPlatformFromUrl(tab.url))
      .map(tab => tab.id);
    if (toClose.length) {
      chrome.tabs.remove(toClose);
      toClose.forEach(id => removeTab(id));
    }
  });
}
