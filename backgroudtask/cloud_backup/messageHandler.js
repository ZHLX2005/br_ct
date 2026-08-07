/**
 * CloudBackup Module — 消息分发
 *
 * action 命名空间：cloudBackup.*
 *   cloudBackup.getState  → { loggedIn, email, userId, lastBackupTime }
 *   cloudBackup.login     → { email, password } → { success, user? }
 *   cloudBackup.logout    → { success }
 *   cloudBackup.push      → { suffix } → { success, backupTime?, suffix? }
 *   cloudBackup.list      → { success, backups?: [{ key, suffix }] }
 *   cloudBackup.pull      → { key } → { success, backupTime?, keyCount? }（后台直接写回存储）
 *
 * 所有分支均异步，return true 保持 channel 存活；不识别的 action return false。
 */

import { login, logout, getState, cloudPush, cloudList, cloudPull } from './service.js';

export function setupMessageHandler() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.action) {
      case 'cloudBackup.getState':
        getState()
          .then(sendResponse)
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'cloudBackup.login':
        login(message.email, message.password)
          .then((auth) =>
            sendResponse({ success: true, user: { email: auth.email, userId: auth.userId } })
          )
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'cloudBackup.logout':
        logout().then(() => sendResponse({ success: true }));
        return true;

      case 'cloudBackup.push':
        cloudPush(message.suffix)
          .then((result) =>
            sendResponse({ success: true, backupTime: result.backupTime, suffix: result.suffix })
          )
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'cloudBackup.list':
        cloudList()
          .then((backups) => sendResponse({ success: true, backups }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'cloudBackup.pull':
        cloudPull(message.key)
          .then((result) =>
            sendResponse({ success: true, backupTime: result.backupTime, keyCount: result.keyCount })
          )
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      default:
        return false;
    }
  });
}
