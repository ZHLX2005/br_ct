/**
 * @fileoverview DOM 变化可视化监听器
 *
 * @scenario    在 DevTools Console 手动执行，对任意目标 DOM 节点进行实时观察
 * @feature     悬浮面板+MutationObserver 捕获属性/新增/移除/文本变更
 * @effect      注入悬浮监听面板，实时显示目标元素的 DOM 结构和变化日志
 * @category    DOM创建
 * @platform    通用
 * @entry       IIFE 自动执行
 */

(function () {
  if (document.getElementById("ai-dom-visualizer-root")) {
    alert("监听面板已存在！");
    return;
  }

  // ==========================================================
  // 1. 定义高亮专用的类名和样式
  // ==========================================================
  const HIGHLIGHT_CLASS = 'dv-highlight-active';
  
  const STYLES = `
    /* 高亮专用样式，使用 !important 确保覆盖 */
    .${HIGHLIGHT_CLASS} {
      outline: 2px dashed #0d6efd !important;
      box-shadow: 0 0 15px rgba(13, 110, 253, 0.6) !important;
      z-index: 2147483646; /* 尽量在顶层 */
    }

    #ai-dom-visualizer-root {
      position: fixed; top: 20px; right: 20px; width: 450px; height: 600px;
      background: #242424; color: #e8eaed; z-index: 2147483647;
      border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      display: flex; flex-direction: column; font-family: Consolas, monospace;
      font-size: 12px; border: 1px solid #444; overflow: hidden;
    }
    .dv-header { padding: 10px; background: #333; border-bottom: 1px solid #444; display: flex; justify-content: space-between; align-items: center; }
    .dv-btn { background: #0d6efd; border: none; color: white; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-right: 5px; }
    .dv-btn:hover { background: #0b5ed7; }
    .dv-btn.danger { background: #dc3545; }
    .dv-split-pane { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .dv-tree-view { flex: 1; overflow-y: auto; padding: 10px; background: #202124; border-bottom: 1px solid #444; }
    .dv-tree-node { padding: 2px 0; white-space: nowrap; cursor: pointer; border-radius: 2px; display: flex; align-items: center;}
    .dv-tree-node:hover { background: rgba(255,255,255,0.05); }
    .dv-tree-node.selected { background: #3c4043; outline: 1px solid #5f6368; }
    
    /* 语法高亮 */
    .syn-tag { color: #569cd6; }
    .syn-attr { color: #9cdcfe; margin-left: 4px; }
    .syn-eq { color: #d4d4d4; }
    .syn-val { color: #ce9178; }
    .syn-txt { color: #d4d4d4; }
    
    .dv-logs-header { padding: 5px 10px; background: #2d2d2d; border-bottom: 1px solid #333; font-weight: bold; display: flex; justify-content: space-between; }
    .dv-logs { flex: 1; overflow-y: auto; background: #1e1e1e; padding: 5px; }
    .dv-log-item { padding: 6px; border-bottom: 1px solid #333; margin-bottom: 2px; border-left: 3px solid transparent; }
    .dv-log-item.type-attr { border-left-color: #e67e22; background: rgba(230, 126, 34, 0.1); }
    .dv-log-item.type-add { border-left-color: #2ecc71; background: rgba(46, 204, 113, 0.1); }
    .dv-log-item.type-rem { border-left-color: #e74c3c; background: rgba(231, 76, 60, 0.1); }
    .dv-log-item.type-char { border-left-color: #3498db; background: rgba(52, 152, 219, 0.1); }
    .dv-log-time { color: #888; margin-right: 8px; }
    .dv-log-detail { margin-top: 4px; color: #bbb; word-break: break-all; white-space: pre-wrap; }
    .node-changed { animation: flash-bg 1s ease-out; }
    @keyframes flash-bg { 0% { background: #444; } 100% { background: transparent; } }
  `;

  // 安全 DOM 创建器
  function el(tag, props = {}, children = []) {
    const element = document.createElement(tag);
    Object.keys(props).forEach(key => {
      if (key === 'style' && typeof props[key] === 'object') Object.assign(element.style, props[key]);
      else if (key.startsWith('on')) element.addEventListener(key.substring(2).toLowerCase(), props[key]);
      else if (key === 'className') element.className = props[key];
      else element[key] = props[key];
    });
    children.forEach(child => {
      if (typeof child === 'string') element.appendChild(document.createTextNode(child));
      else if (child instanceof Node) element.appendChild(child);
    });
    return element;
  }

  let state = {
    target: null,
    observer: null,
    nodeMap: new Map(), 
    filterNode: null,
    isPicking: false,
    hoveredEl: null
  };

  function createSyntaxSpan(cls, text) { return el('span', { className: cls, textContent: text }); }

  function renderNodeDOM(node) {
    const wrapper = el('div', { className: 'dv-tree-node' });
    if (node.nodeType === 3) {
      const txt = node.textContent.trim();
      if (!txt) return null;
      wrapper.appendChild(createSyntaxSpan('syn-txt', `"${txt}"`));
      return wrapper;
    }
    if (node.nodeType === 1) {
      const tagName = node.tagName.toLowerCase();
      wrapper.appendChild(createSyntaxSpan('syn-tag', `<${tagName}`));
      Array.from(node.attributes).forEach(attr => {
        // 在显示 DOM 树时，隐藏我们自己注入的高亮类名，避免干扰视觉
        if (attr.name === 'class') {
            const visibleClasses = attr.value.replace(HIGHLIGHT_CLASS, '').trim();
            if(!visibleClasses) return; // 如果只剩下空，就不显示 class 属性了
            wrapper.appendChild(createSyntaxSpan('syn-attr', 'class'));
            wrapper.appendChild(createSyntaxSpan('syn-eq', '='));
            wrapper.appendChild(createSyntaxSpan('syn-val', `"${visibleClasses}"`));
        } else {
            wrapper.appendChild(createSyntaxSpan('syn-attr', attr.name));
            wrapper.appendChild(createSyntaxSpan('syn-eq', '='));
            wrapper.appendChild(createSyntaxSpan('syn-val', `"${attr.value}"`));
        }
      });
      wrapper.appendChild(createSyntaxSpan('syn-tag', '>'));
      return wrapper;
    }
    return null;
  }

  function buildVisualTree(rootRealNode, container, depth = 0) {
    container.replaceChildren();
    function traverse(realNode, parentUI, level) {
      const uiNode = renderNodeDOM(realNode);
      if (!uiNode) return;
      uiNode.style.paddingLeft = `${level * 15}px`;
      
      uiNode.onclick = (e) => { e.stopPropagation(); setFilter(realNode, uiNode); };
      uiNode.onmouseover = (e) => { e.stopPropagation(); highlightRealDOM(realNode); };
      uiNode.onmouseout = () => removeHighlight(realNode);

      state.nodeMap.set(realNode, uiNode);
      parentUI.appendChild(uiNode);

      if (realNode.childNodes && realNode.childNodes.length > 0) {
        realNode.childNodes.forEach(child => traverse(child, parentUI, level + 1));
        if (realNode.nodeType === 1) {
           const closeTag = el('div', { className: 'dv-tree-node', style: { paddingLeft: `${level * 15}px` } }, [
               createSyntaxSpan('syn-tag', `</${realNode.tagName.toLowerCase()}>`)
           ]);
           parentUI.appendChild(closeTag);
        }
      }
    }
    traverse(rootRealNode, container, depth);
  }

  function refreshVisualTree() {
    if (!state.target) return;
    const container = document.getElementById('dv-tree-container');
    const scrollTop = container.scrollTop;
    state.nodeMap.clear();
    buildVisualTree(state.target, container);
    container.scrollTop = scrollTop;
  }

  function setFilter(realNode, uiNode) {
    const allSelected = document.querySelectorAll('.dv-tree-node.selected');
    allSelected.forEach(e => e.classList.remove('selected'));
    
    const statusLabel = document.getElementById('dv-filter-status');
    if (state.filterNode === realNode) {
      state.filterNode = null;
      statusLabel.textContent = '全部日志';
      renderLogs();
    } else {
      state.filterNode = realNode;
      uiNode.classList.add('selected');
      const tagName = realNode.nodeType === 1 ? realNode.tagName.toLowerCase() : '#text';
      statusLabel.textContent = `🔍 仅追踪: <${tagName}>`;
      renderLogs();
    }
  }

  // ==========================================================
  // 核心修复 1: 使用 classList 操作高亮，而非 style
  // ==========================================================
  function highlightRealDOM(node) {
    if (node.nodeType === 1) {
      node.classList.add(HIGHLIGHT_CLASS);
    }
  }

  function removeHighlight(node) {
    // 移除指定节点的高亮
    if (node && node.nodeType === 1) {
        node.classList.remove(HIGHLIGHT_CLASS);
    }
    // 兜底：清理页面上所有残留的高亮（防止快速移动鼠标导致遗漏）
    document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(el => el.classList.remove(HIGHLIGHT_CLASS));
  }

  const logs = [];
  function addLog(type, node, desc) {
    const entry = {
      time: new Date().toLocaleTimeString().split(' ')[0],
      type, node, desc,
      id: Date.now() + Math.random()
    };
    logs.push(entry);
    if (logs.length > 500) logs.shift();
    if (!state.filterNode || state.filterNode === node) appendLogToUI(entry);
    const uiNode = state.nodeMap.get(node);
    if (uiNode) {
        uiNode.classList.remove('node-changed');
        void uiNode.offsetWidth;
        uiNode.classList.add('node-changed');
    }
  }

  function appendLogToUI(entry) {
    const container = document.getElementById('dv-logs-container');
    let typeName = '未知';
    if(entry.type === 'attr') typeName = '🔧 属性';
    if(entry.type === 'add') typeName = '🟢 新增';
    if(entry.type === 'rem') typeName = '🔴 移除';
    if(entry.type === 'char') typeName = '📝 文本';
    let nodeName = entry.node.nodeName.toLowerCase();
    if(entry.node.id) nodeName += `#${entry.node.id}`;

    const row = el('div', { className: `dv-log-item type-${entry.type}` }, [
        el('div', {}, [
            el('span', { className: 'dv-log-time', textContent: `[${entry.time}]` }),
            el('strong', { textContent: typeName }),
            el('span', { style: { opacity: '0.7', marginLeft: '5px' }, textContent: `<${nodeName}>` })
        ]),
        el('div', { className: 'dv-log-detail', textContent: entry.desc })
    ]);
    container.insertBefore(row, container.firstChild);
  }

  function renderLogs() {
    const container = document.getElementById('dv-logs-container');
    container.replaceChildren();
    logs.forEach(entry => {
      if (!state.filterNode || state.filterNode === entry.node) appendLogToUI(entry);
    });
  }

  // ==========================================================
  // 核心修复 2: 在 Observer 中过滤掉高亮 class 引发的变动
  // ==========================================================
  function isInternalHighlightChange(mutation) {
      if (mutation.attributeName !== 'class') return false;

      const oldVal = mutation.oldValue || "";
      const newVal = mutation.target.getAttribute("class") || "";
      
      // 拆分类名数组
      const oldClasses = oldVal.split(/\s+/).filter(Boolean);
      const newClasses = newVal.split(/\s+/).filter(Boolean);

      // 计算差异
      const added = newClasses.filter(c => !oldClasses.includes(c));
      const removed = oldClasses.filter(c => !newClasses.includes(c));

      // 判定：如果新增的或移除的【仅仅】是我们的高亮类，则认为是内部变动
      // 情况A: 仅增加了 HIGHLIGHT_CLASS
      if (added.length === 1 && added[0] === HIGHLIGHT_CLASS && removed.length === 0) return true;
      // 情况B: 仅移除了 HIGHLIGHT_CLASS
      if (removed.length === 1 && removed[0] === HIGHLIGHT_CLASS && added.length === 0) return true;

      return false;
  }

  function startObserver(element) {
    if (state.observer) state.observer.disconnect();
    refreshVisualTree();
    addLog('add', element, '开始监听目标元素...');

    state.observer = new MutationObserver((mutations) => {
      let needsRefresh = false;

      mutations.forEach((m) => {
        // --- 过滤逻辑开始 ---
        if (isInternalHighlightChange(m)) {
            // 这是工具自己产生的高亮变化，直接忽略，不记录日志，不刷新树
            return;
        }
        // --- 过滤逻辑结束 ---

        if (m.type === 'attributes') {
           const oldVal = m.oldValue;
           const newVal = m.target.getAttribute(m.attributeName);
           // 双重检查：如果过滤后值其实没变（某些浏览器怪癖），也不记录
           if (oldVal !== newVal) {
             addLog('attr', m.target, `${m.attributeName}: "${oldVal}" ➔ "${newVal}"`);
             needsRefresh = true;
           }
        } else if (m.type === 'characterData') {
            addLog('char', m.target, `内容变更: "${m.target.textContent.trim().slice(0,30)}..."`);
            needsRefresh = true;
        } else if (m.type === 'childList') {
            m.addedNodes.forEach(n => addLog('add', n, `被插入到 <${m.target.nodeName.toLowerCase()}>`));
            m.removedNodes.forEach(n => addLog('rem', n, `从 <${m.target.nodeName.toLowerCase()}> 移除`));
            needsRefresh = true;
        }
      });

      if (needsRefresh) refreshVisualTree();
    });

    state.observer.observe(element, {
      attributes: true, childList: true, subtree: true, characterData: true, attributeOldValue: true
    });
  }

  function togglePicker() { state.isPicking ? stopPicking() : startPicking(); }
  function startPicking() {
    state.isPicking = true; document.body.style.cursor = 'crosshair';
    const btn = document.getElementById('dv-btn-pick'); btn.textContent = '❌ 取消选择'; btn.classList.add('danger');
    document.addEventListener('mouseover', pickerHover); document.addEventListener('click', pickerClick, true);
  }
  function stopPicking() {
    state.isPicking = false; document.body.style.cursor = '';
    const btn = document.getElementById('dv-btn-pick'); btn.textContent = '🎯 选取目标'; btn.classList.remove('danger');
    removeHighlight(state.hoveredEl);
    document.removeEventListener('mouseover', pickerHover); document.removeEventListener('click', pickerClick, true);
  }
  function pickerHover(e) {
    if (document.getElementById('ai-dom-visualizer-root').contains(e.target)) return;
    // 移除上一个的高亮
    if (state.hoveredEl) removeHighlight(state.hoveredEl);
    state.hoveredEl = e.target;
    // 添加当前高亮
    highlightRealDOM(state.hoveredEl);
  }
  function pickerClick(e) {
    if (document.getElementById('ai-dom-visualizer-root').contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    state.target = e.target;
    stopPicking();
    document.getElementById('dv-target-name').textContent = `<${state.target.tagName.toLowerCase()}>`;
    startObserver(state.target);
  }

  function init() {
    const styleTag = document.createElement('style');
    styleTag.textContent = STYLES;
    document.head.appendChild(styleTag);
    const root = el('div', { id: 'ai-dom-visualizer-root' }, [
        el('div', { className: 'dv-header' }, [
            el('span', { style: { fontWeight: 'bold', color: '#fff' }, textContent: '👁️ DOM 深度透视 (No Loop)' }),
            el('button', { id: 'dv-close-btn', style: { background: 'none', border: 'none', color: '#aaa', fontSize: '16px', cursor: 'pointer' }, textContent: '✕',
                onclick: () => { if(state.observer) state.observer.disconnect(); stopPicking(); removeHighlight(); root.remove(); styleTag.remove(); }
            })
        ]),
        el('div', { style: { padding: '10px', background: '#2d2d2d', borderBottom: '1px solid #444', display: 'flex', gap: '10px', alignItems: 'center' } }, [
            el('button', { id: 'dv-btn-pick', className: 'dv-btn', textContent: '🎯 选取目标', onclick: togglePicker }),
            el('span', { id: 'dv-target-name', style: { color: '#888', flex: '1', overflow: 'hidden' }, textContent: '未选择...' })
        ]),
        el('div', { className: 'dv-split-pane' }, [
            el('div', { id: 'dv-tree-container', className: 'dv-tree-view' }, [ el('div', { style: { color: '#666', textAlign: 'center', paddingTop: '20px' }, textContent: '请先选取页面上的元素' }) ]),
            el('div', { className: 'dv-logs-header' }, [
                el('span', { id: 'dv-filter-status', textContent: '全部日志' }),
                el('span', { style: { fontSize: '10px', cursor: 'pointer', color: '#569cd6', fontWeight: 'normal' }, textContent: '清空', onclick: () => document.getElementById('dv-logs-container').replaceChildren() })
            ]),
            el('div', { id: 'dv-logs-container', className: 'dv-logs' })
        ])
    ]);
    document.body.appendChild(root);
    console.log("DOM 监听器 (Anti-Loop Fixed) 已启动。");
  }
  init();
})();