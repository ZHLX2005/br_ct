/**
 * 填充优化器下拉框
 * @param {HTMLElement} promptOptimizerSelect - 下拉框元素
 * @param {Object} templates - PROMPT_TEMPLATES 模板对象（可选，默认使用全局）
 */
function populateOptimizer(promptOptimizerSelect, templates) {
  const PROMPT_TEMPLATES = templates || (typeof window !== 'undefined' && window.PROMPT_TEMPLATES) || {};
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
  
  // 创建右侧选项列表
  const optionsList = document.createElement('div');
  optionsList.className = 'options-list';

  // 修改恢复逻辑，同时获取lastPromptTemplate和对应的模板内容
  chrome.storage.sync.get(['lastPromptTemplate'], (result) => {
    if (result.lastPromptTemplate) {
      const template = PROMPT_TEMPLATES[result.lastPromptTemplate];
      if (template) {
        selectedValue.textContent = template.label;
        selectedValue.dataset.value = result.lastPromptTemplate;
        selectedValue.dataset.template = template.template;
      }
    }
  });
  
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
    
    // 更新分组项的active状态
    document.querySelectorAll('.group-item').forEach(item => {
      item.classList.toggle('active', item.textContent === groupName);
    });
    
    // 保存最后选中的分组
    chrome.storage.sync.set({ lastActiveGroup: groupName });
  }

  // 按分组添加选项
  let firstGroup = null;
  for (const groupName in groups) {
    const groupItem = document.createElement('div');
    groupItem.className = 'group-item';
    groupItem.textContent = groupName;
    if (!firstGroup) firstGroup = groupName;
    
    // 使用事件委托来处理hover
    let hoverTimer = null;
    
    groupItem.addEventListener('mouseenter', () => {
      // 清除之前的定时器
      if (hoverTimer) clearTimeout(hoverTimer);
      
      // 立即移除其他active状态
      document.querySelectorAll('.group-item').forEach(item => {
        item.classList.remove('active');
      });
      
      // 立即添加当前active状态
      groupItem.classList.add('active');
      
      // 立即显示对应选项
      showGroupOptions(groupName);
    });
    
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
      
      option.addEventListener('click', (e) => {
        e.stopPropagation();
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
  twoColumnContainer.appendChild(optionsList);
  optionsContainer.appendChild(twoColumnContainer);

  // 初始化显示第一个分组的选项
  if (firstGroup) {
    const firstGroupItem = groupList.querySelector('.group-item');
    firstGroupItem.classList.add('active');
    showGroupOptions(firstGroup);
  }

  // 修改点击事件切换下拉框显示状态
  promptOptimizerSelect.addEventListener('click', () => {
    const isOpening = !promptOptimizerSelect.classList.contains('active');
    promptOptimizerSelect.classList.toggle('active');
    
    // 当下拉框打开时，显示对应分组
    if (isOpening) {
      chrome.storage.sync.get(['lastActiveGroup', 'lastPromptTemplate'], (result) => {
        let groupToShow = firstGroup; // 默认显示第一个分组
        
        if (result.lastPromptTemplate) {
          // 如果有上次选中的模板，优先使用其分组
          const template = PROMPT_TEMPLATES[result.lastPromptTemplate];
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
  });

  // 点击外部关闭下拉框（用具名引用以便 teardown removeEventListener）
  const onOutsideClick = (e) => {
    if (!promptOptimizerSelect.contains(e.target)) {
      promptOptimizerSelect.classList.remove('active');
    }
  };
  document.addEventListener('click', onOutsideClick);

  // 返回 cleanup：移除本函数注册的 document 级监听。
  // 由 mainUtils.initializePopup 收集，main.js teardown 调用。
  return () => {
    document.removeEventListener('click', onOutsideClick);
  };
}

/**
 * 初始化输入框的 /alias 快捷触发
 * 用户输入 /alias 时弹出匹配列表，选择后自动切换下拉框模板并删除 /alias
 * @param {HTMLElement} textarea - 消息输入框
 * @param {Object} templates - PROMPT_TEMPLATES 模板对象
 * @param {HTMLElement} promptOptimizerSelect - 提示词下拉框容器
 */
function initAliasShortcut(textarea, templates, promptOptimizerSelect) {
  const PROMPT_TEMPLATES = templates || {};
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

export { populateOptimizer, initAliasShortcut };