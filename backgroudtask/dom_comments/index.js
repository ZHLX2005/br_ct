/**
 * DOM Comments Module - Background Service Worker
 *
 * DOM 评论定位器的数据后端：funcs 注入脚本（无模块能力）通过
 * chrome.runtime.sendMessage 存取评论记录，本模块统一转发到
 * shared/domComments/domCommentsStore，任何上下文不直接操作 chrome.storage。
 *
 * Actions:
 *   domComment.add   — 新增一条评论记录
 *   domComment.list  — 读取全部评论记录
 *   domComment.clear — 清空评论记录
 */

import {
  loadDomComments,
  addDomComment,
  clearDomComments,
} from '../../shared/domComments/domCommentsStore.js';

let messageSetup = false; // 防重复注册（service worker 可能重启）

async function handleAdd(request) {
  await loadDomComments();
  const list = await addDomComment(request.payload || {});
  return { status: 'success', list };
}

async function handleList() {
  const list = await loadDomComments();
  return { status: 'success', list };
}

async function handleClear() {
  await clearDomComments();
  return { status: 'success', list: [] };
}

export function setupDomCommentsModule() {
  if (messageSetup) return;
  messageSetup = true;

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    switch (request.action) {
      case 'domComment.add':
        handleAdd(request).then(sendResponse).catch((err) => {
          console.error('[DomComments] add 失败:', err);
          sendResponse({ status: 'error', message: err.message });
        });
        return true; // 异步必须 return true
      case 'domComment.list':
        handleList().then(sendResponse).catch((err) => {
          console.error('[DomComments] list 失败:', err);
          sendResponse({ status: 'error', message: err.message });
        });
        return true;
      case 'domComment.clear':
        handleClear().then(sendResponse).catch((err) => {
          console.error('[DomComments] clear 失败:', err);
          sendResponse({ status: 'error', message: err.message });
        });
        return true;
      default:
        return false; // 不识别的 action 交给其他模块
    }
  });

  console.log('[DomComments] 模块初始化完成');
}
