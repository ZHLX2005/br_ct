/**
 * 共享工具函数 - 通信、存储、Toast、确认
 */

const STORAGE_KEYS = {
  commandTemplates: 'commandTemplates',
  gitMonitoredDirs: 'gitMonitoredDirs',
  skillCentralPath: 'skillCentralPath',
  skillMonitoredProjects: 'skillMonitoredProjects',
  skillSelectedProject: 'skillSelectedProject',
  // Skill 中心至项目推送模式：'symlink' (默认) | 'copy'
  skillSyncMode: 'skillSyncMode',
  lastActiveTab: 'lastActiveTab',
};

// ========== Native Host 通信（通过 background 中继）==========

function sendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'nativeMessage', payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('Native host 无响应'));
        return;
      }
      if (response.status === 'error') {
        reject(new Error(response.message || '操作失败'));
        return;
      }
      resolve(response);
    });
  });
}

async function checkNativeHost() {
  const dot = document.getElementById('nativeDot');
  const status = document.getElementById('nativeStatus');
  try {
    await sendNativeMessage({ command: 'listProcesses' });
    dot.className = 'status-dot running';
    status.textContent = 'Native Host 已连接';
  } catch (err) {
    dot.className = 'status-dot stopped';
    status.textContent = 'Native Host 未连接 - ' + err.message;
  }
}

// ========== 工具函数 ==========

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadStorage(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] || []);
    });
  });
}

function saveStorage(key, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: data }, resolve);
  });
}

function formatTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 复制路径到剪切板（全模块通用：skill / git / 命令 / 进程 / 环境变量）
async function copyPathToClipboard(path) {
  if (!path) { toast('路径为空', 'warning'); return; }
  try {
    await navigator.clipboard.writeText(path);
    toast('路径已复制到剪切板', 'success', 1600);
  } catch (e) {
    // 降级方案：临时 textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = path;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('路径已复制到剪切板', 'success', 1600);
    } catch (err) {
      toast('复制失败: ' + err.message, 'error');
    }
  }
}

// ========== Toast 提示 ==========

function toast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;

  const sep = message.indexOf('\n');
  if (sep > 0) {
    el.innerHTML = `<div class="toast-title">${escapeHtml(message.slice(0, sep))}</div>`
      + `<div class="toast-body">${escapeHtml(message.slice(sep + 1))}</div>`;
  } else {
    el.textContent = message;
  }

  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 200);
  }, duration);
}

// ========== 二次确认机制 ==========

const confirmTimers = new Map();

function needConfirm(btn) {
  if (btn.dataset.confirmed === 'true') {
    btn.dataset.confirmed = '';
    clearTimeout(confirmTimers.get(btn));
    confirmTimers.delete(btn);
    btn.textContent = btn.dataset.origText;
    btn.classList.remove('btn-confirm-pending');
    return false;
  }
  btn.dataset.origText = btn.textContent;
  btn.dataset.confirmed = 'true';
  btn.textContent = '确认?';
  btn.classList.add('btn-confirm-pending');
  const timer = setTimeout(() => {
    btn.dataset.confirmed = '';
    btn.textContent = btn.dataset.origText;
    btn.classList.remove('btn-confirm-pending');
    confirmTimers.delete(btn);
  }, 2500);
  confirmTimers.set(btn, timer);
  return true;
}
