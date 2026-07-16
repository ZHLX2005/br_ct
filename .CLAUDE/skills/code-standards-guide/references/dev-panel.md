---
name: dev-panel
description: 当用户要在 funcs/ 元素dom/ 下开发"开发阶段调试面板"类脚本（悬浮 UI、hover 高亮元素、click 锁定、悬浮面板展示资源/路径/分析结果）时触发。提供与 div_Img_wrapper.js 一致的 UI 三件套规范、状态机约定、cleanup 资源释放、z-index 选型。
reference: code-standards-guide — 调试面板开发特化指南
---

# 开发阶段开发面板规范

## 适用场景

本 ref 专用于**开发阶段**使用的 DOM 调试面板类脚本，特征是：

- 注入**悬浮 UI 三件套**（overlay 高亮 + tooltip 提示 + container 面板）
- **hover 高亮 + click 锁定**的拾取状态机
- 渲染**资源嗅探 / 路径分析 / 状态诊断**结果到悬浮面板
- 默认只跑一次，关闭后清理所有 DOM 和监听

不属于本 ref 的场景：单纯抓取数据（看 `数据提取` 章节）、纯点击行为（看 `自动化点击` 章节）。

> ⚠️ "开发面板"≠"生产 UI"。面板是**临时调试工具**，不要把这些模式当作生产 UI 组件的设计蓝本。

## 现有面板型脚本参考

| 脚本 | 主要能力 |
|------|---------|
| `funcs/元素dom/div_Img_wrapper.js` | 资源嗅探（图片/链接/媒体）+ 多种选择器复制 |
| `funcs/元素dom/div_input_wrapper.js` | 输入框双向绑定 |
| `funcs/元素dom/dom_find_co_parent.js` | 框选 A/B → LCA / class 共享 / XPath 分离点分析 |
| `funcs/元素dom/dom_visibility_controller.js` | 元素可见性切换 |
| `funcs/元素dom/div_counter.js` | 计数器悬浮面板 |
| `funcs/元素dom/div_changer_wrapper.js` | 元素内容/属性修改 |
| `funcs/元素dom/videoControllerPlane/videoPlane.js` | 视频播放面板 |

## UI 三件套规范（强制）

所有面板型脚本必须创建这三个 DOM 元素，并**严格区分职责**：

```js
// 1. overlay: 当前悬停元素的描边高亮
this.overlay = document.createElement('div');
Object.assign(this.overlay.style, {
  position: 'absolute',
  pointerEvents: 'none',          // 不阻挡鼠标事件
  border: '2px solid #6c757d',
  background: 'rgba(108, 117, 125, 0.2)',
  zIndex: '2147483645',           // 见下文 z-index 选型
  transition: 'all 0.12s ease-in-out'
});
document.body.appendChild(this.overlay);

// 2. tooltip: 跟随鼠标的元素标签提示
this.tooltip = document.createElement('div');
Object.assign(this.tooltip.style, {
  position: 'fixed',
  background: '#212529',
  color: '#f8f9fa',
  fontSize: '12px',
  padding: '6px 10px',
  borderRadius: '6px',
  zIndex: '2147483646',
  pointerEvents: 'none',
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif"
});
document.body.appendChild(this.tooltip);

// 3. container: 悬浮结果面板（始终在右上角）
this.container = document.createElement('div');
Object.assign(this.container.style, {
  position: 'fixed',
  top: '20px',
  right: '20px',
  width: '420px',                 // 标准宽度 420-460px
  maxHeight: '90vh',
  overflowY: 'auto',
  background: '#f8f9fa',
  border: '1px solid #dee2e6',
  borderRadius: '8px',
  padding: '16px',
  zIndex: '2147483647',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  fontSize: '13px',
  color: '#212529',
  lineHeight: '1.5'
});
document.body.appendChild(this.container);
```

### z-index 选型

页面可能存在任何 z-index 的元素（弹出层、广告、模态框）。**不要用 999999**——经常被覆盖。

| 元素 | z-index |
|------|---------|
| overlay | `2147483645` |
| tooltip | `2147483646` |
| container | `2147483647`（32-bit int 上限，确保始终在最顶） |

## 状态机（hover 高亮 + click 锁定）

拾取行为统一为三段状态机：

```js
this.pickState = 'idle';  // idle | pickA | pickB | locked | done
```

### 单段拾取（最常见）

```
idle ──startPicking()──► pick ──click──► locked ──click──► idle (cleanup)
```

### 双段拾取（参考 dom_find_co_parent）

```
idle ──pickA()──► pickA ──click──► pickB ──click──► done
                                       │
                                       └─reset──► pickA
```

### 鼠标事件写法（强制）

```js
// 用箭头函数确保 this 绑定 + 捕获阶段 + cleanup 时能正确移除
this._onMove = (e) => { /* ... */ };
this._onClick = (e) => { /* ... */ };

_startPicking() {
  document.addEventListener('mousemove', this._onMove, true);   // true=捕获
  document.addEventListener('click', this._onClick, true);
}

_stopPicking() {
  document.removeEventListener('mousemove', this._onMove, true);
  document.removeEventListener('click', this._onClick, true);
}
```

> ❌ 错误：把 `_onMove` 写成普通方法 `onMove(e) { this.xxx }`，然后 `document.addEventListener('mousemove', this.onMove)`——回调里 `this` 会丢失。
> ❌ 错误：用 `document.body.addEventListener` 替代 `document`——某些页面的 body 可能被替换或代理事件。

### 忽略工具自身元素（强制）

```js
_onMove = (e) => {
  let el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) {
    return;  // 鼠标在工具自身上,不做拾取
  }
  // ... 正常处理
}

_onClick = (e) => {
  if (this.container.contains(e.target)) return;  // 面板内点击不触发锁定
  e.preventDefault();
  e.stopPropagation();
  // ...
}
```

## 锁定后的视觉区分

拾取阶段（hover）→ 灰色 `#6c757d` / 2px / 半透明背景。
锁定后 → **3px 加粗** + 不同主题色 + 更深背景：

```js
// 拾取态
this.overlay.style.border = '2px solid #6c757d';
this.overlay.style.background = 'rgba(108, 117, 125, 0.2)';

// 锁定态
this.overlay.style.border = '3px solid #495057';
this.overlay.style.background = 'rgba(73, 80, 87, 0.25)';
```

## cleanup 资源释放（强制）

面板型脚本最容易留下**僵尸 DOM 和监听**。`cleanup()` 必须做满这五件事：

```js
cleanup() {
  // 1. 移除所有全局事件监听
  document.removeEventListener('mousemove', this._onMove, true);
  document.removeEventListener('click', this._onClick, true);

  // 2. 移除三件套 DOM
  if (this.overlay) this.overlay.remove();
  if (this.tooltip) this.tooltip.remove();
  if (this.container) this.container.remove();

  // 3. 移除其他可能的高亮标记
  this.highlighted.forEach(el => {
    if (el && el.style) {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }
  });
  this.highlighted = [];

  // 4. 清理实例引用,允许重新注入
  window.__xxxInstance = null;

  // 5. 解绑内容脚本注入的事件(若有)
  // 例如双向绑定、targetElement 的 input 监听
}
```

## 实例防重复（强制）

脚本可能被多次触发（用户刷新 popup 或快捷键）。**第一次执行时检测实例，存在就 cleanup 旧实例再创建新的**：

```js
function main() {
  if (window.__xxxInstance) {
    window.__xxxInstance.cleanup();
  }
  window.__xxxInstance = new XxxClass();
}
```

或者在脚本顶层：

```js
if (window.__xxxInstance) {
  window.__xxxInstance.cleanup();
  window.__xxxInstance = null;
}
```

## 选择器生成工具集（强烈建议复用）

参考 `div_Img_wrapper.js:_generateSelectors()` 的实现，每个面板脚本若涉及"获取当前元素路径"，都建议实现这四种选择器：

| 选择器 | 用途 |
|--------|------|
| `css` | `tag.class#id` 形式，最常用 |
| `jsPath` | `document.querySelector("...")` 形式，可直接粘贴运行 |
| `xpath` | 简版 XPath，从最近有 id 的祖先开始 |
| `fullXPath` | 完整 XPath，从 html 开始逐层 `[n]` |

提供"一键复制所有路径"按钮，统一格式：

```
css:xxx;xpath:xxx;jsPath:xxx;fullXPath:xxx
```

## HTML 转义与高亮标记

面板内经常需要展示元素的 outerHTML 或属性值，**必须 HTML 转义**避免 XSS / 渲染错乱：

```js
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  }[c]));
}
```

展示原始 HTML 结构用 `<pre>` + `textContent`（双层保险）：

```js
const pre = document.getElementById('html-content');
pre.textContent = formattedHTML;  // 不会触发 HTML 解析
```

## 复制反馈约定

所有"复制"按钮点击后必须有 1~2 秒视觉反馈：

```js
_copyToClipboard(text, btn) {
  // 优先用 navigator.clipboard,失败回退到 textarea + execCommand
  // ...
  const orig = btn.innerText;
  btn.innerText = '✓ 已复制';
  btn.style.background = '#218838';
  setTimeout(() => {
    btn.innerText = orig;
    btn.style.background = '';  // 还原 CSS 默认色
  }, 1200);
}
```

## 颜色主题约定

保持与 div_Img_wrapper.js 一致的语义色：

| 用途 | 色值 |
|------|------|
| 拾取 hover | `#6c757d`（灰） |
| 锁定 A | `#007bff`（蓝） |
| 锁定 B | `#28a745`（绿） |
| 关键高亮（命中节点） | `#ff5722`（橙） |
| 成功提示 | `#28a745` 背景 + `#d4edda` 浅色 |
| 失败提示 | `#dc3545` 背景 + `#f8d7da` 浅色 |
| 警告/重置 | `#ffc107`（黄） |
| 关闭 | `#dc3545`（红） |

## 完整骨架（可直接 copy）

```js
/**
 * @fileoverview <一句话，15字以内>
 *
 * @scenario    <适用场景>
 * @feature     <功能简述>
 * @effect      <悬浮面板 + 高亮 + 锁定>
 * @category    DOM创建
 * @platform    通用
 * @entry       main()
 */

(function () {
  'use strict';

  // 防止重复实例
  if (window.__xxxInstance) {
    window.__xxxInstance.cleanup();
  }

  class XxxPanel {
    constructor() {
      this.pickState = 'idle';
      this.highlighted = [];
      this._createUI();
      this._startPicking();
    }

    _createUI() {
      // ... 三件套,见上文
    }

    _onMove = (e) => { /* ... */ };
    _onClick = (e) => { /* ... */ };

    _startPicking() { /* ... */ }
    _stopPicking() { /* ... */ }

    cleanup() {
      this._stopPicking();
      this.highlighted.forEach(el => {
        if (el && el.style) {
          el.style.outline = '';
          el.style.outlineOffset = '';
        }
      });
      this.highlighted = [];
      if (this.overlay) this.overlay.remove();
      if (this.tooltip) this.tooltip.remove();
      if (this.container) this.container.remove();
      window.__xxxInstance = null;
    }
  }

  function main() {
    window.__xxxInstance = new XxxPanel();
    return { success: true };
  }
  main();
})();
```

## 错误案例

| 错误操作 | 实际后果 | 正确做法 |
|---------|---------|---------|
| overlay 设了 `pointerEvents: 'auto'` | 阻挡鼠标事件，无法拾取穿透到下层元素 | 永远设 `'none'` |
| tooltip 用 `position: 'absolute'` 跟随鼠标 | scroll 后定位错位 | 用 `'fixed'`，配合 `e.clientX/Y` |
| z-index 用 999999 | 被页面高 z-index 元素遮挡 | 用 `2147483645~7` 段 |
| 把 `_onMove` 写成普通方法 | `this` 丢失，cleanup 时 removeEventListener 无效 | 用箭头函数赋值 |
| container 的 `container.contains(el)` 判断在 tooltip/overlay 上也生效 | tooltip 显示在自身上时拾取中断 | 单独排除 overlay 和 tooltip |
| cleanup 没移除三件套 | 再次启动出现多个叠加面板 | 三件套全部 `remove()` |
| 把面板脚本当成生产 UI 组件使用 | 难以维护、调试困难、与页面样式冲突 | 面板仅限开发阶段 |

## 何时**不**触发本 ref

- 脚本不创建悬浮 UI（比如 `copy2file.js` 只读剪贴板）→ 看主文档
- 脚本是模态对话框（遮罩整个页面、需要用户输入后才能继续）→ 这是生产 UI，不在本 ref 范围
- 脚本仅做单次数据抓取，无持续 UI → 看主文档"数据提取"类别
