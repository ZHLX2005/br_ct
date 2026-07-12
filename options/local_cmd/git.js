/**
 * Git 监控
 */

let gitStatusCache = [];
let gitAutoRefreshTimer = null;
let lastRefreshTime = null;

async function loadGitDirList() {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  const container = document.getElementById('gitList');

  if (dirs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无监控目录</p>
        <button class="btn btn-primary" data-action="add-git-dir">添加第一个目录</button>
      </div>`;
    return;
  }

  container.innerHTML = dirs.map(d => `
    <div class="git-card" id="git-card-${d.id}">
      <div class="git-card-header">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span class="git-card-dir">${escapeHtml(d.name)}</span>
            <span class="git-card-dir git-path">${escapeHtml(d.path)}</span>
          </div>
          <div class="git-status-area" id="git-status-${d.id}">
            <span style="color:var(--muted);font-size:14px;">加载中...</span>
          </div>
        </div>
        <div class="git-card-actions">
          <button class="btn btn-secondary" data-action="git-refresh" data-id="${d.id}">刷新</button>
          <button class="btn btn-warning" data-action="git-add-commit-pull" data-id="${d.id}">推送</button>
          <button class="btn btn-success" data-action="git-pull" data-id="${d.id}">Pull</button>
          <button class="btn btn-primary" data-action="git-push" data-id="${d.id}">Push</button>
          <div class="git-more-actions" style="position:relative;display:inline-block;">
            <button class="btn btn-secondary" data-action="git-more-toggle" data-id="${d.id}">+</button>
            <div class="git-more-dropdown" id="git-more-${d.id}" style="display:none;position:absolute;right:0;top:100%;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:100;min-width:120px;">
              <button class="btn btn-warning git-confirm-btn" data-action="git-discard" data-id="${d.id}" data-confirm="false" style="width:100%;border-radius:0 0 6px 6px;border:none;padding:8px 12px;">丢弃</button>
              <button class="btn btn-danger" style="width:100%;border-radius:0 0 6px 6px;border:none;padding:8px 12px;margin-top:4px;" data-action="git-delete" data-id="${d.id}">移除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  // 自动刷新状态
  loadGitStatus();
}

function openGitDirModal() {
  document.getElementById('gitDirName').value = '';
  document.getElementById('gitDirPath').value = '';
  document.getElementById('gitDirModal').classList.add('show');
}

function closeGitDirModal() {
  document.getElementById('gitDirModal').classList.remove('show');
}

async function saveGitDir() {
  const name = document.getElementById('gitDirName').value.trim();
  const path = document.getElementById('gitDirPath').value.trim();

  if (!name || !path) {
    toast('名称和路径为必填项', 'warning');
    return;
  }

  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  dirs.push({ id: generateId(), name, path });
  await saveStorage(STORAGE_KEYS.gitMonitoredDirs, dirs);
  closeGitDirModal();
  loadGitDirList();
}

async function deleteGitDir(id) {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  await saveStorage(STORAGE_KEYS.gitMonitoredDirs, dirs.filter(d => d.id !== id));
  loadGitDirList();
}

async function loadGitStatus(withFetch = false) {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  if (dirs.length === 0) return;

  try {
    const command = withFetch ? 'gitBatchFetch' : 'gitBatchStatus';
    const resp = await sendNativeMessage({
      command,
      dirs: dirs.map(d => d.path),
    });
    gitStatusCache = resp.data || [];
    lastRefreshTime = Date.now();
    renderGitStatus(dirs, gitStatusCache);
    updateRefreshTimeDisplay();
  } catch (err) {
    toast('获取 Git 状态失败: ' + err.message, 'error');
  }
}

function renderGitStatus(dirs, statuses) {
  dirs.forEach((d, i) => {
    const area = document.getElementById('git-status-' + d.id);
    if (!area) return;

    const s = statuses[i];
    if (!s || s.error) {
      area.innerHTML = `<span style="color:var(--danger);font-size:12px;">${escapeHtml(s?.error || '未知错误')}</span>`;
      return;
    }

    const hasChanges = s.ahead > 0 || s.behind > 0 || s.modCount > 0 || s.untrackCount > 0 ||
                       (s.staged && s.staged.length > 0) ||
                       (s.modified && s.modified.length > 0) ||
                       (s.untracked && s.untracked.length > 0);

    const filesHtml = (label, files, color) => {
      if (!files || files.length === 0) return '';
      return `<div style="margin-top:6px;">
        <span style="font-size:12px;font-weight:600;color:${color};">${label} (${files.length})</span>
        <div style="margin-top:2px;font-size:12px;color:var(--muted);overflow-x: auto;overflow-y: visible;">
          ${files.map(f => `<div>${escapeHtml(f)}</div>`).join('')}
        </div>
      </div>`;
    };

    const detailsHtml = filesHtml('已暂存', s.staged, '#6a8758')
       + filesHtml('已修改', s.modified, '#9a4f40')
       + filesHtml('未跟踪', s.untracked, '#7a6858');

    const toggleBtn = hasChanges
      ? `<button class="git-toggle-btn" data-id="${d.id}">收起 ▲</button>`
      : '';

    area.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <span style="font-weight:600;font-size:14px;">${escapeHtml(s.branch || 'unknown')}</span>
        <span class="status-badge ${s.clean ? 'running' : 'stopped'}" style="padding:2px 10px;font-size:12px;">
          <span class="status-dot" style="width:7px;height:7px;${s.clean ? 'background:#6a8758;' : 'background:#9a4f40;'}"></span>
          ${s.clean ? '干净' : '有变更'}
        </span>
        <span class="git-stat-item ${s.ahead > 0 ? 'dirty' : 'clean'}">待推送 <b>${s.ahead}</b></span>
        <span class="git-stat-item ${s.behind > 0 ? 'dirty' : 'clean'}">待拉取 <b>${s.behind}</b></span>
        <span class="git-stat-item ${s.modCount > 0 ? 'dirty' : 'clean'}">已修改 <b>${s.modCount}</b></span>
        <span class="git-stat-item ${s.untrackCount > 0 ? 'dirty' : 'clean'}">未跟踪 <b>${s.untrackCount}</b></span>
        ${toggleBtn}
      </div>
      <div class="git-details" id="git-details-${d.id}" style="margin-top:10px;max-width: 700px;">
        ${detailsHtml}
      </div>
    `;

    // 绑定展开/收缩事件
    const toggleBtnEl = area.querySelector('.git-toggle-btn');
    if (toggleBtnEl) {
      toggleBtnEl.addEventListener('click', () => {
        const details = document.getElementById('git-details-' + d.id);
        if (details) {
          const isExpanded = details.style.display !== 'none';
          details.style.display = isExpanded ? 'none' : 'block';
          toggleBtnEl.textContent = isExpanded ? '详情 ▼' : '收起 ▲';
        }
      });
    }
  });
}

async function gitRefreshDir(id) {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  const dir = dirs.find(d => d.id === id);
  if (!dir) return;

  const area = document.getElementById('git-status-' + id);
  if (area) area.innerHTML = '<span style="color:var(--muted);font-size:14px;">刷新中...</span>';

  try {
    // 先 fetch 再 status，获取准确的 ahead/behind
    const fetchResp = await sendNativeMessage({
      command: 'gitBatchFetch',
      dirs: [dir.path],
    });
    const statuses = fetchResp.data || [];
    const allStatuses = gitStatusCache.length === dirs.length ? [...gitStatusCache] : [];
    const idx = dirs.indexOf(dir);
    if (idx >= 0 && statuses[0]) {
      allStatuses[idx] = statuses[0];
      gitStatusCache = allStatuses;
    }
    renderGitStatus(dirs, allStatuses.length ? allStatuses : statuses);
  } catch (err) {
    if (area) area.innerHTML = `<span style="color:var(--danger);font-size:14px;">${escapeHtml(err.message)}</span>`;
  }
}

async function gitPullDir(id) {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  const dir = dirs.find(d => d.id === id);
  if (!dir) return;

  try {
    const resp = await sendNativeMessage({ command: 'gitPull', path: dir.path });
    const result = resp.data;
    toast(result.success ? `Pull 成功\n${result.output}` : `Pull 失败\n${result.error}\n${result.output}`,
          result.success ? 'success' : 'error');
    gitRefreshDir(id);
  } catch (err) {
    toast('Pull 失败: ' + err.message, 'error');
  }
}

async function gitPushDir(id) {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  const dir = dirs.find(d => d.id === id);
  if (!dir) return;

  try {
    // 智能 push：本地必须干净；远程落后时自动 fetch+pull 合并后再 push；冲突则放弃
    const resp = await sendNativeMessage({ command: 'gitPush', path: dir.path });
    const result = resp.data;
    toast(result.success ? `Push 成功\n${result.output}` : `Push 失败\n${result.error || ''}\n${result.output || ''}`,
          result.success ? 'success' : 'error');
    gitRefreshDir(id);
  } catch (err) {
    toast('Push 失败: ' + err.message, 'error');
  }
}

async function gitAddCommitPush(id) {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  const dir = dirs.find(d => d.id === id);
  if (!dir) return;

  try {
    const resp = await sendNativeMessage({
      command: 'gitAutoCommitAndPush',
      path: dir.path,
      message: 'extension push',
    });
    const result = resp.data;
    toast(result.success
      ? `推送云端成功\n${result.output}`
      : `失败\n${result.error || ''}\n${result.output}`,
          result.success ? 'success' : 'error');
    gitRefreshDir(id);
  } catch (err) {
    toast('操作失败: ' + err.message, 'error');
  }
}

async function batchPull() {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  if (dirs.length === 0) return;

  try {
    const resp = await sendNativeMessage({
      command: 'gitBatchPull',
      dirs: dirs.map(d => d.path),
    });
    const results = resp.data || [];
    const summary = results.map(r =>
      `${r.dir}: ${r.success ? '成功' : '失败 - ' + r.error}`
    ).join('\n');
    const allOk = results.every(r => r.success);
    toast('批量 Pull 结果:\n' + summary, allOk ? 'success' : 'error', 5000);
    loadGitStatus();
  } catch (err) {
    toast('批量 Pull 失败: ' + err.message, 'error');
  }
}

async function batchPush() {
  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  if (dirs.length === 0) return;

  try {
    const resp = await sendNativeMessage({
      command: 'gitBatchPush',
      dirs: dirs.map(d => d.path),
    });
    const results = resp.data || [];
    const summary = results.map(r =>
      `${r.dir}: ${r.success ? '成功' : '失败 - ' + r.error}`
    ).join('\n');
    const allOk = results.every(r => r.success);
    toast('批量 Push 结果:\n' + summary, allOk ? 'success' : 'error', 5000);
    loadGitStatus();
  } catch (err) {
    toast('批量 Push 失败: ' + err.message, 'error');
  }
}

// 切换更多操作下拉菜单
function toggleGitMoreDropdown(btn) {
  const id = btn.dataset.id;
  const dropdown = document.getElementById('git-more-' + id);
  if (!dropdown) return;

  // 关闭其他所有下拉
  document.querySelectorAll('.git-more-dropdown').forEach(d => {
    if (d !== dropdown) d.style.display = 'none';
  });

  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// 点击其他地方关闭下拉
document.addEventListener('click', (e) => {
  if (!e.target.closest('.git-more-actions')) {
    document.querySelectorAll('.git-more-dropdown').forEach(d => {
      d.style.display = 'none';
    });
  }
});

// 丢弃暂存区的更改和未跟踪文件（双重点击确认）
async function gitDiscardStaged(id) {
  const btn = document.querySelector(`[data-action="git-discard"][data-id="${id}"]`);
  if (!btn) return;

  const isConfirmed = btn.dataset.confirm === 'true';

  if (!isConfirmed) {
    // 第一次点击：切换为确认状态
    btn.dataset.confirm = 'true';
    btn.textContent = '确认?';
    btn.classList.remove('btn-warning');
    btn.classList.add('btn-danger');

    // 3秒后自动恢复
    setTimeout(() => {
      if (btn.dataset.confirm === 'true') {
        btn.dataset.confirm = 'false';
        btn.textContent = '丢弃';
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-warning');
      }
    }, 3000);
    return;
  }

  // 第二次点击：执行丢弃操作
  btn.dataset.confirm = 'false';
  btn.textContent = '丢弃';
  btn.classList.remove('btn-danger');
  btn.classList.add('btn-warning');

  const dirs = await loadStorage(STORAGE_KEYS.gitMonitoredDirs);
  const dir = dirs.find(d => d.id === id);
  if (!dir) return;

  try {
    // 执行 git reset HEAD 丢弃暂存
    const resetResp = await sendNativeMessage({ command: 'gitDiscard', path: dir.path });
    const resetResult = resetResp.data;

    // 执行 git clean -fd 丢弃未跟踪文件
    const cleanResp = await sendNativeMessage({ command: 'gitClean', path: dir.path });
    const cleanResult = cleanResp.data;

    const resetOk = resetResult.success;
    const cleanOk = cleanResult.success;
    const messages = [];
    if (resetOk) messages.push('暂存已丢弃');
    if (cleanOk) messages.push('未跟踪已删除');

    toast(messages.length > 0 ? messages.join('\n') : '没有需要丢弃的内容', 'success');
    gitRefreshDir(id);
  } catch (err) {
    toast('丢弃失败: ' + err.message, 'error');
  }
}

// 丢弃未跟踪文件（已废弃，由 gitDiscardStaged 统一处理）
async function gitCleanUntracked(id) {
  // 此函数保留但不再使用
}

// ========== Git 自动刷新 ==========

function startGitAutoRefresh() {
  if (gitAutoRefreshTimer) clearInterval(gitAutoRefreshTimer);
  gitAutoRefreshTimer = setInterval(() => {
    const gitPanel = document.getElementById('panel-git');
    if (gitPanel && gitPanel.classList.contains('active')) {
      loadGitStatus();
    }
  }, 60000);
}

function getLastRefreshTimeStr() {
  if (!lastRefreshTime) return '';
  const d = new Date(lastRefreshTime);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function updateRefreshTimeDisplay() {
  const el = document.getElementById('gitRefreshTime');
  if (el) el.textContent = lastRefreshTime ? `上次刷新: ${getLastRefreshTimeStr()}` : '';
}
