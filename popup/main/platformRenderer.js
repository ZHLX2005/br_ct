/**
 * 动态生成平台选项
 *
 * 从统一配置文件读取平台列表，自动生成 HTML
 * 这样添加新平台时只需修改 platformConfig.js
 */

import { PLATFORM_CONFIG } from '../../config/platformConfig.js';

/**
 * 动态生成平台选项 HTML
 */
export function generatePlatformOptionsHTML() {
  const options = [];

  Object.entries(PLATFORM_CONFIG).forEach(([platformId, config]) => {
    options.push(`
      <label class="platform-icon-option" data-platform-id="${platformId}">
        <input type="checkbox" data-platform="${platformId}" />
        <div class="icon-wrapper" data-platform-icon="${config.shortIcon}">${config.icon}</div>
        <div class="platform-label">${config.name}</div>
      </label>
    `);
  });

  return options.join('');
}

/**
 * 初始化平台选项（在视图 init 时调用，scope 到 rootEl）。
 * @param {Element} rootEl
 */
export function initializePlatformOptions(rootEl) {
  const container = rootEl.querySelector('#platform-options-row');
  if (container) {
    const platformCount = Object.keys(PLATFORM_CONFIG).length;
    container.innerHTML = generatePlatformOptionsHTML();
    container.style.setProperty('--platform-columns', Math.min(platformCount, 7));
  }
}
