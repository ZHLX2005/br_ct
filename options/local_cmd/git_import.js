/**
 * Git Skill 导入功能
 * 从 git 仓库导入 skill 到中心仓库
 *
 * 两种模式：
 *   - GitHub API 模式（零 clone）：通过 Trees API + raw.githubusercontent.com 直接下载
 *   - Git Clone 模式（回退）：浅克隆 --depth 1，适用于非 GitHub 仓库
 */

// 打开 Git 导入弹窗
function openGitImportModal() {
  document.getElementById('gitImportModal').classList.add('show');
  document.getElementById('gitImportUrl').value = '';
  document.getElementById('gitImportRef').value = '';
  document.getElementById('gitImportSubpath').value = '';
  document.getElementById('gitImportProgress').style.display = 'none';
  document.getElementById('gitImportResult').innerHTML = '';
  document.getElementById('gitImportList').innerHTML = '';
  document.getElementById('gitImportUrl').focus();
}

function closeGitImportModal() {
  document.getElementById('gitImportModal').classList.remove('show');

  // 如果是 clone 模式且没有导入，通知 native host 清理临时目录
  if (_gitImportContext && _gitImportContext.source === 'git-clone' && _gitImportContext.tempDir) {
    sendNativeMessage({
      command: 'gitCleanupTemp',
      tempDir: _gitImportContext.tempDir,
    }).catch(() => {});
  }
  _gitImportContext = null;
}

// 从 URL 解析可能的 ref（分支/tag）
function parseRefFromUrl(url) {
  const treeMatch = url.match(/tree\/([^/]+)/);
  if (treeMatch) return treeMatch[1];
  const refMatch = url.match(/refs\/heads\/([^/]+)/);
  if (refMatch) return refMatch[1];
  const atMatch = url.match(/@([^/]+)$/);
  if (atMatch) return atMatch[1];
  return '';
}

// 解析 URL 中的 subpath
function parseSubpathFromUrl(url) {
  const treeMatch = url.match(/tree\/[^/]+\/(.+)$/);
  if (treeMatch) return treeMatch[1];
  return '';
}

// 标准化 git URL（提取 owner/repo 部分）
function normalizeGitUrl(url) {
  url = url.replace(/\.git$/, '');
  url = url.replace(/\/tree\/[^/]+(\/.*)?$/, '');
  url = url.replace(/\/refs\/heads\/[^/]+(\/.*)?$/, '');
  return url;
}

// 保存发现结果的上下文（用于后续导入）
let _gitImportContext = null;

// 发现 skills
async function discoverGitSkills() {
  const urlInput = document.getElementById('gitImportUrl');
  const refInput = document.getElementById('gitImportRef');
  const subpathInput = document.getElementById('gitImportSubpath');
  const progress = document.getElementById('gitImportProgress');
  const resultDiv = document.getElementById('gitImportResult');
  const listDiv = document.getElementById('gitImportList');

  let url = urlInput.value.trim();
  if (!url) {
    toast('请输入 Git 仓库地址', 'error');
    return;
  }

  // 自动检测 URL 中的分支和子路径
  const detectedRef = parseRefFromUrl(url);
  const detectedSubpath = parseSubpathFromUrl(url);
  if (detectedRef && !refInput.value.trim()) {
    refInput.value = detectedRef;
  }
  if (detectedSubpath && !subpathInput.value.trim()) {
    subpathInput.value = detectedSubpath;
  }
  // 标准化 URL
  url = normalizeGitUrl(url);
  urlInput.value = url;

  const ref = refInput.value.trim();
  const subpath = subpathInput.value.trim();

  // 显示进度
  progress.style.display = 'flex';
  progress.querySelector('.progress-text').textContent = '正在发现 Skills...';
  resultDiv.innerHTML = '';
  listDiv.innerHTML = '<div class="skill-loading"><div class="spinner"></div></div>';

  try {
    const resp = await sendNativeMessage({
      command: 'gitCloneAndDiscover',
      url: url,
      ref: ref || undefined,
      subpath: subpath || undefined,
    });

    progress.style.display = 'none';

    if (resp.status === 'error') {
      resultDiv.innerHTML = `<div class="result-error">${escapeHtml(resp.message)}</div>`;
      return;
    }

    const data = resp.data;
    const skills = data.skills || [];

    if (skills.length === 0) {
      listDiv.innerHTML = '<div class="skill-empty"><p>该仓库未发现任何 Skill</p></div>';
      return;
    }

    // 保存上下文用于后续导入
    _gitImportContext = {
      source: data.source,           // "github-api" | "git-clone"
      tempDir: data.tempDir || '',    // clone 模式的临时目录
      ownerRepo: data.ownerRepo || '', // API 模式的 owner/repo
      branch: data.branch || '',      // API 模式的分支
      skills: skills,                 // 完整 skill 列表（用于查找 skillDir）
    };

    // 渲染 skill 列表
    renderGitImportList(skills);

    const sourceLabel = data.source === 'github-api' ? 'GitHub API（零 clone）' : 'Git Clone';
    resultDiv.innerHTML = `<div class="result-success">发现 ${skills.length} 个 Skill · via ${sourceLabel}</div>`;

  } catch (err) {
    progress.style.display = 'none';
    resultDiv.innerHTML = `<div class="result-error">${escapeHtml(err.message)}</div>`;
  }
}

// 渲染 Git 导入列表
function renderGitImportList(skills) {
  const listDiv = document.getElementById('gitImportList');
  const selectAll = document.getElementById('gitImportSelectAll');

  listDiv.innerHTML = skills.map(s => `
    <div class="git-import-skill-item">
      <label class="skill-checkbox-label">
        <input type="checkbox" class="git-import-checkbox"
               data-skill-dir="${escapeHtml(s.skillDir)}"
               value="${escapeHtml(s.name)}" checked>
        <span class="skill-name">${escapeHtml(s.name)}</span>
      </label>
      <div class="skill-desc">${escapeHtml(s.description || '(无描述)')}</div>
    </div>
  `).join('');

  if (selectAll) {
    selectAll.onchange = function() {
      listDiv.querySelectorAll('.git-import-checkbox').forEach(cb => cb.checked = this.checked);
    };
  }
}

// 获取选中的 skill（返回 skillDir 列表）
function getSelectedGitImportSkills() {
  const checkboxes = document.querySelectorAll('.git-import-checkbox:checked');
  return Array.from(checkboxes).map(cb => cb.dataset.skillDir || cb.value);
}

// 导入选中的 skills
async function importGitSkills() {
  const centralPath = await loadStorage(STORAGE_KEYS.skillCentralPath);
  if (!centralPath) {
    toast('请先设置中心仓库路径', 'error');
    return;
  }

  const selectedDirs = getSelectedGitImportSkills();
  if (selectedDirs.length === 0) {
    toast('请选择要导入的 Skill', 'error');
    return;
  }

  if (!_gitImportContext) {
    toast('请先发现 Skills', 'error');
    return;
  }

  const ctx = _gitImportContext;
  const progress = document.getElementById('gitImportProgress');
  const resultDiv = document.getElementById('gitImportResult');

  progress.style.display = 'flex';
  progress.querySelector('.progress-text').textContent = ctx.source === 'github-api'
    ? '正在下载文件...'
    : '正在复制文件...';

  try {
    const payload = {
      command: 'gitImportSkills',
      dstParent: centralPath + '/skills',
      names: selectedDirs,
    };

    // 根据模式传递不同参数
    if (ctx.source === 'github-api') {
      payload.ownerRepo = ctx.ownerRepo;
      payload.branch = ctx.branch;
    } else {
      payload.tempDir = ctx.tempDir;
    }

    const resp = await sendNativeMessage(payload);
    progress.style.display = 'none';

    if (resp.status === 'error') {
      resultDiv.innerHTML = `<div class="result-error">${escapeHtml(resp.message)}</div>`;
      return;
    }

    const data = resp.data;
    let msg = '';
    if (data.copied && data.copied.length > 0) {
      msg += `已导入: ${data.copied.join(', ')}`;
    }
    if (data.skipped && data.skipped.length > 0) {
      if (msg) msg += '\n';
      msg += `跳过（已存在且相同）: ${data.skipped.join(', ')}`;
    }
    if (!msg) msg = '导入完成';

    resultDiv.innerHTML = `<div class="result-success">${escapeHtml(msg).replace(/\n/g, '<br>')}</div>`;
    toast(`已导入 ${data.copied?.length || 0} 个 Skill`);

    _gitImportContext = null;
    loadSkills();

    setTimeout(() => closeGitImportModal(), 1500);

  } catch (err) {
    progress.style.display = 'none';
    resultDiv.innerHTML = `<div class="result-error">${escapeHtml(err.message)}</div>`;
  }
}
