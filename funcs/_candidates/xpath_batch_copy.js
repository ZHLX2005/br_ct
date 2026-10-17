/**
 * @fileoverview XPath批量复制工具
 *
 * @scenario    需要批量复制同一层级兄弟元素的文字内容
 * @feature     悬浮识别XPath，高亮并列兄弟元素，点击批量复制文本
 * @effect      注入悬浮面板DOM，高亮兄弟元素并复制其文本到剪贴板
 * @category    DOM创建
 * @platform    通用
 * @entry       main()
 */

/**
 * XPath 批量复制工具
 *
 * 功能说明：
 * 1. 悬浮时自动识别目标元素的 XPath 路径
 * 2. 找到所有同级别的兄弟元素
 * 3. 高亮显示所有匹配的元素
 * 4. 点击后批量复制所有元素的文字内容
 *
 * 使用方式：
 * 通过快捷键或扩展功能触发 main() 函数
 */

export async function main() {
  // 状态管理
  const state = {
    highlightedElements: new Set(),
    currentXPath: null,
    siblingElements: [],
    overlay: null,
    tooltip: null,
    infoPanel: null
  };

  // 清理函数
  function cleanup() {
    state.highlightedElements.forEach(el => {
      try {
        el.style.outline = '';
      } catch (e) {}
    });
    state.highlightedElements.clear();

    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }
    if (state.tooltip) {
      state.tooltip.remove();
      state.tooltip = null;
    }
    if (state.infoPanel) {
      state.infoPanel.remove();
      state.infoPanel = null;
    }

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    if (window.__xpathBatchCopyCleanup === cleanup) {
      delete window.__xpathBatchCopyCleanup;
    }

    console.log('[XPath Batch Copy] 已清理');
  }

  // 暴露清理接口
  window.__xpathBatchCopyCleanup = cleanup;

  // 创建高亮覆盖层
  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.border = '2px solid #3b82f6';
    overlay.style.background = 'rgba(59, 130, 246, 0.1)';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '999999';
    overlay.style.transition = 'all 0.1s ease';
    document.body.appendChild(overlay);
    state.overlay = overlay;
  }

  // 创建提示框
  function createTooltip() {
    const tooltip = document.createElement('div');
    tooltip.style.position = 'fixed';
    tooltip.style.background = 'rgba(0, 0, 0, 0.85)';
    tooltip.style.color = 'white';
    tooltip.style.fontSize = '12px';
    tooltip.style.padding = '8px 12px';
    tooltip.style.borderRadius = '6px';
    tooltip.style.zIndex = '1000000';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.fontFamily = 'monospace';
    tooltip.style.maxWidth = '400px';
    tooltip.style.wordBreak = 'break-word';
    document.body.appendChild(tooltip);
    state.tooltip = tooltip;
  }

  // 创建信息面板
  function createInfoPanel() {
    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.top = '10px';
    panel.style.right = '10px';
    panel.style.background = 'rgba(0, 0, 0, 0.9)';
    panel.style.color = 'white';
    panel.style.fontSize = '12px';
    panel.style.padding = '12px';
    panel.style.borderRadius = '8px';
    panel.style.zIndex = '1000001';
    panel.style.pointerEvents = 'none';
    panel.style.maxWidth = '300px';
    panel.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    panel.innerHTML = `
      <div style="margin-bottom: 8px; font-weight: bold; color: #3b82f6;">
        XPath 批量复制
      </div>
      <div style="font-size: 11px; color: #aaa;">
        悬浮识别同级元素<br>
        点击复制全部内容<br>
        按 ESC 退出
      </div>
    `;
    document.body.appendChild(panel);
    state.infoPanel = panel;
  }

  // 生成元素的 XPath
  function generateXPath(element) {
    if (element.id !== '') {
      return `//*[@id="${element.id}"]`;
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let hasFollowingSiblings = false;

      // 检查是否有后续兄弟节点
      let sibling = current.nextSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE) {
          hasFollowingSiblings = true;
          break;
        }
        sibling = sibling.nextSibling;
      }

      // 计算同类型元素的索引
      let siblingSameType = current.previousSibling;
      while (siblingSameType) {
        if (siblingSameType.nodeType === Node.ELEMENT_NODE &&
            siblingSameType.tagName === current.tagName) {
          index++;
        }
        siblingSameType = siblingSameType.previousSibling;
      }

      const tagName = current.tagName.toLowerCase();
      const pathIndex = index > 0 ? `[${index + 1}]` : '';

      parts.unshift(`${tagName}${pathIndex}`);

      // 如果有后续兄弟节点，说明这是最后一个有兄弟的层级
      if (hasFollowingSiblings || current.parentElement === null) {
        break;
      }

      current = current.parentElement;
    }

    return parts.length > 0 ? `/${parts.join('/')}` : null;
  }

  // 根据 XPath 查找所有同级元素
  function findSiblingElements(xpath, baseElement) {
    if (!xpath) return [];

    try {
      // 解析 XPath 获取最后一部分（元素类型和索引）
      const match = xpath.match(/\/([^\/\[\]]+)(\[(\d+)\])?$/);
      if (!match) return [baseElement];

      const tagName = match[1];
      const parent = baseElement.parentElement;

      if (!parent) return [baseElement];

      // 查找所有同类型的子元素
      const siblings = Array.from(parent.children).filter(el =>
        el.tagName.toLowerCase() === tagName
      );

      return siblings.length > 1 ? siblings : [baseElement];
    } catch (e) {
      console.warn('[XPath Batch Copy] 查找兄弟元素失败:', e);
      return [baseElement];
    }
  }

  // 高亮所有匹配的元素
  function highlightElements(elements) {
    // 清除之前的高亮
    state.highlightedElements.forEach(el => {
      try {
        el.style.outline = '';
      } catch (e) {}
    });
    state.highlightedElements.clear();

    // 添加新高亮
    elements.forEach(el => {
      try {
        el.style.outline = '2px solid #3b82f6';
        el.style.outlineOffset = '2px';
        state.highlightedElements.add(el);
      } catch (e) {}
    });
  }

  // 鼠标移动处理
  function onMouseMove(e) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === state.overlay || target === state.tooltip || target === state.infoPanel) {
      return;
    }

    // 跳过我们自己创建的元素
    if (target.style?.zIndex >= 999999) {
      return;
    }

    // 生成 XPath
    const xpath = generateXPath(target);
    if (!xpath) return;

    state.currentXPath = xpath;

    // 查找同级元素
    state.siblingElements = findSiblingElements(xpath, target);

    // 高亮所有匹配元素
    highlightElements(state.siblingElements);

    // 更新主高亮框位置（当前悬停的元素）
    const rect = target.getBoundingClientRect();
    state.overlay.style.top = (rect.top + window.scrollY) + 'px';
    state.overlay.style.left = (rect.left + window.scrollX) + 'px';
    state.overlay.style.width = rect.width + 'px';
    state.overlay.style.height = rect.height + 'px';
    state.overlay.style.display = 'block';

    // 更新提示框
    state.tooltip.style.top = (rect.top + window.scrollY - 50) + 'px';
    state.tooltip.style.left = rect.left + 'px';
    state.tooltip.innerHTML = `
      <div style="color: #3b82f6; font-weight: bold; margin-bottom: 4px;">
        找到 ${state.siblingElements.length} 个元素
      </div>
      <div style="font-size: 10px; color: #aaa; max-width: 300px; overflow: hidden; text-overflow: ellipsis;">
        ${xpath}
      </div>
    `;
  }

  // 复制文本到剪贴板
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // 回退方案
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
      } catch (e) {
        document.body.removeChild(textArea);
        return false;
      }
    }
  }

  // 点击处理
  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (state.siblingElements.length === 0) {
      showNotification('没有找到可复制的元素', 'error');
      return;
    }

    // 收集所有文本
    const texts = state.siblingElements.map(el => {
      let text = (el.innerText || el.textContent || '').trim();
      // 清理文本：合并连续空格和空行
      text = text
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n');
      return text;
    }).filter(text => text.length > 0);

    if (texts.length === 0) {
      showNotification('元素中没有文本内容', 'warning');
      return;
    }

    // 合并文本（每条占一行）
    const combinedText = texts.join('\n---\n');

    // 复制到剪贴板
    const success = await copyToClipboard(combinedText);

    if (success) {
      showNotification(`✓ 已复制 ${texts.length} 个元素的内容`, 'success');
    } else {
      showNotification('复制失败，请重试', 'error');
    }

    // 复制后清理
    setTimeout(() => cleanup(), 1500);
  }

  // 显示通知
  function showNotification(message, type = 'info') {
    const colors = {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6'
    };

    const notification = document.createElement('div');
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.background = colors[type] || colors.info;
    notification.style.color = 'white';
    notification.style.padding = '12px 24px';
    notification.style.borderRadius = '8px';
    notification.style.zIndex = '1000002';
    notification.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    notification.style.fontSize = '14px';
    notification.style.fontWeight = '500';
    notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    notification.style.animation = 'slideDown 0.3s ease';
    notification.textContent = message;

    // 添加动画样式
    if (!document.getElementById('xpath-batch-copy-anim')) {
      const style = document.createElement('style');
      style.id = 'xpath-batch-copy-anim';
      style.textContent = `
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }

  // 键盘事件处理
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      showNotification('已退出 XPath 批量复制模式', 'info');
    }
  }

  // 初始化
  createOverlay();
  createTooltip();
  createInfoPanel();

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  console.log('[XPath Batch Copy] 已启动 - 悬浮识别同级元素，点击批量复制');
  showNotification('XPath 批量复制已启动 - ESC 退出', 'info');

  return {
    success: true,
    message: 'XPath 批量复制工具已启动',
    tip: '悬浮元素查看同级项，点击复制全部内容，按 ESC 退出'
  };
}
