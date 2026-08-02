// platformVisibility.js - 平台可见性管理模块

import { loadData, savePlatformVisibilitySettings } from './storage.js';

function updateVisiblePlatformColumns() {
  const container = document.getElementById('platform-options-row');
  if (!container) {
    return;
  }

  const visibleCount = Array.from(
    container.querySelectorAll('.platform-icon-option')
  ).filter((option) => option.style.display !== 'none').length;

  container.style.setProperty(
    '--platform-columns',
    Math.min(Math.max(visibleCount, 1), 7)
  );
}

/**
 * 加载并应用平台可见性设置
 */
export async function loadPlatformVisibilitySettings() {
  try {
    const result = await loadData('platformVisibilitySettings');
    const visibilitySettings = result.platformVisibilitySettings || {};

    // 获取所有平台选项
    const platformOptions = document.querySelectorAll('.platform-icon-option');

    platformOptions.forEach(option => {
      const platformId = option.getAttribute('data-platform-id');
      if (platformId) {
        // 如果设置了可见性为false，则隐藏该平台
        if (visibilitySettings.hasOwnProperty(platformId) && !visibilitySettings[platformId]) {
          option.style.display = 'none';
        } else {
          option.style.display = '';
        }
      }
    });

    updateVisiblePlatformColumns();
    return visibilitySettings;
  } catch (error) {
    console.error('加载平台可见性设置失败:', error);
    return {};
  }
}

/**
 * 应用平台可见性设置（当设置更新时调用）
 * 对不可见的平台取消勾选状态，但保留可见平台的原始勾选状态
 */
export function applyPlatformVisibilitySettings(settings) {
  const platformOptions = document.querySelectorAll('.platform-icon-option');

  platformOptions.forEach(option => {
    const platformId = option.getAttribute('data-platform-id');
    if (platformId) {
      const isVisible = settings.hasOwnProperty(platformId) ? settings[platformId] : true;

      // 应用可见性设置
      if (!isVisible) {
        option.style.display = 'none';
        // 对不可见的平台取消勾选状态
        const checkbox = option.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = false;
        }
      } else {
        option.style.display = '';
        // 可见的平台保持原来的勾选状态
      }
    }
  });

  updateVisiblePlatformColumns();
}

/**
 * 获取可见的平台复选框
 */
export function getVisiblePlatformCheckboxes(allCheckboxes) {
  return Array.from(allCheckboxes).filter((checkbox) => {
    const option = checkbox.closest('.platform-icon-option');
    return option && option.style.display !== 'none';
  });
}

/**
 * 检查是否所有可见平台都已选中
 */
export function areAllVisiblePlatformsChecked(visibleCheckboxes) {
  if (visibleCheckboxes.length === 0) {
    return false;
  }
  return visibleCheckboxes.every((checkbox) => checkbox.checked);
}

/**
 * 设置平台可见性并保存
 */
export async function setPlatformVisibility(platformId, isVisible) {
  try {
    const currentSettings = await loadData('platformVisibilitySettings');
    const visibilitySettings = currentSettings.platformVisibilitySettings || {};

    visibilitySettings[platformId] = isVisible;

    await savePlatformVisibilitySettings(visibilitySettings);
    return visibilitySettings;
  } catch (error) {
    console.error('设置平台可见性失败:', error);
    throw error;
  }
}

/**
 * 监听平台可见性更新消息
 * 返回 cleanup 函数：移除注册的 onMessage 监听，供 main.js teardown 调用。
 * @param {(settings: object) => void} [callback]
 * @returns {() => void}
 */
export function setupPlatformVisibilityMessageListener(callback) {
  const handler = (request) => {
    if (request.action === 'platformVisibilityUpdated') {
      applyPlatformVisibilitySettings(request.settings);
      if (callback) {
        callback(request.settings);
      }
    }
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => {
    chrome.runtime.onMessage.removeListener(handler);
  };
}
