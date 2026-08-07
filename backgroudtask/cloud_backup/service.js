/**
 * CloudBackup Module — 业务逻辑
 *
 * 将整个 chrome.storage.local 序列化为一个 KV（多备份，key 由用户自定义尾缀）：
 *   - push：全量读取本地存储 → 包装备份元信息 → 写入云端 KV `bro_chat_backup:<尾缀>`
 *   - list：`GET /kv?key=bro_chat_backup:*&keysOnly=true` 前缀扫描所有备份 key
 *   - pull：按选中的 key 读取云端 KV → 解析 → 写回本地存储（覆盖）
 *
 * 约定：
 *   - 每个备份一个 key（尾缀即备份名）；同名再次备份会覆盖该 key，后端保留 20 版历史。
 *   - 云同步自身账本（cloudBackup.* 前缀的 key）不进入备份载荷，
 *     避免把登录 token 嵌入云端备份 blob，也让恢复不会破坏本机登录态。
 */

import { apiLogin, apiKvSet, apiKvGet, apiKvList } from './api.js';

const AUTH_KEY = 'cloudBackup.auth';
const LAST_BACKUP_TIME_KEY = 'cloudBackup.lastBackupTime';
const BACKUP_KEY_PREFIX = 'bro_chat_backup:';
const CLOUD_KV_TAGS = ['backup'];
const BACKUP_VERSION = '1.1.0';

/**
 * 规范化备份尾缀：去首尾空白、替换 glob 通配符（避免污染 `前缀*` 扫描），空则报错。
 */
function normalizeSuffix(suffix) {
  const s = String(suffix || '').trim().replace(/[*?%_]/g, '-');
  if (!s) throw new Error('备份名称不能为空');
  return s;
}

// ==================== 认证持久化 ====================

function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get([AUTH_KEY], (result) => {
      resolve(result[AUTH_KEY] || null);
    });
  });
}

function saveAuth(auth) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [AUTH_KEY]: auth }, resolve);
  });
}

function clearAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(AUTH_KEY, resolve);
  });
}

/**
 * 登录：调用后端拿 JWT 后持久化。
 * @returns {Promise<{token: string, userId: number, email: string}>}
 */
export async function login(email, password) {
  const data = await apiLogin(email, password);
  const auth = { token: data.token, userId: data.userId, email, loginTime: Date.now() };
  await saveAuth(auth);
  return auth;
}

export async function logout() {
  await clearAuth();
}

/**
 * 当前登录态（不含 token，避免泄露给页面）。
 */
export async function getState() {
  const auth = await getAuth();
  const lastBackupTime = await getLastBackupTime();
  return {
    loggedIn: !!auth,
    email: auth?.email || null,
    userId: auth?.userId || null,
    lastBackupTime,
  };
}

// ==================== 本地存储读取 ====================

/**
 * 全量读取 chrome.storage.local，剔除云同步账本 key。
 */
function getAllStorageData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      const data = {};
      Object.entries(items).forEach(([key, value]) => {
        if (!key.startsWith('cloudBackup.')) data[key] = value;
      });
      resolve(data);
    });
  });
}

// ==================== 云端备份 / 恢复 ====================

/**
 * 云备份（push）：本地全量存储 → 云端 KV `bro_chat_backup:<尾缀>`。
 * @param {string} [suffix] - 备份尾缀（备份名）；空则抛错
 * @returns {Promise<{backupTime: number, key: string, suffix: string}>}
 */
export async function cloudPush(suffix) {
  const auth = await getAuth();
  if (!auth?.token) throw new Error('未登录，请先登录');

  const name = normalizeSuffix(suffix);
  const key = `${BACKUP_KEY_PREFIX}${name}`;

  const storageData = await getAllStorageData();
  const payload = JSON.stringify({
    version: BACKUP_VERSION,
    backupTime: new Date().toISOString(),
    data: storageData,
  });

  await apiKvSet(auth.token, key, payload, CLOUD_KV_TAGS);

  const now = Date.now();
  await saveLastBackupTime(now);
  return { backupTime: now, key, suffix: name };
}

/**
 * 云端备份列表（list）：前缀 `bro_chat_backup:*` 扫描，keysOnly 省大响应包。
 * @returns {Promise<Array<{key: string, suffix: string}>>}
 */
export async function cloudList() {
  const auth = await getAuth();
  if (!auth?.token) throw new Error('未登录，请先登录');

  const result = await apiKvList(auth.token, `${BACKUP_KEY_PREFIX}*`, true);
  const items = (result && result.items) || [];

  return items.map((item) => ({
    key: item.key,
    suffix: item.key.startsWith(BACKUP_KEY_PREFIX)
      ? item.key.slice(BACKUP_KEY_PREFIX.length)
      : item.key,
  }));
}

/**
 * 云恢复（pull）：按选中的云端 KV → 写回本地存储（覆盖）。
 * @param {string} key - 云端 KV 完整 key
 * @returns {Promise<{backupTime: number, keyCount: number}>}
 */
export async function cloudPull(key) {
  const auth = await getAuth();
  if (!auth?.token) throw new Error('未登录，请先登录');
  if (!key) throw new Error('请先选择一个云端备份');

  const kv = await apiKvGet(auth.token, key);
  if (!kv || !kv.value) throw new Error('云端没有备份数据');

  let backup;
  try {
    backup = JSON.parse(kv.value);
  } catch {
    throw new Error('云端备份数据损坏');
  }

  const data = backup && backup.data;
  if (!data || typeof data !== 'object') {
    throw new Error('云端备份数据格式无效');
  }

  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error('云端备份为空');

  await new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });

  const backupTime = backup.backupTime ? new Date(backup.backupTime).getTime() : Date.now();
  return { backupTime, keyCount: keys.length };
}

// ==================== 备份时间记录 ====================

function saveLastBackupTime(time) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [LAST_BACKUP_TIME_KEY]: time }, resolve);
  });
}

function getLastBackupTime() {
  return new Promise((resolve) => {
    chrome.storage.local.get([LAST_BACKUP_TIME_KEY], (result) => {
      resolve(result[LAST_BACKUP_TIME_KEY] || null);
    });
  });
}
