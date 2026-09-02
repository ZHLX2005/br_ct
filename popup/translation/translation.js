/**
 * 划词翻译设置页面
 * 管理翻译和OCR相关的设置
 */

// 视图根元素（init 时绑定；事件处理函数中查询使用）
let viewRoot = null;

// DOM 元素
let selectionModeRadios;  // 模式单选按钮
let promptSelector;        // 提示词选择器
let promptSelectorContainer; // 提示词选择器容器
let selectionStreamToggle, selectionThinkingToggle;
let ocrPromptInput, ocrStreamToggle, ocrThinkingToggle, ocrSilentModeToggle;
let flowRateControl, flowRateSlider, flowRateValue, flowRateWarning;
let ocrShortcutInput, clearOcrShortcutBtn;
let todayCountEl, totalCountEl;

// 快捷键录制状态
let isRecordingOcrShortcut = false;

// 提示词数据（从 background 动态加载）
let promptData = [];

async function loadPromptData() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'translation.getTransPrompts' });
    if (response && response.success && response.prompts) {
      promptData = response.prompts;
      updatePromptSelector();
      return;
    }
  } catch (e) {
    console.warn('[Translation] 从 background 获取提示词失败:', e);
  }
  promptData = [
    { label: '翻译', alias: 'fy', template: '请翻译：%s' },

  ];
  updatePromptSelector();
}

function updatePromptSelector() {
  if (!promptSelector) return;
  promptSelector.innerHTML = promptData.map(p =>
    `<option value="${p.alias}">${p.label}</option>`
  ).join('');
  // 恢复之前保存的选择
  chrome.storage.local.get(['translation.settings'], (result) => {
    const settings = result['translation.settings'];
    if (settings && settings.selectionPromptKey) {
      promptSelector.value = settings.selectionPromptKey;
    }
  });
}

// 流速档位配置
const FLOW_RATE_PRESETS = {
  1: { name: '很慢', outputInterval: 60, chunkSize: 8, warning: false },
  2: { name: '较慢', outputInterval: 45, chunkSize: 10, warning: false },
  3: { name: '中等', outputInterval: 35, chunkSize: 12, warning: false },
  4: { name: '较快', outputInterval: 25, chunkSize: 15, warning: true },
  5: { name: '很快', outputInterval: 15, chunkSize: 20, warning: true }
};

// 初始化
export function init(rootEl) {
  viewRoot = rootEl;

  // 获取 DOM 元素（全部 scope 到 rootEl）
  selectionModeRadios = rootEl.querySelectorAll('input[name="selectionMode"]');
  promptSelector = rootEl.querySelector('#promptSelector');
  promptSelectorContainer = rootEl.querySelector('#promptSelectorContainer');
  selectionStreamToggle = rootEl.querySelector('#selectionStreamToggle');
  selectionThinkingToggle = rootEl.querySelector('#selectionThinkingToggle');
  ocrPromptInput = rootEl.querySelector('#ocrPromptInput');
  ocrStreamToggle = rootEl.querySelector('#ocrStreamToggle');
  ocrThinkingToggle = rootEl.querySelector('#ocrThinkingToggle');
  ocrSilentModeToggle = rootEl.querySelector('#ocrSilentModeToggle');
  flowRateControl = rootEl.querySelector('#flowRateControl');
  flowRateSlider = rootEl.querySelector('#flowRateSlider');
  flowRateValue = rootEl.querySelector('#flowRateValue');
  flowRateWarning = rootEl.querySelector('#flowRateWarning');
  ocrShortcutInput = rootEl.querySelector('#ocrShortcutInput');
  clearOcrShortcutBtn = rootEl.querySelector('#clearOcrShortcutBtn');
  todayCountEl = rootEl.querySelector('#todayCount');
  totalCountEl = rootEl.querySelector('#totalCount');

  // 加载设置
  loadSettings();
  loadPromptData();
  loadStatistics();

  // 绑定事件
  bindEvents();
}

// teardown：清理快捷键录制 document 级监听（视图切走时调用）
// finishOcrShortcutRecording 内部的 removeEventListener 是无条件执行的
// （不依赖 e.key），故合成 keyup Event 可触发清理分支。
export function teardown(rootEl) {
  if (isRecordingOcrShortcut) finishOcrShortcutRecording(new Event('keyup'));
}

// 绑定事件
function bindEvents() {
  // 划词翻译设置 - 模式切换
  selectionModeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      updatePromptSelectorVisibility();
      saveSelectionSettings();
    });
  });

  // 提示词选择
  if (promptSelector) {
    promptSelector.addEventListener('change', () => {
      saveSelectionSettings();
    });
  }

  // 划词翻译选项
  if (selectionStreamToggle) selectionStreamToggle.addEventListener('change', saveSelectionSettings);
  if (selectionThinkingToggle) selectionThinkingToggle.addEventListener('change', saveSelectionSettings);

  // OCR 设置
  if (ocrPromptInput) ocrPromptInput.addEventListener('input', saveOCRSettings);
  if (ocrStreamToggle) ocrStreamToggle.addEventListener('change', () => {
    saveOCRSettings();
    updateFlowRateControlVisibility();
  });
  if (ocrThinkingToggle) ocrThinkingToggle.addEventListener('change', saveOCRSettings);
  if (ocrSilentModeToggle) ocrSilentModeToggle.addEventListener('change', saveOCRSettings);

  // 流速控制
  if (flowRateSlider) {
    flowRateSlider.addEventListener('input', updateFlowRateDisplay);
    flowRateSlider.addEventListener('change', saveFlowRate);
  }

  // 快捷键设置
  if (ocrShortcutInput) ocrShortcutInput.addEventListener('click', startOcrShortcutRecording);
  if (clearOcrShortcutBtn) clearOcrShortcutBtn.addEventListener('click', clearOcrShortcut);
}

// 更新提示词选择器可见性
function updatePromptSelectorVisibility() {
  const selectedMode = viewRoot?.querySelector('input[name="selectionMode"]:checked')?.value;
  if (promptSelectorContainer) {
    promptSelectorContainer.style.display = selectedMode === 'auto' ? 'block' : 'none';
  }
}

// 加载设置
function loadSettings() {
  chrome.storage.local.get(['translation.settings'], (result) => {
    const settings = result['translation.settings'] || {
      selectionMode: 'panel',
      selectionPromptKey: 'fy',
      selectionPrompt: '请翻译：%s',
      selectionStream: true,
      selectionThinking: false,
      ocrPrompt: '请识别图片中的所有文字内容',
      ocrStream: false,
      ocrThinking: false,
      ocrSilentMode: false,
      flowRate: 3
    };

    // 应用划词翻译设置
    const modeRadio = viewRoot?.querySelector(`input[name="selectionMode"][value="${settings.selectionMode}"]`);
    if (modeRadio) modeRadio.checked = true;
    updatePromptSelectorVisibility();

    if (selectionStreamToggle) selectionStreamToggle.checked = settings.selectionStream !== false;
    if (selectionThinkingToggle) selectionThinkingToggle.checked = settings.selectionThinking || false;

    // 应用 OCR 设置
    if (ocrPromptInput) ocrPromptInput.value = settings.ocrPrompt || '请识别图片中的所有文字内容';
    if (ocrStreamToggle) ocrStreamToggle.checked = settings.ocrStream || false;
    if (ocrThinkingToggle) ocrThinkingToggle.checked = settings.ocrThinking || false;
    if (ocrSilentModeToggle) ocrSilentModeToggle.checked = settings.ocrSilentMode || false;
    if (flowRateSlider) flowRateSlider.value = settings.flowRate || 3;

    updateFlowRateDisplay();
    updateFlowRateControlVisibility();

    // 加载快捷键
    loadOcrShortcut();
  });
}

// 保存划词翻译设置
function saveSelectionSettings() {
  chrome.storage.local.get(['translation.settings'], (result) => {
    const settings = result['translation.settings'] || {};

    // 模式
    const selectedMode = viewRoot?.querySelector('input[name="selectionMode"]:checked')?.value || 'panel';
    settings.selectionMode = selectedMode;

    // 提示词
    if (promptSelector) {
      settings.selectionPromptKey = promptSelector.value;
      const found = promptData.find(p => p.alias === promptSelector.value);
      settings.selectionPrompt = found ? found.template : '请翻译：%s';
    }

    // 选项
    if (selectionStreamToggle) settings.selectionStream = selectionStreamToggle.checked;
    if (selectionThinkingToggle) settings.selectionThinking = selectionThinkingToggle.checked;
    settings.autoTranslate = selectedMode === 'auto'; // 向后兼容

    chrome.storage.local.set({ 'translation.settings': settings }, () => {
      console.log('[Translation] 划词翻译设置已保存');
      notifySettingsChanged();
    });
  });
}

// 保存 OCR 设置
function saveOCRSettings() {
  chrome.storage.local.get(['translation.settings'], (result) => {
    const settings = result['translation.settings'] || {};
    settings.ocrPrompt = ocrPromptInput?.value || '请识别图片中的所有文字内容';
    settings.ocrStream = ocrStreamToggle?.checked || false;
    settings.ocrThinking = ocrThinkingToggle?.checked || false;
    settings.ocrSilentMode = ocrSilentModeToggle?.checked || false;

    chrome.storage.local.set({ 'translation.settings': settings }, () => {
      console.log('[Translation] OCR 设置已保存');
      notifySettingsChanged();
    });
  });
}

// 更新流速控制显示
function updateFlowRateDisplay() {
  const level = parseInt(flowRateSlider?.value || 3);
  const preset = FLOW_RATE_PRESETS[level];

  if (flowRateValue) flowRateValue.textContent = preset.name;
  if (flowRateWarning) flowRateWarning.style.display = preset.warning ? 'block' : 'none';
}

// 更新流速控制可见性
function updateFlowRateControlVisibility() {
  const show = ocrStreamToggle?.checked;
  if (flowRateControl) flowRateControl.style.display = show ? 'block' : 'none';
}

// 保存流速设置
function saveFlowRate() {
  chrome.storage.local.get(['translation.settings'], (result) => {
    const settings = result['translation.settings'] || {};
    settings.flowRate = parseInt(flowRateSlider?.value || 3);

    chrome.storage.local.set({ 'translation.settings': settings }, () => {
      console.log('[Translation] 流速设置已保存');
    });
  });
}

// ==================== OCR 快捷键 ====================

function startOcrShortcutRecording() {
  if (isRecordingOcrShortcut) return;

  isRecordingOcrShortcut = true;
  ocrShortcutInput.classList.add('recording');
  ocrShortcutInput.value = '请按下快捷键组合...';
  ocrShortcutInput.disabled = true;

  document.addEventListener('keydown', recordOcrShortcut);
  document.addEventListener('keyup', finishOcrShortcutRecording);
}

function recordOcrShortcut(e) {
  e.preventDefault();
  e.stopPropagation();

  const modifiers = [];
  if (e.ctrlKey) modifiers.push('Ctrl');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  if (e.metaKey) modifiers.push('Meta');

  const mainKey = e.key;

  if (modifiers.length === 0) {
    ocrShortcutInput.value = '请至少按下一个修饰键 (Ctrl/Alt/Shift/Meta)';
    return;
  }

  const shortcutString = [...modifiers, mainKey].join('+');
  ocrShortcutInput.value = shortcutString;
}

function finishOcrShortcutRecording(e) {
  e.preventDefault();
  e.stopPropagation();

  isRecordingOcrShortcut = false;
  ocrShortcutInput.classList.remove('recording');
  ocrShortcutInput.disabled = false;

  document.removeEventListener('keydown', recordOcrShortcut);
  document.removeEventListener('keyup', finishOcrShortcutRecording);

  const shortcutString = ocrShortcutInput.value;

  if (!shortcutString || shortcutString.includes('请按下')) {
    ocrShortcutInput.value = '';
    return;
  }

  const shortcut = parseShortcutString(shortcutString);
  saveOcrShortcut(shortcut);
  ocrShortcutInput.value = formatShortcutDisplay(shortcutString);
}

function parseShortcutString(shortcutString) {
  const parts = shortcutString.split('+');
  return {
    ctrlKey: parts.includes('Ctrl'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    metaKey: parts.includes('Meta'),
    key: parts[parts.length - 1]
  };
}

function formatShortcutDisplay(shortcutString) {
  return shortcutString
    .replace('Control', 'Ctrl')
    .replace('Meta', 'Cmd');
}

function saveOcrShortcut(shortcut) {
  chrome.storage.local.set({ 'translation.ocr.shortcut': shortcut });

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translation.ocr.updateShortcut',
        shortcut: shortcut
      }).catch(() => {});
    });
  });

  console.log('[Translation] OCR 快捷键已保存:', shortcut);
}

function loadOcrShortcut() {
  chrome.storage.local.get(['translation.ocr.shortcut'], (result) => {
    if (result['translation.ocr.shortcut']) {
      const shortcut = result['translation.ocr.shortcut'];
      const parts = [];
      if (shortcut.ctrlKey) parts.push('Ctrl');
      if (shortcut.altKey) parts.push('Alt');
      if (shortcut.shiftKey) parts.push('Shift');
      if (shortcut.metaKey) parts.push('Meta');
      parts.push(shortcut.key);

      ocrShortcutInput.value = formatShortcutDisplay(parts.join('+'));
    } else {
      ocrShortcutInput.value = '';
    }
  });
}

function clearOcrShortcut() {
  chrome.storage.local.remove('translation.ocr.shortcut');
  ocrShortcutInput.value = '';

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'translation.ocr.clearShortcut'
      }).catch(() => {});
    });
  });

  console.log('[Translation] OCR 快捷键已清除');
}

// 加载统计信息
function loadStatistics() {
  chrome.storage.local.get(['translation.todayCount', 'translation.totalCount'], (result) => {
    if (todayCountEl) todayCountEl.textContent = result['translation.todayCount'] || 0;
    if (totalCountEl) totalCountEl.textContent = result['translation.totalCount'] || 0;
  });
}

// 通知设置已更改
function notifySettingsChanged() {
  chrome.runtime.sendMessage({ action: 'translation.updateSettings' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[Translation] 通知设置更新失败:', chrome.runtime.lastError);
    }
  });
}

// 直开（非嵌入 popup shell）时自动 init
if (document.querySelector('[data-view-content]')) {
  document.addEventListener('DOMContentLoaded', () => init(document.body));
}