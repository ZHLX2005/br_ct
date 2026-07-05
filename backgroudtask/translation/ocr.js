/**
 * OCR 处理模块 - 翻译/OCR功能
 * 负责处理 OCR 相关的截图和识别请求
 */

/**
 * 处理 OCR 请求 - 使用 captureVisibleTab 获取截图
 * @param {Object} request - 请求对象，包含 rect 区域信息
 * @returns {Promise<{success: boolean, dataUrl?: string, rect?: Object, error?: string}>}
 */
export async function handleOCRRequest(request) {
  try {
    const { rect } = request;

    console.log('[Translation OCR] 收到 OCR 请求，区域:', rect);

    // 使用 captureVisibleTab 获取当前窗口的完整截图
    // 注意：captureVisibleTab 第一个参数在 Manifest V3 中应该是 windowId
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

    console.log('[Translation OCR] 截图完成');

    return {
      success: true,
      dataUrl: dataUrl,
      rect: rect
    };

  } catch (error) {
    console.error('[Translation OCR] 错误:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 直接对一张图片 dataUrl 执行 OCR 识别（用于 popup 发起的小图识别）
 * @param {{ imageDataUrl: string, prompt?: string }} opts
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
export async function recognizeImageOCR({ imageDataUrl, prompt }) {
  try {
    if (!imageDataUrl) {
      return { success: false, error: '缺少图片数据' };
    }

    const finalPrompt = prompt || '请识别这张图片中的所有文字内容';

    // 读取 API 配置（与 options/ocr/main.js + runjs/translation/content-ocr.js 共用 storage key）
    const config = await new Promise((resolve) => {
      chrome.storage.local.get(['translation.api.config'], (result) => {
        resolve(result['translation.api.config'] || null);
      });
    });

    const apiConfig = {
      baseURL: (config && config.baseURL) || 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: (config && config.apiKey) || '',
      model: (config && config.model) || 'glm-4.5v'
    };

    if (!apiConfig.apiKey) {
      return { success: false, error: '请先在 API 设置页配置 API Key' };
    }

    const apiUrl = `${apiConfig.baseURL}/chat/completions`;

    // 与 options/ocr/main.js callOCR 一致的请求体（非流式，便于 popup 直接拿全文）
    const requestBody = {
      model: apiConfig.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl } },
            { type: 'text', text: finalPrompt }
          ]
        }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      stream: false
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Translation OCR] API 请求失败:', response.status, errText);
      return { success: false, error: `API 请求失败: ${response.status}` };
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';

    if (!text) {
      return { success: false, error: '识别结果为空' };
    }

    console.log('[Translation OCR] 图片识别完成，长度:', text.length);
    return { success: true, text };
  } catch (error) {
    console.error('[Translation OCR] recognizeImageOCR 错误:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 初始化 OCR 模块
 * 目前不需要额外的初始化逻辑
 */
export function setupOCR() {
  console.log('[Translation Module] OCR 模块已初始化');
}
