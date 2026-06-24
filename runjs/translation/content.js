/**
 * 划词翻译/识别模块
 * 使用与 OCR 相同的固定面板结构，支持 LLM 文本处理
 */

// 全局状态
let resultPanel = null;
let lastSelection = '';
let currentAbortController = null;
let isUserScrolling = false;
let currentResultMarkdown = ''; // 存储当前结果的原始 Markdown 文本
let currentThinkingMarkdown = ''; // 存储当前思考过程的原始 Markdown 文本

// API 配置（从浏览器存储获取）
let API_CONFIG = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  model: 'glm-4.5v'
};

/**
 * 从浏览器存储加载 API 配置
 */
function loadAPIConfig() {
  chrome.storage.local.get(['translation.api.config'], (result) => {
    const config = result['translation.api.config'];
    if (config && config.apiKey) {
      API_CONFIG = {
        baseURL: config.baseURL || 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: config.apiKey,
        model: config.model || 'glm-4.5v'
      };
    } else {
      console.warn('[Translation] API 配置未设置，请在设置页面配置 API Key');
    }
  });
}

// 设置状态
let settings = {
  autoTranslate: false,
  showContextMenu: true,
  translatePrompt: '请解释 %s',  // 默认提示词
  selectionMode: 'panel'  // 'auto' | 'panel' | 'off'
};

// 标记设置是否已加载
let settingsInitialized = false;

// ========== 划词选项面板（panel 模式） ==========
let selectionPanel = null;
let selectionPanelSelection = '';
let transPrompts = []; // 提示词

// 默认提示词（background 不可用时的回退）
const DEFAULT_PROMPTS = [
  { label: '翻译', alias: 'fy', template: '请翻译：%s' },

];

/**
 * 从 background 获取提示词
 */
async function initTransPrompts() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'translation.getTransPrompts' });
    if (response && response.success && response.prompts && response.prompts.length > 0) {
      transPrompts = response.prompts;
      return;
    }
  } catch (e) {
    console.warn('[Translation] 从 background 获取提示词失败，使用默认:', e);
  }
  transPrompts = DEFAULT_PROMPTS;
}

/**
 * 创建划词选项面板
 */
function createSelectionPanel() {
  const panel = document.createElement('div');
  panel.id = 'selection-trans-panel';
  panel.className = 'selection-trans-panel';

  let itemsHtml = transPrompts.map((p, i) =>
    `<div class="selection-trans-item" data-index="${i}">${p.label}</div>`
  ).join('');

  panel.innerHTML = itemsHtml;

  // 绑定点击事件
  panel.querySelectorAll('.selection-trans-item').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      handlePanelItemClick(transPrompts[index].template);
    });
  });

  return panel;
}

/**
 * 显示划词选项面板
 */
function showSelectionPanel(rect) {
  if (!selectionPanel) {
    selectionPanel = createSelectionPanel();
    document.body.appendChild(selectionPanel);
  }

  const padding = 8;
  // 先显示面板以获取真实尺寸
  selectionPanel.style.display = 'block';
  const panelRect = selectionPanel.getBoundingClientRect();
  const panelWidth = panelRect.width || 120;
  const panelHeight = panelRect.height || (40 + transPrompts.length * 36);

  // 定位：选区右下方
  let left = rect.right + padding;
  let top = rect.bottom + padding;

  // 右侧空间不够，放到左侧
  if (left + panelWidth > window.innerWidth) {
    left = rect.left - panelWidth - padding;
  }

  // 下方空间不够，放到上方
  if (top + panelHeight > window.innerHeight) {
    top = rect.top - panelHeight - padding;
  }

  // 确保不超出左/上边界
  if (left < 0) left = padding;
  if (top < 0) top = padding;

  selectionPanel.style.left = `${left}px`;
  selectionPanel.style.top = `${top}px`;
}

/**
 * 隐藏划词选项面板
 */
function hideSelectionPanel() {
  if (selectionPanel) {
    selectionPanel.style.display = 'none';
  }
}

/**
 * 处理面板项点击
 */
function handlePanelItemClick(template) {
  if (!selectionPanelSelection) return;

  // 将 %s 替换为选中文本，生成完整提示词
  const prompt = template.replace('%s', selectionPanelSelection);
  hideSelectionPanel();

  // 调用翻译逻辑，传入自定义提示词
  processSelectedText(selectionPanelSelection, prompt);
}

// 收藏快捷键
let favoritesShortcut = null;
let favoritesShortcutPressed = false;

// ========== SelectionStreamFlowController 流速控制类 ==========

/**
 * 流速控制类 - 使用预加载缓冲机制实现平滑输出
 * 解决服务器推送不均导致的文字卡顿问题
 */
class SelectionStreamFlowController {
  constructor(options = {}) {
    this.preloadThreshold = options.preloadThreshold ?? 80;
    this.outputInterval = options.outputInterval ?? 35;
    this.minBufferSize = options.minBufferSize ?? 15;
    this.chunkSize = options.chunkSize ?? 12;

    this.buffer = '';
    this.isStarted = false;
    this.isEnded = false;
    this.outputTimer = null;
    this.onFlushCallback = null;
  }

  startOutput(onFlush) {
    this.onFlushCallback = onFlush;

    const outputLoop = async () => {
      if (this.isEnded) {
        this.stop();
        return;
      }

      const shouldOutput =
        (this.isStarted && this.buffer.length > this.minBufferSize) ||
        (!this.isStarted && this.buffer.length >= this.preloadThreshold);

      if (shouldOutput && this.buffer.length > 0) {
        this.isStarted = true;

        const outputSize = Math.min(
          this.chunkSize,
          this.buffer.length - this.minBufferSize
        );

        if (outputSize > 0) {
          const outputText = this.buffer.slice(0, outputSize);
          this.buffer = this.buffer.slice(outputSize);

          try {
            await this.onFlushCallback(outputText);
          } catch (e) {
            console.error('输出回调失败:', e);
          }
        }
      }

      this.outputTimer = setTimeout(outputLoop, this.outputInterval);
    };

    this.outputTimer = setTimeout(outputLoop, this.outputInterval);
  }

  add(data) {
    this.buffer += data;
  }

  async end() {
    this.isEnded = true;
    this.stop();

    if (this.buffer.length > 0 && this.onFlushCallback) {
      await this.onFlushCallback(this.buffer);
      this.buffer = '';
    }
  }

  stop() {
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
  }
}

// ========== Marked.js + KaTeX 渲染（共享代码） ==========

let markedConfigured = false;

/**
 * 配置 marked.js（只执行一次）
 */
function configureMarked() {
  if (markedConfigured || typeof marked === 'undefined') return;

  marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false
  });

  markedConfigured = true;
}

/**
 * 渲染 LaTeX 数学公式为 HTML
 */
function renderLatex(latex, displayMode = false) {
  if (typeof katex === 'undefined') {
    console.error('KaTeX is not loaded');
    return `<code>${latex}</code>`;
  }

  let processedLatex = latex;
  processedLatex = processedLatex.replace(/\\ /g, '\\;');

  try {
    return katex.renderToString(processedLatex, {
      displayMode: displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html'
    });
  } catch (error) {
    console.warn('KaTeX rendering failed:', error, 'for latex:', latex);
    return latex.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

/**
 * 使用 marked.js 渲染 Markdown，并渲染 KaTeX 数学公式
 */
async function renderMarkdown(markdown) {
  if (!markdown) return '';

  try {
    if (typeof marked === 'undefined') {
      console.error('marked.js is not loaded');
      return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    configureMarked();
    let html = marked.parse(markdown);

    // 渲染 LaTeX 数学公式
    html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => {
      return renderLatex(latex.trim(), true);
    });

    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
      return renderLatex(latex.trim(), true);
    });

    html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => {
      return renderLatex(latex.trim(), false);
    });

    html = html.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
      return renderLatex(latex.trim(), false);
    });

    // 处理括号内的 LaTeX 公式
    html = html.replace(/\(([^)]+)\)/g, (match, content) => {
      const hasMathSymbols = /[_^\\]|\\[a-zA-Z]|\\frac|\\sum|\\int|\\prod|[αβγδεζηθικλμνξπρστυφχψω]/.test(content);
      if (hasMathSymbols) {
        return '(' + renderLatex(content.trim(), false) + ')';
      }
      return match;
    });

    return html;
  } catch (error) {
    console.error('Markdown rendering failed:', error);
    return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ========== 面板管理 ==========

/**
 * 创建结果面板（与 OCR 相同的结构）
 */
function createResultPanel() {
  const panel = document.createElement('div');
  panel.id = 'selection-result-panel';
  panel.className = 'selection-result-panel';
  panel.style.display = 'flex';
  panel.style.visibility = 'hidden';

  panel.innerHTML = `
    <div class="panel-header">
      <span>划词识别</span>
      <button id="selection-close-result">&times;</button>
    </div>
    <!-- 原文区域 -->
    <div class="original-text-section">
      <div class="section-title">
        <span>PROMPT</span>
        <button id="selection-edit-original" class="edit-btn" title="编辑原文">编辑</button>
      </div>
      <div id="selection-original-text" class="original-text-content"></div>
      <!-- 原文编辑区域 -->
      <div id="selection-original-edit-container" style="display: none;">
        <textarea id="selection-original-edit" class="original-edit-textarea"></textarea>
        <div class="original-edit-buttons">
          <button id="selection-save-original" class="save-edit-btn">保存并处理</button>
          <button id="selection-cancel-original" class="cancel-edit-btn">取消</button>
        </div>
      </div>
    </div>
    <!-- 思考模式区域 (可折叠) -->
    <div id="selection-thinking-section">
      <div id="selection-thinking-toggle">
        <span>THINKING</span>
        <span id="selection-thinking-arrow">▼</span>
      </div>
      <div id="selection-thinking-content"></div>
    </div>
    <!-- 主回答区域容器 -->
    <div class="content-section">
      <div id="selection-result-text">正在处理中...</div>
    </div>
    <!-- 底部按钮区域 -->
    <div class="footer-section">
      <button id="selection-copy-original">复制原文</button>
      <button id="selection-copy-result">复制结果</button>
      <button id="selection-add-favorites">收藏</button>
      <button id="selection-auto-translate" class="auto-translate-btn" title="点击切换模式">自动</button>
      <button id="selection-close-panel">关闭</button>
    </div>
  `;

  document.body.appendChild(panel);

  // 绑定按钮事件
  panel.querySelector('#selection-close-result').addEventListener('click', hideResultPanel);
  panel.querySelector('#selection-close-panel').addEventListener('click', hideResultPanel);
  panel.querySelector('#selection-copy-original').addEventListener('click', copyOriginalText);
  panel.querySelector('#selection-copy-result').addEventListener('click', copyResult);
  panel.querySelector('#selection-add-favorites').addEventListener('click', addCurrentToFavorites);
  panel.querySelector('#selection-auto-translate').addEventListener('click', toggleAutoTranslate);

  // 绑定原文编辑功能
  panel.querySelector('#selection-edit-original').addEventListener('click', startEditingOriginal);
  panel.querySelector('#selection-save-original').addEventListener('click', saveAndProcessOriginal);
  panel.querySelector('#selection-cancel-original').addEventListener('click', cancelEditingOriginal);

  // 绑定思考面板折叠功能
  const thinkingToggle = panel.querySelector('#selection-thinking-toggle');
  const thinkingContent = panel.querySelector('#selection-thinking-content');
  const thinkingArrow = panel.querySelector('#selection-thinking-arrow');
  let thinkingExpanded = false;

  thinkingToggle?.addEventListener('click', () => {
    thinkingExpanded = !thinkingExpanded;
    thinkingContent.style.display = thinkingExpanded ? 'block' : 'none';
    thinkingArrow.textContent = thinkingExpanded ? '▲' : '▼';
  });

  // 绑定拖动功能
  setupDraggable(panel);

  // 绑定滚动行为
  setupScrollBehavior(panel);

  return panel;
}

/**
 * 设置面板拖动功能
 */
function setupDraggable(panel) {
  const header = panel.querySelector('.panel-header');
  if (!header) return;

  let isDragging = false;
  let startX, startY, initialX, initialY;

  header.addEventListener('mousedown', (e) => {
    if (e.target.id === 'selection-close-result') return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = panel.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;

    header.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newX = initialX + dx;
    let newY = initialY + dy;

    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    requestAnimationFrame(() => {
      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
      panel.style.right = 'auto';
    });
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'move';
    }
  });
}

/**
 * 设置面板滚动行为
 */
function setupScrollBehavior(panel) {
  const resultTextElement = panel.querySelector('#selection-result-text');
  if (!resultTextElement) return;

  let scrollTimeout = null;

  resultTextElement.addEventListener('scroll', () => {
    isUserScrolling = true;

    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    scrollTimeout = setTimeout(() => {
      isUserScrolling = false;
    }, 2000);
  });
}

/**
 * 显示结果面板
 */
async function showResultPanel(originalText, resultText) {
  if (!resultPanel) {
    resultPanel = createResultPanel();
  }

  // 隐藏思考区域（旧函数兼容）
  const thinkingSection = document.getElementById('selection-thinking-section');
  if (thinkingSection) thinkingSection.style.display = 'none';

  // 显示原文
  const originalTextElement = document.getElementById('selection-original-text');
  if (originalTextElement) {
    originalTextElement.textContent = originalText;
  }

  // 渲染结果并存储原始 Markdown
  const resultTextElement = document.getElementById('selection-result-text');
  if (resultTextElement) {
    if (typeof resultText === 'string') {
      // 存储原始 Markdown 文本
      currentResultMarkdown = resultText;
      currentThinkingMarkdown = '';
      const html = await renderMarkdown(resultText);
      resultTextElement.innerHTML = html;
    } else if (resultText && typeof resultText === 'object') {
      // 支持传入对象格式 { mainContent, thinkingContent }
      if (resultText.thinkingContent) {
        const thinkingContent = document.getElementById('selection-thinking-content');
        if (thinkingContent) {
          // 存储思考过程的原始 Markdown 文本
          currentThinkingMarkdown = resultText.thinkingContent;
          const thinkingHtml = await renderMarkdown(resultText.thinkingContent);
          thinkingContent.innerHTML = thinkingHtml;
          thinkingSection.style.display = 'block';
        }
      } else {
        currentThinkingMarkdown = '';
      }
      // 存储主回答的原始 Markdown 文本
      currentResultMarkdown = resultText.mainContent || '';
      const mainHtml = await renderMarkdown(resultText.mainContent || '');
      resultTextElement.innerHTML = mainHtml;
    }
  }

  resultPanel.style.visibility = 'visible';

  // 更新自动翻译按钮状态
  updateAutoTranslateButton();
}

/**
 * 更新结果面板（用于流式输出）
 */
async function updateResultText(text) {
  const resultTextElement = document.getElementById('selection-result-text');
  if (resultTextElement) {
    // 存储原始 Markdown 文本
    if (typeof text === 'string') {
      currentResultMarkdown = text;
      currentThinkingMarkdown = '';
    } else if (text && typeof text === 'object') {
      currentResultMarkdown = text.mainContent || '';
      currentThinkingMarkdown = text.thinkingContent || '';
    }

    const html = await renderMarkdown(text);
    resultTextElement.innerHTML = html;

    // 智能滚动
    const isAtBottom = resultTextElement.scrollHeight - resultTextElement.scrollTop - resultTextElement.clientHeight < 50;

    if (isAtBottom && !isUserScrolling) {
      resultTextElement.scrollTop = resultTextElement.scrollHeight;
    }
  }
}

/**
 * 隐藏结果面板
 */
function hideResultPanel() {
  if (resultPanel) {
    resultPanel.style.visibility = 'hidden';
  }
}

// ========== API 调用 ==========

/**
 * 调用 LLM API 处理文本（非流式）
 */
async function callLLMNonStream(text, prompt) {
  // 检查 API Key 是否已配置
  if (!API_CONFIG.apiKey) {
    throw new Error('API Key 未配置，请在设置页面配置 API Key');
  }

  const apiUrl = `${API_CONFIG.baseURL}/chat/completions`;

  // 替换提示词中的占位符
  const finalPrompt = prompt.replace('%s', text);

  // 从存储中获取思考模式设置
  const thinkingEnabled = await new Promise((resolve) => {
    chrome.storage.local.get(['translation.settings'], (result) => {
      const selectionSettings = result['translation.settings'] || {};
      resolve(selectionSettings.selectionThinking || false);
    });
  });

  try {
    const requestBody = {
      model: API_CONFIG.model,
      messages: [
        {
          role: 'user',
          content: finalPrompt
        }
      ],
      stream: false
    };

    // 构建 thinking 参数（始终传递，默认是 enabled）
    requestBody.thinking = {
      type: thinkingEnabled ? 'enabled' : 'disabled'
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // 返回识别结果（分离思考内容和主回答）
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const message = data.choices[0].message;
      return {
        mainContent: message.content || '无法获取结果',
        thinkingContent: thinkingEnabled ? (message.reasoning_content || '') : ''
      };
    }

    return {
      mainContent: '无法获取结果',
      thinkingContent: ''
    };
  } catch (error) {
    throw new Error('API 调用失败: ' + error.message);
  }
}

/**
 * 调用 LLM API 处理文本（流式，使用 StreamFlowController）
 */
async function callLLMStream(text, prompt) {
  // 检查 API Key 是否已配置
  if (!API_CONFIG.apiKey) {
    throw new Error('API Key 未配置，请在设置页面配置 API Key');
  }

  const apiUrl = `${API_CONFIG.baseURL}/chat/completions`;

  // 替换提示词中的占位符
  const finalPrompt = prompt.replace('%s', text);

  const resultTextElement = document.getElementById('selection-result-text');
  const thinkingSection = document.getElementById('selection-thinking-section');
  const thinkingContent = document.getElementById('selection-thinking-content');

  if (!resultTextElement) {
    throw new Error('结果面板元素不存在');
  }

  let fullMainText = '';
  let fullThinkingText = '';
  let hasThinkingContent = false;

  // 从存储中获取设置
  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(['translation.settings'], (result) => {
      const selectionSettings = result['translation.settings'] || {};
      resolve({
        thinkingEnabled: selectionSettings.selectionThinking || false
      });
    });
  });

  const thinkingEnabled = settings.thinkingEnabled;

  // 创建流速控制器
  const mainFlowController = new SelectionStreamFlowController({
    preloadThreshold: 80,
    outputInterval: 35,
    minBufferSize: 15,
    chunkSize: 12
  });

  // 只有启用思考模式时才创建思考流控制器
  const thinkingFlowController = thinkingEnabled ? new SelectionStreamFlowController({
    preloadThreshold: 50,
    outputInterval: 35,
    minBufferSize: 10,
    chunkSize: 6
  }) : null;

  /**
   * 思考内容输出回调
   */
  const thinkingOutputCallback = (textChunk) => {
    return new Promise((resolve) => {
      requestAnimationFrame(async () => {
        if (thinkingContent) {
          fullThinkingText += textChunk;
          // 更新全局变量，保存原始 Markdown
          currentThinkingMarkdown = fullThinkingText;
          const html = await renderMarkdown(fullThinkingText);
          thinkingContent.innerHTML = html;
        }
        resolve();
      });
    });
  };

  /**
   * 主回答输出回调
   */
  const mainOutputCallback = (textChunk) => {
    return new Promise((resolve) => {
      requestAnimationFrame(async () => {
        if (!resultTextElement) {
          resolve();
          return;
        }

        fullMainText += textChunk;
        // 更新全局变量，保存原始 Markdown
        currentResultMarkdown = fullMainText;
        const html = await renderMarkdown(fullMainText);
        resultTextElement.innerHTML = html;

        // 智能滚动
        const isAtBottom = resultTextElement.scrollHeight - resultTextElement.scrollTop - resultTextElement.clientHeight < 50;

        if (isAtBottom && !isUserScrolling) {
          resultTextElement.scrollTop = resultTextElement.scrollHeight;
        }

        resolve();
      });
    });
  };

  // 创建新的 AbortController 并保存到全局变量
  const abortController = new AbortController();
  currentAbortController = abortController;

  try {
    const requestBody = {
      model: API_CONFIG.model,
      messages: [
        {
          role: 'user',
          content: finalPrompt
        }
      ],
      stream: true
    };

    // 构建 thinking 参数（始终传递，默认是 enabled）
    requestBody.thinking = {
      type: thinkingEnabled ? 'enabled' : 'disabled'
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_CONFIG.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    // 清空加载状态
    resultTextElement.textContent = '';
    if (thinkingContent) thinkingContent.textContent = '';
    if (thinkingSection) thinkingSection.style.display = 'none';

    // 启动输出定时器
    if (thinkingFlowController) {
      thinkingFlowController.startOutput(thinkingOutputCallback);
    }
    mainFlowController.startOutput(mainOutputCallback);

    // 读取流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            break;
          }

          try {
            const parsed = JSON.parse(data);

            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
              const delta = parsed.choices[0].delta;

              // 分离思考内容和主回答内容（仅当启用思考模式时）
              if (thinkingEnabled && thinkingFlowController && delta.reasoning_content) {
                if (!hasThinkingContent) {
                  hasThinkingContent = true;
                  if (thinkingSection) thinkingSection.style.display = 'block';
                }
                thinkingFlowController.add(delta.reasoning_content);
              }

              if (delta.content) {
                mainFlowController.add(delta.content);
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    // 数据接收完毕，结束输出并刷新剩余数据
    const endPromises = [mainFlowController.end()];
    if (thinkingFlowController) {
      endPromises.push(thinkingFlowController.end());
    }
    await Promise.all(endPromises);

  } catch (error) {
    if (error.name === 'AbortError') {
      if (thinkingFlowController) {
        thinkingFlowController.stop();
      }
      mainFlowController.stop();
      resultTextElement.innerHTML = fullMainText + '\n\n<p style="color:#999;">[请求已取消]</p>';
    } else {
      if (thinkingFlowController) {
        thinkingFlowController.stop();
      }
      mainFlowController.stop();
      throw new Error('API 调用失败: ' + error.message);
    }
  } finally {
    // 只有当全局变量仍指向这个 controller 时才设置为 null
    // 这样可以避免覆盖更新的请求
    if (currentAbortController === abortController) {
      currentAbortController = null;
    }
  }
}

// ========== 处理选中文本 ==========

/**
 * 检查选中的文本是否在面板内部
 */
function isSelectionInsidePanel(panel) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return false;

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;

  // 检查选中的文本或其父节点是否在面板内
  return panel.contains(container.nodeType === Node.TEXT_NODE ? container.parentNode : container);
}

/**
 * 处理选中的文本
 */
async function processSelectedText(selectedText, customPrompt) {
  // 严格检查：文本必须是非空且不仅仅是空白字符
  const trimmedText = selectedText?.trim() || '';
  if (!trimmedText || trimmedText === lastSelection) return;

  // 如果传入的是未 trim 的文本，使用 trim 后的版本
  selectedText = trimmedText;

  // 检查选中的文本是否来自面板内部，如果是则不处理
  if (resultPanel && isSelectionInsidePanel(resultPanel)) {
    return;
  }

  lastSelection = selectedText;

  // 显示面板和加载状态
  if (!resultPanel) {
    resultPanel = createResultPanel();
  }

  // 显示加载状态
  const resultTextElement = document.getElementById('selection-result-text');
  if (resultTextElement) {
    resultTextElement.textContent = '正在处理中...';
  }

  resultPanel.style.visibility = 'visible';

  // 如果有自定义提示词，直接使用；否则从 storage 读取
  if (customPrompt) {
    // 面板模式：customPrompt 已是完整提示词（已替换 %s）
    const originalTextElement = document.getElementById('selection-original-text');
    if (originalTextElement) {
      originalTextElement.textContent = customPrompt;
    }

    const useStream = settings.selectionStream !== false;

    if (currentAbortController) {
      currentAbortController.abort();
    }

    try {
      if (useStream) {
        await callLLMStream(selectedText, customPrompt);
      } else {
        const apiResult = await callLLMNonStream(selectedText, customPrompt);
        await updateResultText(apiResult);
      }
    } catch (error) {
      await showResultPanel(selectedText, '处理失败: ' + error.message);
    }
    return;
  }

  // 自动模式：从 storage 读取提示词
  chrome.storage.local.get(['translation.settings'], async (result) => {
    const selectionSettings = result['translation.settings'] || {
      selectionPrompt: '请解释 %s',
      selectionStream: true
    };

    const prompt = selectionSettings.selectionPrompt;
    const fullPrompt = prompt.replace('%s', selectedText);
    const useStream = selectionSettings.selectionStream;

    // 显示完整提示词作为原文
    const originalTextElement = document.getElementById('selection-original-text');
    if (originalTextElement) {
      originalTextElement.textContent = fullPrompt;
    }

    // 取消之前的请求
    if (currentAbortController) {
      currentAbortController.abort();
    }

    try {
      if (useStream) {
        await callLLMStream(selectedText, prompt);
      } else {
        const apiResult = await callLLMNonStream(selectedText, prompt);
        await updateResultText(apiResult);
      }
    } catch (error) {
      await showResultPanel(selectedText, '处理失败: ' + error.message);
    }
  });
}

// ========== 按钮功能 ==========

/**
 * 复制原文
 */
function copyOriginalText() {
  const originalTextElement = document.getElementById('selection-original-text');
  if (originalTextElement) {
    const text = originalTextElement.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('selection-copy-original');
      const originalText = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1500);
    }).catch(err => {
      console.error('复制失败:', err);
    });
  }
}

/**
 * 复制结果（复制原始 Markdown 文本）
 */
function copyResult() {
  // 构建要复制的文本：包含思考过程（如果有）和主回答
  let textToCopy = currentResultMarkdown || '';

  if (currentThinkingMarkdown) {
    textToCopy = `## 思考过程\n\n${currentThinkingMarkdown}\n\n---\n\n## 回答\n\n${currentResultMarkdown}`;
  }

  if (!textToCopy) {
    const resultTextElement = document.getElementById('selection-result-text');
    if (resultTextElement) {
      textToCopy = resultTextElement.textContent || '';
    }
  }

  navigator.clipboard.writeText(textToCopy).then(() => {
    const btn = document.getElementById('selection-copy-result');
    const originalText = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1500);
  }).catch(err => {
    console.error('复制失败:', err);
  });
}

/**
 * 添加当前文本到收藏
 */
function addCurrentToFavorites() {
  const originalTextElement = document.getElementById('selection-original-text');
  if (originalTextElement) {
    const text = originalTextElement.textContent;
    addToFavorites(text, window.location.href);
    showFavoriteNotification(text);
  }
}

/**
 * 收藏文本到本地存储
 */
function addToFavorites(text, url) {
  chrome.runtime.sendMessage({
    action: 'translation.addToFavorites',
    text: text,
    url: url,
    timestamp: new Date().toISOString()
  });
}

/**
 * 循环切换模式：auto → panel → off → auto
 */
function toggleAutoTranslate() {
  const modeCycle = ['auto', 'panel', 'off'];
  const currentIdx = modeCycle.indexOf(settings.selectionMode);
  const nextIdx = (currentIdx + 1) % modeCycle.length;
  const newMode = modeCycle[nextIdx];
  settings.selectionMode = newMode;

  updateModeButton();

  chrome.storage.local.get(['translation.settings'], (result) => {
    const translationSettings = result['translation.settings'] || {};
    translationSettings.selectionMode = newMode;
    chrome.storage.local.set({ 'translation.settings': translationSettings });
  });
}

/**
 * 更新模式按钮显示
 */
function updateModeButton() {
  const btn = document.getElementById('selection-auto-translate');
  if (!btn) return;

  const modeConfig = {
    auto:  { text: '自动', cls: 'active' },
    panel: { text: '面板', cls: 'active' },
    off:   { text: '关闭', cls: '' }
  };
  const cfg = modeConfig[settings.selectionMode] || modeConfig.off;

  btn.textContent = cfg.text;
  btn.className = 'auto-translate-btn';
  if (cfg.cls) btn.classList.add(cfg.cls);
}

/**
 * 更新自动翻译按钮状态
 */
function updateAutoTranslateButton() {
  updateModeButton();
}

/**
 * 显示收藏成功提示
 */
function showFavoriteNotification(text) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #6c757d;
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 2147483647;
    font-size: 14px;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = `已收藏: "${text.length > 30 ? text.substring(0, 30) + '...' : text}"`;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      if (style.parentNode) {
        style.parentNode.removeChild(style);
      }
    }, 300);
  }, 3000);
}

// ========== 原文编辑功能 ==========

/**
 * 开始编辑原文
 */
function startEditingOriginal() {
  const originalTextElement = document.getElementById('selection-original-text');
  const editContainer = document.getElementById('selection-original-edit-container');
  const editTextarea = document.getElementById('selection-original-edit');

  if (originalTextElement && editContainer && editTextarea) {
    // 将当前原文填充到编辑框
    editTextarea.value = originalTextElement.textContent;

    // 隐藏原文显示，显示编辑框
    originalTextElement.style.display = 'none';
    editContainer.style.display = 'block';

    // 聚焦编辑框
    editTextarea.focus();
  }
}

/**
 * 取消编辑原文
 */
function cancelEditingOriginal() {
  const originalTextElement = document.getElementById('selection-original-text');
  const editContainer = document.getElementById('selection-original-edit-container');

  if (originalTextElement && editContainer) {
    // 隐藏编辑框，显示原文
    editContainer.style.display = 'none';
    originalTextElement.style.display = 'block';
  }
}

/**
 * 保存编辑后的原文并重新处理
 */
async function saveAndProcessOriginal() {
  const editTextarea = document.getElementById('selection-original-edit');
  const originalTextElement = document.getElementById('selection-original-text');
  const editContainer = document.getElementById('selection-original-edit-container');

  if (!editTextarea || !originalTextElement || !editContainer) return;

  const editedText = editTextarea.value.trim();

  if (!editedText) {
    alert('请输入内容');
    return;
  }

  // 更新原文显示
  originalTextElement.textContent = editedText;

  // 隐藏编辑框，显示原文
  editContainer.style.display = 'none';
  originalTextElement.style.display = 'block';

  // 显示加载状态
  const resultTextElement = document.getElementById('selection-result-text');
  if (resultTextElement) {
    resultTextElement.innerHTML = '正在处理中...';
  }

  // 获取提示词设置
  chrome.storage.local.get(['translation.settings'], async (result) => {
    const selectionSettings = result['translation.settings'] || {
      selectionPrompt: '请解释 %s',
      selectionStream: true
    };

    const prompt = selectionSettings.selectionPrompt;
    const useStream = selectionSettings.selectionStream;

    // 取消之前的请求
    if (currentAbortController) {
      currentAbortController.abort();
    }

    try {
      if (useStream) {
        await callLLMStream(editedText, prompt);
      } else {
        const apiResult = await callLLMNonStream(editedText, prompt);
        await updateResultText(apiResult);
      }
    } catch (error) {
      await showResultPanel(editedText, '处理失败: ' + error.message);
    }
  });
}

// ========== 收藏快捷键 ==========

/**
 * 检查快捷键是否匹配
 */
function checkFavoritesShortcut(e) {
  if (!favoritesShortcut) {
    return e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.key === 'Control';
  }

  return (
    e.ctrlKey === favoritesShortcut.ctrlKey &&
    e.altKey === favoritesShortcut.altKey &&
    e.shiftKey === favoritesShortcut.shiftKey &&
    e.metaKey === favoritesShortcut.metaKey &&
    e.key.toLowerCase() === favoritesShortcut.key.toLowerCase()
  );
}

/**
 * 获取快捷键的主键
 */
function getShortcutMainKey() {
  if (!favoritesShortcut) {
    return 'Control';
  }
  return favoritesShortcut.key;
}

// 监听键盘事件（用于收藏快捷键）
document.addEventListener('keydown', (e) => {
  if (checkFavoritesShortcut(e)) {
    if (favoritesShortcutPressed) return;
    favoritesShortcutPressed = true;

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    // 检查是否在面板内部选中，如果是则不处理
    if (selectedText && (!resultPanel || !isSelectionInsidePanel(resultPanel))) {
      addToFavorites(selectedText, window.location.href);
      showFavoriteNotification(selectedText);
    }
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === getShortcutMainKey().toLowerCase()) {
    favoritesShortcutPressed = false;
  }
});

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  if (selectedText && favoritesShortcutPressed) {
    // 检查是否在面板内部选中，如果是则不处理
    if (!resultPanel || !isSelectionInsidePanel(resultPanel)) {
      addToFavorites(selectedText, window.location.href);
      showFavoriteNotification(selectedText);
    }
  }
});

// ========== 文本选择监听 ==========

document.addEventListener('mouseup', (e) => {
  // 检查设置是否已初始化
  if (!settingsInitialized) {
    return;
  }

  // 如果是关闭模式，不处理
  if (settings.selectionMode === 'off') {
    return;
  }

  // 保存鼠标位置用于定位
  const mouseUpX = e.clientX;
  const mouseUpY = e.clientY;

  // 延迟一小段时间确保选择完成
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    // 优先用 range rect，回退到鼠标位置
    let rect = selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect || rect.width === 0) {
      rect = { left: mouseUpX, right: mouseUpX, top: mouseUpY, bottom: mouseUpY, width: 0, height: 0 };
    }

    // 如果有选中文本且与上次不同
    if (selectedText && selectedText !== lastSelection) {
      // 检查是否在面板内部选中
      if (resultPanel && isSelectionInsidePanel(resultPanel)) {
        return;
      }
      if (selectionPanel && selectionPanel.contains(e.target)) {
        return;
      }

      // 注意：不在这里设置 lastSelection，由 processSelectedText 内部处理
      selectionPanelSelection = selectedText;

      if (settings.selectionMode === 'panel') {
        if (rect) {
          showSelectionPanel(rect);
        }
      } else if (settings.selectionMode === 'auto') {
        processSelectedText(selectedText);
      }
    } else if (!selectedText) {
      lastSelection = '';
      hideSelectionPanel();
    }
  }, 100);
});

// 点击页面其他地方关闭选项面板
document.addEventListener('mousedown', (e) => {
  if (selectionPanel && !selectionPanel.contains(e.target)) {
    hideSelectionPanel();
  }
});

// ========== 监听来自后台的消息 ==========

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateSettings') {
    settings = { ...settings, ...request.settings };
    sendResponse({ success: true });
  } else if (request.action === 'updateSelectionSettings') {
    // 更新划词翻译设置
    if (request.selectionSettings) {
      if (request.selectionSettings.prompt) {
        settings.translatePrompt = request.selectionSettings.prompt;
      }
    }
    sendResponse({ success: true });
  } else if (request.action === 'translation.show') {
    // 兼容旧的消息格式
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (selectedText) {
      processSelectedText(selectedText);
    }
  } else if (request.action === 'translation.updateFavoritesShortcut') {
    favoritesShortcut = request.shortcut;
    sendResponse({ success: true });
  } else if (request.action === 'translation.clearFavoritesShortcut') {
    favoritesShortcut = null;
    sendResponse({ success: true });
  } else if (request.action === 'processSelection') {
    // 新增：处理选中文本的消息
    if (request.text) {
      processSelectedText(request.text);
      sendResponse({ success: true });
    }
  }
});

// ========== 点击页面其他地方时的事件 ==========

document.addEventListener('click', (e) => {
  // 如果点击的不是面板内部，也不是在选择文本，则隐藏面板
  if (resultPanel && !resultPanel.contains(e.target)) {
    // 不自动隐藏，让用户手动关闭
  }
});

// ========== 监听 ESC 键 ==========

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideResultPanel();
  }
});

// ========== 初始化 ==========

/**
 * 加载设置
 */
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['translation.settings'], (result) => {
      const defaultSettings = {
        autoTranslate: false,
        showContextMenu: true,
        selectionPrompt: '请解释 %s',
        selectionMode: 'panel'
      };

      if (result['translation.settings']) {
        settings = { ...defaultSettings, ...result['translation.settings'] };
      } else {
        settings = { ...defaultSettings };
      }

      // 加载划词设置
      if (result['translation.settings']) {
        settings.translatePrompt = result['translation.settings'].selectionPrompt || '请解释 %s';
        if (result['translation.settings'].selectionMode) {
          settings.selectionMode = result['translation.settings'].selectionMode;
        }
      }

      settingsInitialized = true;
      resolve(settings);
    });
  });
}

/**
 * 加载收藏快捷键
 */
function loadFavoritesShortcut() {
  chrome.storage.local.get(['translation.favoritesShortcut'], (result) => {
    if (result['translation.favoritesShortcut']) {
      favoritesShortcut = result['translation.favoritesShortcut'];
    } else {
      favoritesShortcut = null;
    }
  });
}

// 监听 storage 变化
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes['translation.settings']) {
      const newSettings = changes['translation.settings'].newValue;
      settings = { ...settings, ...newSettings };
      settingsInitialized = true;

      // 监听 selectionMode 变化
      if (newSettings.selectionMode) {
        settings.selectionMode = newSettings.selectionMode;
        if (newSettings.selectionMode === 'off') {
          hideSelectionPanel();
        }
      }
    }

    if (changes['translation.favoritesShortcut']) {
      favoritesShortcut = changes['translation.favoritesShortcut'].newValue;
    }

    if (changes['translation.settings']) {
      const newSettings = changes['translation.settings'].newValue;
      if (newSettings.selectionPrompt) {
        settings.translatePrompt = newSettings.selectionPrompt;
      }
    }

    // 监听 API 配置变化
    if (changes['translation.api.config']) {
      loadAPIConfig();
    }
  }
});

// 初始化提示词（从 background 获取）
initTransPrompts();

// 立即加载设置和 API 配置
loadSettings();

loadFavoritesShortcut();
loadAPIConfig();
