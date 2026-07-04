// background.js
// 使用 ES Modules 导入功能
console.log('[Background] Service Worker 启动');
import {
    setupTabUpdateListener,
    setupMessageListener as setupAIProcessorListener
} from './backgroudtask/ai_platform_processor.js';
import { setupFuncCommandListener, setupMessageListener as setupFuncExecutorListener } from './backgroudtask/func_executor.js';
import { init as initVideoPlaneServer } from './backgroudtask/video_plane_server.js';
import { initBackupService, setupBackupMessageListener } from './backgroudtask/backupService.js';
import { setupTranslationModule } from './backgroudtask/translation/index.js';
import { setupBinddomCommandListener, setupBinddomMessageListener } from './backgroudtask/binddom/index.js';
import { setupHtmlTextReaderListener } from './backgroudtask/html_text_reader/index.js';
import { setupSidebarCommandListener } from './backgroudtask/sidebar_toggle.js';

// 初始化标签页更新监听器
setupTabUpdateListener();
console.log('[Background] setupTabUpdateListener 完成');

// 启动所有监听器
setupAIProcessorListener();       // AI 平台消息监听
console.log('[Background] setupAIProcessorListener 完成');

setupFuncCommandListener();
console.log('[Background] setupFuncCommandListener 完成');

setupFuncExecutorListener();      // 函数执行消息监听
console.log('[Background] setupFuncExecutorListener 完成');

// 初始化视频片段播放器配置服务器
initVideoPlaneServer();

// 初始化备份服务
initBackupService().catch(error => {
  console.error('[Background] 初始化备份服务失败:', error);
});
setupBackupMessageListener();

// 初始化翻译/OCR模块
setupTranslationModule();

// 初始化 BindDom 模块
setupBinddomCommandListener();
setupBinddomMessageListener();
console.log('[Background] BindDom 模块初始化完成');

// 初始化页面文本提取模块
setupHtmlTextReaderListener();
console.log('[Background] HtmlTextReader 模块初始化完成');

// 初始化边栏快捷键监听
setupSidebarCommandListener();
console.log('[Background] SidebarToggle 模块初始化完成');

// 初始化划词快捷提问配置 (已移至 translation/index.js)
// import { initSelectionAskConfig } from './backgroudtask/translation/selectionAskConfig.js';
// initSelectionAskConfig();

// 初始化 Native Host 中继（单例连接，所有页面共享）
import { setupNativeRelay } from './backgroudtask/native_relay/index.js';
setupNativeRelay();
console.log('[Background] NativeRelay 中继初始化完成');

// 初始化 nx-ce WebSocket 单例（CC 模式业务消息中转）
import { setupNxceWs } from './backgroudtask/nxce_ws.js';
setupNxceWs();
console.log('[Background] NxceWS 初始化完成');