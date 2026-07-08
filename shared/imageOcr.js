/**
 * shared/imageOcr.js
 *
 * 图片 OCR 客户端模块（popup + sidebar 共用）
 *
 * 提供：
 *  - createImageOcrController(): 构造一个图片队列/预览/识别控制器（依赖注入 storage / sendMessage / showTempMessage）
 *  - getOcrPrompt():              读取 chrome.storage.local 里的 platformOcrPrompt（带默认 fallback）
 *  - recognizeImage():            单张图片识别（调用 background 的 popup.ocr.recognize）
 *
 * 不直接调用 chrome.* / window.* 以外的全局，方便 sidebar 在非 popup 上下文复用。
 */

const DEFAULT_OCR_PROMPT = '请识别这张图片中的所有文字内容';
const OCR_PROMPT_STORAGE_KEY = 'platformOcrPrompt';

/**
 * 读取 OCR 提示词（带默认 fallback）
 * @returns {Promise<string>}
 */
export async function getOcrPrompt() {
  const storage = await new Promise((resolve) => {
    chrome.storage.local.get([OCR_PROMPT_STORAGE_KEY], resolve);
  });
  return (storage && storage[OCR_PROMPT_STORAGE_KEY]) || DEFAULT_OCR_PROMPT;
}

/**
 * 单张图片 OCR 识别
 * @param {{ dataUrl: string, prompt?: string }} opts
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
export function recognizeImage({ dataUrl, prompt }) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'popup.ocr.recognize',
        payload: {
          imageDataUrl: dataUrl,
          prompt: prompt || DEFAULT_OCR_PROMPT,
        },
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      }
    );
  });
}

/**
 * 清理 LLM 识别结果：移除 <think>...</think> 思考段（含多行/嵌套/贪婪匹配）
 * LLM 在返回主结果前可能输出内部思考，污染用户可见的 imageInfo
 */
export function stripThinkTags(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')   // 非贪婪：成对删除
    .replace(/<think>[\s\S]*/g, '')              // 未配对的开标签（含到末尾）
    .replace(/<\/think>/g, '')                   // 未配对的闭标签
    .replace(/^\s+|\s+$/g, '')                   // trim
    .replace(/\n{3,}/g, '\n\n');                 // 多余空行压缩
}

/**
 * HTML 属性值转义：避免 fileName 等用户可控字符串直接拼到 alt / title 等属性里导致 XSS。
 * @param {string} value
 * @returns {string}
 */
function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const STATUS_TEXT = {
  pending: '点击识别',
  recognizing: '识别中...',
  success: '已识别',
  error: '失败',
};

function getStatusText(status) {
  return STATUS_TEXT[status] || status;
}

// 模块首次加载时自注入样式（仅一次；aichat/popup 加载路径均会触发）
if (typeof document !== 'undefined' && !document.querySelector('link[data-image-ocr-css]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './imageOcr.css';
  link.dataset.imageOcrCss = '1';
  document.head.appendChild(link);
}

// 自定义 hover tooltip 状态（单例）
let tooltipEl = null;
let tooltipFeedbackTimer = null;
let tooltipHideTimer = null;
let tooltipEnable = true;

/**
 * 确保 tooltip 元素存在并挂到 body。失败时（无 document.body）返回 null。
 */
function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  if (typeof document === 'undefined' || !document.body) return null;

  const root = document.createElement('div');
  root.className = 'image-ocr-tooltip';
  root.setAttribute('role', 'tooltip');
  root.setAttribute('data-state', 'hidden');

  const feedback = document.createElement('div');
  feedback.className = 'image-ocr-tooltip-feedback';
  feedback.setAttribute('data-role', 'feedback');

  const body = document.createElement('div');
  body.className = 'image-ocr-tooltip-body';

  root.appendChild(feedback);
  root.appendChild(body);

  root.addEventListener('click', copyTooltipBody);
  document.body.appendChild(root);

  tooltipEl = root;
  return tooltipEl;
}

/**
 * 根据 image 状态返回 hover 显示的文本。
 * status: pending / recognizing / success / error
 */
function getTooltipTextForItem(img) {
  if (img.status === 'success' && img.recognizedText) return img.recognizedText;
  if (img.status === 'error' && img.recognizedText) return `识别失败: ${img.recognizedText}`;
  if (img.status === 'recognizing') return '识别中...';
  return img.fileName || '';
}

/**
 * 显示 tooltip 在 item 上方居中，超出视口时自动调整。
 */
function showTooltip(itemEl, text) {
  if (!tooltipEnable) return;
  const tip = ensureTooltip();
  if (!tip) return;

  const body = tip.querySelector('.image-ocr-tooltip-body');
  body.textContent = text; // 必须 textContent，避免 XSS

  // 重置反馈条
  const feedback = tip.querySelector('.image-ocr-tooltip-feedback');
  feedback.textContent = '';
  feedback.removeAttribute('data-visible');
  if (tooltipFeedbackTimer) {
    clearTimeout(tooltipFeedbackTimer);
    tooltipFeedbackTimer = null;
  }

  // 取消延迟隐藏
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }

  // 先显示在屏幕外以测量尺寸
  tip.setAttribute('data-state', 'visible');
  tip.style.left = '0px';
  tip.style.top = '0px';

  const itemRect = itemEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;

  let left = itemRect.left + itemRect.width / 2 - tipRect.width / 2;
  let top = itemRect.top - tipRect.height - margin;

  // 边界保护
  if (left < margin) left = margin;
  if (left + tipRect.width > window.innerWidth - margin) {
    left = window.innerWidth - tipRect.width - margin;
  }
  if (top < margin) {
    // 上方空间不足，改为下方
    top = itemRect.bottom + margin;
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/**
 * 隐藏 tooltip。
 * opts.delay > 0 时延迟隐藏（毫秒）
 */
function hideTooltip(opts) {
  if (!tooltipEl) return;
  const delay = (opts && opts.delay) || 0;
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }
  const doHide = () => {
    if (!tooltipEl) return;
    tooltipEl.setAttribute('data-state', 'hidden');
    tooltipEl.style.left = '-9999px';
    tooltipEl.style.top = '-9999px';
  };
  if (delay > 0) {
    tooltipHideTimer = setTimeout(doHide, delay);
  } else {
    doHide();
  }
}

/**
 * 在 tooltip 顶部展示一条 2 秒的反馈条（绿底白字），用于「已复制」等提示。
 */
function showTooltipFeedback(msg) {
  const tip = ensureTooltip();
  if (!tip) return;
  const feedback = tip.querySelector('.image-ocr-tooltip-feedback');
  feedback.textContent = msg;
  feedback.setAttribute('data-visible', 'true');
  if (tooltipFeedbackTimer) clearTimeout(tooltipFeedbackTimer);
  tooltipFeedbackTimer = setTimeout(() => {
    feedback.textContent = '';
    feedback.removeAttribute('data-visible');
    tooltipFeedbackTimer = null;
  }, 2000);
}

/**
 * 复制 tooltip body 文本到剪贴板。
 * 优先 navigator.clipboard，失败时 fallback 到 textarea + execCommand。
 */
async function copyTooltipBody(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  const tip = ensureTooltip();
  if (!tip) return;
  const text = tip.querySelector('.image-ocr-tooltip-body').textContent || '';
  if (!text) return;

  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (_) {
    // fallthrough to execCommand fallback
  }

  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) {
      ok = false;
    }
  }

  showTooltipFeedback(ok ? '已复制' : '复制失败');
}

/**
 * 创建图片 OCR 控制器。
 *
 * 依赖注入（便于 sidebar / popup 共用）：
 *   - getPreviewContainer(): 返回 DOM 容器元素（调用方负责保证存在；不存在的场景由调用方不渲染）
 *   - showTempMessage(msg):  轻量提示（toast / 状态条）
 *   - onChange():            队列或单条状态变更后回调（例如通知外部更新 sendable 文本）
 *
 * 返回值：
 *   {
 *     addImage({ dataUrl, fileName }),
 *     removeImage(imageId),
 *     recognizeImage(imageId),
 *     buildImageInfo(),
 *     clear(),
 *     getImages(),
 *   }
 *
 * @param {{
 *   getPreviewContainer: () => HTMLElement | null,
 *   showTempMessage: (msg: string) => void,
 *   onChange?: () => void,
 * }} deps
 */
export function createImageOcrController(deps) {
  const { getPreviewContainer, showTempMessage, onChange, enableTooltip } = deps;
  // 模块级 enableTooltip 在该 controller 创建时设置（最后一个创建者生效）
  tooltipEnable = enableTooltip !== false; // 默认 true

  let pendingImages = [];
  let nextImageId = 1;

  function render() {
    const container = typeof getPreviewContainer === 'function' ? getPreviewContainer() : null;
    if (!container) return;

    if (pendingImages.length === 0) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    container.hidden = false;
    container.innerHTML = pendingImages
      .map((img) => {
        const fallbackTitle = tooltipEnable ? '' : escapeAttr(getTooltipTextForItem(img));
        const titleAttr = fallbackTitle ? ` title="${fallbackTitle}"` : '';
        return `
          <div class="image-preview-item" data-image-id="${escapeAttr(img.id)}"${titleAttr}>
            <img src="${escapeAttr(img.dataUrl)}" alt="${escapeAttr(img.fileName)}" />
            <button class="image-preview-remove" data-action="remove" data-image-id="${escapeAttr(img.id)}">×</button>
            <div class="image-preview-status ${escapeAttr(img.status)}">${escapeAttr(getStatusText(img.status))}</div>
          </div>
        `;
      })
      .join('');

    // 绑定删除按钮
    container.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.imageId;
        removeImage(id);
      });
    });

    // 绑定 hover tooltip（mouseenter/leave 委托到每个 item）
    if (tooltipEnable) {
      container.querySelectorAll('.image-preview-item').forEach((item) => {
        item.addEventListener('mouseenter', () => {
          const id = item.dataset.imageId;
          const img = pendingImages.find((i) => i.id === id);
          if (!img) return;
          showTooltip(item, getTooltipTextForItem(img));
        });
        item.addEventListener('mouseleave', () => {
          hideTooltip({ delay: 0 });
        });
      });
    }
  }

  function addImage({ dataUrl, fileName }) {
    const imageId = `img_${nextImageId++}`;
    const imageItem = {
      id: imageId,
      dataUrl,
      fileName,
      status: 'pending', // pending | recognizing | success | error
      recognizedText: '',
    };
    pendingImages.push(imageItem);
    render();
    if (typeof onChange === 'function') onChange();
    // v2: 自动触发识别（无需用户点击）
    recognizeImageById(imageId);
    return imageId;
  }

  function removeImage(imageId) {
    pendingImages = pendingImages.filter((img) => img.id !== imageId);
    render();
    if (typeof onChange === 'function') onChange();
  }

  async function recognizeImageById(imageId) {
    const img = pendingImages.find((i) => i.id === imageId);
    if (!img || img.status === 'recognizing') return;

    const prompt = await getOcrPrompt();

    img.status = 'recognizing';
    render();

    try {
      const response = await recognizeImage({ dataUrl: img.dataUrl, prompt });
      if (response && response.success) {
        img.status = 'success';
        // 过滤 LLM 内部思考段（如 <think>...</think>）避免污染 imageInfo
        img.recognizedText = stripThinkTags(response.text || '');
      } else {
        img.status = 'error';
        img.recognizedText = (response && response.error) || '识别失败';
        showTempMessage(`图片识别失败: ${img.recognizedText}`);
      }
    } catch (err) {
      img.status = 'error';
      img.recognizedText = err.message;
      showTempMessage(`图片识别失败: ${err.message}`);
    }

    render();
    if (typeof onChange === 'function') onChange();
  }

  function buildImageInfo() {
    const successImages = pendingImages.filter((img) => img.status === 'success');
    if (successImages.length === 0) return '';
    return successImages
      .map((img) => `[${img.fileName}]\n${img.recognizedText}`)
      .join('\n\n');
  }

  function clear() {
    pendingImages = [];
    nextImageId = 1;
    render();
    if (typeof onChange === 'function') onChange();
  }

  function getImages() {
    return pendingImages.slice();
  }

  return {
    addImage,
    removeImage,
    buildImageInfo,
    clear,
    getImages,
  };
}
