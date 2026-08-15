// promptsUI.js - popup 提示词下拉框（消费 shared 内存快照 + 就地编辑）
import { getCurrentPrompts } from "../../../shared/prompts/promptsStore.js";
import { updatePrompt } from "../../../shared/prompts/promptsEditorApi.js";

/**
 * 把 shared cache (`{group: [{group,label,alias,template}, ...]}`)
 * 扁平化为 composite-keyed map（key = "${group}::${label}"），
 * 供现有渲染逻辑继续按 key 取值。
 *
 * 为什么用 group::label 复合 key: 不同 group 的 prompt 可能共用同一 label
 * （例如 read/trans 与 xxxx_trans/fy 都叫"翻译"），
 * 用裸 label 做 key 会让后写入者覆盖前写入者,导致
 * popup 下拉里看不到部分 alias。复合 key 保证唯一。
 *
 * @returns {{[key: string]: {group: string, label: string, alias: string, template: string}}}
 */
function buildPromptMap() {
  const all = getCurrentPrompts();
  const map = {};
  if (!all) return map;
  for (const group of Object.keys(all)) {
    const items = all[group];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || !item.label) continue;
      const key = `${item.group || group}::${item.label}`;
      map[key] = {
        group: item.group || group,
        label: item.label,
        alias: item.alias || "",
        template: item.template || "",
      };
    }
  }
  return map;
}

/**
 * 填充优化器下拉框（数据源：shared 内存快照，templates 参数已弃用保留签名兼容）。
 * @param {HTMLElement} promptOptimizerSelect - 下拉框元素
 * @param {Object} [templates] - 兼容旧调用方；忽略，统一从 shared 快照取
 */
function populateOptimizer(promptOptimizerSelect, templates) {
  const PROMPT_TEMPLATES = buildPromptMap();
  const optionsContainer = promptOptimizerSelect.querySelector('.custom-select-options');
  const selectedValue = promptOptimizerSelect.querySelector('.selected-value');
  
  // 清空现有选项
  optionsContainer.innerHTML = '';

  // 创建两栏布局容器
  const twoColumnContainer = document.createElement('div');
  twoColumnContainer.className = 'two-column-container';
  
  // 创建左侧分组列表
  const groupList = document.createElement('div');
  groupList.className = 'group-list';
  
  // 创建右侧统一滚动容器：包在 .options-list 外，承担全部滚动职责
  const optionsWrapper = document.createElement('div');
  optionsWrapper.className = 'options-wrapper';

  // 创建右侧选项列表
  const optionsList = document.createElement('div');
  optionsList.className = 'options-list';
  optionsWrapper.appendChild(optionsList);

  // 修改恢复逻辑,改由 mainUtils.loadStoredData 统一从 chrome.storage.sync
  // 读 lastPromptTemplate 并在 populateOptimizer 之后写回 selected-value,
  // 避免此处与 mainUtils 两处分别触发 sync.get 时发生竞态(谁后到谁覆盖 UI)。

  // 获取所有分组
  const groups = {};
  for (const key in PROMPT_TEMPLATES) {
    const group = PROMPT_TEMPLATES[key].group;
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push({
      key,
      ...PROMPT_TEMPLATES[key]
    });
  }

  // 显示指定分组的选项
  function showGroupOptions(groupName) {
    const allOptions = document.querySelectorAll('.group-options');
    allOptions.forEach(container => {
      if(container.dataset.group === groupName) {
        container.style.display = 'block';
        container.classList.add('active');
      } else {
        container.style.display = 'none';
        container.classList.remove('active');
      }
    });

    // 统一重置右侧滚动容器到顶部：旧组滚动位置不该带到新组
    // 注意：真正滚动的是 .options-list（wrapper 只是固定高度的 hidden 隔离层）
    const optionsList = document.querySelector('.options-list');
    if (optionsList) optionsList.scrollTop = 0;
    
    // 更新分组项的active状态
    document.querySelectorAll('.group-item').forEach(item => {
      item.classList.toggle('active', item.textContent === groupName);
    });
    
    // 保存最后选中的分组
    chrome.storage.sync.set({ lastActiveGroup: groupName });
  }

  // 按分组添加选项
  let firstGroup = null;
  // 单一定时器：mouseenter 防抖 200ms，只处理最后一次停留的分组
  // 修复滚动期间光标不动但 group-item 依次滚到光标下时多次触发重排导致视觉抖动
  let hoverTimer = null;
  for (const groupName in groups) {
    const groupItem = document.createElement('div');
    groupItem.className = 'group-item';
    groupItem.textContent = groupName;
    if (!firstGroup) firstGroup = groupName;

    // 视觉态即时切换 active（让用户感觉响应跟手）
    groupItem.addEventListener('mouseenter', () => {
      document.querySelectorAll('.group-item').forEach(item => {
        item.classList.remove('active');
      });
      groupItem.classList.add('active');

      // 重操作（showGroupOptions 内含 display 切换 + chrome.storage.sync.set）：防抖
      // 滚动期间只触发最后一次停留的组，避免右侧列高度反复跳变造成抖动
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        showGroupOptions(groupName);
      }, 200);
    });

    // 鼠标离开立刻清除 pending timer，避免后续 hover 还要等满 200ms
    groupItem.addEventListener('mouseleave', () => clearTimeout(hoverTimer));

    groupList.appendChild(groupItem);
    
    // 为每个分组创建选项容器
    const groupOptions = document.createElement('div');
    groupOptions.className = 'group-options';
    groupOptions.dataset.group = groupName;
    
    groups[groupName].forEach(template => {
      const option = document.createElement('div');
      option.className = 'select-option';
      option.textContent = template.alias ? `${template.label} (/${template.alias})` : template.label;
      option.dataset.value = template.key;
      option.dataset.template = template.template;
      option.dataset.alias = template.alias || '';

      // 就地编辑图标（SVG，hover 时 opacity 0.5 → 1）
      const editIcon = document.createElement('span');
      editIcon.className = 'prompt-edit-icon';
      editIcon.dataset.promptEdit = '';
      editIcon.title = '编辑该提示词';
      editIcon.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>`;
      option.appendChild(editIcon);

      // 注册就地编辑（点 icon → label/alias/template 输入 + 确认/取消）
      bindEditIcon(option, {
        group: template.group,
        label: template.label,
        alias: template.alias || '',
        template: template.template,
      });

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        // 点 edit icon 时不切换选中
        if (e.target.closest('[data-prompt-edit]')) return;
        // 更新选中值的所有数据属性
        selectedValue.textContent = template.label;
        selectedValue.dataset.value = template.key;
        selectedValue.dataset.template = template.template;
        promptOptimizerSelect.classList.remove('active');

        // 只保存模板的key，恢复时从PROMPT_TEMPLATES中获取完整信息
        chrome.storage.sync.set({
          lastPromptTemplate: template.key
        });

        // 触发change事件
        const event = new CustomEvent('change', {
          detail: {
            value: template.key,
            template: template.template,
            label: template.label
          }
        });
        promptOptimizerSelect.dispatchEvent(event);
      });
      
      groupOptions.appendChild(option);
    });
    
    optionsList.appendChild(groupOptions);
  }

  // 装载两栏布局
  twoColumnContainer.appendChild(groupList);
  twoColumnContainer.appendChild(optionsWrapper);
  optionsContainer.appendChild(twoColumnContainer);

  // 初始化显示第一个分组的选项
  if (firstGroup) {
    const firstGroupItem = groupList.querySelector('.group-item');
    firstGroupItem.classList.add('active');
    showGroupOptions(firstGroup);
  }

  // 修改点击事件切换下拉框显示状态
  const onToggleClick = () => {
    const isOpening = !promptOptimizerSelect.classList.contains('active');
    promptOptimizerSelect.classList.toggle('active');

    // 当下拉框打开时，显示对应分组
    if (isOpening) {
      chrome.storage.sync.get(['lastActiveGroup', 'lastPromptTemplate'], (result) => {
        let groupToShow = firstGroup; // 默认显示第一个分组

        if (result.lastPromptTemplate) {
          const savedKey = result.lastPromptTemplate;
          let template = PROMPT_TEMPLATES[savedKey];
          if (!template) {
            // 回退: 旧 storage 格式 (裸 alias 或 裸 label) — 跨组搜
            const all = getCurrentPrompts() || {};
            outer: for (const g of Object.keys(all)) {
              const items = all[g];
              if (!Array.isArray(items)) continue;
              for (const t of items) {
                if ((t.alias && t.alias === savedKey) || t.label === savedKey) {
                  template = { group: t.group || g, label: t.label, alias: t.alias || "", template: t.template || "" };
                  break outer;
                }
              }
            }
          }
          if (template) {
            groupToShow = template.group;
          }
        } else if (result.lastActiveGroup && groups[result.lastActiveGroup]) {
          // 其次使用上次激活的分组
          groupToShow = result.lastActiveGroup;
        }

        showGroupOptions(groupToShow);
      });
    }
  };
  promptOptimizerSelect.addEventListener('click', onToggleClick);

  // 点击外部关闭下拉框（用具名引用以便 teardown removeEventListener）
  // 注：当存在就地编辑中的 row（.inline-editing）时，保留下拉打开——
  // 用户可能想点输入框 / 别处切换焦点，inline edit 的 click 已被 swallow 吞掉，
  // 但外点仍会把下拉关掉，让编辑 UI 消失。先把这种状态放行：用户取消/确认后再走正常关闭。
  const onOutsideClick = (e) => {
    if (e.target?.closest && e.target.closest('#prompt-optimizer-select .select-option.inline-editing')) {
      return;
    }
    if (!promptOptimizerSelect.contains(e.target)) {
      promptOptimizerSelect.classList.remove('active');
    }
  };
  document.addEventListener('click', onOutsideClick);

  // 返回 cleanup：移除本函数注册的所有监听。
  // installOptimizer 通过 prevCleanup() 在重装前清掉旧的,避免切换 -> active 双 toggle。
  return () => {
    promptOptimizerSelect.removeEventListener('click', onToggleClick);
    document.removeEventListener('click', onOutsideClick);
  };
}

/**
 * 初始化输入框的 /alias 快捷触发
 * 用户输入 /alias 时弹出匹配列表，选择后自动切换下拉框模板并删除 /alias
 * @param {HTMLElement} textarea - 消息输入框
 * @param {Object} [templates] - 兼容旧签名；忽略，从 shared 快照取
 * @param {HTMLElement} promptOptimizerSelect - 提示词下拉框容器
 */
function initAliasShortcut(textarea, templates, promptOptimizerSelect) {
  const PROMPT_TEMPLATES = buildPromptMap();
  let popup = null;
  let selectedIndex = -1;
  let matches = [];

  function buildAliasMap() {
    const map = [];
    for (const key in PROMPT_TEMPLATES) {
      const t = PROMPT_TEMPLATES[key];
      if (t.alias) {
        map.push({ alias: t.alias, label: t.label, template: t.template, key });
      }
    }
    return map;
  }

  const aliasMap = buildAliasMap();

  function createPopup() {
    popup = document.createElement('div');
    popup.className = 'alias-popup';
    popup.style.cssText = 'position:fixed;z-index:10000;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);max-height:200px;overflow-y:auto;min-width:200px;display:none;';
    document.body.appendChild(popup);

    popup.addEventListener('click', (e) => {
      const item = e.target.closest('.alias-item');
      if (item) applyAlias(parseInt(item.dataset.index));
    });
  }

  function showPopup() {
    if (!popup) createPopup();
    const rect = textarea.getBoundingClientRect();
    const popupHeight = Math.min(200, popup.scrollHeight || 200);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const popupWidth = 240; // 估算弹窗宽度

    // 水平边界保护
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - popupWidth));
    popup.style.left = left + 'px';
    popup.style.maxHeight = '200px';

    if (spaceBelow >= popupHeight + 8 || spaceBelow >= spaceAbove) {
      // 下方空间充足 → 向下展开
      popup.style.top = (rect.bottom + 4) + 'px';
      popup.style.bottom = 'auto';
    } else {
      // 下方空间不足 → 向上展开
      popup.style.top = 'auto';
      popup.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    }
    popup.style.display = 'block';
  }

  function hidePopup() {
    if (popup) popup.style.display = 'none';
    matches = [];
    selectedIndex = -1;
  }

  function renderMatches() {
    if (!popup) createPopup();
    if (matches.length === 0) { hidePopup(); return; }

    popup.innerHTML = matches.map((m, i) => `
      <div class="alias-item" data-index="${i}" style="padding:8px 12px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;align-items:center;${i === selectedIndex ? 'background:#f0f4ff;' : ''}">
        <span style="color:#4361ee;font-weight:600;">/${m.alias}</span>
        <span style="color:#6b7280;font-size:12px;margin-left:12px;">${m.label}</span>
      </div>
    `).join('');

    popup.querySelectorAll('.alias-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        selectedIndex = parseInt(item.dataset.index);
        renderMatches();
      });
    });

    showPopup();
  }

  function applyAlias(index) {
    if (index < 0 || index >= matches.length) return;
    const match = matches[index];

    // 1. 删除文本中的 /alias
    const value = textarea.value;
    const before = value.substring(0, textarea.selectionStart);
    const slashPos = before.lastIndexOf('/');
    const after = value.substring(textarea.selectionEnd);
    textarea.value = before.substring(0, slashPos) + after;
    textarea.setSelectionRange(slashPos, slashPos);
    textarea.dispatchEvent(new Event('input'));

    // 2. 自动选中下拉框对应的模板
    if (promptOptimizerSelect) {
      const selectedValue = promptOptimizerSelect.querySelector('.selected-value');
      if (selectedValue) {
        selectedValue.textContent = match.label;
        selectedValue.dataset.value = match.key;
        selectedValue.dataset.template = match.template;

        chrome.storage.sync.set({ lastPromptTemplate: match.key });

        const event = new CustomEvent('change', {
          detail: { value: match.key, template: match.template, label: match.label }
        });
        promptOptimizerSelect.dispatchEvent(event);
      }
    }

    hidePopup();
  }

  function getCurrentAliasInput() {
    const pos = textarea.selectionStart;
    const text = textarea.value.substring(0, pos);
    const slashPos = text.lastIndexOf('/');
    if (slashPos === -1) return null;
    const afterSlash = text.substring(slashPos + 1);
    if (afterSlash.length === 0 || afterSlash.length > 15) return null;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(afterSlash)) {
      if (slashPos === 0 || /[\s\n]/.test(text[slashPos - 1])) {
        return afterSlash;
      }
    }
    return null;
  }

  textarea.addEventListener('input', () => {
    const aliasInput = getCurrentAliasInput();
    if (aliasInput === null) { hidePopup(); return; }
    const lower = aliasInput.toLowerCase();
    matches = aliasMap.filter(m => m.alias.toLowerCase().startsWith(lower));
    selectedIndex = 0;
    renderMatches();
  });

  textarea.addEventListener('keydown', (e) => {
    if (!popup || popup.style.display === 'none') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % matches.length;
      renderMatches();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
      renderMatches();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applyAlias(selectedIndex);
    } else if (e.key === 'Escape') {
      hidePopup();
    }
  });

  // 用具名引用以便 teardown removeEventListener
  const onOutsideClick = (e) => {
    if (popup && !popup.contains(e.target) && e.target !== textarea) {
      hidePopup();
    }
  };
  document.addEventListener('click', onOutsideClick);

  // 返回 cleanup：移除 document 级监听 + 移除挂到 document.body 的 alias popup。
  // 由 mainUtils.initializePopup 收集，main.js teardown 调用，避免多次挂载累积 popup 与监听。
  return () => {
    document.removeEventListener('click', onOutsideClick);
    if (popup && popup.parentNode) {
      popup.parentNode.removeChild(popup);
    }
    popup = null;
  };
}

// ============================================================
// 就地编辑（点击 option 内的编辑 icon → 原位变 input/textarea + 确认/取消）
// 仅支持修改现有提示词（label/alias/template）；新增/删除走 options 页 editor。
// ============================================================

/**
 * 把当前 optionEl 内的编辑图标与就地编辑入口绑定。
 * 抽成命名函数以便 restore() 在 innerHTML 重置后重新绑定新生成的 icon。
 * @param {HTMLElement} optionEl - 选项 div（含 data-prompt-edit 的子元素）
 * @param {{group: string, label: string, alias: string, template: string}} currentItem
 */
function bindEditIcon(optionEl, currentItem) {
  const editBtn = optionEl.querySelector('[data-prompt-edit]');
  if (!editBtn) return;
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    startInlineEdit(optionEl, currentItem);
  });
}

/**
 * 把 optionEl 转为编辑态：label/alias/template 三输入 + 确认/取消按钮。
 * 确认按钮 → updatePrompt → 触发 subscribe → 重渲染。
 * @param {HTMLElement} optionEl
 * @param {{group: string, label: string, alias: string, template: string}} currentItem
 */
function startInlineEdit(optionEl, currentItem) {
  // 保存原文，编辑失败/取消时回滚
  const original = optionEl.innerHTML;

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'inline-edit-label';
  labelInput.value = currentItem.label || '';

  const aliasInput = document.createElement('input');
  aliasInput.type = 'text';
  aliasInput.className = 'inline-edit-alias';
  aliasInput.placeholder = '/alias（可空）';
  aliasInput.value = currentItem.alias || '';

  const templateArea = document.createElement('textarea');
  templateArea.className = 'inline-edit-template';
  templateArea.value = currentItem.template || '';

  const actions = document.createElement('div');
  actions.className = 'inline-edit-actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'inline-confirm';
  confirmBtn.textContent = '确认';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'inline-cancel';
  cancelBtn.textContent = '取消';

  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);

  // 清空原内容，挂入编辑控件
  optionEl.innerHTML = '';
  optionEl.appendChild(labelInput);
  optionEl.appendChild(aliasInput);
  optionEl.appendChild(templateArea);
  optionEl.appendChild(actions);
  optionEl.classList.add('inline-editing');

  labelInput.focus();
  labelInput.select();

  // 阻止 click 冒泡到 option / document，避免触发选中切换或外点关闭
  const swallow = (e) => e.stopPropagation();
  optionEl.addEventListener('click', swallow);

  const restore = () => {
    optionEl.innerHTML = original;
    optionEl.classList.remove('inline-editing');
    // innerHTML 重置会替换掉原 edit-icon DOM 节点，原监听随之丢失。
    // 重新绑定新的 edit-icon，使其恢复后可再次点开就地编辑。
    bindEditIcon(optionEl, currentItem);
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
      showInlineError(optionEl, '标题不能为空');
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
      // savePromptFile 已 bump version，subscribe 会触发 prompts:changed → 重渲染
      // 这里不需要手动 restore；重渲染会重建整张下拉框
    } catch (err) {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      showInlineError(optionEl, err && err.message ? err.message : '保存失败');
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
  // 移除旧错误
  const old = host.querySelector('.inline-error');
  if (old) old.remove();
  const e = document.createElement('div');
  e.className = 'inline-error';
  e.textContent = msg;
  host.appendChild(e);
}

// 模块级事件监听：shared cache 更新 → 重渲染下拉框。
// 由 mainUtils.initializePopup 调 loadAllPrompts / subscribeToPrompts 触发 document 上的
// `prompts:changed` 事件，populateOptimizer 重建整张下拉框。
//
// 设计：把外部"重建一次"的入口封装成 installOptimizer，事件触发时调用。
// 注意：重建会调用 populateOptimizer 注册一组新的 outside-click 监听；为避免泄漏，
// 每次重建前先调用上一次安装时记录的 cleanup（由 _optimizerRegistry 维护）。
const _optimizerRegistry = new WeakMap(); // optimizerEl → 上一轮 cleanup

/**
 * 安装/重装提示词下拉框。返回 cleanup（与 populateOptimizer 兼容）。
 * 同一元素多次调用时，先卸掉前一轮的 outside-click 监听再装新监听，避免泄漏。
 * @param {HTMLElement} optimizerEl
 * @returns {() => void} cleanup
 */
function installOptimizer(optimizerEl) {
  if (!optimizerEl || !optimizerEl.isConnected) {
    return () => {};
  }
  const prevCleanup = _optimizerRegistry.get(optimizerEl);
  if (typeof prevCleanup === 'function') {
    try { prevCleanup(); } catch (_) { /* noop */ }
  }
  const cleanup = populateOptimizer(optimizerEl, null);
  _optimizerRegistry.set(optimizerEl, cleanup);
  return cleanup;
}

document.addEventListener('prompts:changed', () => {
  const optimizerEl = document.querySelector('#prompt-optimizer-select');
  if (!optimizerEl) return;
  installOptimizer(optimizerEl);
});

export {
  populateOptimizer,
  initAliasShortcut,
  installOptimizer,
};