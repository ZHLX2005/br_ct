/**
 * BindDom 执行脚本（注入到页面执行点击）
 * 由 background 命令触发
 */

/**
 * @fileoverview 注入页面执行选择器点击
 *
 * @scenario    由 background 派发 binddom.doClick 消息时触发
 * @feature     按 CSS 选择器定位目标元素并模拟点击
 * @effect      在页面注入 highlight 样式高亮被点元素，返回点击结果
 * @category    自动化点击
 * @platform    通用
 * @entry       (function IIFE)
 */

(function() {
  console.log('[BindDom] 执行脚本已注入');

  // 样式
  const style = document.createElement('style');
  style.textContent = `
    .binddom-highlight {
      position: absolute !important;
      border: 3px solid #22c55e !important;
      background: rgba(34, 197, 94, 0.2) !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
      transition: opacity 0.5s ease-out;
    }
    .binddom-tooltip {
      position: fixed !important;
      left: 50% !important;
      top: 20px !important;
      transform: translateX(-50%) !important;
      background: #22c55e !important;
      color: #fff !important;
      font-size: 14px !important;
      padding: 8px 16px !important;
      border-radius: 8px !important;
      z-index: 2147483648 !important;
      font-family: system-ui, sans-serif !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
      opacity: 1 !important;
      transition: opacity 1s ease-out !important;
    }
  `;
  document.head.appendChild(style);

  // 消息监听
  chrome.runtime.onMessage.addListener((req, _, send) => {
    if (req.action === 'binddom.doClick' && req.selector) {
      const success = clickElement(req.selector);
      send({ success: success });
    }
    return false;
  });

  function clickElement(selectorStr) {
    const selectors = parseSelectors(selectorStr);
    let el = null;
    let usedSelector = null;

    // 1. 先尝试精确选择器
    for (const sel of selectors) {
      el = queryElement(sel);
      if (el && isVisible(el)) {
        usedSelector = sel.value;
        break;
      }
      el = null;
    }

    // 2. 如果精确选择器失败，尝试在范围内查找已绑定点击事件的元素
    if (!el) {
      console.log('[BindDom] 精确选择器未命中，尝试兜底查找...');
      el = findClickableFallback(selectors);
      if (el) {
        usedSelector = '[fallback]';
      }
    }

    if (!el) {
      console.log('[BindDom] 未找到可见元素');
      return false;
    }

    // 可视化高亮
    showHighlight(el);

    // 点击
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      el.click();
      console.log('[BindDom] 点击成功:', usedSelector);
    }, 100);

    return true;
  }

  // 查询单个选择器
  function queryElement(sel) {
    try {
      if (sel.type === 'css') {
        return document.querySelector(sel.value);
      } else if (sel.type === 'xpath') {
        const r = document.evaluate(sel.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return r.singleNodeValue;
      } else if (sel.type === 'id') {
        return document.getElementById(sel.value);
      } else if (sel.type === 'jsPath') {
        const match = sel.value.match(/document\.querySelector\("([^"]+)"\)/);
        if (match) return document.querySelector(match[1]);
      }
    } catch (e) {
      console.log('[BindDom] 选择器出错:', sel.value, e.message);
    }
    return null;
  }

  // 查找点击兜底元素
  function findClickableFallback(selectors) {
    let scope = document.body;

    // 尝试获取第一个能匹配的选择器作为范围
    for (const sel of selectors) {
      const found = queryElement(sel);
      if (found) {
        scope = found;
        break;
      }
    }

    // 在范围内查找所有可能可点击的元素
    const candidates = [];

    // 优先：本身有 onclick 或绑定过事件的元素
    if (hasClickHandler(scope)) {
      candidates.push({ el: scope, score: 100 });
    }

    // 次优：a, button, input 等原生可交互元素
    const interactiveTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
    scope.querySelectorAll(interactiveTags.join(',')).forEach(el => {
      if (isVisible(el)) {
        candidates.push({ el, score: 80 });
      }
    });

    // 次优：有 role 属性的可交互元素
    scope.querySelectorAll('[role="button"], [role="link"], [role="menuitem"]').forEach(el => {
      if (isVisible(el)) {
        candidates.push({ el, score: 70 });
      }
    });

    // 次优：有 onclick 属性的元素
    scope.querySelectorAll('[onclick]').forEach(el => {
      if (isVisible(el)) {
        candidates.push({ el, score: 90 });
      }
    });

    // 次优：可点击的 CSS 样式元素（cursor: pointer）
    scope.querySelectorAll('*').forEach(el => {
      if (isVisible(el)) {
        const style = window.getComputedStyle(el);
        if (style.cursor === 'pointer') {
          candidates.push({ el, score: 30 });
        }
      }
    });

    // 返回最高分的候选人
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0].el;
      console.log('[BindDom] 兜底选择:', best.tagName, best.className || '', 'score:', candidates[0].score);
      return best;
    }

    return null;
  }

  // 检查元素是否有点击处理（通过 EventTarget 检查）
  function hasClickHandler(el) {
    if (!el) return false;

    // 检查 onclick 属性
    if (el.hasAttribute('onclick')) return true;

    // 检查是否有事件监听器（有限制，非 DevTools 环境可能不准）
    try {
      // 尝试通过 onXXX 属性检查
      const onclick = el.getAttribute('onclick');
      if (onclick) return true;

      // 检查父亲链上是否有处理
      let parent = el.parentElement;
      while (parent) {
        if (parent.hasAttribute('onclick')) return true;
        parent = parent.parentElement;
      }
    } catch (e) { }

    return false;
  }

  function parseSelectors(str) {
    if (!str) return [];
    return str.split(';').map(s => s.trim()).filter(s => s).map(s => {
      const idx = s.indexOf(':');
      if (idx > 0) {
        return { type: s.slice(0, idx).trim(), value: s.slice(idx + 1).trim() };
      }
      return { type: 'css', value: s };
    });
  }

  function isVisible(el) {
    if (!el || !document.body.contains(el)) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function showHighlight(el) {
    const rect = el.getBoundingClientRect();
    const highlight = document.createElement('div');
    highlight.className = 'binddom-highlight';
    highlight.style.top = (rect.top + window.scrollY) + 'px';
    highlight.style.left = (rect.left + window.scrollX) + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
    document.body.appendChild(highlight);

    const tooltip = document.createElement('div');
    tooltip.className = 'binddom-tooltip';
    tooltip.textContent = '✓ BindDom 点击成功';
    document.body.appendChild(tooltip);

    setTimeout(() => {
      highlight.style.opacity = '0';
      tooltip.style.opacity = '0';
    }, 500);

    setTimeout(() => {
      highlight.remove();
      tooltip.remove();
    }, 1500);
  }

  // 通知 background 脚本已就绪
  console.log('[BindDom] 执行脚本已加载');
})();
