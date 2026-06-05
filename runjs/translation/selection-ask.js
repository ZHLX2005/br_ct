/**
 * 划词快捷提问模块
 * 仅在 AI 平台页面显示模板面板，点击后发送消息
 */

// ========== 提示词 ==========
let SELECTION_ASK_PROMPTS = [];

const DEFAULT_ASK_PROMPTS = [
  { label: "复制", alias: "copy", template: "" },

  { label: "枚举关联", alias: "mjgl", template: "和他们处理的需求,按照场景的推导出他们,而不是直接告诉我他们存在,从真实的问题出发,演进历史出发,没有他们会出现什么问题,以及在这个领域 有没有其他更多的技术\n%s" },
  { label: "more", alias: "more", template: "如果你是一个面试官,你听到了这些实习生的解释,你会提出哪些更加深入的问题和企业级别的复杂场景,以及对应答案,进行深入的挖掘\n%s" },
  { label: "具体具体", alias: "jhjh", template: "具体具体,我要知道原子操作,让我自己也可以编码实现这个机制,我要自己实现类xx的机制,而不是简单的使用,作为一个核心开发者,以及开源案例或者案例结构设计\n%s" }
];

async function loadAskPrompts() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'translation.getAskPrompts' });
    if (response && response.success && response.prompts && response.prompts.length > 0) {
      SELECTION_ASK_PROMPTS = response.prompts;
      return;
    }
  } catch (e) {
    console.warn('[SelectionAsk] 从 background 获取提示词失败:', e);
  }
  SELECTION_ASK_PROMPTS = DEFAULT_ASK_PROMPTS;
}

// ========== 全局状态 ==========
let selectionAskPanel = null;
let selectionAskLastSelection = '';
let selectionAskLastUserInput = ''; // 上次用户的自定义提问（用于连续提问时一键回填）
let selectionAskEnabled = true; // 默认启用
let platformDomains = {}; // 从 background 获取

// ========== 初始化：获取配置 ==========
async function initializeSelectionAsk() {
  try {
    // 获取平台域名映射
    const domainResponse = await chrome.runtime.sendMessage({ action: 'getPlatformDomains' });
    if (domainResponse && domainResponse.domains) {
      platformDomains = domainResponse.domains;
    }

    // 获取启用设置
    const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSelectionAskSettings' });
    if (settingsResponse && settingsResponse.settings) {
      selectionAskEnabled = settingsResponse.settings.enabled !== false;
    }

    console.log('[SelectionAsk] 配置加载完成，启用状态:', selectionAskEnabled);
  } catch (e) {
    console.warn('[SelectionAsk] 配置加载失败，使用默认配置:', e);
  }
}

/**
 * 获取当前页面所属平台
 * @returns {string|null} 平台名或 null
 */
function getCurrentPlatform() {
  const hostname = window.location.hostname;
  // 移除 www. 前缀进行匹配
  const cleanHost = hostname.replace(/^www\./, '');

  for (const [domain, platform] of Object.entries(platformDomains)) {
    if (cleanHost.includes(domain) || hostname.includes(domain)) {
      return platform;
    }
  }
  return null;
}

/**
 * 检查当前页面是否为 AI 平台
 */
function isAIPatform() {
  return selectionAskEnabled && getCurrentPlatform() !== null;
}

// ========== 面板创建和定位逻辑 ==========
/**
 * 创建面板元素
 */
function createPanel() {
  const panel = document.createElement('div');
  panel.id = 'selection-ask-panel';
  panel.className = 'selection-ask-panel';

  let itemsHtml = SELECTION_ASK_PROMPTS.map(p =>
    `<div class="selection-ask-item" data-template="${encodeURIComponent(p.template)}">${p.label}</div>`
  ).join('');

  // 末端自定义输入框：支持用户对划词内容自行提问
  // 倒数第二个位置：上次提问记录（淡色区分，点击回填）
  const historyHtml = `<div class="selection-ask-history" style="${selectionAskLastUserInput ? '' : 'display:none'}" title="${escapeAttr(selectionAskLastUserInput)}">↺ 上次: <span class="selection-ask-history-text"></span></div>`;

  const customHtml = `
    <div class="selection-ask-custom">
      <input type="text" class="selection-ask-input" placeholder="对划词提问（回车发送）..." />
    </div>
  `;

  panel.innerHTML = itemsHtml + historyHtml + customHtml;

  // 第一个是复制功能，后面是发送功能
  const firstItem = panel.querySelector('.selection-ask-item');
  if (firstItem) {
    firstItem.addEventListener('click', () => {
      handleCopyClick();
    });
  }

  // 其他发送功能
  panel.querySelectorAll('.selection-ask-item:not(:first-child)').forEach(item => {
    item.addEventListener('click', () => {
      const template = decodeURIComponent(item.dataset.template);
      handleTemplateClick(template);
    });
  });

  // 末端输入框事件绑定
  const input = panel.querySelector('.selection-ask-input');
  const historyItem = panel.querySelector('.selection-ask-history');

  // 初次渲染历史文本
  if (historyItem) {
    historyItem.querySelector('.selection-ask-history-text').textContent = truncate(selectionAskLastUserInput, 24);
  }

  const handleCustomSend = () => {
    const userQuestion = input.value.trim();
    if (!userQuestion) {
      input.focus();
      return;
    }
    const selectedText = selectionAskLastSelection;
    if (!selectedText) {
      hidePanel();
      return;
    }
    // 记录本次提问，方便下次连续提问
    selectionAskLastUserInput = userQuestion;
    handleCustomInputSend(selectedText, userQuestion);
    input.value = '';
    refreshHistoryDisplay();
  };

  // 历史项点击 → 直接用当前选中文字 + 历史提问发送
  if (historyItem) {
    historyItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectionAskLastUserInput) return;
      const selectedText = selectionAskLastSelection;
      if (!selectedText) {
        input.focus();
        return;
      }
      handleCustomInputSend(selectedText, selectionAskLastUserInput);
    });
    historyItem.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      e.preventDefault();
      handleCustomSend();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
    }
  });

  // 阻止输入区域内的 mousedown 冒泡，避免被 document 监听误判为外部点击
  input.addEventListener('mousedown', (e) => e.stopPropagation());

  return panel;
}

/**
 * 刷新面板中"上次提问"历史项的显示
 */
function refreshHistoryDisplay() {
  if (!selectionAskPanel) return;
  const historyItem = selectionAskPanel.querySelector('.selection-ask-history');
  if (!historyItem) return;

  if (selectionAskLastUserInput) {
    const textEl = historyItem.querySelector('.selection-ask-history-text');
    if (textEl) textEl.textContent = truncate(selectionAskLastUserInput, 24);
    historyItem.setAttribute('title', selectionAskLastUserInput);
    historyItem.style.display = '';
  } else {
    historyItem.style.display = 'none';
  }
}

/**
 * 截断长字符串用于显示
 */
function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.substring(0, n) + '…' : s;
}

/**
 * 转义 HTML 属性值
 */
function escapeAttr(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 获取选中文字的边界框
 */
function getSelectionRect() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return range.getBoundingClientRect();
}

/**
 * 定位面板在选中文字旁边
 */
function positionPanel(panel, rect) {
  const panelWidth = 220;
  const panelHeight = 240;
  const padding = 10;

  let left = rect.right + padding;
  let top = rect.top;

  // 右侧空间不够，显示在左侧
  if (left + panelWidth > window.innerWidth) {
    left = rect.left - panelWidth - padding;
  }

  // 下方空间不够，显示在上方
  if (top + panelHeight > window.innerHeight) {
    top = window.innerHeight - panelHeight - padding;
  }

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

// ========== 面板显示/隐藏逻辑 ==========
/**
 * 显示面板
 */
function showPanel() {
  if (!selectionAskPanel) {
    selectionAskPanel = createPanel();
    document.body.appendChild(selectionAskPanel);
  }

  // 每次显示时刷新历史项（防止跨次显示出现状态错乱）
  refreshHistoryDisplay();

  const rect = getSelectionRect();
  if (!rect) return;

  positionPanel(selectionAskPanel, rect);
  selectionAskPanel.style.display = 'block';
}

/**
 * 隐藏面板
 */
function hidePanel() {
  if (selectionAskPanel) {
    selectionAskPanel.style.display = 'none';
  }
}

// ========== 发送消息逻辑 ==========
/**
 * 处理复制点击 - 复制选中文本到剪贴板
 */
async function handleCopyClick() {
  const selectedText = selectionAskLastSelection;
  if (!selectedText) return;

  try {
    await navigator.clipboard.writeText(selectedText);
    console.log('[SelectionAsk] 已复制到剪贴板:', selectedText.substring(0, 50) + '...');
  } catch (e) {
    console.warn('[SelectionAsk] 复制失败:', e);
  }

  hidePanel();
}

/**
 * 处理模板点击 - 组合消息并发送
 */
function handleTemplateClick(template) {
  const selectedText = selectionAskLastSelection;
  if (!selectedText) return;

  // 组合消息
  const message = template.replace('%s', selectedText);
  const platform = getCurrentPlatform();

  if (!platform) {
    console.warn('[SelectionAsk] 非 AI 平台页面');
    hidePanel();
    return;
  }

  console.log(`[SelectionAsk] 发送消息到 ${platform}: "${message}"`);

  // 通过 background.js 发送
  try {
    chrome.runtime.sendMessage({
      action: 'processTaskQueue',
      queue: [{ platform, message }]
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[SelectionAsk] 消息发送失败:', chrome.runtime.lastError.message);
      } else {
        console.log('[SelectionAsk] 消息发送成功');
      }
    });
  } catch (e) {
    console.warn('[SelectionAsk] 扩展 context 已失效，请刷新页面:', e.message);
  }

  hidePanel();
}

/**
 * 处理末端输入框发送 - 组合 "划词: %s 用户提问: %i" 消息并发送
 */
function handleCustomInputSend(selectedText, userQuestion) {
  const message = `划词: ${selectedText} 用户提问: ${userQuestion}`;
  const platform = getCurrentPlatform();

  if (!platform) {
    console.warn('[SelectionAsk] 非 AI 平台页面');
    hidePanel();
    return;
  }

  console.log(`[SelectionAsk] 发送自定义提问到 ${platform}: "${message}"`);

  try {
    chrome.runtime.sendMessage({
      action: 'processTaskQueue',
      queue: [{ platform, message }]
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[SelectionAsk] 消息发送失败', chrome.runtime.lastError.message);
      } else {
        console.log('[SelectionAsk] 消息发送成功');
      }
    });
  } catch (e) {
    console.warn('[SelectionAsk] 扩展 context 已失效，请刷新页面:', e.message);
  }

  hidePanel();
}

// ========== 划词监听和初始化逻辑 ==========
// ========== 划词监听 ==========
let selectionTimeout = null;

document.addEventListener('mouseup', (e) => {
  // 仅在 AI 平台页面处理
  if (!isAIPatform()) return;

  // 点击面板内元素时跳过（让用户能正常输入到末端输入框）
  if (selectionAskPanel && selectionAskPanel.contains(e.target)) {
    return;
  }

  // 延迟获取选中文本，确保选择完成
  if (selectionTimeout) clearTimeout(selectionTimeout);
  selectionTimeout = setTimeout(() => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text && text !== selectionAskLastSelection) {
      selectionAskLastSelection = text;
      showPanel();
    } else if (!text) {
      selectionAskLastSelection = '';
      hidePanel();
    }
  }, 100);
});

// 点击页面其他地方关闭面板
document.addEventListener('mousedown', (e) => {
  if (selectionAskPanel && !selectionAskPanel.contains(e.target)) {
    hidePanel();
  }
});

// ESC 键关闭面板
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hidePanel();
  }
});

// 监听设置变化
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.selectionAskSettings) {
    selectionAskEnabled = changes.selectionAskSettings.newValue.enabled !== false;
    console.log('[SelectionAsk] 启用状态已更新:', selectionAskEnabled);
    if (!selectionAskEnabled) {
      hidePanel();
    }
  }
});

// 初始化并加载配置
initializeSelectionAsk(); // 会内部 await loadAskPrompts()

async function initializeSelectionAsk() {
  await loadAskPrompts();

  try {
    // 获取平台域名映射
    const domainResponse = await chrome.runtime.sendMessage({ action: 'getPlatformDomains' });
    if (domainResponse && domainResponse.domains) {
      platformDomains = domainResponse.domains;
    }

    // 获取启用设置
    const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSelectionAskSettings' });
    if (settingsResponse && settingsResponse.settings) {
      selectionAskEnabled = settingsResponse.settings.enabled !== false;
    }

    console.log('[SelectionAsk] 配置加载完成，启用状态:', selectionAskEnabled);
  } catch (e) {
    console.warn('[SelectionAsk] 配置加载失败，使用默认配置:', e);
  }
}

console.log('[SelectionAsk] 划词快捷提问模块已加载');
