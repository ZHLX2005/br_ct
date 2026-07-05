/**
 * 平台显示设置页面
 */

// 导入统一平台配置
import { PLATFORM_CONFIG } from '../../config/platformConfig.js';

const PLATFORM_VISIBILITY_KEY = 'platformVisibilitySettings';
const OCR_PROMPT_KEY = 'platformOcrPrompt';
const DEFAULT_OCR_PROMPT = '请识别这张图片中的所有文字内容';

// API 配置存储
const STORAGE_KEY = 'translation.api.config';
const DEFAULT_CONFIG = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  model: 'glm-4.5v'
};

// DOM 元素
let platformGrid;
let statusMessage;

// API 配置 DOM 元素
let baseURLInput, apiKeyInput, modelInput;
let baseURLStatus, apiKeyStatus, modelStatus;
let testResultDiv, apiStatusMessageDiv;

/**
 * 初始化平台设置页面
 */
function initializePlatformSettings() {
  platformGrid = document.getElementById('platform-grid');
  statusMessage = document.getElementById('status-message');

  // 生成平台选项
  generatePlatformOptions();

  // 加载保存的设置
  loadPlatformVisibilitySettings();
  loadOcrPrompt();

  // 绑定事件监听器
  bindEventListeners();

  // API 配置
  bindAPIDomElements();
  loadAPISettings();
  bindAPIEventListeners();
}

/**
 * 生成平台选项
 */
function generatePlatformOptions() {
  platformGrid.innerHTML = '';

  // 分组标题
  const divider = document.createElement('div');
  divider.className = 'section-divider';
  divider.innerHTML = '<div class="section-title">平台可见性</div>';
  platformGrid.appendChild(divider);

  Object.entries(PLATFORM_CONFIG).forEach(([platformId, config]) => {
    const platformItem = document.createElement('div');
    platformItem.className = 'platform-item';

    platformItem.innerHTML = `
      <input
        type="checkbox"
        class="platform-checkbox"
        id="platform-${platformId}"
        data-platform="${platformId}"
      >
      <label class="platform-label" for="platform-${platformId}">
        <div class="platform-icon" style="background-color: ${config.color}">
          ${config.icon}
        </div>
        <span>${config.name}</span>
      </label>
    `;

    platformGrid.appendChild(platformItem);
  });
}

/**
 * 加载平台可见性设置
 */
function loadPlatformVisibilitySettings() {
  chrome.storage.local.get([PLATFORM_VISIBILITY_KEY], (result) => {
    const settings = result[PLATFORM_VISIBILITY_KEY] || {};

    // 应用保存的设置，如果没有保存的设置则使用默认值
    Object.entries(PLATFORM_CONFIG).forEach(([platformId, config]) => {
      const checkbox = document.getElementById(`platform-${platformId}`);
      if (checkbox) {
        checkbox.checked = settings.hasOwnProperty(platformId)
          ? settings[platformId]
          : config.defaultVisible;
      }
    });
  });
}

/**
 * 保存平台可见性设置
 */
function savePlatformVisibilitySettings() {
  const settings = {};

  // 收集平台可见性设置
  Object.keys(PLATFORM_CONFIG).forEach(platformId => {
    const checkbox = document.getElementById(`platform-${platformId}`);
    if (checkbox) {
      settings[platformId] = checkbox.checked;
    }
  });

  // 获取当前的平台勾选状态，只取消不可见平台的勾选
  chrome.storage.local.get(['platformStates'], (result) => {
    const platformStates = result.platformStates || {};

    // 对不可见的平台，取消其勾选状态
    Object.keys(settings).forEach(platformId => {
      if (!settings[platformId]) {
        platformStates[platformId] = false;
      }
      // 可见的平台保持原来的勾选状态
    });

    // 保存可见性设置和更新后的勾选状态
    chrome.storage.local.set({
      [PLATFORM_VISIBILITY_KEY]: settings,
      platformStates: platformStates
    }, () => {
      showStatusMessage('设置已保存', 'success');

      // 通知 popup 页面更新平台显示
      chrome.runtime.sendMessage({
        action: 'platformVisibilityUpdated',
        settings: settings
      }).catch(() => {
        console.log('Popup 页面可能未打开，忽略消息错误');
      });
    });
  });
}

/**
 * 加载 OCR 提示词
 */
function loadOcrPrompt() {
  chrome.storage.local.get([OCR_PROMPT_KEY], (result) => {
    const textarea = document.getElementById('ocr-prompt');
    if (textarea) {
      textarea.value = result[OCR_PROMPT_KEY] || DEFAULT_OCR_PROMPT;
    }
  });
}

/**
 * 保存 OCR 提示词
 */
function saveOcrPrompt() {
  const textarea = document.getElementById('ocr-prompt');
  if (!textarea) return;
  chrome.storage.local.set({ [OCR_PROMPT_KEY]: textarea.value.trim() || DEFAULT_OCR_PROMPT }, () => {
    showStatusMessage('OCR 提示词已保存', 'success');
  });
}

/**
 * 重置为默认设置
 */
function resetToDefaults() {
  Object.entries(PLATFORM_CONFIG).forEach(([platformId, config]) => {
    const checkbox = document.getElementById(`platform-${platformId}`);
    if (checkbox) {
      checkbox.checked = config.defaultVisible;
    }
  });

  // 自动保存重置后的设置，同步更新勾选状态
  savePlatformVisibilitySettings();
}

/**
 * 显示状态消息
 */
function showStatusMessage(message, type = 'success') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message show ${type}`;

  // 3秒后自动隐藏
  setTimeout(() => {
    statusMessage.classList.remove('show');
  }, 3000);
}

/**
 * 绑定事件监听器
 */
function bindEventListeners() {
  // 保存设置按钮 - 保存平台可见性设置
  document.getElementById('save-settings').addEventListener('click', () => {
    savePlatformVisibilitySettings();
  });

  // 重置设置按钮
  document.getElementById('reset-settings').addEventListener('click', resetToDefaults);

  // OCR 提示词 - blur 时自动保存
  document.getElementById('ocr-prompt').addEventListener('blur', saveOcrPrompt);

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getPlatformVisibilitySettings') {
      const settings = {};
      Object.keys(PLATFORM_CONFIG).forEach(platformId => {
        const checkbox = document.getElementById(`platform-${platformId}`);
        if (checkbox) {
          settings[platformId] = checkbox.checked;
        }
      });
      sendResponse({ settings });
    } else if (request.action === 'getAPISettings') {
      const config = {
        baseURL: baseURLInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim()
      };
      sendResponse({ config });
    }
  });
}

/**
 * 获取 API 配置相关 DOM 元素引用
 */
function bindAPIDomElements() {
  baseURLInput = document.getElementById('baseurl-input');
  apiKeyInput = document.getElementById('apikey-input');
  modelInput = document.getElementById('model-input');
  baseURLStatus = document.getElementById('baseurl-status');
  apiKeyStatus = document.getElementById('apikey-status');
  modelStatus = document.getElementById('model-status');
  testResultDiv = document.getElementById('test-result');
  apiStatusMessageDiv = document.getElementById('api-status-message');
}

/**
 * 加载 API 设置到表单
 */
function loadAPISettings() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const config = result[STORAGE_KEY] || { ...DEFAULT_CONFIG };

    baseURLInput.value = config.baseURL || DEFAULT_CONFIG.baseURL;
    apiKeyInput.value = config.apiKey || '';
    modelInput.value = config.model || DEFAULT_CONFIG.model;

    updateStatusDisplay();
  });
}

/**
 * 更新 API 输入框旁的「已配置/默认值/未配置」状态显示
 */
function updateStatusDisplay() {
  // Base URL 状态
  if (baseURLInput.value && baseURLInput.value !== DEFAULT_CONFIG.baseURL) {
    baseURLStatus.textContent = '已配置';
    baseURLStatus.className = 'api-status configured';
  } else if (baseURLInput.value === DEFAULT_CONFIG.baseURL) {
    baseURLStatus.textContent = '默认值';
    baseURLStatus.className = 'api-status configured';
  } else {
    baseURLStatus.textContent = '未配置';
    baseURLStatus.className = 'api-status not-configured';
  }

  // API Key 状态
  if (apiKeyInput.value) {
    apiKeyStatus.textContent = '已配置';
    apiKeyStatus.className = 'api-status configured';
  } else {
    apiKeyStatus.textContent = '未配置';
    apiKeyStatus.className = 'api-status not-configured';
  }

  // Model 状态
  if (modelInput.value) {
    modelStatus.textContent = '已配置';
    modelStatus.className = 'api-status configured';
  } else {
    modelStatus.textContent = '未配置';
    modelStatus.className = 'api-status not-configured';
  }
}

/**
 * 保存 API 设置
 */
function saveAPISettings() {
  const config = {
    baseURL: baseURLInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim()
  };

  if (!config.baseURL) {
    showAPIStatusMessage('请输入 API Base URL', 'error');
    return;
  }
  if (!config.apiKey) {
    showAPIStatusMessage('请输入 API Key', 'error');
    return;
  }
  if (!config.model) {
    showAPIStatusMessage('请输入模型名称', 'error');
    return;
  }

  chrome.storage.local.set({ [STORAGE_KEY]: config }, () => {
    showAPIStatusMessage('设置已保存', 'success');
    updateStatusDisplay();
    testResultDiv.style.display = 'none';
  });
}

/**
 * 重置为默认 API 设置（不自动保存）
 */
function resetAPIToDefaults() {
  baseURLInput.value = DEFAULT_CONFIG.baseURL;
  apiKeyInput.value = '';
  modelInput.value = DEFAULT_CONFIG.model;

  showAPIStatusMessage('已重置为默认设置，请点击保存', 'success');
  updateStatusDisplay();
}

/**
 * 测试 API 连接
 */
async function testAPIConnection() {
  const config = {
    baseURL: baseURLInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim()
  };

  if (!config.baseURL || !config.apiKey || !config.model) {
    showAPITestResult('请先填写完整的 API 配置信息', 'error');
    return;
  }

  showAPITestResult('正在测试连接...', 'info');

  try {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        showAPITestResult('连接成功，API 配置有效', 'success');
      } else {
        showAPITestResult('连接成功，但返回格式异常', 'error');
      }
    } else {
      const errorData = await response.json().catch(() => ({}));
      showAPITestResult(`连接失败：${errorData.error?.message || response.statusText}`, 'error');
    }
  } catch (error) {
    showAPITestResult(`连接失败：${error.message}`, 'error');
  }
}

/**
 * 显示 API 测试结果
 */
function showAPITestResult(message, type) {
  testResultDiv.textContent = message;
  testResultDiv.className = `test-result ${type}`;
  testResultDiv.style.display = 'block';
}

/**
 * 显示 API 区域状态消息（独立于平台可见性的页面级 #status-message）
 */
function showAPIStatusMessage(message, type = 'success') {
  apiStatusMessageDiv.textContent = message;
  apiStatusMessageDiv.className = `status-message show ${type}`;

  setTimeout(() => {
    apiStatusMessageDiv.classList.remove('show');
  }, 3000);
}

/**
 * 绑定 API 配置相关事件监听器
 */
function bindAPIEventListeners() {
  document.getElementById('save-btn').addEventListener('click', saveAPISettings);
  document.getElementById('reset-btn').addEventListener('click', resetAPIToDefaults);
  document.getElementById('test-btn').addEventListener('click', testAPIConnection);

  baseURLInput.addEventListener('input', updateStatusDisplay);
  apiKeyInput.addEventListener('input', updateStatusDisplay);
  modelInput.addEventListener('input', updateStatusDisplay);
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', initializePlatformSettings);
