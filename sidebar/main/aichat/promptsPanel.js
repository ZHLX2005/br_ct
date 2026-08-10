/**
 * sidebar/main/aichat/promptsPanel.js
 *
 * sidebar 独立提示词面板（与 popup 下拉选择器互不引用 DOM/CSS）。
 * 调 shared 数据层 (`promptsStore` + `promptsEditorApi`)，
 * subscribe 监听其他页面（options/popup）修改 → 自动重渲染。
 *
 * 设计要点：
 *   - 类前缀 `sidebar-prompt-*` / `sidebar-inline-*`，与 popup 的 `prompt-edit-icon`
 *     / `inline-edit-*` 命名空间隔离，避免 CSS / DOM 互相干扰。
 *   - 编辑入口用 bindEditIcon 命名函数：innerHTML 重置（取消/Escape）后能
 *     重新绑定新生成的 edit-icon 上的 click 监听（参见 Task 6 fix round 1
 *     同样的 rebind 模式）。
 */
import {
  getCurrentPrompts,
  loadAllPrompts,
  subscribeToPrompts,
} from '../../../shared/prompts/promptsStore.js';
import { updatePrompt } from '../../../shared/prompts/promptsEditorApi.js';

let mounted = false;
let unsub = null;

export async function mountPromptsPanel(container, rootEl) {
  if (mounted) return;
  mounted = true;

  // 启动时拉 disk（幂等；popup/options 已加载也行）。
  await loadAllPrompts().catch(() => {});

  renderInto(container);

  // 订阅：其他页面修改 → 重渲染。
  unsub = subscribeToPrompts(() => {
    if (!mounted) return;
    renderInto(container);
  });
}

export function unmountPromptsPanel() {
  mounted = false;
  if (unsub) { unsub(); unsub = null; }
}

function renderInto(container) {
  container.innerHTML = renderPanel(getCurrentPrompts());
  bindEvents(container);
}

function renderPanel(grouped) {
  const items = [];
  for (const group of Object.keys(grouped || {})) {
    for (const item of grouped[group]) {
      items.push({ ...item });
    }
  }
  return `
    <div class="sidebar-prompts-panel">
      ${items.map((item) => `
        <div class="sidebar-prompt-item" data-label="${esc(item.label)}" data-group="${esc(item.group)}">
          <span class="sidebar-prompt-label">${esc(item.label)}</span>
          <small class="sidebar-prompt-alias">${item.alias ? '/' + esc(item.alias) : ''}</small>
          <svg class="sidebar-prompt-edit" data-prompt-edit width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </div>
      `).join('')}
    </div>
  `;
}

function bindEvents(container) {
  container.querySelectorAll('.sidebar-prompt-item').forEach((itemEl) => {
    const label = itemEl.dataset.label;
    const group = itemEl.dataset.group;
    const all = getCurrentPrompts();
    const cur = (all[group] || []).find((p) => p.label === label);
    if (!cur) return;
    bindEditIcon(itemEl, cur);
  });
}

/**
 * 把 itemEl 内的编辑图标与就地编辑入口绑定。
 * 抽成命名函数以便 restore() 在 innerHTML 重置后重新绑定新生成的 icon。
 * @param {HTMLElement} itemEl
 * @param {{group: string, label: string, alias: string, template: string}} currentItem
 */
function bindEditIcon(itemEl, currentItem) {
  const editBtn = itemEl.querySelector('[data-prompt-edit]');
  if (!editBtn) return;
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    startInlineEdit(itemEl, currentItem);
  });
}

/**
 * 把 itemEl 转为编辑态：label/alias/template 三输入 + 确认/取消按钮。
 * 确认按钮 → updatePrompt → 触发 subscribe → 重渲染。
 */
function startInlineEdit(itemEl, currentItem) {
  const original = itemEl.innerHTML;

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'sidebar-inline-label';
  labelInput.value = currentItem.label || '';

  const aliasInput = document.createElement('input');
  aliasInput.type = 'text';
  aliasInput.className = 'sidebar-inline-alias';
  aliasInput.placeholder = '/alias（可空）';
  aliasInput.value = currentItem.alias || '';

  const templateArea = document.createElement('textarea');
  templateArea.className = 'sidebar-inline-template';
  templateArea.value = currentItem.template || '';

  const actions = document.createElement('div');
  actions.className = 'sidebar-inline-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'sidebar-inline-confirm';
  confirmBtn.textContent = '确认';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'sidebar-inline-cancel';
  cancelBtn.textContent = '取消';

  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);

  itemEl.innerHTML = '';
  itemEl.appendChild(labelInput);
  itemEl.appendChild(aliasInput);
  itemEl.appendChild(templateArea);
  itemEl.appendChild(actions);
  itemEl.classList.add('sidebar-inline-editing');

  labelInput.focus();
  labelInput.select();

  // 阻止 click 冒泡（避免误触发任何外层处理）。
  const swallow = (e) => e.stopPropagation();
  itemEl.addEventListener('click', swallow);

  // restore 抽成函数：cancel / Escape / 错误回滚共用
  // innerHTML 重置会替换掉原 edit-icon DOM 节点，原监听随之丢失
  // → 重新绑定新的 edit-icon，使其恢复后可再次点开就地编辑。
  const restore = () => {
    itemEl.innerHTML = original;
    itemEl.classList.remove('sidebar-inline-editing');
    bindEditIcon(itemEl, currentItem);
  };

  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    restore();
  });

  confirmBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newLabel = labelInput.value.trim();
    const newAlias = aliasInput.value.trim();
    const newTemplate = templateArea.value;
    if (!newLabel) {
      showInlineError(itemEl, '标题不能为空');
      return;
    }
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await updatePrompt({
        group: currentItem.group,
        oldLabel: currentItem.label,
        newLabel,
        newAlias,
        newTemplate,
      });
      // savePromptFile 已 bump version，subscribe 会触发整张面板重渲染；
      // 这里不需要手动 restore。
    } catch (err) {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      showInlineError(itemEl, err && err.message ? err.message : '保存失败');
    }
  });

  // Escape 键取消
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      restore();
      document.removeEventListener('keydown', onKey, true);
    }
  };
  document.addEventListener('keydown', onKey, true);
}

function showInlineError(host, msg) {
  const old = host.querySelector('.sidebar-inline-error');
  if (old) old.remove();
  const e = document.createElement('div');
  e.className = 'sidebar-inline-error';
  e.textContent = msg;
  host.appendChild(e);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}