/**
 * 本地命令管理 - 入口文件（初始化 + 事件分发）
 * 功能模块拆分到 core.js / command.js / git.js / skill.js
 */

document.addEventListener('DOMContentLoaded', init);

function init() {
  setupDelegation();
  checkNativeHost();
  loadCommandList();
  loadGitDirList();
  startGitAutoRefresh();
}

/**
 * 刷新全部 - 重新检测native并刷新Git和Skill状态
 */
async function refreshAll() {
  toast('正在刷新...', 'info');
  await checkNativeHost();
  await loadGitStatus(true);
  await loadSkills();
  toast('刷新完成', 'success');
}

function setupDelegation() {
  // 分组筛选器 change 事件
  document.getElementById('groupFilter')?.addEventListener('change', () => loadSkills());

  document.addEventListener('click', (e) => {
    // Tab 切换
    const tabBtn = e.target.closest('.tab-btn');
    if (tabBtn && tabBtn.dataset.tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tabBtn.classList.add('active');
      const panel = document.getElementById('panel-' + tabBtn.dataset.tab);
      if (panel) panel.classList.add('active');
      if (tabBtn.dataset.tab === 'processes') loadProcesses();
      if (tabBtn.dataset.tab === 'git') loadGitStatus();
      if (tabBtn.dataset.tab === 'skills') { refreshProjectSelect(); loadSkills(); }
      if (tabBtn.dataset.tab === 'envvars') { initEnvvarPanel(); ensureFirstEnvSnapshot(); }
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const pid = parseInt(btn.dataset.pid, 10);

    switch (action) {
      // 命令管理 (command.js)
      case 'add-cmd': openCmdModal(); break;
      case 'execute-cmd': executeCmd(id); break;
      case 'edit-cmd': editCmd(id); break;
      case 'delete-cmd': if (needConfirm(btn)) return; deleteCmd(id); break;

      // 进程管理 (command.js)
      case 'refresh-processes': loadProcesses(); break;
      case 'stop-process': if (needConfirm(btn)) return; stopProcess(pid); break;
      case 'remove-process': removeProcess(pid); break;

      // Git (git.js)
      case 'add-git-dir': openGitDirModal(); break;
      case 'git-refresh': gitRefreshDir(id); break;
      case 'git-pull': gitPullDir(id); break;
      case 'git-push': gitPushDir(id); break;
      case 'git-add-commit-pull': gitAddCommitPush(id); break;
      case 'git-delete': if (needConfirm(btn)) return; deleteGitDir(id); break;
      case 'git-batch-refresh': loadGitStatus(true); break;
      case 'git-batch-pull': batchPull(); break;
      case 'git-batch-push': if (needConfirm(btn)) return; batchPush(); break;

      // Skills (skill.js)
      case 'skill-save-central': saveSkillCentralPath(); break;
      case 'skill-add-project': openSkillProjectModal(); break;
      case 'refresh-all': refreshAll(); break;
      case 'skill-remove-project': if (needConfirm(btn)) return; removeSkillProject(); break;
      case 'skill-import-from-git': importProjectFromGit(); break;
      case 'skill-project-cancel': closeSkillProjectModal(); break;
      case 'skill-project-save': saveSkillProject(); break;
      case 'skill-group-cancel': closeSkillGroupModal(); break;
      case 'skill-group-create': createSkillGroup(); break;
      case 'skill-refresh': loadSkills(); break;
      case 'skill-push': skillPushToCentral(btn.dataset.name); break;
      case 'skill-push-central-to-project': skillPushToProject(btn.dataset.name); break;
      case 'skill-more': toggleSkillMoreDropdown(btn); break;
      case 'skill-sync-to-all': syncSkillToAllProjects(btn.dataset.name); break;
      case 'skill-pull': skillPullFromCentral(btn.dataset.name); break;
      case 'skill-delete-project': deleteSkillProject(btn.dataset.id); break;
      case 'skill-delete-skill': deleteSkillFromProject(btn.dataset.name, btn.dataset.projectId); break;
      case 'skill-filter-change': loadSkills(); break;
      case 'skill-manage-groups': openSkillGroupManageModal(); break;
      case 'skill-create-group': openSkillGroupModal(); break;
      case 'skill-manage-cancel': closeSkillGroupManageModal(); break;
      case 'skill-manage-confirm': batchMoveSkillsFromModal(); break;
      case 'skill-create-group-in-manage': closeSkillGroupManageModal(); openSkillGroupModal(); break;
      case 'skill-select-group': selectManageTargetGroup(btn.dataset.groupId); break;

      // 环境变量 (envvar.js)
      case 'envvar-save-snapshot': saveEnvSnapshot(); break;
      case 'envvar-refresh': initEnvvarPanel(); break;
      case 'envvar-add-user-path': addUserPath(); break;
      case 'envvar-remove-user-path': if (needConfirm(btn)) return; removeUserPath(btn.dataset.path); break;
      case 'envvar-batch-remove-user-path': if (needConfirm(btn)) return; batchRemoveUserPath(); break;
      case 'envvar-add-system-path': addSystemPath(); break;
      case 'envvar-remove-system-path': if (needConfirm(btn)) return; removeSystemPath(btn.dataset.path); break;
      case 'envvar-batch-remove-system-path': if (needConfirm(btn)) return; batchRemoveSystemPath(); break;
      case 'envvar-set-user-var': setUserEnvVar(); break;
      case 'envvar-remove-user-var': if (needConfirm(btn)) return; deleteUserEnvVar(btn.dataset.name); break;
      case 'envvar-batch-remove-user-var': if (needConfirm(btn)) return; batchRemoveUserEnvVar(); break;
      case 'envvar-set-system-var': setSystemEnvVar(); break;
      case 'envvar-remove-system-var': if (needConfirm(btn)) return; deleteSystemEnvVar(btn.dataset.name); break;
      case 'envvar-batch-remove-system-var': if (needConfirm(btn)) return; batchRemoveSystemEnvVar(); break;
      case 'envvar-restore-snapshot': if (needConfirm(btn)) return; restoreEnvSnapshot(btn.dataset.file); break;

      // 弹窗
      case 'cmd-cancel': closeCmdModal(); break;
      case 'cmd-save': saveCmd(); break;
      case 'gitdir-cancel': closeGitDirModal(); break;
      case 'gitdir-save': saveGitDir(); break;
    }
  });

  // 弹窗背景点击关闭
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('show');
      }
    });
  });
}
