/**
 * CloudBackup Module — API 客户端
 *
 * 云备份后端接口（GoFrame v2 + Postgres，见 user-kv-invitecode skill）：
 *   - POST /user/login     邮箱+密码 → JWT
 *   - POST /kv             Set 单个 KV（groupId=0 → 个人默认组）
 *   - GET  /kv/:key        Get 单个 KV
 *   - GET  /kv             List（支持 key glob 前缀扫描 + keysOnly）
 *
 * 统一响应信封：{ code, message, data }，code=0 成功。
 * 401 场景后端返回 { code:401, error:"unauthorized..." }（用 error 字段）。
 */

const API_BASE = 'http://47.110.80.47:8988/api/v1';

/**
 * 通用请求封装。
 * @param {string} path - 接口路径（含 query）
 * @param {Object} [opts]
 * @param {string} [opts.method]
 * @param {string} [opts.token] - JWT，可选
 * @param {Object} [opts.body] - 请求体对象
 * @returns {Promise<Object>} 成功时返回 data 字段
 * @throws {Error} 业务失败（code≠0）时抛错，message 取自后端
 */
async function request(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 后端 401 响应会在 JSON 后附带非 JSON 尾巴（如 `{...}Unauthorized`），
    // 直接解析会失败，退而用正则从原始文本抽取错误字段。
    const m = text.match(/"error"\s*:\s*"([^"]+)"/) || text.match(/"message"\s*:\s*"([^"]+)"/);
    if (m) json = { code: response.status, error: m[1] };
  }

  if (json && json.code === 0) {
    return json.data;
  }

  const message = json?.message || json?.error || `HTTP ${response.status}`;
  const error = new Error(message);
  error.code = json?.code ?? response.status;
  throw error;
}

/**
 * 登录：邮箱 + 密码 → { token, userId }
 */
export function apiLogin(email, password) {
  return request('/user/login', { method: 'POST', body: { email, password } });
}

/**
 * 写入单个 KV（groupId=0 → caller 个人默认组）。
 * value 为字符串；ttl=0 永不过期；tags 可空数组。
 */
export function apiKvSet(token, key, value, tags = []) {
  return request('/kv', {
    method: 'POST',
    token,
    body: { key, value, ttl: 0, tags, groupId: 0 },
  });
}

/**
 * 读取单个 KV（groupId=0 → caller 个人默认组）。
 * @returns {Promise<Object>} { key, value, expires_at, tags, groupId, ... }
 */
export function apiKvGet(token, key) {
  return request(`/kv/${encodeURIComponent(key)}?groupId=0`, { token });
}

/**
 * 列出 KV（groupId=0 → caller 个人默认组）。
 * @param {string} token
 * @param {string} keyGlob - Redis 风格 glob（如 `bro_chat_backup:*`），空串不过滤
 * @param {boolean} [keysOnly] - true 时 items[].value 恒为空串（先 SCAN keys 再按需 Get）
 * @returns {Promise<Object>} { items, total }
 */
export function apiKvList(token, keyGlob = '', keysOnly = false) {
  const params = new URLSearchParams();
  params.set('groupId', '0');
  if (keyGlob) params.set('key', keyGlob);
  if (keysOnly) params.set('keysOnly', 'true');
  return request(`/kv?${params.toString()}`, { token });
}
