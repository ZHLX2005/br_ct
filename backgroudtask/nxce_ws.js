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
 * native_host 只在 WS 连不上时介入（启动 nx-ce serve），
 * 业务数据流完全走 WS，**不经 native_host 转发**。
 *
 * 多 tab 路由（§8.4 方案 E）：
 *   - 每个 tab 注册时分配 senderId (sender.tab.id)
 *   - query 走 turnId 配对：turn_start 时把最近活跃 tab 记为该 turn 的 owner
 *   - text/thinking/tool_use/done 按 turnId 路由回对应 tab
 *   - 多 tab 并发查询时按"最近一次 query"做 best-effort 路由
 */

const NXCE_WS_URL = 'ws://127.0.0.1:3100';
const NATIVE_HOST = 'com.brochat.prompts_editor';
const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10000];
const CONNECT_TIMEOUT_MS = 5000;

let ws = null;
let wsReady = null;       // Promise<void>，等待 'connected'
let reconnectAttempt = 0;
let reconnectTimer = null;
let manuallyClosed = false;

// 路由表
const sessionTabMap = new Map();  // sessionName (e.g. "tab-123") → tabId
const turnOwner = new Map();       // turnId → tabId (按 turn 路由)
const recentTab = { tabId: null, turnId: null, sessionId: null };

/* ============================================================
 *  WS 连接管理
 * ============================================================ */

function connect() {
  if (wsReady) return wsReady;
  // 若之前 ws 实例残留（error 后未 close），先强制关
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  manuallyClosed = false;

  const ready = new Promise((resolve, reject) => {
    let sock;
    try {
      sock = new WebSocket(NXCE_WS_URL);
    } catch (err) {
      reject(err);
      return;
    }
    ws = sock;

    const timer = setTimeout(() => {
      // 超时 → 主动 close socket 触发 close handler
      try { sock.close(); } catch {}
      reject(new Error('WS connect timeout'));
    }, CONNECT_TIMEOUT_MS);

    sock.addEventListener('open', () => {
      // 等 server 的 'connected' 握手消息
    });

    sock.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'connected') {
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
      // 失败 reject
      reject(new Error('WS closed before handshake'));
      if (!manuallyClosed) scheduleReconnect();
    });

    sock.addEventListener('error', () => {
      // close handler 会跟着触发，不用这里 reject
    });
  });

  wsReady = ready;
  // 失败后清掉 wsReady，方便下次重试
  ready.catch(() => {
    if (wsReady === ready) wsReady = null;
  });
  return ready;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (ensureRunningInFlight) return; // 已经在启动 nx-ce 了，不要并发重连
  const base = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
  reconnectAttempt++;
  // 加 0~500ms jitter，避免多个 tab 同时连时同步打
  const delay = base + Math.floor(Math.random() * 500);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(async () => {
      // 连不上 → 尝试经 native_host 启动
      try { await ensureNxceRunning(); }
      catch (e) { console.log('[NxceWS] ensureRunning failed:', e.message); }
    });
  }, delay);
}

let ensureRunningInFlight = null;

async function ensureNxceRunning() {
  // 防止并发：多次重连失败时只启动一次
  if (ensureRunningInFlight) return ensureRunningInFlight;

  ensureRunningInFlight = (async () => {
    // 1. 先尝试直连 WS（最权威——能连上就说明真的在跑）
    try {
      await connect();
      console.log('[NxceWS] nx-ce 已在运行（直连成功）');
      return;
    } catch { /* 继续下一步 */ }

    // 2. 看状态文件
    let alreadyRunning = false;
    try {
      const statusResp = await sendNative({ command: 'claudeServeStatus', name: 'default' });
      if (statusResp?.data?.exists && statusResp.data.lifecycleState === 'running') {
        alreadyRunning = true;
      }
    } catch { /* 忽略 */ }

    if (alreadyRunning) {
      // 状态文件说在跑，但 WS 连不上 → 说明 nx-ce 进程僵尸，强制重启
      console.log('[NxceWS] 状态显示 running 但连不上，强制重启');
      await sendNative({ command: 'stopProcess', name: 'nxce-serve-default' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }

    // 3. 启动
    console.log('[NxceWS] 经 native_host 启动 nx-ce serve');
    await sendNative({
      command: 'claudeStartServe',
      name: 'default',
      port: 3100,
    });
    // 等待 nx-ce 初始化 + 端口起来
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await connect();
        console.log('[NxceWS] 启动成功');
        return;
      } catch { /* 继续等 */ }
    }
    throw new Error('nx-ce 启动后仍无法连接');
  })().finally(() => {
    ensureRunningInFlight = null;
  });

  return ensureRunningInFlight;
}

/* ============================================================
 *  业务消息发送
 * ============================================================ */

async function send(message) {
  await connect();
  ws.send(JSON.stringify(message));
}

// 业务消息返回 Promise（仅对响应类：getStatus / listSessions）
const pendingRequests = new Map();
let nextReqId = 1;

function sendRequest(message) {
  return new Promise(async (resolve) => {
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
      try { await send(tagged); } catch (e) { resolve({ ok: false, error: e.message }); }
      return;
    }

    pendingRequests.set(id, { resolve, expectedType });
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(null);
    }, 5000);
    pendingRequests.get(id).timer = timer;

    try { await send(tagged); }
    catch (e) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      resolve({ ok: false, error: e.message });
    }
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
      // 始终广播一份（覆盖 sidebar / 新 tab / 任何监听者）
      broadcastEvent(msg);
      if (msg.type === 'done') {
        turnOwner.delete(recentTab.turnId);
        recentTab.turnId = null;
      }
      break;
    }

    case 'init': {
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
      // 找不到归属 → 广播给所有监听者
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
 *  native_host 转发（仅用于进程管理：start/status）
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

export function setupNxceWs() {
  // 不预连接（懒加载）—— 节省 service_worker 唤醒成本
  // connect();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== 'nxce_ws') return false;

    const { cmd } = message;
    (async () => {
      try {
        switch (cmd) {
          case 'query': {
            // 记录发起者 tab（sidebar 可能是独立 webview，sender.tab 可能为空）
            const tabId = sender?.tab?.id;
            if (tabId != null) {
              sessionTabMap.set(message.session, tabId);
              recentTab.tabId = tabId;
            }
            await send({
              type: 'query',
              session: message.session,
              cwd: message.cwd,
              prompt: message.prompt,
              id: message.queryId,
            });
            sendResponse({ ok: true });
            break;
          }
          case 'closeSession': {
            await send({
              type: 'closeSession',
              session: message.session,
              cwd: message.cwd,
            });
            sendResponse({ ok: true });
            break;
          }
          case 'getSkills': {
            // 请求-响应：等 nx-ce 回 'skills' 消息
            const r = await sendRequest({
              type: 'getSkills',
              session: message.session,
              cwd: message.cwd,
            });
            sendResponse(r || { ok: false, error: 'timeout' });
            break;
          }
          case 'getStatus': {
            const r = await sendRequest({
              type: 'getStatus',
              session: message.session,
              cwd: message.cwd,
            });
            sendResponse(r);
            break;
          }
          case 'listSessions': {
            const r = await sendRequest({ type: 'listSessions' });
            sendResponse(r);
            break;
          }
          case 'ensureRunning': {
            try { await ensureNxceRunning(); sendResponse({ ok: true }); }
            catch (e) { sendResponse({ ok: false, error: e.message }); }
            break;
          }
          case 'serveStatus': {
            const r = await sendNative({ command: 'claudeServeStatus', name: 'default' });
            sendResponse(r);
            break;
          }
          case 'ping': {
            // 显式探测 WS 是否连得上（不触发 ensureRunning）
            try {
              await connect();
              sendResponse({ ok: true, connected: true });
            } catch {
              sendResponse({ ok: false, connected: false });
            }
            break;
          }
          case 'stopServe': {
            await sendNative({ command: 'stopProcess', name: 'nxce-serve-default' });
            // 关闭当前 WS，让 UI 知道断开了
            if (ws) {
              try { ws.close(); } catch {}
              ws = null;
            }
            wsReady = null;
            sendResponse({ ok: true });
            break;
          }
          default:
            sendResponse({ ok: false, error: 'unknown cmd: ' + cmd });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true; // 异步响应
  });

  console.log('[NxceWS] listener ready');
}
