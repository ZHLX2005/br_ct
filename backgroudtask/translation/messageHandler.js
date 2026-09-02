/**
 * 消息处理模块 - 翻译/OCR功能
 * 负责处理来自 content script 和 popup 的消息
 */

import { updateContextMenuVisibility } from './contextMenu.js';
import { handleOCRRequest, recognizeImageOCR } from './ocr.js';
import transPrompts from '../../popup/main/prompts/groups/xxxx_trans.js';
import askPrompts from '../../popup/main/prompts/groups/xxxx_ask.js';

/**
 * 处理翻译请求
 */
function handleTranslate(request, sendResponse) {
  // 翻译逻辑由 content script 直接调用 API，这里仅作备用
  sendResponse({
    success: true,
    originalText: request.text,
    translatedText: request.text + ' [翻译由前端处理]'
  });
}

/**
 * 处理更新设置
 */
function handleUpdateSettings() {
  // 更新右键菜单显示状态
  updateContextMenuVisibility();
  return { success: true };
}

/**
 * 初始化消息处理模块
 */
export function setupMessageHandler() {
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    let response = null;
    let isAsync = false;

    // 使用 namespaced action
    switch (request.action) {
      case 'translation.updateSettings':
        response = handleUpdateSettings();
        break;

      case 'translation.translate':
        handleTranslate(request, sendResponse);
        break;

      case 'translation.ocr.perform':
        isAsync = true;
        handleOCRRequest(request).then(sendResponse);
        break;

      case 'popup.ocr.recognize':
        // 弹窗发起的单张图片 OCR 请求
        // request.payload = { imageDataUrl: 'data:image/...', prompt?: string }
        isAsync = true;
        recognizeImageOCR({
          imageDataUrl: request.payload && request.payload.imageDataUrl,
          prompt: request.payload && request.payload.prompt
        }).then((result) => {
          sendResponse(result);
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
        break;

      case 'translation.getTransPrompts':
        response = { success: true, prompts: transPrompts };
        break;

      case 'translation.getAskPrompts':
        response = { success: true, prompts: askPrompts };
        break;

      default:
        // 不处理非翻译相关的消息
        return false;
    }

    // 如果不是异步响应，立即发送响应
    if (!isAsync && response) {
      sendResponse(response);
    }

    // 返回true表示将异步发送响应
    return isAsync;
  });

  console.log('[Translation Module] 消息监听器已设置');
}
