// storage.js - 数据存储管理模块

// 存储键常量
export const STORAGE_KEYS = {
  HISTORY: "messageHistory",
  OPTIMIZER: "selectedOptimizer",
  PLATFORM_VISIBILITY: "platformVisibilitySettings",
  LAST_MESSAGE: "lastMessage",
  PLATFORM_STATES: "platformStates",
  LAST_PROMPT_TEMPLATE: "lastPromptTemplate",
  MESSAGE_TAB_CONTEXT: "messageTabContext"
};

const MAX_HISTORY = 30;

/**
 * 保存消息内容到本地存储
 */
export async function saveMessageContent(content) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.LAST_MESSAGE]: content }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log("消息内容已保存到本地存储，长度:", content.length);
        resolve();
      }
    });
  });
}

/**
 * 保存平台勾选状态
 */
export function savePlatformStates(platformCheckboxes) {
  const checkedStates = {};
  platformCheckboxes.forEach((cb) => {
    checkedStates[cb.dataset.platform] = cb.checked;
  });

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.PLATFORM_STATES]: checkedStates }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 保存优化器选择
 */
export function saveOptimizerSetting(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.OPTIMIZER]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 保存平台可见性设置
 */
export function savePlatformVisibilitySettings(settings) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.PLATFORM_VISIBILITY]: settings }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * 加载存储的数据
 */
export function loadStoredData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      Object.values(STORAGE_KEYS),
      (result) => {
        if (chrome.runtime.lastError) {
          console.error("加载数据失败:", chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        resolve(result);
      }
    );
  });
}

/**
 * 加载特定键的数据
 */
export function loadData(keys) {
  return new Promise((resolve) => {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    chrome.storage.local.get(keysArray, (result) => {
      if (chrome.runtime.lastError) {
        console.error("加载数据失败:", chrome.runtime.lastError.message);
        resolve({});
        return;
      }
      resolve(result);
    });
  });
}

/**
 * 添加消息到历史记录
 */
export function addToHistory(message) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(STORAGE_KEYS.HISTORY, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      let history = result[STORAGE_KEYS.HISTORY] || [];
      history = history.filter((item) => item !== message);
      history.unshift(message);

      if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
      }

      chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(history);
        }
      });
    });
  });
}

/**
 * 添加消息到 "标签页-消息" 关联容器
 * 结构：{ [tabUrl]: string[] }
 * 用于统计"某个标签页（专注窗口）下产生了哪些问题"
 */
export async function addMessageTabContext(message, tabUrl) {
  if (!message || !tabUrl) return;

  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MESSAGE_TAB_CONTEXT);
    const map = result[STORAGE_KEYS.MESSAGE_TAB_CONTEXT] || {};
    const list = map[tabUrl] || [];

    // 按内容去重：已有相同消息则移到最前
    const filtered = list.filter((m) => m !== message);
    filtered.unshift(message);

    map[tabUrl] = filtered;
    await chrome.storage.local.set({ [STORAGE_KEYS.MESSAGE_TAB_CONTEXT]: map });
  } catch (error) {
    console.error("保存标签页-消息关联失败:", error);
  }
}

/**
 * 读取 "标签页-消息" 关联容器
 * @returns {Object} { [tabUrl]: messages[] }
 */
export async function getMessageTabContext() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MESSAGE_TAB_CONTEXT);
    return result[STORAGE_KEYS.MESSAGE_TAB_CONTEXT] || {};
  } catch (error) {
    console.error("读取标签页-消息关联失败:", error);
    return {};
  }
}

/**
 * 从指定 URL 下移除单条消息
 * 如果该 URL 下没有消息了，则自动删除该 URL 条目
 */
export async function removeMessageFromTabContext(message, tabUrl) {
  if (!message || !tabUrl) return;

  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MESSAGE_TAB_CONTEXT);
    const map = result[STORAGE_KEYS.MESSAGE_TAB_CONTEXT] || {};
    const list = map[tabUrl] || [];

    const filtered = list.filter((m) => m !== message);
    if (filtered.length === 0) {
      delete map[tabUrl];
    } else {
      map[tabUrl] = filtered;
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.MESSAGE_TAB_CONTEXT]: map });
  } catch (error) {
    console.error("删除标签页-消息关联失败:", error);
  }
}

/**
 * 移除整个 URL 条目（包括其下所有消息）
 */
export async function removeTabContextUrl(tabUrl) {
  if (!tabUrl) return;

  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MESSAGE_TAB_CONTEXT);
    const map = result[STORAGE_KEYS.MESSAGE_TAB_CONTEXT] || {};
    delete map[tabUrl];
    await chrome.storage.local.set({ [STORAGE_KEYS.MESSAGE_TAB_CONTEXT]: map });
  } catch (error) {
    console.error("删除来源 URL 失败:", error);
  }
}