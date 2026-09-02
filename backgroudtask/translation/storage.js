/**
 * 存储管理模块 - 翻译/OCR功能
 * 负责初始化和管理 chrome.storage
 */

import { updateContextMenuVisibility } from './contextMenu.js';

/**
 * 清理已删除的划词收藏功能遗留的存储数据
 */
function cleanupLegacyFavoritesStorage() {
  chrome.storage.local.remove(['translation.favorites', 'translation.favoritesShortcut']);
}

/**
 * 初始化翻译设置存储
 */
function initSettingsStorage() {
  chrome.storage.local.get(['translation.settings'], (result) => {
    if (!result['translation.settings']) {
      chrome.storage.local.set({
        'translation.settings': {
          autoTranslate: false,
          showContextMenu: true,
          selectionPrompt: '请解释 %s',
          selectionStream: true,
          selectionThinking: false,
          ocrPrompt: '请识别图片中的所有文字内容',
          ocrStream: false,
          ocrThinking: false,
          flowRate: 3
        }
      });
      console.log('[Translation] 翻译设置已初始化');
    }
  });
}

/**
 * 初始化统计存储
 */
function initStatsStorage() {
  chrome.storage.local.get(['translation.todayCount', 'translation.totalCount'], (result) => {
    if (result['translation.todayCount'] === undefined) {
      chrome.storage.local.set({
        'translation.todayCount': 0,
        'translation.totalCount': 0
      });
      console.log('[Translation] 统计已初始化');
    }
  });
}

/**
 * 监听 storage 变化
 */
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['translation.settings']) {
      console.log('[Translation] 检测到设置变化，更新右键菜单');
      updateContextMenuVisibility();
    }
  });

  console.log('[Translation] Storage 监听器已设置');
}

/**
 * 初始化存储模块
 */
export function setupStorage() {
  cleanupLegacyFavoritesStorage();
  initSettingsStorage();
  initStatsStorage();
  setupStorageListener();
}
