// storage.js - 数据存储管理模块

// 存储键常量
export const STORAGE_KEYS = {
  HISTORY: "messageHistory",
  OPTIMIZER: "selectedOptimizer",
  PLATFORM_VISIBILITY: "platformVisibilitySettings",
  LAST_MESSAGE: "lastMessage",
  PLATFORM_STATES: "platformStates",
  LAST_PROMPT_TEMPLATE: "lastPromptTemplate"
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