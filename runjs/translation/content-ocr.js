/**
 * OCR 区域选择和结果显示模块
 * 在当前网页上实现区域框选和 OCR 识别结果显示
 */

// 全局状态
let selectionBox = null;
let isSelecting = false;
let startX = 0;
let startY = 0;
let ocrResultPanel = null;
let currentCroppedImage = null;
let ocrAbortController = null;
let ocrIsUserScrolling = false;  // 标记用户是否正在滚动
let currentOcrResultMarkdown = ''; // 存储当前 OCR 结果的原始 Markdown 文本
let currentOcrThinkingMarkdown = ''; // 存储当前 OCR 思考过程的原始 Markdown 文本

// API 配置（从浏览器存储获取）
let OCR_API_CONFIG = {
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  model: 'glm-4.5v'
};

// 静默模式状态
let OCR_SILENT_MODE = false;

/**
 * 从浏览器存储加载 API 配置
 */
function loadOCR_APIConfig() {
  chrome.storage.local.get(['translation.api.config'], (result) => {
    const config = result['translation.api.config'];
    if (config && config.apiKey) {
      OCR_API_CONFIG = {
        baseURL: config.baseURL || 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: config.apiKey,
        model: config.model || 'glm-4.5v'
      };
    } else {
      console.warn('[OCR] API 配置未设置，请在设置页面配置 API Key');
    }
  });
}

/**
 * 加载静默模式设置
 */
function loadOCR_SilentMode() {
  chrome.storage.local.get(['translation.settings'], (result) => {
    const settings = result['translation.settings'] || {};
    OCR_SILENT_MODE = settings.ocrSilentMode || false;
  });
}

/**
 * 更新静默模式状态指示灯
 * @param {string} status - 状态: 'loading'(进行中), 'success'(成功), 'error'(失败)
 */
function updateSilentModeIndicator(status) {
  const indicator = document.getElementById('ocr-silent-indicator');
  const statusLight = document.getElementById('ocr-status-light');
  const statusText = document.getElementById('ocr-status-text');

  if (!indicator || !statusLight) return;

  // 确保指示灯显示
  indicator.style.display = 'flex';

  // 移除所有状态类
  statusLight.classList.remove('status-loading', 'status-success', 'status-error');

  switch (status) {
    case 'loading':
      statusLight.classList.add('status-loading');
      statusText.textContent = '识别中...';
      break;
    case 'success':
      statusLight.classList.add('status-success');
      statusText.textContent = '已完成，点击复制';
      break;
    case 'error':
      statusLight.classList.add('status-error');
      statusText.textContent = '识别失败';
      break;
  }
}

// ========== Marked.js + KaTeX 渲染 ==========

// marked.js 和 katex 作为 content script 加载，全局可用
let ocrMarkedConfigured = false;
let ocrKatexConfigured = false;

/**
 * 配置 marked.js（只执行一次）
 */
function ocrConfigureMarked() {
  if (ocrMarkedConfigured || typeof marked === 'undefined') return;

  // 配置 marked 选项
  marked.setOptions({
    breaks: true,      // 支持 GitHub 风格的换行
    gfm: true,          // GitHub Flavored Markdown
    headerIds: false,   // 不生成 header id
    mangle: false       // 不转义邮箱地址
  });

  ocrMarkedConfigured = true;
}

/**
 * 渲染 LaTeX 数学公式为 HTML
 * @param {string} latex - LaTeX 公式
 * @param {boolean} displayMode - 是否为显示模式（块级）
 * @returns {string} HTML 字符串
 */
function ocrRenderLatex(latex, displayMode = false) {
  if (typeof katex === 'undefined') {
    console.error('KaTeX is not loaded');
    return `<code>${latex}</code>`;
  }

  // 预处理：将 AI 输出的特殊格式转换为标准 LaTeX
  let processedLatex = latex;

  // 将 \ `（反斜杠+空格）转换为 LaTeX 的间距命令
  // 例如：010\ 111\ 011 -> 010\;111\;011
  processedLatex = processedLatex.replace(/\\ /g, '\\;');

  try {
    return katex.renderToString(processedLatex, {
      displayMode: displayMode,
      throwOnError: false,
      strict: 'ignore',  // 宽松模式，忽略非标准语法错误
      trust: false,
      output: 'html'
    });
  } catch (error) {
    console.warn('KaTeX rendering failed:', error, 'for latex:', latex);
    // 失败时返回原始文本（转义 HTML）
    return latex.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

/**
 * 使用 marked.js 渲染 Markdown，并渲染 KaTeX 数学公式
 * @param {string} markdown - Markdown 文本
 * @returns {Promise<string>} HTML 字符串
 */
async function ocrRenderMarkdown(markdown) {
  if (!markdown) return '';

  try {
    // 先渲染 Markdown
    if (typeof marked === 'undefined') {
      console.error('marked.js is not loaded');
      // 降级到纯文本
      return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    ocrConfigureMarked();
    let html = marked.parse(markdown);

    // 渲染 LaTeX 数学公式
    // 需要先处理块级公式，再处理行内公式，避免冲突

    // 1. 处理块级公式 \[...\] 和 $$...$$
    html = html.replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => {
      return ocrRenderLatex(latex.trim(), true);
    });

    html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
      return ocrRenderLatex(latex.trim(), true);
    });

    // 2. 处理行内公式 \(...\) 和 $...$
    html = html.replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => {
      return ocrRenderLatex(latex.trim(), false);
    });

    html = html.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
      return ocrRenderLatex(latex.trim(), false);
    });

    // 3. 处理括号内的 LaTeX 公式，如 (8 = 2^3)
    // 检测包含数学符号的括号内容：下标 _、上标 ^、反斜杠 \、希腊字母等
    html = html.replace(/\(([^)]+)\)/g, (match, content) => {
      // 检查是否包含 LaTeX 数学符号
      const hasMathSymbols = /[_^\\]|\\[a-zA-Z]|\\frac|\\sum|\\int|\\prod|[αβγδεζηθικλμνξπρστυφχψω]/.test(content);
      if (hasMathSymbols) {
        return '(' + ocrRenderLatex(content.trim(), false) + ')';
      }
      return match;
    });

    return html;
  } catch (error) {
    console.error('Markdown rendering failed:', error);
    // 降级到纯文本
    return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ========== 性能优化工具函数 ==========

/**
 * 节流函数 - 限制函数执行频率
 * @param {Function} func - 要节流的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 节流后的函数
 */
function throttle(func, delay) {
  let lastCall = 0;
  let timeoutId = null;

  return function executedFunction(...args) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    if (remaining <= 0) {
      // 立即执行
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      func.apply(this, args);
    } else if (!timeoutId) {
      // 设置延迟执行，确保最后一次调用被执行
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        func.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * 防抖函数 - 延迟执行，只执行最后一次
 * @param {Function} func - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
function debounce(func, delay) {
  let timeoutId = null;

  return function executedFunction(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * 使用 requestAnimationFrame 优化的节流
 * 适用于视觉更新场景
 * @param {Function} func - 要优化的函数
 * @returns {Function} 优化后的函数
 */
function throttleRAF(func) {
  let rafId = null;

  return function executedFunction(...args) {
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        func.apply(this, args);
        rafId = null;
      });
    }
  };
}

/**
 * 流速控制类 - 使用预加载缓冲机制实现平滑输出
 * 解决服务器推送不均导致的文字卡顿问题
 */
class StreamFlowController {
  /**
   * @param {Object} options - 配置选项
   * @param {number} options.preloadThreshold - 预加载阈值（字符数），达到此值开始输出，默认 100
   * @param {number} options.outputInterval - 输出间隔（毫秒），控制输出速率，默认 40ms (25fps)
   * @param {number} options.minBufferSize - 最小缓冲区大小，低于此值停止输出等待补充，默认 20
   * @param {number} options.chunkSize - 每次输出的字符数，默认 15
   */
  constructor(options = {}) {
    this.preloadThreshold = options.preloadThreshold ?? 80; // 预加载80字符后开始输出
    this.outputInterval = options.outputInterval ?? 35; // 每35ms输出一次
    this.minBufferSize = options.minBufferSize ?? 15; // 缓冲区最少保留15字符
    this.chunkSize = options.chunkSize ?? 12; // 每次输出12字符

    this.buffer = '';
    this.isStarted = false;
    this.isEnded = false;
    this.outputTimer = null;
    this.onFlushCallback = null;
  }

  /**
   * 启动输出定时器
   */
  startOutput(onFlush) {
    this.onFlushCallback = onFlush;

    const outputLoop = async () => {
      if (this.isEnded) {
        this.stop();
        return;
      }

      // 检查是否需要继续输出
      const shouldOutput =
        // 已开始输出且缓冲区有足够数据
        (this.isStarted && this.buffer.length > this.minBufferSize) ||
        // 缓冲区达到预加载阈值，首次开始输出
        (!this.isStarted && this.buffer.length >= this.preloadThreshold);

      if (shouldOutput && this.buffer.length > 0) {
        this.isStarted = true;

        // 计算本次输出的字符数
        const outputSize = Math.min(
          this.chunkSize,
          this.buffer.length - this.minBufferSize // 保持缓冲区不低于最小值
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

      // 继续下一轮
      this.outputTimer = setTimeout(outputLoop, this.outputInterval);
    };

    // 启动输出循环
    this.outputTimer = setTimeout(outputLoop, this.outputInterval);
  }

  /**
   * 添加数据到缓冲区
   * @param {string} data - 要添加的数据
   */
  add(data) {
    this.buffer += data;
  }

  /**
   * 标记数据流结束，输出剩余所有数据
   * @returns {Promise<void>}
   */
  async end() {
    this.isEnded = true;

    // 停止定时器
    this.stop();

    // 输出所有剩余数据
    if (this.buffer.length > 0 && this.onFlushCallback) {
      await this.onFlushCallback(this.buffer);
      this.buffer = '';
    }
  }

  /**
   * 停止输出定时器
   */
  stop() {
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
  }

  /**
   * 获取缓冲区状态
   */
  getBufferStatus() {
    return {
      bufferLength: this.buffer.length,
      isStarted: this.isStarted,
      isEnded: this.isEnded
    };
  }
}

// 创建选择框
function createSelectionBox() {
  const box = document.createElement('div');
  box.id = 'ocr-selection-box';
  document.body.appendChild(box);
  return box;
}

// 创建提示文字
function createInstruction() {
  const instruction = document.createElement('div');
  instruction.id = 'ocr-instruction';
  instruction.textContent = '按住鼠标左键拖动选择区域，按 ESC 取消';
  document.body.appendChild(instruction);
  return instruction;
}

// 创建结果面板
function ocrCreateResultPanel() {
  const panel = document.createElement('div');
  panel.id = 'ocr-result-panel';
  panel.style.display = 'flex';
  panel.style.visibility = 'hidden';

  panel.innerHTML = `
    <div id="ocr-panel-header">
      <span>识别结果</span>
      <button id="ocr-close-result">&times;</button>
    </div>
    <!-- 静默模式指示灯 -->
    <div id="ocr-silent-indicator" class="ocr-silent-indicator" style="display: none;">
      <span id="ocr-status-light" class="ocr-status-light"></span>
      <span id="ocr-status-text">识别中...</span>
    </div>
    <div class="ocr-preview-section">
      <div class="ocr-preview-header">
        <div>PREVIEW</div>
        <span class="ocr-preview-arrow">▼</span>
      </div>
      <div class="ocr-preview-content">
        <img id="ocr-image-preview" alt="截图预览">
      </div>
    </div>
    <!-- 思考模式区域 (可折叠) -->
    <div id="thinking-section">
      <div id="thinking-toggle">
        <span>THINKING</span>
        <span id="thinking-arrow">▼</span>
      </div>
      <div id="thinking-content"></div>
    </div>
    <!-- 主回答区域容器 -->
    <div class="ocr-content-section">
      <div id="ocr-result-text">正在识别中...</div>
    </div>
    <!-- 底部按钮区域 -->
    <div class="ocr-footer-section">
      <button id="ocr-restart-btn">重新识别</button>
      <button id="ocr-copy-result">复制</button>
      <button id="ocr-close-panel">关闭</button>
    </div>
  `;

  document.body.appendChild(panel);

  // 绑定按钮事件
  panel.querySelector('#ocr-close-result').addEventListener('click', ocrHideResultPanel);
  panel.querySelector('#ocr-close-panel').addEventListener('click', ocrHideResultPanel);
  panel.querySelector('#ocr-copy-result').addEventListener('click', ocrCopyResult);
  panel.querySelector('#ocr-restart-btn').addEventListener('click', restartOCR);

  // 绑定图片预览折叠功能
  const previewHeader = panel.querySelector('.ocr-preview-header');
  const previewContent = panel.querySelector('.ocr-preview-content');
  const previewArrow = panel.querySelector('.ocr-preview-arrow');
  let previewExpanded = true;

  previewHeader?.addEventListener('click', () => {
    previewExpanded = !previewExpanded;
    if (previewExpanded) {
      previewContent.classList.remove('collapsed');
      previewArrow.classList.remove('collapsed');
      previewArrow.textContent = '▼';
      // 恢复显示图片（如果之前已加载）
      const img = previewContent.querySelector('#ocr-image-preview');
      if (img && img.src && img.style.display === 'none') {
        img.style.display = 'block';
      }
    } else {
      previewContent.classList.add('collapsed');
      previewArrow.classList.add('collapsed');
      previewArrow.textContent = '▶';
    }
  });

  // 绑定思考面板折叠功能
  const thinkingToggle = panel.querySelector('#thinking-toggle');
  const thinkingContent = panel.querySelector('#thinking-content');
  const thinkingArrow = panel.querySelector('#thinking-arrow');
  let thinkingExpanded = false;

  thinkingToggle?.addEventListener('click', () => {
    thinkingExpanded = !thinkingExpanded;
    thinkingContent.style.display = thinkingExpanded ? 'block' : 'none';
    thinkingArrow.textContent = thinkingExpanded ? '▲' : '▼';
  });

  // 绑定拖动功能
  ocrSetupDraggable(panel);

  // 绑定滚动行为
  ocrSetupScrollBehavior(panel);

  return panel;
}

/**
 * 设置面板滚动行为
 */
function ocrSetupScrollBehavior(panel) {
  const resultTextElement = panel.querySelector('#ocr-result-text');
  if (!resultTextElement) return;

  let scrollTimeout = null;

  // 监听滚动事件
  resultTextElement.addEventListener('scroll', () => {
    // 标记用户正在滚动
    ocrIsUserScrolling = true;

    // 清除之前的定时器
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    // 2秒后重置标志（假设用户2秒没有滚动就是停止了）
    scrollTimeout = setTimeout(() => {
      ocrIsUserScrolling = false;
    }, 2000);
  });
}

/**
 * 设置面板拖动功能
 */
function ocrSetupDraggable(panel) {
  const header = panel.querySelector('#ocr-panel-header');
  if (!header) return;

  let isDragging = false;
  let startX, startY, initialX, initialY;

  // 鼠标按下
  header.addEventListener('mousedown', (e) => {
    // 如果点击的是关闭按钮，不启动拖动
    if (e.target.id === 'ocr-close-result') return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    // 获取面板当前位置
    const rect = panel.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;

    // 改变鼠标样式
    header.style.cursor = 'grabbing';

    // 阻止文本选择
    e.preventDefault();
  });

  // 鼠标移动（使用 RAF 优化）
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // 计算新位置
    let newX = initialX + dx;
    let newY = initialY + dy;

    // 确保不超出视窗
    const maxX = window.innerWidth - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;

    // 限制边界
    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    // 使用 RAF 优化位置更新
    requestAnimationFrame(() => {
      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
      panel.style.right = 'auto'; // 清除 right 属性
    });
  });

  // 鼠标释放
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = 'move';
    }
  });
}

// 显示结果面板
async function ocrShowResultPanel(text, imageDataUrl = null) {
  if (!ocrResultPanel) {
    ocrResultPanel = ocrCreateResultPanel();
  }

  // 隐藏思考区域（旧函数兼容）
  const thinkingSection = document.getElementById('thinking-section');
  if (thinkingSection) thinkingSection.style.display = 'none';

  // 渲染结果并存储原始 Markdown
  const resultTextElement = document.getElementById('ocr-result-text');
  if (typeof text === 'string') {
    // 存储原始 Markdown 文本
    currentOcrResultMarkdown = text;
    currentOcrThinkingMarkdown = '';
    const html = await ocrRenderMarkdown(text);
    resultTextElement.innerHTML = html;
  } else if (text && typeof text === 'object') {
    // 支持传入对象格式 { mainContent, thinkingContent }
    if (text.thinkingContent) {
      const thinkingContent = document.getElementById('thinking-content');
      if (thinkingContent) {
        // 存储思考过程的原始 Markdown 文本
        currentOcrThinkingMarkdown = text.thinkingContent;
        const thinkingHtml = await ocrRenderMarkdown(text.thinkingContent);
        thinkingContent.innerHTML = thinkingHtml;
        thinkingSection.style.display = 'block';
      }
    } else {
      currentOcrThinkingMarkdown = '';
    }
    // 存储主回答的原始 Markdown 文本
    currentOcrResultMarkdown = text.mainContent || '';
    const mainHtml = await ocrRenderMarkdown(text.mainContent || '');
    resultTextElement.innerHTML = mainHtml;
  }

  // 显示图片预览
  const previewImg = document.getElementById('ocr-image-preview');
  if (imageDataUrl) {
    previewImg.src = imageDataUrl;
    previewImg.style.display = 'block';
  } else {
    previewImg.style.display = 'none';
  }

  // 显示重新识别按钮
  const restartBtn = document.getElementById('ocr-restart-btn');
  if (restartBtn) {
    restartBtn.style.display = 'block';
  }

  ocrResultPanel.style.visibility = 'visible';
}

// 显示结果面板（带图片和加载状态）
async function ocrShowResultPanelWithImage(imageDataUrl, text) {
  if (!ocrResultPanel) {
    ocrResultPanel = ocrCreateResultPanel();
  }

  // 隐藏思考区域
  const thinkingSection = document.getElementById('thinking-section');
  if (thinkingSection) thinkingSection.style.display = 'none';

  // 显示图片预览
  const previewImg = document.getElementById('ocr-image-preview');
  if (imageDataUrl) {
    previewImg.src = imageDataUrl;
    previewImg.style.display = 'block';
  }

  // 设置加载文字并存储原始 Markdown
  const resultTextElement = document.getElementById('ocr-result-text');
  if (typeof text === 'string') {
    // 存储原始 Markdown 文本
    currentOcrResultMarkdown = text;
    currentOcrThinkingMarkdown = '';
    const html = await ocrRenderMarkdown(text);
    resultTextElement.innerHTML = html;
  }

  // 显示重新识别按钮
  const restartBtn = document.getElementById('ocr-restart-btn');
  if (restartBtn) {
    restartBtn.style.display = 'block';
  }

  ocrResultPanel.style.visibility = 'visible';
}

// 只更新结果文字
async function ocrUpdateResultText(text) {
  const resultTextElement = document.getElementById('ocr-result-text');
  if (resultTextElement) {
    // 存储原始 Markdown 文本
    if (typeof text === 'string') {
      currentOcrResultMarkdown = text;
      currentOcrThinkingMarkdown = '';
    } else if (text && typeof text === 'object') {
      currentOcrResultMarkdown = text.mainContent || '';
      currentOcrThinkingMarkdown = text.thinkingContent || '';
    }

    const html = await ocrRenderMarkdown(text);
    resultTextElement.innerHTML = html;
  }
}

// 隐藏结果面板
function ocrHideResultPanel() {
  if (ocrResultPanel) {
    ocrResultPanel.style.visibility = 'hidden';
  }
}

// 复制结果（复制原始 Markdown 文本）
function ocrCopyResult() {
  // 构建要复制的文本：包含思考过程（如果有）和主回答
  let textToCopy = currentOcrResultMarkdown || '';

  if (currentOcrThinkingMarkdown) {
    textToCopy = `## 思考过程\n\n${currentOcrThinkingMarkdown}\n\n---\n\n## 识别结果\n\n${currentOcrResultMarkdown}`;
  }

  if (!textToCopy) {
    const resultTextElement = document.getElementById('ocr-result-text');
    if (resultTextElement) {
      textToCopy = resultTextElement.textContent || '';
    }
  }

  navigator.clipboard.writeText(textToCopy).then(() => {
    const btn = document.getElementById('ocr-copy-result');
    const originalText = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1500);
  }).catch(err => {
    console.error('复制失败:', err);
  });
}

// 自动复制 OCR 结果到剪切板
async function autoCopyOCRResult() {
  const textToCopy = currentOcrResultMarkdown || '';
  if (!textToCopy) return;

  try {
    await navigator.clipboard.writeText(textToCopy);

    // 显示短暂提示
    const btn = document.getElementById('ocr-copy-result');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '已自动复制';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }
  } catch (err) {
    console.error('自动复制失败:', err);
  }
}

// 开始区域选择
function startSelection() {
  // 清除之前的选择框
  cleanup();

  // 创建 UI
  selectionBox = createSelectionBox();
  const instruction = createInstruction();

  // 添加遮罩层
  const overlay = document.createElement('div');
  overlay.id = 'ocr-overlay';
  document.body.appendChild(overlay);

  // 监听鼠标事件
  overlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('keydown', onKeyDown);

  // 监听页面滚动，滚动时隐藏选择框
  document.addEventListener('wheel', onScroll, { passive: true });
  document.addEventListener('touchmove', onScroll, { passive: true });

  // 显示提示
  setTimeout(() => {
    instruction.style.opacity = '1';
  }, 100);
}

// 鼠标按下
function onMouseDown(e) {
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;

  selectionBox.style.left = startX + 'px';
  selectionBox.style.top = startY + 'px';
  selectionBox.style.width = '0px';
  selectionBox.style.height = '0px';
  selectionBox.style.display = 'block';

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// 鼠标移动（使用 RAF 优化，减少重绘）
function onMouseMove(e) {
  if (!isSelecting) return;

  const currentX = e.clientX;
  const currentY = e.clientY;

  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);

  // 使用 RAF 优化的更新函数
  requestAnimationFrame(() => {
    if (selectionBox) {
      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';
    }
  });
}

// 鼠标释放
function onMouseUp(e) {
  if (!isSelecting) return;
  isSelecting = false;

  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);

  // 获取选择区域
  const rawRect = {
    left: parseInt(selectionBox.style.left),
    top: parseInt(selectionBox.style.top),
    width: parseInt(selectionBox.style.width),
    height: parseInt(selectionBox.style.height)
  };

  // 移除遮罩和提示
  const overlay = document.getElementById('ocr-overlay');
  const instruction = document.getElementById('ocr-instruction');
  if (overlay) overlay.remove();
  if (instruction) instruction.remove();

  // 立即隐藏选择框（完成后不再显示）
  if (selectionBox) {
    selectionBox.style.display = 'none';
  }

  // 如果选择区域太小，忽略
  if (rawRect.width < 10 || rawRect.height < 10) {
    cleanup();
    return;
  }

  // 检测并校正坐标
  const adjustedRect = detectAndAdjustCoordinates(rawRect);

  // 发送消息进行 OCR
  performOCR(adjustedRect);
}

/**
 * 检测并校正坐标系统差异
 * 某些网站（如知乎）可能有 CSS transform 或缩放，导致坐标偏差
 */
function detectAndAdjustCoordinates(rect) {
  // 1. 检测页面是否有 transform 或 scale
  const bodyStyle = window.getComputedStyle(document.body);
  const transform = bodyStyle.transform || bodyStyle.webkitTransform;
  const zoom = bodyStyle.zoom;

  // 2. 获取设备像素比
  const devicePixelRatio = window.devicePixelRatio || 1;

  // 3. 检测浏览器缩放级别（通过检测实际像素和CSS像素的比值）
  const browserZoom = detectBrowserZoom();

  // 计算总的缩放因子
  let scaleAdjustment = 1;

  // 如果有 transform matrix，提取缩放因子
  if (transform && transform !== 'none') {
    const matrix = transform.match(/matrix\((.+)\)/);
    if (matrix) {
      const values = matrix[1].split(', ').map(parseFloat);
      // transform: matrix(a, b, c, d, tx, ty)
      // a 和 d 是 X 和 Y 方向的缩放
      const scaleX = values[0];
      const scaleY = values[3];
      scaleAdjustment *= ((scaleX + scaleY) / 2);
    }
  }

  // 如果有 CSS zoom
  if (zoom && zoom !== '1' && zoom !== 'normal') {
    scaleAdjustment *= parseFloat(zoom);
  }

  // 考虑浏览器缩放
  if (browserZoom !== 1) {
    scaleAdjustment *= browserZoom;
  }

  // 如果有缩放，调整坐标
  if (scaleAdjustment !== 1 && Math.abs(scaleAdjustment - 1) > 0.01) {

    return {
      left: rect.left / scaleAdjustment,
      top: rect.top / scaleAdjustment,
      width: rect.width / scaleAdjustment,
      height: rect.height / scaleAdjustment
    };
  }

  // 如果没有检测到缩放，但 devicePixelRatio 不是 1，也需要调整
  // 因为 captureVisibleTab 返回的是物理像素，而鼠标坐标是 CSS 像素
  if (devicePixelRatio !== 1) {
    return {
      left: rect.left * devicePixelRatio,
      top: rect.top * devicePixelRatio,
      width: rect.width * devicePixelRatio,
      height: rect.height * devicePixelRatio
    };
  }

  return rect;
}

/**
 * 检测浏览器缩放级别
 * 通过创建一个 100px 的测试元素并检查其实际宽度
 */
function detectBrowserZoom() {
  const testDiv = document.createElement('div');
  testDiv.style.cssText = 'position: absolute; width: 100px; height: 100px; visibility: hidden; pointer-events: none;';
  document.body.appendChild(testDiv);

  const rect = testDiv.getBoundingClientRect();
  const zoom = rect.width / 100;

  document.body.removeChild(testDiv);

  return zoom;
}

// 键盘事件（ESC 取消）
function onKeyDown(e) {
  if (e.key === 'Escape') {
    cleanup();
  }
}

// 页面滚动事件（使用节流优化）
const onScroll = throttle(() => {
  // 滚动时隐藏选择框
  if (selectionBox && selectionBox.style.display === 'block') {
    selectionBox.style.display = 'none';
  }
}, 100);

// 执行 OCR
async function performOCR(rect) {
  try {
    // 检查扩展上下文是否有效
    if (!chrome.runtime || !chrome.runtime.id) {
      await ocrShowResultPanel('扩展已重新加载\n\n请刷新页面后重试（按 F5 或 Ctrl+R）');
      cleanup();
      return;
    }

    // 从存储中获取 OCR 设置
    chrome.storage.local.get(['translation.settings'], async (settingsResult) => {
      const ocrSettings = settingsResult['translation.settings'] || {
        ocrPrompt: '请识别图片中的所有文字内容',
        ocrStream: false,
        ocrSilentMode: false
      };

      // 获取静默模式设置
      const isSilentMode = ocrSettings.ocrSilentMode || false;

      // 发送消息给 background script 获取截图
      // background script 会从 sender.tab.id 获取当前标签页 ID
      chrome.runtime.sendMessage({
        action: 'translation.ocr.perform',
        rect: rect
      }, async (response) => {
        if (chrome.runtime.lastError) {
          await ocrShowResultPanel('识别失败: ' + chrome.runtime.lastError.message);
          if (isSilentMode) updateSilentModeIndicator('error');
          return;
        }

        if (response && response.success && response.dataUrl) {
          try {
            // 在 content script 中裁剪图片
            const croppedImage = await cropImage(response.dataUrl, response.rect);
            currentCroppedImage = croppedImage;

            // 先显示图片预览和加载状态
            await ocrShowResultPanelWithImage(croppedImage, '正在识别中，请稍候...');

            // 如果是静默模式，显示加载指示灯
            if (isSilentMode) {
              updateSilentModeIndicator('loading');
              // 静默模式下隐藏内容区域
              const contentSection = document.querySelector('.ocr-content-section');
              const thinkingSection = document.getElementById('thinking-section');
              const footerSection = document.querySelector('.ocr-footer-section');
              if (contentSection) contentSection.style.display = 'none';
              if (thinkingSection) thinkingSection.style.display = 'none';
              if (footerSection) footerSection.style.display = 'none';
            }

            // 使用存储中的设置
            const prompt = ocrSettings.ocrPrompt;
            const useStream = ocrSettings.ocrStream;

            // 调用真实 OCR API
            if (useStream) {
              await callOCRApiStream(croppedImage, prompt);
              // 流式输出完成后自动复制
              await autoCopyOCRResult();
            } else {
              const result = await callOCRApiNonStream(croppedImage, prompt);
              await ocrUpdateResultText(result.mainContent || '');
              // 非流式直接自动复制
              await autoCopyOCRResult();
            }

            // 完成后更新静默模式指示灯
            if (isSilentMode) {
              updateSilentModeIndicator('success');
              // 点击面板可以复制
              const panel = document.getElementById('ocr-result-panel');
              if (panel) {
                panel.onclick = ocrCopyResult;
                panel.style.cursor = 'pointer';
              }
            }
          } catch (error) {
            await ocrShowResultPanel('识别失败: ' + error.message);
            if (isSilentMode) updateSilentModeIndicator('error');
          }
        } else {
          await ocrShowResultPanel('识别失败: ' + (response?.error || '未知错误'));
          if (isSilentMode) updateSilentModeIndicator('error');
        }
      });
    });
  } catch (error) {
    // 捕获扩展上下文失效等错误
    await ocrShowResultPanel('扩展已重新加载\n\n请刷新页面后重试（按 F5 或 Ctrl+R）');
    cleanup();
  }
}

/**
 * 裁剪图片
 * @param {string} dataUrl - 原始图片的 base64
 * @param {Object} rect - 裁剪区域 { left, top, width, height }
 * @returns {Promise<string>} 裁剪后的图片 base64
 */
function cropImage(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // 设置画布大小为裁剪区域大小
      canvas.width = rect.width;
      canvas.height = rect.height;

      // 裁剪图片
      ctx.drawImage(
        img,
        rect.left, rect.top, rect.width, rect.height,
        0, 0, rect.width, rect.height
      );

      // 转换为 base64
      const croppedDataUrl = canvas.toDataURL('image/png');
      resolve(croppedDataUrl);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * 非流式 OCR API 调用
 * @param {string} imageBase64 - 图片的 base64 数据
 * @param {string} prompt - 用户提示词
 * @returns {Promise<{mainContent: string, thinkingContent: string}>} OCR 识别结果（包含主回答和思考内容）
 */
async function callOCRApiNonStream(imageBase64, prompt = '请识别图片中的所有文字内容') {
  // 移除 data:image/png;base64, 前缀
  const base64Data = imageBase64.split(',')[1];

  const apiUrl = `${OCR_API_CONFIG.baseURL}/chat/completions`;

  // 从存储中获取思考模式设置
  const thinkingEnabled = await new Promise((resolve) => {
    chrome.storage.local.get(['translation.settings'], (result) => {
      const ocrSettings = result['translation.settings'] || {};
      resolve(ocrSettings.ocrThinking || false);
    });
  });

  try {
    // SiliconFlow 需要使用特定的图片格式
    const isSiliconFlow = apiUrl.includes('siliconflow');

    // 构建 API 请求体
    let content;
    if (isSiliconFlow) {
      // SiliconFlow 使用不同的图片格式
      content = [
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64Data}`
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ];
    } else {
      content = [
        {
          type: 'image_url',
          image_url: {
            url: base64Data
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ];
    }

    const requestBody = {
      model: OCR_API_CONFIG.model,
      messages: [
        {
          role: 'user',
          content: content
        }
      ],
      stream: false
    };

    // SiliconFlow API 不支持 thinking 参数，只在官方 API 使用
    if (!isSiliconFlow) {
      requestBody.thinking = {
        type: thinkingEnabled ? 'enabled' : 'disabled'
      };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OCR_API_CONFIG.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OCR] API 请求失败:', requestBody);
      throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // 返回识别结果（分离思考内容和主回答）
    if (data.choices && data.choices[0] && data.choices[0].message) {
      const message = data.choices[0].message;
      return {
        mainContent: message.content || '无法获取识别结果',
        thinkingContent: thinkingEnabled ? (message.reasoning_content || '') : ''
      };
    }

    return {
      mainContent: '无法获取识别结果',
      thinkingContent: ''
    };
  } catch (error) {
    throw new Error('API 调用失败: ' + error.message);
  }
}

/**
 * 流式 OCR API 调用（使用预加载缓冲机制实现平滑输出）
 * @param {string} imageBase64 - 图片的 base64 数据
 * @param {string} prompt - 用户提示词
 */
async function callOCRApiStream(imageBase64, prompt = '请识别图片中的所有文字内容') {
  // 移除 data:image/png;base64, 前缀
  const base64Data = imageBase64.split(',')[1];

  const apiUrl = `${OCR_API_CONFIG.baseURL}/chat/completions`;

  // 创建 AbortController 用于取消请求
  ocrAbortController = new AbortController();

  const resultTextElement = document.getElementById('ocr-result-text');
  const thinkingSection = document.getElementById('thinking-section');
  const thinkingContent = document.getElementById('thinking-content');

  if (!resultTextElement) return;

  let fullMainText = '';     // 主回答内容
  let fullThinkingText = ''; // 思考过程内容
  let hasThinkingContent = false; // 标记是否有思考内容

  // 从存储中获取设置
  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(['translation.settings'], (result) => {
      const ocrSettings = result['translation.settings'] || {};
      resolve({
        flowRate: ocrSettings.flowRate || {
          level: 3,
          outputInterval: 35,
          chunkSize: 12
        },
        thinkingEnabled: ocrSettings.ocrThinking || false
      });
    });
  });

  const flowRateSettings = settings.flowRate;
  const thinkingEnabled = settings.thinkingEnabled;

  // 创建流速控制器
  const mainFlowController = new StreamFlowController({
    preloadThreshold: 80,
    outputInterval: flowRateSettings.outputInterval,
    minBufferSize: 15,
    chunkSize: flowRateSettings.chunkSize
  });

  // 只有启用思考模式时才创建思考流控制器
  const thinkingFlowController = thinkingEnabled ? new StreamFlowController({
    preloadThreshold: 50,
    outputInterval: flowRateSettings.outputInterval,
    minBufferSize: 10,
    chunkSize: Math.max(5, Math.floor(flowRateSettings.chunkSize / 2))
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
          currentOcrThinkingMarkdown = fullThinkingText;
          const html = await ocrRenderMarkdown(fullThinkingText);
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
        currentOcrResultMarkdown = fullMainText;
        // 使用 Markdown 渲染
        const html = await ocrRenderMarkdown(fullMainText);
        resultTextElement.innerHTML = html;

        // 智能滚动
        const isAtBottom = resultTextElement.scrollHeight - resultTextElement.scrollTop - resultTextElement.clientHeight < 50;

        if (isAtBottom && !ocrIsUserScrolling) {
          resultTextElement.scrollTop = resultTextElement.scrollHeight;
        }

        resolve();
      });
    });
  };

  try {
    // SiliconFlow 需要使用特定的图片格式
    const isSiliconFlow = apiUrl.includes('siliconflow');

    // 构建 API 请求体
    let content;
    if (isSiliconFlow) {
      // SiliconFlow 使用不同的图片格式
      content = [
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64Data}`
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ];
    } else {
      content = [
        {
          type: 'image_url',
          image_url: {
            url: base64Data
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ];
    }

    const requestBody = {
      model: OCR_API_CONFIG.model,
      messages: [
        {
          role: 'user',
          content: content
        }
      ],
      stream: true
    };

    // SiliconFlow API 不支持 thinking 参数，只在官方 API 使用
    if (!isSiliconFlow) {
      requestBody.thinking = {
        type: thinkingEnabled ? 'enabled' : 'disabled'
      };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OCR_API_CONFIG.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: ocrAbortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OCR] API 请求失败:', requestBody);
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
                // 思考内容
                if (!hasThinkingContent) {
                  hasThinkingContent = true;
                  if (thinkingSection) thinkingSection.style.display = 'block';
                }
                thinkingFlowController.add(delta.reasoning_content);
              }

              if (delta.content) {
                // 主回答内容
                mainFlowController.add(delta.content);
              }
            }
          } catch (e) {
            // 忽略解析错误
            console.warn('解析 SSE 数据失败:', e);
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
      // 停止输出定时器
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
    ocrAbortController = null;
  }
}

/**
 * 重新识别（使用已保存的截图）
 */
async function restartOCR() {
  if (!currentCroppedImage) {
    alert('没有可用的截图，请重新选择区域');
    return;
  }

  // 从存储中获取最新的 OCR 设置
  chrome.storage.local.get(['translation.settings'], async (settingsResult) => {
    const ocrSettings = settingsResult['translation.settings'] || {
      ocrPrompt: '请识别图片中的所有文字内容',
      ocrStream: false,
      ocrSilentMode: false
    };

    const prompt = ocrSettings.ocrPrompt;
    const useStream = ocrSettings.ocrStream;
    const isSilentMode = ocrSettings.ocrSilentMode || false;

    // 取消之前的请求
    if (ocrAbortController) {
      ocrAbortController.abort();
    }

    // 如果是静默模式，显示加载指示灯
    if (isSilentMode) {
      updateSilentModeIndicator('loading');
      // 静默模式下隐藏内容区域
      const contentSection = document.querySelector('.ocr-content-section');
      const thinkingSection = document.getElementById('thinking-section');
      const footerSection = document.querySelector('.ocr-footer-section');
      if (contentSection) contentSection.style.display = 'none';
      if (thinkingSection) thinkingSection.style.display = 'none';
      if (footerSection) footerSection.style.display = 'none';
    }

    try {
      // 调用 OCR API
    if (useStream) {
      await callOCRApiStream(currentCroppedImage, prompt);
      // 流式输出完成后自动复制
      await autoCopyOCRResult();
    } else {
      const result = await callOCRApiNonStream(currentCroppedImage, prompt);
      await ocrShowResultPanel(result, currentCroppedImage);
      // 非流式自动复制
      await autoCopyOCRResult();
    }

    // 完成后更新静默模式指示灯
    if (isSilentMode) {
      updateSilentModeIndicator('success');
      // 点击面板可以复制
      const panel = document.getElementById('ocr-result-panel');
      if (panel) {
        panel.onclick = ocrCopyResult;
        panel.style.cursor = 'pointer';
      }
    }
    } catch (error) {
      await ocrShowResultPanel('识别失败: ' + error.message);
      if (isSilentMode) updateSilentModeIndicator('error');
    }
  });
}

// 清理
function cleanup() {
  // 取消进行中的 API 请求
  if (ocrAbortController) {
    ocrAbortController.abort();
    ocrAbortController = null;
  }

  const overlay = document.getElementById('ocr-overlay');
  const instruction = document.getElementById('ocr-instruction');
  if (overlay) overlay.remove();
  if (instruction) instruction.remove();
  if (selectionBox) {
    selectionBox.remove();
    selectionBox = null;
  }
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('keydown', onKeyDown);
  document.removeEventListener('wheel', onScroll);
  document.removeEventListener('touchmove', onScroll);
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translation.ocr.start') {
    startSelection();
    sendResponse({ success: true });
  } else if (request.action === 'closeOCRResult') {
    ocrHideResultPanel();
    sendResponse({ success: true });
  } else if (request.action === 'translation.ocr.updateShortcut') {
    // 更新快捷键
    currentShortcut = request.shortcut;
    sendResponse({ success: true });
  } else if (request.action === 'translation.ocr.clearShortcut') {
    // 清除快捷键
    currentShortcut = null;
    sendResponse({ success: true });
  }
});

// 页面卸载时清理
window.addEventListener('unload', cleanup);

// ========== 快捷键功能 ==========

// 当前注册的快捷键
let currentShortcut = null;

// 加载快捷键设置
function loadShortcut() {
  chrome.storage.local.get(['translation.ocr.shortcut'], (result) => {
    if (result['translation.ocr.shortcut']) {
      currentShortcut = result['translation.ocr.shortcut'];
    }
  });
}

// 格式化快捷键用于日志输出
function formatShortcutForLog(shortcut) {
  const parts = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  if (shortcut.metaKey) parts.push('Meta');
  parts.push(shortcut.key);
  return parts.join('+');
}

// 检查键盘事件是否匹配快捷键
function isShortcutMatch(e, shortcut) {
  if (!shortcut) return false;

  return (
    e.ctrlKey === shortcut.ctrlKey &&
    e.altKey === shortcut.altKey &&
    e.shiftKey === shortcut.shiftKey &&
    e.metaKey === shortcut.metaKey &&
    e.key === shortcut.key
  );
}

// 监听键盘事件
document.addEventListener('keydown', (e) => {
  // 如果当前正在选择区域，不触发快捷键
  if (isSelecting) return;

  // 如果快捷键未设置，不处理
  if (!currentShortcut) return;

  // 检查是否匹配快捷键
  if (isShortcutMatch(e, currentShortcut)) {
    e.preventDefault();
    e.stopPropagation();

    // 启动 OCR 选择
    startSelection();
  }
});

// 初始化时加载快捷键和API配置
loadShortcut();
loadOCR_APIConfig();
loadOCR_SilentMode();

// 监听存储变化（API配置和设置更新时自动重新加载）
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes['translation.api.config']) {
      loadOCR_APIConfig();
    }
    if (changes['translation.settings']) {
      loadOCR_SilentMode();
    }
  }
});
