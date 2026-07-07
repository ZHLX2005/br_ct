// background.js
// 使用 ES Modules 导入功能
console.log('[Background] Service Worker 启动');

// 所有 import 必须放在文件顶层、最前面,ES Module 语法强制要求
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
import { setupBannerStarter } from './backgroudtask/banner_starter.js';
import { setupNativeRelay } from './backgroudtask/native_relay/index.js';
import { setupNxceWs } from './backgroudtask/nxce_ws.js';

// 全局兜底:任何模块顶层抛错都能在控制台看到,不会被吞掉
self.addEventListener('unhandledrejection', (e) => {
  console.error('[Background] unhandledrejection:', e.reason);
});
self.addEventListener('error', (e) => {
  console.error('[Background] global error:', e?.error || e?.message || e);
});

// 工具:把 setup 调用包成 try/catch,失败不阻断后续模块
const safe = (name, fn) => {
  try {
    fn();
    console.log(`[Background] ${name} 完成`);
  } catch (e) {
    console.error(`[Background] ${name} 失败:`, e?.message || e, e?.stack);
  }
};

// 初始化标签页更新监听器
safe('setupTabUpdateListener', setupTabUpdateListener);

// 启动所有监听器
safe('setupAIProcessorListener', setupAIProcessorListener);

safe('setupFuncCommandListener', setupFuncCommandListener);
safe('setupFuncExecutorListener', setupFuncExecutorListener);

// 初始化视频片段播放器配置服务器
safe('initVideoPlaneServer', initVideoPlaneServer);

// 初始化备份服务
safe('initBackupService', () => initBackupService().catch(error => {
  console.error('[Background] 初始化备份服务失败:', error);
}));
safe('setupBackupMessageListener', setupBackupMessageListener);

// 初始化翻译/OCR模块
safe('setupTranslationModule', setupTranslationModule);

// 初始化 BindDom 模块
safe('setupBinddomCommandListener', setupBinddomCommandListener);
safe('setupBinddomMessageListener', setupBinddomMessageListener);

// 初始化页面文本提取模块
safe('setupHtmlTextReaderListener', setupHtmlTextReaderListener);

// 初始化边栏快捷键监听
safe('setupSidebarCommandListener', setupSidebarCommandListener);

// 初始化启动横幅模块(Chrome 启动后第一次新标签页飘一次激励语)
safe('setupBannerStarter', setupBannerStarter);

// 初始化 Native Host 中继(单例连接,所有页面共享)
safe('setupNativeRelay', setupNativeRelay);

// 初始化 nx-ce WebSocket 单例(CC 模式业务消息转中转)
safe('setupNxceWs', setupNxceWs);