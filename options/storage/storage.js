/**
 * 存储管理页面
 * 存储调试、备份设置和导入导出功能
 */

// ==================== 存储调试相关 ====================

let debugContent;
let statusMessage;
let lastBackupTimeElement;

/**
 * 初始化存储管理页面
 */
function initializeStorageDebug() {
  debugContent = document.getElementById('storage-debug-content');
  statusMessage = document.getElementById('storage-status-message');
  lastBackupTimeElement = document.getElementById('last-backup-time');

  // 加载存储数据
  loadStorageDebug();

  // 加载备份设置
  loadSettings();

  // 加载最后备份时间
  loadLastBackupTime();

  // 加载存储大小
  loadStorageSize();

  // 刷新按钮
  document.getElementById('refresh-storage').addEventListener('click', loadStorageDebug);

  // 清空按钮
  document.getElementById('clear-storage').addEventListener('click', clearAllStorage);

  // 备份按钮
  document.getElementById('backup-now-btn').addEventListener('click', performManualBackup);

  // 导入按钮
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  // 导入文件选择
  document.getElementById('import-file').addEventListener('change', handleImportFile);

  // 保存设置按钮
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

  // 使用事件委托处理折叠/展开和删除
  debugContent.addEventListener('click', (e) => {
    // 处理分组折叠
    const groupToggle = e.target.closest('[data-toggle="group"]');
    if (groupToggle) {
      const content = groupToggle.nextElementSibling;
      content.classList.toggle('collapsed');
      return;
    }

    // 处理项目折叠
    const itemToggle = e.target.closest('[data-toggle="item"]');
    if (itemToggle) {
      const content = itemToggle.nextElementSibling;
      const isHidden = content.style.display === 'none';
      content.style.display = isHidden ? 'block' : 'none';
      return;
    }

    // 处理 JSON 树折叠
    const jsonToggle = e.target.closest('.json-collapsible');
    if (jsonToggle) {
      jsonToggle.classList.toggle('collapsed');
      const content = jsonToggle.nextElementSibling;
      if (content) {
        content.classList.toggle('json-collapsed');
      }
      return;
    }

    // 处理删除按钮
    const deleteBtn = e.target.closest('.delete-key-btn');
    if (deleteBtn) {
      const key = deleteBtn.dataset.key;
      if (confirm(`确定要删除 key "${key}" 吗？此操作不可恢复！`)) {
        deleteStorageKey(key);
      }
      return;
    }
  });
}

// ==================== 存储调试功能 ====================

/**
 * 加载并显示存储数据（分组显示）
 */
function loadStorageDebug() {
  chrome.storage.local.get(null, (items) => {
    if (Object.keys(items).length === 0) {
      debugContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #6c757d;">存储为空</div>';
      return;
    }

    // 对 key 进行分组
    const grouped = groupStorageKeys(items);

    // 渲染分组
    debugContent.innerHTML = renderGroupedStorage(grouped);
  });
}

/**
 * 对存储 key 进行分组
 */
function groupStorageKeys(items) {
  const groups = {
    queue: { name: '任务队列', items: [], keys: [] },
    config: { name: '配置设置', items: [], keys: [] },
    menu: { name: '菜单配置', items: [], keys: [] },
    video: { name: '视频配置', items: [], keys: [] },
    history: { name: '历史记录', items: [], keys: [] },
    other: { name: '其他数据', items: [], keys: [] }
  };

  Object.entries(items).forEach(([key, value]) => {
    const item = { key, value };

    if (key.includes('Queue') || key.includes('queue') || key === 'actionsQueue') {
      groups.queue.items.push(item);
      groups.queue.keys.push(key);
    } else if (key.includes('Config') || key.includes('config') || key.includes('Settings') || key.includes('settings')) {
      groups.config.items.push(item);
      groups.config.keys.push(key);
    } else if (key.includes('Menu') || key.includes('menu')) {
      groups.menu.items.push(item);
      groups.menu.keys.push(key);
    } else if (key.includes('video') || key.includes('Video')) {
      groups.video.items.push(item);
      groups.video.keys.push(key);
    } else if (key.includes('history') || key.includes('History')) {
      groups.history.items.push(item);
      groups.history.keys.push(key);
    } else {
      groups.other.items.push(item);
      groups.other.keys.push(key);
    }
  });

  return Object.values(groups).filter(g => g.items.length > 0);
}

/**
 * 渲染分组存储
 */
function renderGroupedStorage(groups) {
  return groups.map(group => `
    <div class="storage-group">
      <div class="storage-group-header" data-toggle="group">
        <span>${group.name}</span>
        <span class="group-badge">${group.items.length} 项</span>
      </div>
      <div class="storage-group-content">
        ${group.items.map(item => renderStorageItem(item)).join('')}
      </div>
    </div>
  `).join('');
}

/**
 * 渲染单个存储项
 */
function renderStorageItem(item) {
  const valueType = getValueType(item.value);
  const content = renderValue(item.value, item.key);

  return `
    <div class="storage-item">
      <div class="storage-item-header" data-toggle="item">
        <span class="key-name">${escapeHtml(item.key)}</span>
        <span class="key-type">${valueType}</span>
        <button class="delete-key-btn" data-key="${escapeHtml(item.key)}">删除</button>
      </div>
      <div class="storage-item-content" style="display: none;">
        ${content}
      </div>
    </div>
  `;
}

/**
 * 获取值类型
 */
function getValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array[]';
    return `array[${value.length}]`;
  }
  const type = typeof value;
  if (type === 'object') return 'object';
  return type;
}

/**
 * 渲染值
 */
function renderValue(value, key) {
  if (key === 'actionsQueue' && Array.isArray(value)) {
    return renderActionsQueue(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '<div class="json-null">空数组 []</div>';
    return renderArray(value);
  }

  if (value !== null && typeof value === 'object') {
    return renderObject(value);
  }

  return `<span class="json-${getJsonClass(value)}">${escapeHtml(String(value))}</span>`;
}

/**
 * 递归渲染数组
 */
function renderArray(arr, depth = 0) {
  if (depth > 3) return `<span class="json-null">[...]</span>`;

  const items = arr.slice(0, 10).map((item, index) => {
    return `[${index}]: ${renderJsonValue(item, depth + 1)}`;
  }).join('<br>');

  const more = arr.length > 10 ? `<br>... 共 ${arr.length} 项` : '';

  return `<div class="json-tree"><span class="json-collapsible">Array(${arr.length})</span><div class="json-collapsed">${items}${more}</div></div>`;
}

/**
 * 递归渲染对象
 */
function renderObject(obj, depth = 0) {
  if (depth > 3) return `<span class="json-null">{...}</span>`;

  const keys = Object.keys(obj);
  const items = keys.slice(0, 10).map(key => {
    return `<span class="json-key">${escapeHtml(key)}</span>: ${renderJsonValue(obj[key], depth + 1)}`;
  }).join('<br>');

  const more = keys.length > 10 ? `<br>... 共 ${keys.length} 项` : '';

  return `<div class="json-tree"><span class="json-collapsible">Object {${keys.length}}</span><div class="json-collapsed">${items}${more}</div></div>`;
}

/**
 * 递归渲染任意 JSON 值
 */
function renderJsonValue(value, depth) {
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === 'string') {
    const display = value.length > 50 ? value.substring(0, 50) + '...' : value;
    return `<span class="json-string" title="${escapeHtml(value)}">"${escapeHtml(display)}"</span>`;
  }
  if (typeof value === 'number') return `<span class="json-number">${value}</span>`;
  if (typeof value === 'boolean') return `<span class="json-boolean">${value}</span>`;
  if (Array.isArray(value)) return `<span class="json-null">[${value.length}]</span>`;
  if (typeof value === 'object') return `<span class="json-null">{${Object.keys(value).length}}</span>`;
  return String(value);
}

/**
 * 特殊渲染 actionsQueue
 */
function renderActionsQueue(queue) {
  if (!queue || queue.length === 0) return '<span class="json-null">队列为空</span>';

  return queue.slice(0, 5).map((item, index) => {
    const platform = item.platform || 'unknown';
    const message = item.message ? (typeof item.message === 'string' ? item.message : JSON.stringify(item.message).substring(0, 50)) : '';
    return `[${index + 1}] <span class="json-string">${escapeHtml(platform)}</span>: ${escapeHtml(message)}`;
  }).join('<br>');
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 删除单个存储 key
 */
function deleteStorageKey(key) {
  chrome.storage.local.remove(key, () => {
    showStatusMessage(`已删除: ${key}`, 'success');
    loadStorageDebug();
  });
}

/**
 * 清空所有存储数据
 */
function clearAllStorage() {
  if (confirm('确定要清空所有存储数据吗？此操作不可恢复！')) {
    chrome.storage.local.clear(() => {
      showStatusMessage('存储数据已清空', 'success');
      loadStorageDebug();
      loadStorageSize();
    });
  }
}

// ==================== 备份设置功能 ====================

let totalBackupsCount;
let storageSizeCount;
let nextBackupCount;

/**
 * 加载备份设置
 */
function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getBackupSettings' }, (response) => {
    if (response) {
      document.getElementById('auto-backup-toggle').checked = response.enabled;
      document.getElementById('backup-interval-select').value = response.intervalHours;
      document.getElementById('max-backups-select').value = response.maxBackups;
      document.getElementById('folder-name-input').value = response.folderName || 'bro_chat_backups';
      updateNextBackupDisplay();
    }
  });

  // 获取统计元素
  totalBackupsCount = document.getElementById('total-backups-count');
  storageSizeCount = document.getElementById('storage-size-count');
  nextBackupCount = document.getElementById('next-backup-count');
}

/**
 * 保存备份设置
 */
function saveSettings() {
  const folderName = document.getElementById('folder-name-input').value.trim();
  if (!folderName) {
    showStatusMessage('请输入文件夹名称', 'error');
    return;
  }

  const settings = {
    enabled: document.getElementById('auto-backup-toggle').checked,
    intervalHours: parseInt(document.getElementById('backup-interval-select').value),
    maxBackups: parseInt(document.getElementById('max-backups-select').value),
    folderName: folderName,
    saveAs: false
  };

  chrome.runtime.sendMessage({ action: 'updateBackupSettings', settings }, (response) => {
    if (response) {
      showStatusMessage('设置已保存', 'success');
      updateNextBackupDisplay();
    } else {
      showStatusMessage('保存失败', 'error');
    }
  });
}

/**
 * 加载最后备份时间
 */
function loadLastBackupTime() {
  chrome.runtime.sendMessage({ action: 'getLastBackupTime' }, (response) => {
    if (response !== undefined) {
      updateLastBackupTimeDisplay(response);
    }
  });
}

/**
 * 更新最后备份时间显示
 */
function updateLastBackupTimeDisplay(timestamp) {
  if (!timestamp) {
    lastBackupTimeElement.textContent = '从未备份';
    lastBackupTimeElement.classList.add('never');
    return;
  }

  lastBackupTimeElement.classList.remove('never');
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let timeText;
  if (diffMins < 1) {
    timeText = '刚刚';
  } else if (diffMins < 60) {
    timeText = `${diffMins} 分钟前`;
  } else if (diffHours < 24) {
    timeText = `${diffHours} 小时前`;
  } else if (diffDays < 7) {
    timeText = `${diffDays} 天前`;
  } else {
    timeText = `上次：${formatDateTime(date)}`;
  }

  lastBackupTimeElement.textContent = timeText;
}

/**
 * 更新下次备份显示
 */
function updateNextBackupDisplay() {
  if (!document.getElementById('auto-backup-toggle').checked) {
    nextBackupCount.textContent = '未启用';
    return;
  }

  chrome.alarms.get('storage-auto-backup', (alarm) => {
    if (chrome.runtime.lastError || !alarm) {
      nextBackupCount.textContent = '等待调度';
      return;
    }

    const nextBackupTime = new Date(alarm.scheduledTime);
    const now = new Date();
    const diffMs = nextBackupTime - now;

    if (diffMs <= 0) {
      nextBackupCount.textContent = '即将执行';
      return;
    }

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 60) {
      nextBackupCount.textContent = `${diffMins} 分钟后`;
    } else if (diffHours < 24) {
      nextBackupCount.textContent = `${diffHours} 小时后`;
    } else {
      nextBackupCount.textContent = `${Math.floor(diffHours / 24)} 天后`;
    }
  });
}

/**
 * 加载存储大小
 */
function loadStorageSize() {
  chrome.storage.local.get(null, (items) => {
    const jsonStr = JSON.stringify(items);
    const sizeBytes = new Blob([jsonStr]).size;
    storageSizeCount.textContent = formatBytes(sizeBytes);
  });
}

/**
 * 执行手动备份
 */
function performManualBackup() {
  const btn = document.getElementById('backup-now-btn');
  btn.disabled = true;
  btn.textContent = '⏳ 备份中...';

  chrome.runtime.sendMessage({ action: 'performManualBackup' }, (response) => {
    btn.disabled = false;
    btn.textContent = '立即备份';

    if (response && response.success) {
      showStatusMessage(`备份成功: ${response.filename}`, 'success');
      updateLastBackupTimeDisplay(response.time);
      loadStorageSize();
    } else {
      showStatusMessage(`备份失败: ${response?.error || '未知错误'}`, 'error');
    }
  });
}

/**
 * 格式化日期时间
 */
function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 格式化字节大小
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// ==================== 导入功能 ====================

/**
 * 处理导入文件选择
 */
function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      restoreFromBackup(data);
    } catch (err) {
      showStatusMessage(`导入失败: 文件格式错误 - ${err.message}`, 'error');
    }
  };
  reader.onerror = () => {
    showStatusMessage('导入失败: 无法读取文件', 'error');
  };
  reader.readAsText(file);

  event.target.value = '';
}

/**
 * 从备份数据恢复
 */
function restoreFromBackup(data) {
  if (!data || typeof data !== 'object') {
    showStatusMessage('导入失败: 数据格式无效', 'error');
    return;
  }

  // 提取实际数据（备份文件有包装格式）
  let storageData = data;
  if (data.data && typeof data.data === 'object') {
    storageData = data.data;
  }

  const keys = Object.keys(storageData);
  if (keys.length === 0) {
    showStatusMessage('导入失败: 备份文件为空', 'error');
    return;
  }

  const confirmed = confirm(`即将导入 ${keys.length} 个存储项到扩展存储中。\n导入将覆盖现有数据。\n是否继续？`);

  if (!confirmed) return;

  chrome.storage.local.set(storageData, () => {
    if (chrome.runtime.lastError) {
      showStatusMessage(`导入失败: ${chrome.runtime.lastError.message}`, 'error');
    } else {
      showStatusMessage(`成功导入 ${keys.length} 个存储项`, 'success');
      loadStorageDebug();
      loadStorageSize();
    }
  });
}

// ==================== 云备份功能 ====================

let cloudLoginView, cloudLoggedView;
let cloudEmailInput, cloudPasswordInput;
let cloudUserEmail, cloudLastBackupTime;
let cloudStatusMessage;
let cloudBackupNameInput, cloudBackupList;

/**
 * 初始化云备份功能（登录 + 云端 KV 备份/恢复）
 */
function initializeCloudBackup() {
  cloudLoginView = document.getElementById('cloud-login-view');
  cloudLoggedView = document.getElementById('cloud-logged-view');
  cloudUserEmail = document.getElementById('cloud-user-email');
  cloudLastBackupTime = document.getElementById('cloud-last-backup-time');
  cloudStatusMessage = document.getElementById('cloud-status-message');
  cloudEmailInput = document.getElementById('cloud-email');
  cloudPasswordInput = document.getElementById('cloud-password');
  cloudBackupNameInput = document.getElementById('cloud-backup-name');
  cloudBackupList = document.getElementById('cloud-backup-list');

  // 登录（回车触发）
  document.getElementById('cloud-login-btn').addEventListener('click', handleCloudLogin);
  cloudPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCloudLogin();
  });

  // 退出登录
  document.getElementById('cloud-logout-btn').addEventListener('click', handleCloudLogout);

  // 云端备份：录入名称回车 / 按钮 / 刷新列表 / 恢复
  cloudBackupNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCloudPush();
  });
  document.getElementById('cloud-push-btn').addEventListener('click', handleCloudPush);
  document.getElementById('cloud-refresh-btn').addEventListener('click', refreshCloudBackupList);
  document.getElementById('cloud-pull-btn').addEventListener('click', handleCloudPull);

  // 加载当前登录态
  loadCloudState();
}

/**
 * 加载云备份登录态
 */
function loadCloudState() {
  chrome.runtime.sendMessage({ action: 'cloudBackup.getState' }, (response) => {
    if (chrome.runtime.lastError) {
      showCloudLoginView();
      return;
    }
    if (response && response.loggedIn) {
      showCloudLoggedView(response);
    } else {
      showCloudLoginView();
    }
  });
}

function showCloudLoginView() {
  cloudLoginView.hidden = false;
  cloudLoggedView.hidden = true;
}

function showCloudLoggedView(state) {
  cloudUserEmail.textContent = state.email || '';
  updateCloudLastBackupTime(state.lastBackupTime);
  cloudLoginView.hidden = true;
  cloudLoggedView.hidden = false;
  refreshCloudBackupList();
}

/**
 * 处理登录
 */
function handleCloudLogin() {
  const email = cloudEmailInput.value.trim();
  const password = cloudPasswordInput.value;

  if (!email || !password) {
    showCloudStatusMessage('请输入邮箱和密码', 'error');
    return;
  }

  const btn = document.getElementById('cloud-login-btn');
  btn.disabled = true;
  btn.textContent = '登录中...';

  chrome.runtime.sendMessage({ action: 'cloudBackup.login', email, password }, (response) => {
    btn.disabled = false;
    btn.textContent = '登录';

    if (response && response.success) {
      showCloudStatusMessage('登录成功', 'success');
      cloudPasswordInput.value = '';
      loadCloudState();
    } else {
      showCloudStatusMessage(`登录失败: ${response?.error || '未知错误'}`, 'error');
    }
  });
}

/**
 * 处理退出登录
 */
function handleCloudLogout() {
  chrome.runtime.sendMessage({ action: 'cloudBackup.logout' }, (response) => {
    if (response && response.success) {
      showCloudStatusMessage('已退出登录', 'success');
      showCloudLoginView();
    }
  });
}

/**
 * 处理云端备份（push）：本地全量存储 → 云端 KV `bro_chat_backup:<尾缀>`
 */
function handleCloudPush() {
  const btn = document.getElementById('cloud-push-btn');
  let suffix = cloudBackupNameInput.value.trim();
  if (!suffix) suffix = generateBackupSuffix();

  btn.disabled = true;
  btn.textContent = '备份中...';

  chrome.runtime.sendMessage({ action: 'cloudBackup.push', suffix }, (response) => {
    btn.disabled = false;
    btn.textContent = '备份到云端';

    if (response && response.success) {
      showCloudStatusMessage(`云端备份成功（${response.suffix || suffix}）`, 'success');
      updateCloudLastBackupTime(response.backupTime);
      cloudBackupNameInput.value = '';
      refreshCloudBackupList();
    } else {
      showCloudStatusMessage(`云端备份失败: ${response?.error || '未知错误'}`, 'error');
    }
  });
}

/**
 * 刷新云端备份下拉列表（前缀扫描 + keysOnly）
 */
function refreshCloudBackupList() {
  cloudBackupList.innerHTML = '<option value="">加载中...</option>';

  chrome.runtime.sendMessage({ action: 'cloudBackup.list' }, (response) => {
    if (chrome.runtime.lastError) {
      cloudBackupList.innerHTML = '<option value="">加载失败</option>';
      return;
    }

    if (response && response.success && response.backups && response.backups.length) {
      cloudBackupList.innerHTML = '';
      // 按尾缀倒序（时间戳命名时新的在前）
      response.backups
        .slice()
        .sort((a, b) => b.suffix.localeCompare(a.suffix))
        .forEach((backup) => {
          const option = document.createElement('option');
          option.value = backup.key;
          option.textContent = backup.suffix;
          cloudBackupList.appendChild(option);
        });
    } else {
      cloudBackupList.innerHTML = '<option value="">暂无云端备份</option>';
    }
  });
}

/**
 * 生成默认备份尾缀（时间戳）：20260807-165530
 */
function generateBackupSuffix() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 处理云端恢复（pull）：覆盖本地存储（危险操作，需二次确认）
 */
function handleCloudPull() {
  const btn = document.getElementById('cloud-pull-btn');
  const key = cloudBackupList.value;
  if (!key) {
    showCloudStatusMessage('请先选择一个云端备份', 'error');
    return;
  }

  // 二次确认
  if (!cloudPullConfirm(btn)) return;

  btn.disabled = true;
  btn.textContent = '恢复中...';

  chrome.runtime.sendMessage({ action: 'cloudBackup.pull', key }, (response) => {
    btn.disabled = false;
    btn.textContent = '从云端恢复';

    if (response && response.success) {
      showCloudStatusMessage(`已从云端恢复 ${response.keyCount} 个存储项`, 'success');
      updateCloudLastBackupTime(response.backupTime);
      // 刷新页面各视图
      loadStorageDebug();
      loadSettings();
      loadLastBackupTime();
      loadStorageSize();
    } else {
      showCloudStatusMessage(`恢复失败: ${response?.error || '未知错误'}`, 'error');
    }
  });
}

/**
 * 危险操作二次确认（云恢复会覆盖本地数据）
 * 首次点击进入待确认态，2.5s 内再次点击才执行。
 */
function cloudPullConfirm(btn) {
  if (btn.dataset.confirmed === 'true') {
    btn.dataset.confirmed = '';
    return true;
  }
  btn.dataset.origText = btn.textContent;
  btn.dataset.confirmed = 'true';
  btn.textContent = '确认覆盖?';
  btn.classList.add('btn-confirm-pending');
  setTimeout(() => {
    if (btn.dataset.confirmed === 'true') {
      btn.dataset.confirmed = '';
      btn.textContent = btn.dataset.origText;
      btn.classList.remove('btn-confirm-pending');
    }
  }, 2500);
  return false;
}

/**
 * 更新云备份时间显示
 */
function updateCloudLastBackupTime(timestamp) {
  if (!timestamp) {
    cloudLastBackupTime.textContent = '从未备份';
    cloudLastBackupTime.classList.add('never');
    return;
  }
  cloudLastBackupTime.classList.remove('never');
  cloudLastBackupTime.textContent = `上次云端备份：${formatDateTime(new Date(timestamp))}`;
}

/**
 * 显示云备份状态消息
 */
function showCloudStatusMessage(message, type = 'success') {
  cloudStatusMessage.textContent = message;
  cloudStatusMessage.className = `status-message show ${type}`;

  setTimeout(() => {
    cloudStatusMessage.classList.remove('show');
  }, 3000);
}

// ==================== 状态消息 ====================

function showStatusMessage(message, type = 'success') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message show ${type}`;

  setTimeout(() => {
    statusMessage.classList.remove('show');
  }, 3000);
}

// ==================== 工具函数 ====================

function getJsonClass(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  initializeStorageDebug();
  initializeCloudBackup();
});
