/**
 * 命令模板 + 子进程管理
 */

let editingCmdId = null;

async function loadCommandList() {
  const templates = await loadStorage(STORAGE_KEYS.commandTemplates);
  const container = document.getElementById('cmdList');

  if (templates.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>暂无命令模板</p>
        <button class="btn btn-primary btn-add-cmd" data-action="add-cmd">添加第一个命令</button>
      </div>`;
    return;
  }

  container.innerHTML = templates.map(t => `
    <div class="cmd-card">
      <div class="cmd-card-header">
        <span class="cmd-card-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
        <dl class="cmd-card-detail">
          <dt>目录</dt><dd title="${escapeHtml(t.workDir)}">${escapeHtml(t.workDir)}</dd>
          <dt>命令</dt><dd title="${escapeHtml(t.cmd)} ${escapeHtml(t.args || '')}">${escapeHtml(t.cmd)} ${escapeHtml(t.args || '')}</dd>
        </dl>
        <div class="cmd-card-actions">
          <button class="btn btn-success" data-action="execute-cmd" data-id="${t.id}">启动</button>
          <button class="btn btn-edit" data-action="edit-cmd" data-id="${t.id}">编辑</button>
          <button class="btn btn-danger" data-action="delete-cmd" data-id="${t.id}">删除</button>
        </div>
      </div>
    </div>
  `).join('');
}

function openCmdModal(template = null) {
  editingCmdId = template ? template.id : null;
  document.getElementById('cmdModalTitle').textContent = template ? '编辑命令' : '新增命令';
  document.getElementById('cmdName').value = template ? template.name : '';
  document.getElementById('cmdWorkDir').value = template ? template.workDir : '';
  document.getElementById('cmdCmd').value = template ? template.cmd : '';
  document.getElementById('cmdArgs').value = template ? template.args : '';
  document.getElementById('cmdModal').classList.add('show');
}

function closeCmdModal() {
  document.getElementById('cmdModal').classList.remove('show');
  editingCmdId = null;
}

async function saveCmd() {
  const name = document.getElementById('cmdName').value.trim();
  const workDir = document.getElementById('cmdWorkDir').value.trim();
  const cmd = document.getElementById('cmdCmd').value.trim();
  const args = document.getElementById('cmdArgs').value.trim();

  if (!name || !workDir || !cmd) {
    toast('名称、工作目录和命令为必填项', 'warning');
    return;
  }

  const templates = await loadStorage(STORAGE_KEYS.commandTemplates);

  if (editingCmdId) {
    const idx = templates.findIndex(t => t.id === editingCmdId);
    if (idx >= 0) {
      templates[idx] = { ...templates[idx], name, workDir, cmd, args };
    }
  } else {
    templates.push({ id: generateId(), name, workDir, cmd, args });
  }

  await saveStorage(STORAGE_KEYS.commandTemplates, templates);
  closeCmdModal();
  loadCommandList();
}

async function editCmd(id) {
  const templates = await loadStorage(STORAGE_KEYS.commandTemplates);
  const template = templates.find(t => t.id === id);
  if (template) openCmdModal(template);
}

async function deleteCmd(id) {
  const templates = await loadStorage(STORAGE_KEYS.commandTemplates);
  await saveStorage(STORAGE_KEYS.commandTemplates, templates.filter(t => t.id !== id));
  loadCommandList();
}

async function executeCmd(id) {
  const templates = await loadStorage(STORAGE_KEYS.commandTemplates);
  const template = templates.find(t => t.id === id);
  if (!template) return;

  const argsArray = template.args ? template.args.split(/\s+/) : [];

  try {
    const resp = await sendNativeMessage({
      command: 'startProcess',
      name: template.name,
      workDir: template.workDir,
      cmd: template.cmd,
      args: argsArray,
    });
    toast(`已启动: ${template.name} (PID: ${resp.data.pid})\n日志: ${resp.data.logFile || '无'}`, 'success');
  } catch (err) {
    toast(`启动失败: ${err.message}`, 'error');
  }
}

// ========== 子进程管理 ==========

async function loadProcesses() {
  const container = document.getElementById('processList');

  try {
    const resp = await sendNativeMessage({ command: 'listProcesses' });
    const processes = resp.data || [];

    if (processes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>当前没有管理的进程</p>
          <p style="font-size:14px;">通过"命令管理"启动命令后，进程会出现在这里</p>
        </div>`;
      return;
    }

    container.innerHTML = processes.map(p => `
      <div class="process-card">
        <div class="process-info">
          <div class="process-name">${escapeHtml(p.name || p.cmd)}</div>
          <div class="process-meta">
            PID: ${p.pid} | 目录: ${escapeHtml(p.workDir || '-')} | 命令: ${escapeHtml(p.cmd)} ${(p.args || []).join(' ')} | 启动时间: ${formatTime(p.startTime)}
            ${p.logFile ? `<br>日志: <a href="file://${p.logFile.replace(/\\/g, '/')}" target="_blank" style="color:var(--accent-deep);">${escapeHtml(p.logFile)}</a>` : ''}
          </div>
        </div>
        <span class="status-badge ${p.running ? 'running' : 'stopped'}">
          <span class="status-dot ${p.running ? 'running' : 'stopped'}"></span>
          ${p.running ? '运行中' : '已停止'}
        </span>
        <div style="display:flex; gap:8px;">
          ${p.running
            ? `<button class="btn btn-danger" data-action="stop-process" data-pid="${p.pid}">停止</button>`
            : `<button class="btn btn-secondary" data-action="remove-process" data-pid="${p.pid}">移除</button>`
          }
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <p>无法获取进程列表</p>
        <p style="font-size:14px; color: var(--danger);">${escapeHtml(err.message)}</p>
      </div>`;
  }
}

async function stopProcess(pid) {
  try {
    await sendNativeMessage({ command: 'stopProcess', pid });
    loadProcesses();
  } catch (err) {
    toast(`停止失败: ${err.message}`, 'error');
  }
}

async function removeProcess(pid) {
  try {
    await sendNativeMessage({ command: 'removeProcess', pid });
    loadProcesses();
  } catch (err) {
    toast(`移除失败: ${err.message}`, 'error');
  }
}
