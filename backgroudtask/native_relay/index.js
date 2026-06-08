/**
 * Native Host 中继模块
 *
 * Background 维护唯一的 connectNative 连接，
 * 所有页面通过 chrome.runtime.sendMessage({ action: 'nativeMessage', ... }) 中转。
 */

const NATIVE_HOST = 'com.brochat.prompts_editor';
let nativePort = null;
let pendingRequests = [];
let userDisconnected = false; // 用户手动断开后阻止自动重连

function connect() {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
    console.log('[NativeRelay] 已连接');
    userDisconnected = false;

    nativePort.onMessage.addListener((msg) => {
      console.log('[NativeRelay] 收到 native host 响应:', {
        status: msg?.status,
        textLen: msg?.data?.text?.length,
        sessionId: msg?.data?.sessionId,
        pending: pendingRequests.length,
      });
      if (pendingRequests.length > 0) {
        const { sendResponse } = pendingRequests.shift();
        sendResponse(msg);
      }
    });

    nativePort.onDisconnect.addListener(() => {
      console.log('[NativeRelay] 连接断开:', chrome.runtime.lastError?.message);
      nativePort = null;
      // 释放等待中的请求
      while (pendingRequests.length > 0) {
        const { sendResponse } = pendingRequests.shift();
        sendResponse({ status: 'error', message: 'Native host 连接断开' });
      }
      // 非用户手动断开时尝试自动重连（仅在 userDisconnected 为 false 时）
      if (!userDisconnected) {
        console.log('[NativeRelay] 尝试在 3 秒后自动重连...');
        setTimeout(() => {
          if (!nativePort && !userDisconnected) {
            console.log('[NativeRelay] 执行自动重连');
            connect();
          }
        }, 3000);
      }
    });
  } catch (err) {
    console.error('[NativeRelay] 连接失败:', err);
    nativePort = null;
  }
}

function disconnect() {
  if (nativePort) {
    userDisconnected = true;
    nativePort.disconnect();
    nativePort = null;
    console.log('[NativeRelay] 用户手动断开');
  }
}

export function setupNativeRelay() {
  // 预连接
  connect();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'nativeConnect') {
      userDisconnected = false;
      connect();
      sendResponse({ status: nativePort ? 'ok' : 'error' });
      return false;
    }
    if (message.action === 'nativeDisconnect') {
      disconnect();
      sendResponse({ status: 'ok' });
      return false;
    }
    if (message.action !== 'nativeMessage') return false;

    // 未连接时：用户手动断开则不允许自动重连
    if (!nativePort) {
      if (userDisconnected) {
        sendResponse({ status: 'error', message: 'Native host 已断开，请点击"启动"连接' });
        return false;
      }
      connect();
      if (!nativePort) {
        sendResponse({ status: 'error', message: 'Native host 不可用' });
        return false;
      }
    }

    pendingRequests.push({ sendResponse });

    try {
      console.log('[NativeRelay] 转发到 native host:', {
        command: message.payload?.command,
        sessionId: message.payload?.sessionId,
        promptLen: message.payload?.prompt?.length,
        pending: pendingRequests.length,
      });
      nativePort.postMessage(message.payload);
    } catch (err) {
      pendingRequests.pop();
      sendResponse({ status: 'error', message: '发送失败: ' + err.message });
      return false;
    }

    // 保持 sendResponse 有效（异步）
    return true;
  });

  console.log('[NativeRelay] 中继监听已就绪');
}
