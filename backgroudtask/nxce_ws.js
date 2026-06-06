/**
 * nx-ce WebSocket 单例 — Browser (MV3 service_worker) 端
 *
 * 架构（与 nx-ce浏览器参考实现.md §10 对齐）：
 *   sidebar (content_script)
 *     → chrome.runtime.sendMessage({ action:'nxce_ws', ... })
 *       → nxce_ws.js (本模块, service_worker 单例)
 *         → WebSocket ws://127.0.0.1:3100
 *           → npx nx-ce serve
 *
 * native_host 只在 sidebar 需要启动/停止 nx-ce 进程时介入；
 * 业务数据流完全走 WS，**不经 native_host 转发**。
 *
 * 设计要点：
 * - 启动 nx-ce 是 sidebar 自己的事（直调 native_host），本模块不做进程管理
 * - 被动 close（nx-ce 死了）不自动重连——必须 sidebar 显式触发
 * - 防止重连风暴：userWantsConnected（用户意图）+ connectGen（代际锁）
 */

const NXCE_WS_URL = 'ws://127.0.0.1:3100';
const NATIVE_HOST = 'com.brochat.prompts_editor';
const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10000];
const CONNECT_TIMEOUT_MS = 5000;

let ws = null;
let wsReady = null;       // Promise<void>，等待 'connected'
let reconnectAttempt = 0;
let reconnectTimer = null;

// === 案例核心逻辑：用户意图 + 代际锁 ===
// userWantsConnected: 唯一信号源，决定是否重连
// connectGen: 自增；旧 connect 的回调看到不匹配就放弃
let userWantsConnected = false;
let connectGen = 0;

// 路由表（多 tab 路由 / turn 配对）
const sessionTabMap = new Map();
const turnOwner = new Map();
const recentTab = { tabId: null, turnId: null, sessionId: null };

/* ============================================================
 *  WS 连接管理（核心：稳定断连 + 防止重连风暴）
 * ============================================================ */

function connect() {
  // 已连或正在连 → 复用
  if (ws && ws.readyState <= 1) return wsReady;
  if (wsReady) return wsReady;

  // 残留 socket 强制关
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }

  // ① 标记用户意图；② 拿到本次代际
  userWantsConnected = true;
  const myGen = ++connectGen;

  const ready = new Promise((resolve, reject) => {
    let sock;
    try { sock = new WebSocket(NXCE_WS_URL); }
    catch (err) { reject(err); return; }
    ws = sock;

    const timer = setTimeout(() => {
      try { sock.close(); } catch {}
      reject(new Error('WS connect timeout'));
    }, CONNECT_TIMEOUT_MS);

    sock.addEventListener('open', () => {
      // 等 server 'connected' 握手消息
    });

    sock.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'connected') {
        if (sock._resolved) return;
        sock._resolved = true;
        clearTimeout(timer);
        reconnectAttempt = 0;
        resolve();
        return;
      }
      dispatch(msg);
    });

    sock.addEventListener('close', () => {
      clearTimeout(timer);
      if (ws === sock) ws = null;
      if (wsReady === ready) wsReady = null;
      if (!sock._resolved) reject(new Error('WS closed before handshake'));

      // 设计：被动 close（nx-ce 进程死了 / 网络断）不自动重连。
      // 任何重连都必须用户显式点 "连接" → ensureRunning。
      if (myGen === connectGen) {
        userWantsConnected = false;
      }
    });

    sock.addEventListener('error', () => {
      // close handler 会跟着触发
    });
  });

  wsReady = ready;
  ready.catch(() => {
    if (myGen !== connectGen) return; // 已被新 connect 取代
    if (wsReady === ready) wsReady = null;
  });
  return ready;
}

function scheduleReconnect(gen) {
  // 保留函数以防未来需要。当前设计：所有重连必须用户显式触发，
  // passive close / nx-ce 死掉 → userWantsConnected=false，不会重连。
  // 此函数永远不会被调用。
  return;
}

/**
 * 显式断开（用户主动取消连接）。
 * - 关闭用户意图
 * - 自增 gen 让所有 in-flight 失效
 * - 标记 sock 主动断开，避免 onclose 重连
 */
function disconnect() {
  userWantsConnected = false;
  connectGen++;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempt = 0;
  if (ws) {
    ws._userDisconnect = true;
    try { ws.close(1000, 'user disconnect'); } catch {}
    ws = null;
  }
  wsReady = null;
  console.log('[NxceWS] 用户主动断开');
}

/* ============================================================
 *  业务消息发送
 * ============================================================ */

async function send(message) {
  await connect();
  ws.send(JSON.stringify(message));
}

// 业务消息返回 Promise（仅对响应类：getStatus / listSessions / getSkills / closeSession）
const pendingRequests = new Map();
let nextReqId = 1;

function sendRequest(message) {
  return new Promise((resolve) => {
    const id = message.id ?? `req-${nextReqId++}`;
    const tagged = { ...message, id };

    // 等待对应的"响应类"消息
    const responseTypes = {
      getStatus: 'status',
      listSessions: 'session_list',
      closeSession: 'session_closed',
      getSkills: 'skills',
    };
    const expectedType = responseTypes[message.type];
    if (!expectedType) {
      // 非请求-响应类：fire-and-forget
      send(tagged).catch((e) => resolve({ ok: false, error: e.message }));
      return;
    }

    pendingRequests.set(id, { resolve, expectedType });
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(null);
    }, 5000);
    pendingRequests.get(id).timer = timer;

    send(tagged).catch((e) => {
      clearTimeout(timer);
      pendingRequests.delete(id);
      resolve({ ok: false, error: e.message });
    });
  });
}

/* ============================================================
 *  消息分发（服务端 → 浏览器 → content_script）
 * ============================================================ */

function dispatch(msg) {
  // 请求-响应类
  if (pendingRequests.size > 0) {
    for (const [id, entry] of pendingRequests) {
      if (msg.type === entry.expectedType) {
        clearTimeout(entry.timer);
        pendingRequests.delete(id);
        entry.resolve({ ok: true, data: msg });
        return;
      }
    }
  }

  switch (msg.type) {
    case 'turn_start': {
      if (recentTab.tabId != null) {
        turnOwner.set(msg.turn, recentTab.tabId);
        recentTab.turnId = msg.turn;
        sendToTab(recentTab.tabId, { action: 'nxce_event', event: msg });
      }
      broadcastEvent(msg);
      break;
    }

    case 'text':
    case 'thinking':
    case 'tool_use':
    case 'done': {
      const tabId = turnOwner.get(recentTab.turnId) ?? recentTab.tabId;
      if (tabId != null) {
        sendToTab(tabId, { action: 'nxce_event', event: msg });
      }
      broadcastEvent(msg);
      if (msg.type === 'done') {
        turnOwner.delete(recentTab.turnId);
        recentTab.turnId = null;
      }
      break;
    }

    case 'init': {
      console.log('[NxceWS] init received, sessionId=' + msg.sessionId + ', skills=' + (msg.skills?.length || 0) + ', cwd=' + msg.cwd);
      if (recentTab.tabId != null) {
        recentTab.sessionId = msg.sessionId;
        sendToTab(recentTab.tabId, { action: 'nxce_event', event: msg });
      }
      broadcastEvent(msg);
      break;
    }

    case 'skills':
    case 'status':
    case 'session_list':
    case 'session_closed':
    case 'error':
    case 'pong':
    default:
      broadcastEvent(msg);
      break;
  }
}

/**
 * 广播事件到所有 sidebar / 监听者。
 * 使用 chrome.runtime.sendMessage（不是 tabs.sendMessage），
 * 因为 sidebar 可能是独立 webview 页面，tabs.sendMessage 收不到。
 */
function broadcastEvent(msg) {
  try {
    chrome.runtime.sendMessage({ action: 'nxce_event', event: msg }).catch(() => {
      // 没有监听者时不报错
    });
  } catch {}
}

function sendToTab(tabId, payload) {
  if (tabId == null) return;
  try {
    chrome.tabs.sendMessage(tabId, payload).catch(() => {
      // tab 没监听者（侧边栏、关闭的 tab 等）时不报错
    });
  } catch {}
}

/* ============================================================
 *  native_host 转发（仅用于 sidebar 主动调用的辅助命令）
 * ============================================================ */

let nativePort = null;
const nativePending = [];
let nativeReady = null;

function ensureNativePort() {
  if (nativePort) return nativeReady;
  nativeReady = new Promise((resolve, reject) => {
    try {
      nativePort = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (err) {
      nativeReady = null;
      reject(err);
      return;
    }
    nativePort.onMessage.addListener((msg) => {
      const p = nativePending.shift();
      if (p) p.resolve(msg);
    });
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      nativeReady = null;
      while (nativePending.length > 0) {
        nativePending.shift().reject(new Error('native host disconnected'));
      }
    });
    resolve();
  });
  return nativeReady;
}

function sendNative(payload) {
  return new Promise((resolve, reject) => {
    ensureNativePort().then(() => {
      const handle = { resolve, reject, settled: false };
      const settle = (fn, val) => {
        if (handle.settled) return;
        handle.settled = true;
        fn(val);
      };
      handle.resolve = (v) => settle(resolve, v);
      handle.reject = (e) => settle(reject, e);
      nativePending.push(handle);
      try { nativePort.postMessage(payload); }
      catch (err) {
        const idx = nativePending.indexOf(handle);
        if (idx !== -1) nativePending.splice(idx, 1);
        handle.reject(err);
        return;
      }
      setTimeout(() => {
        const idx = nativePending.indexOf(handle);
        if (idx !== -1) {
          nativePending.splice(idx, 1);
          handle.reject(new Error('native host timeout'));
        }
      }, 10000);
    }, (err) => reject(err));
  });
}

/* ============================================================
 *  对外 API
 * ============================================================ */

// 业务命令 handler 集中注册
const handlers = {
  // === WS 业务消息（转发到 nx-ce serve） ===
  query: async (msg, sender) => {
    const tabId = sender?.tab?.id;
    if (tabId != null) {
      sessionTabMap.set(msg.session, tabId);
      recentTab.tabId = tabId;
    }
    console.log('[NxceWS] query forward: session=' + msg.session + ', cwd=' + msg.cwd + ', promptLen=' + (msg.prompt?.length || 0) + ', skills=' + JSON.stringify(msg.skills));
    await send({
      type: 'query',
      session: msg.session,
      cwd: msg.cwd,
      prompt: msg.prompt,
      skills: msg.skills,
      id: msg.queryId,
    });
    return { ok: true };
  },

  closeSession: async (msg) => {
    await send({ type: 'closeSession', session: msg.session, cwd: msg.cwd });
    return { ok: true };
  },

  getSkills: async (msg, sender) => {
    if (!msg.cwd || !msg.cwd.trim()) {
      console.warn('[nxce_ws] getSkills received empty cwd from', sender?.tab?.id);
    }
    const r = await sendRequest({ type: 'getSkills', session: msg.session, cwd: msg.cwd });
    return r || { ok: false, error: 'timeout' };
  },

  getStatus: async (msg) => {
    return await sendRequest({ type: 'getStatus', session: msg.session, cwd: msg.cwd });
  },

  listSessions: async () => {
    return await sendRequest({ type: 'listSessions' });
  },

  // === WS 状态控制 ===
  ping: async () => {
    try { await connect(); return { ok: true, connected: true }; }
    catch { return { ok: false, connected: false }; }
  },

  disconnect: () => {
    disconnect();
    return { ok: true };
  },

  // === native_host 转发（进程管理） ===
  startServe: async (msg) => {
    return await sendNative({
      command: 'claudeStartServe',
      name: msg?.name || 'default',
    });
  },

  stopServe: async () => {
    disconnect();
    return await sendNative({ command: 'stopProcess', name: 'nxce-serve-default' }).catch((e) => ({ status: 'error', message: e.message }));
  },

  serveStatus: async () => {
    return await sendNative({ command: 'claudeServeStatus', name: 'default' });
  },
};

export function setupNxceWs() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'nxce_ws') return false;

    const { cmd } = message;
    const handler = handlers[cmd];
    if (!handler) {
      sendResponse({ ok: false, error: 'unknown cmd: ' + cmd });
      return false;
    }

    (async () => {
      try {
        const result = await handler(message, sender);
        sendResponse(result ?? { ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true; // 异步响应
  });

  console.log('[NxceWS] listener ready (' + Object.keys(handlers).length + ' handlers)');
}
