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
  const { getPreviewContainer, showTempMessage, onChange } = deps;

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
        // hover tooltip：成功时显示已识别文本，失败时显示错误信息，其他状态显示文件名
        const tooltip =
          img.status === 'success' && img.recognizedText
            ? img.recognizedText
            : img.status === 'error'
              ? `识别失败: ${img.recognizedText}`
              : img.fileName;
        return `
          <div class="image-preview-item" data-image-id="${escapeAttr(img.id)}" title="${escapeAttr(tooltip)}">
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
