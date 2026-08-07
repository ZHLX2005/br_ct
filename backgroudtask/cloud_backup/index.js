/**
 * CloudBackup Module — Background Service Worker 入口
 * 云备份：登录 + 将整个浏览器存储数据作为单个 KV 备份/恢复。
 */

import { setupMessageHandler } from './messageHandler.js';

export function setupCloudBackupModule() {
  console.log('[CloudBackup] 初始化云备份模块...');
  setupMessageHandler();
  console.log('[CloudBackup] 初始化完成');
}
