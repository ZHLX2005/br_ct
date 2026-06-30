/**
 * @fileoverview DOM元素变化监听面板
 *
 * @scenario    调试时需要监控页面元素的 DOM 变化
 * @feature     悬浮面板，监听并展示目标元素的 DOM 变化日志
 * @effect      在页面注入悬浮监听面板DOM，记录DOM变更
 * @category    DOM创建
 * @platform    通用
 * @entry       自动执行
 */

// dev - 元素相关的监听 

(function () {
  // 防止重复注入
  if (document.getElementById("ai-stream-monitor-panel")) {
    alert("监听面板已存在！");
    return;
  }

  // ==========================================================
  // 状态与变量
  // ==========================================================
  let targetElement = null;
  let observer = null;
  let logCount = 0;
  let isPicking = false;
  let lastHovered = null;

  // ==========================================================
  // 辅助函数：纯 DOM 创建 (安全无 innerHTML)
  // ==========================================================
  function createEl(tag, styles = {}, props = {}) {
    const el = document.createElement(tag);
    Object.assign(el.style, styles);
    Object.assign(el, props);
    return el;
  }

  function appendChildren(parent, ...children) {
    children.forEach(child => {
      if (typeof child === 'string') {
        parent.appendChild(document.createTextNode(child));
      } else if (child) {
        parent.appendChild(child);
      }
    });
  }

  // 简化的节点描述函数，用于日志
  function getNodeDesc(node) {
    if (node.nodeType === 3) { // 文本节点
        const text = node.textContent.trim();
        return text ? `📝文本: "${text.slice(0, 15)}${text.length>15?'...':''}"` : '📝[空文本]';
    }
    if (node.nodeType === 1) { // 元素节点
        let desc = `<${node.tagName.toLowerCase()}`;
        if (node.className && typeof node.className === 'string') {
            desc += `.${node.className.split(' ')[0]}`;
        }
        return desc + '>';
    }
    return node.nodeName;
  }

  // ==========================================================
  // 核心功能：DOM 变动观察者 (增强版)
  // ==========================================================
  function startObserver(element) {
    if (observer) observer.disconnect();

    const logBox = document.getElementById("monitor-logs");
    addLog(`--- 🎯 锁定目标: <${element.tagName.toLowerCase()}> ---`, "#000", true);

    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const timestamp = new Date().toLocaleTimeString().split(' ')[0]; // 只取时间
        
        // 过滤掉面板自身的样式干扰
        if (mutation.attributeName === "style") return;

        const isDirectTarget = mutation.target === element;
        const targetDesc = isDirectTarget ? "主体" : `子元素 ${getNodeDesc(mutation.target)}`;
        
        // --- 1. 属性变化 (Attributes) ---
        if (mutation.type === "attributes") {
          const attrName = mutation.attributeName;
          const oldVal = mutation.oldValue;
          const newVal = mutation.target.getAttribute(attrName);
          
          // 只记录真正变化的值
          if (oldVal !== newVal) {
            const valChange = `"${oldVal || 'null'}" ➔ "${newVal || 'null'}"`;
            const color = "#d35400"; // 橙色
            const prefix = isDirectTarget ? "🔧 [主属性]" : "🔧 [子属性]";
            
            addLog(`[${timestamp}] ${prefix}`, color);
            addLogDetail(`${targetDesc} 的 ${attrName}: ${valChange}`);
          }
        } 
        
        // --- 2. 结构变化 (ChildList) ---
        else if (mutation.type === "childList") {
          // 处理移除的节点
          mutation.removedNodes.forEach(node => {
             addLog(`[${timestamp}] 🔴 [移除]`, "#c0392b"); // 红色
             addLogDetail(`从 ${targetDesc} 移除了: ${getNodeDesc(node)}`);
          });

          // 处理新增的节点
          mutation.addedNodes.forEach(node => {
             addLog(`[${timestamp}] 🟢 [新增]`, "#27ae60"); // 绿色
             addLogDetail(`向 ${targetDesc} 插入了: ${getNodeDesc(node)}`);
          });
        }
      });
      
      // 视觉反馈
      const panel = document.getElementById("ai-stream-monitor-panel");
      if(panel) {
          panel.style.borderColor = "#00ff00";
          setTimeout(() => panel.style.borderColor = "#ccc", 200);
      }
    });

    observer.observe(element, {
      attributes: true,
      childList: true,
      subtree: true,  // 关键：监听所有后代
      attributeOldValue: true // 关键：记录旧值用于对比
    });
  }

  // ==========================================================
  // 日志功能 (支持标题+详情双行显示)
  // ==========================================================
  function addLog(text, color = "black", isBold = false) {
    const logBox = document.getElementById("monitor-logs");
    const div = createEl('div', { 
        marginTop: "6px",
        color: color,
        fontWeight: isBold ? "bold" : "normal",
        fontSize: "12px"
    }, { textContent: `#${++logCount} ${text}` });
    
    logBox.appendChild(div);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function addLogDetail(text) {
    const logBox = document.getElementById("monitor-logs");
    const div = createEl('div', { 
        paddingLeft: "20px",
        color: "#555",
        fontSize: "11px",
        fontFamily: "Consolas, monospace",
        borderBottom: "1px solid #f0f0f0",
        paddingBottom: "4px"
    }, { textContent: text });
    
    logBox.appendChild(div);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // ==========================================================
  // 交互逻辑
  // ==========================================================
  function enablePicking() {
    isPicking = true;
    document.body.style.cursor = "crosshair";
    document.addEventListener("mouseover", hoverHandler);
    document.addEventListener("click", selectHandler, true);
    
    const btn = document.getElementById("btn-pick");
    btn.textContent = "❌ 点击取消选择";
    btn.style.background = "#dc3545";
    document.getElementById("target-status").textContent = "请点击页面上的按钮...";
  }

  function disablePicking() {
    isPicking = false;
    document.body.style.cursor = "default";
    document.removeEventListener("mouseover", hoverHandler);
    document.removeEventListener("click", selectHandler, true);
    
    if (lastHovered) {
      lastHovered.style.outline = "";
      lastHovered = null;
    }

    const btn = document.getElementById("btn-pick");
    if (targetElement) {
        btn.textContent = "🔄 重新选择目标";
        btn.style.background = "#28a745";
    } else {
        btn.textContent = "🎯 选择监听目标";
        btn.style.background = "#007bff";
    }
  }

  function hoverHandler(e) {
    if (document.getElementById("ai-stream-monitor-panel").contains(e.target)) return;
    if (lastHovered) lastHovered.style.outline = "";
    e.target.style.outline = "2px dashed red"; // 虚线区分
    lastHovered = e.target;
  }

  function selectHandler(e) {
    if (document.getElementById("ai-stream-monitor-panel").contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    
    let el = e.target;
    // 智能定位：如果是图标的一部分，优先选父级 Button
    if (['path', 'svg', 'span', 'rect', 'line'].includes(el.tagName.toLowerCase())) {
         const parentBtn = el.closest('button') || el.closest('[role="button"]');
         if (parentBtn) el = parentBtn;
    }
    targetElement = el;

    if (lastHovered) lastHovered.style.outline = "";
    el.style.outline = "";
    disablePicking();

    const status = document.getElementById("target-status");
    const simpleClass = targetElement.className && typeof targetElement.className === 'string' 
        ? "." + targetElement.className.split(" ")[0] 
        : "";
    status.textContent = `🔒 已锁定: <${targetElement.tagName.toLowerCase()}${simpleClass}>`;
    status.style.color = "green";
    status.style.fontWeight = "bold";

    startObserver(targetElement);
  }

  function handleBtnClick() {
    isPicking ? disablePicking() : enablePicking();
  }

  // ==========================================================
  // UI 构建
  // ==========================================================
  (function initUI() {
    const container = createEl('div', {
        position: 'fixed', top: '20px', right: '20px', zIndex: '9999999',
        background: 'rgba(255, 255, 255, 0.98)', border: '1px solid #999', borderRadius: '8px',
        padding: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)', width: '380px', // 加宽一点
        fontFamily: 'sans-serif', fontSize: '12px', color: '#333'
    }, { id: 'ai-stream-monitor-panel' });

    const header = createEl('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' });
    const title = createEl('strong', { fontSize: '14px' }, { textContent: '🕵️‍♂️ DOM 深度监听器 (Pro)' });
    const closeBtn = createEl('button', { background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#999' }, { textContent: '×', id: 'btn-close' });
    appendChildren(header, title, closeBtn);

    const pickBtn = createEl('button', {
        width: '100%', padding: '10px', background: '#007bff', color: 'white', border: 'none',
        cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold', marginBottom: '8px',
        transition: 'background 0.2s'
    }, { textContent: '🎯 选择监听目标', id: 'btn-pick' });

    const statusDiv = createEl('div', {
        marginBottom: '10px', padding: '5px', background: '#f8f9fa', border: '1px solid #eee', borderRadius: '4px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#666'
    }, { textContent: '未选择...', id: 'target-status' });

    const logHeader = createEl('div', { display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '11px', color: '#666' });
    const logLabel = createEl('span', {}, { textContent: '详细变更日志:' });
    const clearLabel = createEl('span', { cursor: 'pointer', color: '#007bff', textDecoration: 'underline' }, { textContent: '清空日志' });
    appendChildren(logHeader, logLabel, clearLabel);

    const logContent = createEl('div', {
        height: '300px', // 增高日志区
        overflowY: 'auto', background: '#fff', border: '1px solid #ddd', borderRadius: '4px', padding: '5px', 
        fontSize: '12px', lineHeight: '1.4'
    }, { id: 'monitor-logs' });

    appendChildren(container, header, pickBtn, statusDiv, logHeader, logContent);
    document.body.appendChild(container);

    pickBtn.addEventListener("click", handleBtnClick);
    closeBtn.addEventListener("click", () => {
        if(observer) observer.disconnect();
        disablePicking();
        container.remove();
    });
    clearLabel.addEventListener("click", () => logContent.replaceChildren());

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isPicking) disablePicking();
    });

    console.log("增强版 DOM 监听器已启动。");
  })();
})();