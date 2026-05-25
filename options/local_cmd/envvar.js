/**
 * 环境变量管理模块
 * 四个面板：用户 PATH、系统 PATH、用户环境变量、系统环境变量
 */

// 当前面板数据缓存
let envvarCache = {
  userPath: [],
  systemPath: [],
  userVars: [],
  systemVars: [],
};

let envvarSelectedPaths = new Set();
let envvarSelectedVars = new Set();
let currentEnvvarSubTab = 'user-path';

// ========== 初始化与面板切换 ==========

function initEnvvarPanel() {
  loadEnvvarSubTab(currentEnvvarSubTab);
  loadEnvSnapshots();
}

function switchEnvvarSubTab(tab) {
  currentEnvvarSubTab = tab;
  envvarSelectedPaths.clear();
  envvarSelectedVars.clear();
  document.querySelectorAll('.envvar-sub-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.envvar-sub-panel').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.envvar-sub-btn[data-envtab="${tab}"]`);
  const panel = document.getElementById(`envvar-panel-${tab}`);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
  loadEnvvarSubTab(tab);
}

async function loadEnvvarSubTab(tab) {
  switch (tab) {
    case 'user-path': await loadUserPath(); break;
    case 'system-path': await loadSystemPath(); break;
    case 'user-vars': await loadUserEnvVars(); break;
    case 'system-vars': await loadSystemEnvVars(); break;
  }
}

// ========== 用户 PATH ==========

async function loadUserPath() {
  const container = document.getElementById('envvar-userPathList');
  container.innerHTML = '<div class="skill-loading"><div class="spinner"></div></div>';
  try {
    const resp = await sendNativeMessage({ command: 'getUserPath' });
    envvarCache.userPath = resp.data || [];
    renderPathList('userPath', envvarCache.userPath, true);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">加载失败: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function addUserPath() {
  const input = document.getElementById('envvarNewPath');
  const path = input.value.trim();
  if (!path) { toast('请输入路径', 'warning'); return; }
  try {
    const resp = await sendNativeMessage({ command: 'addUserPath', path });
    envvarCache.userPath = resp.data || [];
    renderPathList('userPath', envvarCache.userPath, true);
    input.value = '';
    toast('已添加用户 PATH', 'success');
  } catch (err) {
    toast('添加失败: ' + err.message, 'error');
  }
}

async function removeUserPath(path) {
  try {
    const resp = await sendNativeMessage({ command: 'removeUserPath', path });
    envvarCache.userPath = resp.data || [];
    renderPathList('userPath', envvarCache.userPath, true);
    toast('已删除', 'success');
  } catch (err) {
    toast('删除失败: ' + err.message, 'error');
  }
}

async function batchRemoveUserPath() {
  if (envvarSelectedPaths.size === 0) { toast('未选择任何路径', 'warning'); return; }
  if (!confirm(`确定删除选中的 ${envvarSelectedPaths.size} 条用户 PATH？`)) return;
  try {
    await sendNativeMessage({ command: 'batchRemoveUserPath', dirs: [...envvarSelectedPaths] });
    envvarSelectedPaths.clear();
    await loadUserPath();
    toast('批量删除完成', 'success');
  } catch (err) {
    toast('批量删除失败: ' + err.message, 'error');
  }
}

// ========== 系统 PATH ==========

async function loadSystemPath() {
  const container = document.getElementById('envvar-systemPathList');
  container.innerHTML = '<div class="skill-loading"><div class="spinner"></div></div>';
  try {
    const resp = await sendNativeMessage({ command: 'getSystemPath' });
    envvarCache.systemPath = resp.data || [];
    renderPathList('systemPath', envvarCache.systemPath, true);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">加载失败: ${escapeHtml(err.message)}</p><p style="font-size:13px">系统 PATH 需要管理员权限</p></div>`;
  }
}

async function addSystemPath() {
  const input = document.getElementById('envvarNewSystemPath');
  const path = input.value.trim();
  if (!path) { toast('请输入路径', 'warning'); return; }
  try {
    const resp = await sendNativeMessage({ command: 'addSystemPath', path });
    envvarCache.systemPath = resp.data || [];
    renderPathList('systemPath', envvarCache.systemPath, true);
    input.value = '';
    toast('已添加系统 PATH', 'success');
  } catch (err) {
    toast('添加失败: ' + err.message, 'error');
  }
}

async function removeSystemPath(path) {
  try {
    const resp = await sendNativeMessage({ command: 'removeSystemPath', path });
    envvarCache.systemPath = resp.data || [];
    renderPathList('systemPath', envvarCache.systemPath, true);
    toast('已删除', 'success');
  } catch (err) {
    toast('删除失败: ' + err.message, 'error');
  }
}

async function batchRemoveSystemPath() {
  if (envvarSelectedPaths.size === 0) { toast('未选择任何路径', 'warning'); return; }
  if (!confirm(`确定删除选中的 ${envvarSelectedPaths.size} 条系统 PATH？`)) return;
  try {
    await sendNativeMessage({ command: 'batchRemoveSystemPath', dirs: [...envvarSelectedPaths] });
    envvarSelectedPaths.clear();
    await loadSystemPath();
    toast('批量删除完成', 'success');
  } catch (err) {
    toast('批量删除失败: ' + err.message, 'error');
  }
}

// ========== 用户环境变量 ==========

async function loadUserEnvVars() {
  const container = document.getElementById('envvar-userVarsList');
  container.innerHTML = '<div class="skill-loading"><div class="spinner"></div></div>';
  try {
    const resp = await sendNativeMessage({ command: 'getUserEnvVars' });
    envvarCache.userVars = resp.data || [];
    renderEnvVarList('userVars', envvarCache.userVars, true);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">加载失败: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function setUserEnvVar() {
  const name = document.getElementById('envvarNewVarName').value.trim();
  const value = document.getElementById('envvarNewVarValue').value;
  if (!name) { toast('变量名不能为空', 'warning'); return; }
  try {
    await sendNativeMessage({ command: 'setUserEnvVar', name, path: value });
    document.getElementById('envvarNewVarName').value = '';
    document.getElementById('envvarNewVarValue').value = '';
    await loadUserEnvVars();
    toast('已保存用户环境变量', 'success');
  } catch (err) {
    toast('保存失败: ' + err.message, 'error');
  }
}

async function deleteUserEnvVar(name) {
  try {
    await sendNativeMessage({ command: 'removeUserEnvVar', name });
    await loadUserEnvVars();
    toast('已删除', 'success');
  } catch (err) {
    toast('删除失败: ' + err.message, 'error');
  }
}

// ========== 系统环境变量 ==========

async function loadSystemEnvVars() {
  const container = document.getElementById('envvar-systemVarsList');
  container.innerHTML = '<div class="skill-loading"><div class="spinner"></div></div>';
  try {
    const resp = await sendNativeMessage({ command: 'getSystemEnvVars' });
    envvarCache.systemVars = resp.data || [];
    renderEnvVarList('systemVars', envvarCache.systemVars, true);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">加载失败: ${escapeHtml(err.message)}</p><p style="font-size:13px">系统环境变量需要管理员权限</p></div>`;
  }
}

async function setSystemEnvVar() {
  const name = document.getElementById('envvarNewSystemVarName').value.trim();
  const value = document.getElementById('envvarNewSystemVarValue').value;
  if (!name) { toast('变量名不能为空', 'warning'); return; }
  try {
    await sendNativeMessage({ command: 'setSystemEnvVar', name, path: value });
    document.getElementById('envvarNewSystemVarName').value = '';
    document.getElementById('envvarNewSystemVarValue').value = '';
    await loadSystemEnvVars();
    toast('已保存系统环境变量', 'success');
  } catch (err) {
    toast('保存失败: ' + err.message, 'error');
  }
}

async function deleteSystemEnvVar(name) {
  try {
    await sendNativeMessage({ command: 'removeSystemEnvVar', name });
    await loadSystemEnvVars();
    toast('已删除', 'success');
  } catch (err) {
    toast('删除失败: ' + err.message, 'error');
  }
}

// ========== 渲染函数 ==========

function renderPathList(key, paths, editable) {
  const container = document.getElementById(`envvar-${key}List`);
  const searchInput = document.getElementById(`envvar-${key}Search`);
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let filtered = paths;
  if (query) {
    filtered = paths.filter(p => p.path.toLowerCase().includes(query));
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>暂无 PATH 条目</p></div>`;
    updateBatchBar(key, 0);
    return;
  }

  const isUser = key === 'userPath';
  const batchAction = isUser ? 'envvar-batch-remove-user-path' : 'envvar-batch-remove-system-path';

  container.innerHTML = filtered.map((p, idx) => {
    const checked = envvarSelectedPaths.has(p.path) ? 'checked' : '';
    return `
      <div class="envvar-row" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);">
        ${editable ? `<input type="checkbox" class="envvar-checkbox" data-path="${escapeHtml(p.path)}" ${checked} style="accent-color:#6a8758;">` : ''}
        <span style="flex:1;font-size:14px;word-break:break-all;font-family:monospace;">${escapeHtml(p.path)}</span>
        ${editable ? `<button class="btn btn-danger" style="padding:2px 10px;font-size:12px;min-height:auto;" data-action="envvar-remove-${isUser?'user':'system'}-path" data-path="${escapeHtml(p.path)}">删除</button>` : ''}
      </div>
    `;
  }).join('');

  updateBatchBar(key, editable ? envvarSelectedPaths.size : 0);
}

function renderEnvVarList(key, vars, editable) {
  const container = document.getElementById(`envvar-${key}List`);
  const searchInput = document.getElementById(`envvar-${key}Search`);
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  let filtered = vars;
  if (query) {
    filtered = vars.filter(v => v.name.toLowerCase().includes(query) || v.value.toLowerCase().includes(query));
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>暂无环境变量</p></div>`;
    updateBatchBar(key, 0);
    return;
  }

  const isUser = key === 'userVars';

  container.innerHTML = filtered.map(v => {
    const checked = envvarSelectedVars.has(v.name) ? 'checked' : '';
    return `
      <div class="envvar-row" style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);">
        ${editable ? `<input type="checkbox" class="envvar-var-checkbox" data-name="${escapeHtml(v.name)}" ${checked} style="accent-color:#6a8758;margin-top:2px;">` : ''}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;color:var(--ink);">${escapeHtml(v.name)}</div>
          <div style="font-size:13px;color:var(--muted);word-break:break-all;font-family:monospace;margin-top:2px;">${escapeHtml(v.value)}</div>
        </div>
        ${editable ? `<button class="btn btn-danger" style="padding:2px 10px;font-size:12px;min-height:auto;flex-shrink:0;" data-action="envvar-remove-${isUser?'user':'system'}-var" data-name="${escapeHtml(v.name)}">删除</button>` : ''}
      </div>
    `;
  }).join('');

  updateBatchBar(key, editable ? envvarSelectedVars.size : 0);
}

function updateBatchBar(key, count) {
  const bar = document.getElementById(`envvar-${key}BatchBar`);
  if (!bar) return;
  if (count > 0) {
    bar.style.display = 'flex';
    const info = bar.querySelector('.batch-info');
    if (info) info.textContent = `已选择 ${count} 项`;
  } else {
    bar.style.display = 'none';
  }
}

// ========== 快照管理 ==========

async function saveEnvSnapshot() {
  try {
    const resp = await sendNativeMessage({ command: 'saveEnvSnapshot' });
    toast(`快照已保存\n${resp.data.file}`, 'success');
    await loadEnvSnapshots();
  } catch (err) {
    toast('保存快照失败: ' + err.message, 'error');
  }
}

async function loadEnvSnapshots() {
  const container = document.getElementById('envvarSnapshotList');
  try {
    const resp = await sendNativeMessage({ command: 'listEnvSnapshots' });
    const files = resp.data || [];
    if (files.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:20px;"><p style="font-size:13px;">暂无快照</p></div>';
      return;
    }
    container.innerHTML = files.map(f => {
      const name = f.replace(/\\/g, '/').split('/').pop();
      return `
        <div class="envvar-snapshot-item" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);">
          <span style="flex:1;font-size:13px;font-family:monospace;">${escapeHtml(name)}</span>
          <button class="btn btn-secondary" style="padding:2px 10px;font-size:12px;min-height:auto;" data-action="envvar-restore-snapshot" data-file="${escapeHtml(f)}">恢复</button>
          <a href="file://${f.replace(/\\/g, '/')}" target="_blank" class="btn btn-secondary" style="padding:2px 10px;font-size:12px;min-height:auto;text-decoration:none;">查看</a>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="padding:20px;"><p style="color:var(--danger);font-size:13px;">加载失败</p></div>`;
  }
}

async function restoreEnvSnapshot(file) {
  if (!confirm('确定从快照恢复用户环境变量和 PATH？此操作会覆盖当前设置，且仅恢复用户级别变量。')) return;
  try {
    await sendNativeMessage({ command: 'restoreEnvSnapshot', path: file });
    toast('快照恢复成功', 'success');
    await loadEnvvarSubTab(currentEnvvarSubTab);
  } catch (err) {
    toast('恢复失败: ' + err.message, 'error');
  }
}

// ========== 搜索过滤 ==========

function filterEnvvarList(key) {
  if (key === 'userPath') renderPathList('userPath', envvarCache.userPath, true);
  if (key === 'systemPath') renderPathList('systemPath', envvarCache.systemPath, false);
  if (key === 'userVars') renderEnvVarList('userVars', envvarCache.userVars, true);
  if (key === 'systemVars') renderEnvVarList('systemVars', envvarCache.systemVars, false);
}

// ========== Checkbox 处理 ==========

function setupEnvvarCheckboxDelegation() {
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('envvar-checkbox')) {
      const path = e.target.dataset.path;
      if (e.target.checked) envvarSelectedPaths.add(path);
      else envvarSelectedPaths.delete(path);
      renderPathList('userPath', envvarCache.userPath, true);
      renderPathList('systemPath', envvarCache.systemPath, true);
    }
    if (e.target.classList.contains('envvar-var-checkbox')) {
      const name = e.target.dataset.name;
      if (e.target.checked) envvarSelectedVars.add(name);
      else envvarSelectedVars.delete(name);
      renderEnvVarList('userVars', envvarCache.userVars, true);
      renderEnvVarList('systemVars', envvarCache.systemVars, true);
    }
  });
}

// ========== 批量删除环境变量 ==========

async function batchRemoveUserEnvVar() {
  if (envvarSelectedVars.size === 0) { toast('未选择任何变量', 'warning'); return; }
  if (!confirm(`确定删除选中的 ${envvarSelectedVars.size} 个用户环境变量？`)) return;
  try {
    for (const name of envvarSelectedVars) {
      await sendNativeMessage({ command: 'removeUserEnvVar', name });
    }
    envvarSelectedVars.clear();
    await loadUserEnvVars();
    toast('批量删除完成', 'success');
  } catch (err) {
    toast('批量删除失败: ' + err.message, 'error');
  }
}

async function batchRemoveSystemEnvVar() {
  if (envvarSelectedVars.size === 0) { toast('未选择任何变量', 'warning'); return; }
  if (!confirm(`确定删除选中的 ${envvarSelectedVars.size} 个系统环境变量？`)) return;
  try {
    for (const name of envvarSelectedVars) {
      await sendNativeMessage({ command: 'removeSystemEnvVar', name });
    }
    envvarSelectedVars.clear();
    await loadSystemEnvVars();
    toast('批量删除完成', 'success');
  } catch (err) {
    toast('批量删除失败: ' + err.message, 'error');
  }
}

// ========== 首次启动自动保存快照 ==========

let envvarFirstSnapshotDone = false;

async function ensureFirstEnvSnapshot() {
  if (envvarFirstSnapshotDone) return;
  try {
    const resp = await sendNativeMessage({ command: 'listEnvSnapshots' });
    const files = resp.data || [];
    if (files.length === 0) {
      await sendNativeMessage({ command: 'saveEnvSnapshot' });
      console.log('[envvar] 首次启动快照已保存');
    }
    envvarFirstSnapshotDone = true;
  } catch (err) {
    console.warn('[envvar] 首次快照检查失败:', err.message);
  }
}

// ========== 事件委托（子 tab + 搜索） ==========

document.addEventListener('click', (e) => {
  const subBtn = e.target.closest('.envvar-sub-btn');
  if (subBtn && subBtn.dataset.envtab) {
    switchEnvvarSubTab(subBtn.dataset.envtab);
    return;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.envsearch) {
    filterEnvvarList(e.target.dataset.envsearch);
  }
});

// 初始化 checkbox 委托（只调用一次）
setupEnvvarCheckboxDelegation();
