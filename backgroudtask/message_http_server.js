/**
 * HTTP 消息发送服务器
 * 允许通过 HTTP 请求触发 AI 消息发送，无需使用 UI 界面
 *
 * 平台配置统一从 config/platformConfig.js 读取
 * 添加新平台时只需修改 platformConfig.js，无需修改此文件
 */

// 导入统一平台配置
import { PLATFORM_CONFIG, getPlatformIds } from '../config/platformConfig.js';
import { applyPromptTemplate } from '../shared/prompts/promptsCore.js';

// 可配置的端口和域名
const SERVER_PORT = 8902;
const SERVER_DOMAIN = 'localhost'; // 可以改为 '0.0.0.0' 允许外部访问

// 消息发送 API 服务器
let httpServer = null;

/**
 * 获取有效的平台 ID 列表
 * 从 PLATFORM_CONFIG 动态读取，无需硬编码
 */
function getValidPlatformIds() {
  return Object.keys(PLATFORM_CONFIG);
}

/**
 * 获取平台列表（用于 API 响应）
 * 从 PLATFORM_CONFIG 动态读取，无需硬编码
 */
function getPlatformsList() {
  return Object.entries(PLATFORM_CONFIG).map(([platformId, config]) => ({
    id: platformId,
    name: config.name,
    icon: config.icon,
    color: config.color,
    url: config.url
  }));
}

/**
 * 启动 HTTP 消息服务器
 */
export function startMessageHttpServer() {
  if (httpServer) {
    console.log('HTTP message server already running');
    return;
  }

  console.log(`Starting HTTP message server on ${SERVER_DOMAIN}:${SERVER_PORT}`);

  // 使用 Chrome Extension API 创建 HTTP 服务器
  // 由于浏览器扩展限制，我们需要通过 Chrome API 来处理 HTTP 请求
  setupHttpMessageListener();
}

/**
 * 设置 HTTP 消息监听器
 */
function setupHttpMessageListener() {
  // 监听来自外部 HTTP 请求的消息
  chrome.runtime.onMessageExternal.addListener(
    async (request, sender, sendResponse) => {
      try {
        // 验证来源（可选的安全措施）
        if (!isValidSender(sender)) {
          sendResponse({
            success: false,
            error: 'Unauthorized sender'
          });
          return true;
        }

        // 处理不同的 API 端点
        switch (request.action) {
          case 'sendMessage':
            await handleSendMessage(request, sendResponse);
            break;
          case 'getPlatforms':
            await handleGetPlatforms(sendResponse);
            break;
          case 'getStatus':
            await handleGetStatus(sendResponse);
            break;
          default:
            sendResponse({
              success: false,
              error: 'Unknown action'
            });
        }
      } catch (error) {
        console.error('HTTP message server error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }

      return true; // 保持消息通道开启以支持异步响应
    }
  );

  console.log('HTTP message listener setup complete');
}

/**
 * 验证发送者（简化版，实际应用中应该更严格）
 */
function isValidSender(sender) {
  // 这里可以添加更严格的验证逻辑
  // 例如：检查特定的域名、IP地址等
  return true; // 暂时允许所有发送者
}

/**
 * 处理发送消息请求
 */
async function handleSendMessage(request, sendResponse) {
  const { message, platforms, optimizer } = request;

  if (!message || !message.trim()) {
    sendResponse({
      success: false,
      error: 'Message cannot be empty'
    });
    return;
  }

  if (!platforms || platforms.length === 0) {
    sendResponse({
      success: false,
      error: 'At least one platform must be specified'
    });
    return;
  }

  // 验证平台名称（从 PLATFORM_CONFIG 动态读取）
  const validPlatforms = getValidPlatformIds();
  const invalidPlatforms = platforms.filter(p => !validPlatforms.includes(p));

  if (invalidPlatforms.length > 0) {
    sendResponse({
      success: false,
      error: `Invalid platforms: ${invalidPlatforms.join(', ')}`
    });
    return;
  }

  console.log(`Received HTTP request to send message to platforms: ${platforms.join(', ')}`);

  try {
    // 构建任务队列
    let finalMessage = message.trim();

    // 应用优化器（如果指定）
    if (optimizer) {
      const template = await getOptimizerTemplate(optimizer);
      if (template) {
        // 走 promptsCore.applyPromptTemplate 决策树：%s / %v / good_eg / bad_eg 统一处理
        finalMessage = template.includes("%s")
          ? applyPromptTemplate(template, { userMessage: finalMessage })
          : finalMessage + " " + template;
      }
    }

    // 创建任务队列
    const actionsQueue = platforms.map(platform => ({
      platform,
      message: finalMessage
    }));

    // 保存任务到本地存储并开始处理
    await chrome.storage.local.set({
      actionsQueue,
      httpRequest: {
        timestamp: Date.now(),
        platforms,
        message: finalMessage
      }
    });

    // 通知背景脚本开始处理
    chrome.runtime.sendMessage({
      action: "processTaskQueue",
      queue: actionsQueue
    });

    // 添加到历史记录
    await addToHistory(message.trim());

    sendResponse({
      success: true,
      message: 'Message queued for sending',
      details: {
        platforms,
        finalMessage,
        queueLength: actionsQueue.length
      }
    });

  } catch (error) {
    console.error('Error processing HTTP message request:', error);
    sendResponse({
      success: false,
      error: `Failed to process message: ${error.message}`
    });
  }
}

/**
 * 处理获取平台列表请求
 * 从 PLATFORM_CONFIG 动态读取，无需硬编码
 */
async function handleGetPlatforms(sendResponse) {
  const platforms = getPlatformsList();

  sendResponse({
    success: true,
    platforms
  });
}

/**
 * 处理获取状态请求
 */
async function handleGetStatus(sendResponse) {
  try {
    const result = await chrome.storage.local.get(['actionsQueue', 'httpRequest']);
    const queue = result.actionsQueue || [];
    const lastRequest = result.httpRequest || null;

    sendResponse({
      success: true,
      status: {
        queueLength: queue.length,
        isProcessing: queue.length > 0,
        lastRequest: lastRequest ? {
          timestamp: lastRequest.timestamp,
          platforms: lastRequest.platforms,
          messagePreview: lastRequest.message.slice(0, 50) + (lastRequest.message.length > 50 ? '...' : '')
        } : null
      }
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: `Failed to get status: ${error.message}`
    });
  }
}

/**
 * 获取优化器模板
 */
async function getOptimizerTemplate(optimizerKey) {
  try {
    // 这里需要从你的优化器数据中获取模板
    // 假设你有一个存储优化器的地方
    const result = await chrome.storage.local.get(['optimizerTemplates']);
    const templates = result.optimizerTemplates || {};

    return templates[optimizerKey] || null;
  } catch (error) {
    console.error('Error getting optimizer template:', error);
    return null;
  }
}

/**
 * 添加消息到历史记录
 */
async function addToHistory(message) {
  const HISTORY_KEY = "messageHistory";
  const MAX_HISTORY = 5;

  try {
    const result = await chrome.storage.local.get(HISTORY_KEY);
    let history = result[HISTORY_KEY] || [];

    // 移除重复消息
    history = history.filter(item => item !== message);
    // 添加新消息到开头
    history.unshift(message);

    // 限制历史记录数量
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch (error) {
    console.error('Error adding to history:', error);
  }
}

/**
 * 停止 HTTP 消息服务器
 */
export function stopMessageHttpServer() {
  if (httpServer) {
    httpServer = null;
    console.log('HTTP message server stopped');
  }
}

/**
 * 获取服务器信息
 */
export function getServerInfo() {
  return {
    port: SERVER_PORT,
    domain: SERVER_DOMAIN,
    url: `http://${SERVER_DOMAIN}:${SERVER_PORT}`,
    isRunning: !!httpServer
  };
}
