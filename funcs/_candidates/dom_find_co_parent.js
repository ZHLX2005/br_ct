/**
 * DOM 框选式共同父节点分析器
 *
 * 用法:
 *   1. 在浏览器控制台粘贴本脚本并回车,启动后进入"点选 A"阶段
 *   2. 鼠标悬停高亮任意 DOM 元素,点击锁定为 A
 *   3. 自动进入"点选 B"阶段,再次悬停点击锁定 B
 *   4. 自动分析两条路径的相关性,面板内渲染:
 *      - 公共祖先(LCA)
 *      - 共同 class(最细致优先)
 *      - XPath 分离点(每个层级是否同 tag + 同 class)
 *      - A→LCA / B→LCA 的独有路径片段
 *   5. 点击"渲染分离点全部数组"按钮 → 展开每个分离点的具体 tag/class/nth 详情
 *
 * 再次执行脚本会清理旧实例并重置。
 */
(function () {
  'use strict';

  if (window.__coParentFinderInstance) {
    window.__coParentFinderInstance.cleanup();
  }

  // ----------------------- 路径与 class 工具 -----------------------

  function getElementXPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el === document.body) return '/html/body';
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.nodeType === 1 && sib.tagName === cur.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`);
      cur = cur.parentElement;
    }
    parts.unshift('html[1]');
    return '/' + parts.join('/');
  }

  function getNthOfType(el) {
    if (!el || !el.parentElement) return 1;
    const tag = el.tagName;
    let idx = 1;
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === tag) idx++;
      sib = sib.previousElementSibling;
    }
    return idx;
  }

  function getClassSet(el) {
    if (!el || typeof el.className !== 'string') return [];
    return el.className.trim().split(/\s+/).filter(Boolean);
  }

  // 从 el 向上到 document.documentElement,得到形如
  // [{tag, nth, classes:[]}, ...] (root → leaf)
  function buildPath(el) {
    const segments = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement.parentElement) {
      segments.push({
        tag: cur.tagName.toLowerCase(),
        nth: getNthOfType(cur),
        classes: getClassSet(cur),
        id: cur.id || '',
        element: cur
      });
      if (cur === document.documentElement) break;
      cur = cur.parentElement;
    }
    segments.reverse(); // html → ... → leaf
    return segments;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ----------------------- 相关性分析 -----------------------

  function analyzeCorrelation(pathA, pathB) {
    // pathA / pathB: [{tag, nth, classes, id, element}, ...] (html → leaf)
    const len = Math.min(pathA.length, pathB.length);
    let lcaIndex = -1;
    for (let i = 0; i < len; i++) {
      const a = pathA[i], b = pathB[i];
      if (a.tag !== b.tag) break;
      // 完全相同:tag + class + nth
      if (a.nth === b.nth && sameClasses(a.classes, b.classes) && a.id === b.id) {
        lcaIndex = i;
      } else {
        break;
      }
    }
    const lcaSegment = lcaIndex >= 0 ? pathA[lcaIndex] : null;

    // 分离点:从 LCA 之下一层开始,逐层对比 tag/class/nth
    const separationPoints = [];
    for (let i = lcaIndex + 1; i < len; i++) {
      const a = pathA[i] || null;
      const b = pathB[i] || null;
      separationPoints.push({
        depth: i - lcaIndex,
        a, b,
        sameTag: a && b && a.tag === b.tag,
        sameClasses: a && b && sameClasses(a.classes, b.classes),
        sameNth: a && b && a.nth === b.nth
      });
    }

    // 共同 class(最细致优先):即 LCA 节点的 classes
    const commonClasses = lcaSegment ? lcaSegment.classes.slice() : [];

    // A→LCA / B→LCA 独有路径片段
    const aOnly = pathA.slice(lcaIndex + 1);
    const bOnly = pathB.slice(lcaIndex + 1);

    return {
      lcaIndex,
      lcaSegment,
      separationPoints,
      commonClasses,
      aOnly,
      bOnly
    };
  }

  function sameClasses(a, b) {
    if (a.length !== b.length) return false;
    const sa = new Set(a), sb = new Set(b);
    for (const c of sa) if (!sb.has(c)) return false;
    return true;
  }

  // ----------------------- UI 类 -----------------------

  class CoParentFinder {
    constructor() {
      this.pickState = 'idle'; // idle | pickA | pickB
      this.elementA = null;
      this.elementB = null;
      this.currentHover = null;
      this.highlighted = [];
      this._createUI();
      this._startPicking('pickA');
    }

    _createUI() {
      // 高亮遮罩
      this.overlay = document.createElement('div');
      Object.assign(this.overlay.style, {
        position: 'absolute',
        pointerEvents: 'none',
        border: '2px solid #6c757d',
        background: 'rgba(108, 117, 125, 0.2)',
        zIndex: '2147483645',
        transition: 'all 0.12s ease-in-out'
      });
      document.body.appendChild(this.overlay);

      // 状态提示
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
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        fontWeight: '500',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
      });
      document.body.appendChild(this.tooltip);

      // 面板
      this.container = document.createElement('div');
      Object.assign(this.container.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        width: '460px',
        maxHeight: '92vh',
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
        lineHeight: '1.55'
      });

      this.container.innerHTML = `
        <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;color:#212529;display:flex;align-items:center;gap:8px;">
          <span style="font-size:20px;">🧬</span> DOM 路径相关性分析
        </h2>
        <div id="cpf-status" style="background:#e7f1ff;border-left:3px solid #007bff;padding:10px 12px;border-radius:4px;font-size:13px;color:#084298;margin-bottom:12px;">
          ⏳ 等待框选 <strong>元素 A</strong>...
        </div>

        <div id="cpf-picks" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;"></div>

        <div id="cpf-actions" style="display:flex;gap:8px;margin-bottom:12px;">
          <button id="cpf-reset" style="flex:1;padding:10px;border:1px solid #ffc107;background:#ffc107;color:#212529;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">
            🔄 重新框选
          </button>
          <button id="cpf-render-all" style="flex:1;padding:10px;border:1px solid #6f42c1;background:#6f42c1;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;" disabled>
            📑 渲染分离点全部数组
          </button>
          <button id="cpf-close" style="padding:10px 14px;border:1px solid #dc3545;background:#dc3545;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;">
            ❌
          </button>
        </div>

        <div id="cpf-results"></div>
      `;
      document.body.appendChild(this.container);

      this._bindUIEvents();
    }

    _bindUIEvents() {
      this.container.querySelector('#cpf-reset').onclick = () => {
        this._resetPicks();
      };
      this.container.querySelector('#cpf-render-all').onclick = () => {
        this._renderAllSeparations();
      };
      this.container.querySelector('#cpf-close').onclick = () => this.cleanup();
    }

    // ----------------------- 框选状态机 -----------------------

    _startPicking(state) {
      this.pickState = state; // pickA | pickB
      this._updateStatus();
      document.addEventListener('mousemove', this._onMove, true);
      document.addEventListener('click', this._onClick, true);
    }

    _stopPicking() {
      document.removeEventListener('mousemove', this._onMove, true);
      document.removeEventListener('click', this._onClick, true);
    }

    _onMove = (e) => {
      let el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === this.overlay || el === this.tooltip || (this.container && this.container.contains(el))) {
        return;
      }
      this.currentHover = el;
      const rect = el.getBoundingClientRect();
      this.overlay.style.top = (rect.top + window.scrollY) + 'px';
      this.overlay.style.left = (rect.left + window.scrollX) + 'px';
      this.overlay.style.width = rect.width + 'px';
      this.overlay.style.height = rect.height + 'px';
      const color = this.pickState === 'pickA' ? '#007bff' : '#28a745';
      this.overlay.style.border = `2px solid ${color}`;
      this.overlay.style.background = this.pickState === 'pickA' ? 'rgba(0,123,255,0.2)' : 'rgba(40,167,69,0.2)';

      this.tooltip.style.top = (rect.top - 30) + 'px';
      this.tooltip.style.left = rect.left + 'px';
      this.tooltip.style.background = color;
      const tag = el.tagName.toLowerCase();
      const cls = (typeof el.className === 'string' && el.className.trim())
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      this.tooltip.innerText = `${this.pickState === 'pickA' ? '点击锁定为 A' : '点击锁定为 B'} <${tag}${cls}>`;
    }

    _onClick = (e) => {
      if (this.container && this.container.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      let el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) return;

      if (this.pickState === 'pickA') {
        this.elementA = el;
        this._setOverlayLocked(el, '#007bff');
        this._startPicking('pickB');
      } else if (this.pickState === 'pickB') {
        this.elementB = el;
        this._setOverlayLocked(el, '#28a745');
        this._stopPicking();
        this.pickState = 'done';
        this._updateStatus();
        this._renderPicks();
        this._analyzeAndRender();
      }
    }

    _setOverlayLocked(el, color) {
      const rect = el.getBoundingClientRect();
      this.overlay.style.top = (rect.top + window.scrollY) + 'px';
      this.overlay.style.left = (rect.left + window.scrollX) + 'px';
      this.overlay.style.width = rect.width + 'px';
      this.overlay.style.height = rect.height + 'px';
      this.overlay.style.border = `3px solid ${color}`;
      this.overlay.style.background = color === '#007bff' ? 'rgba(0,123,255,0.25)' : 'rgba(40,167,69,0.25)';
      this.tooltip.style.background = color;
      const tag = el.tagName.toLowerCase();
      this.tooltip.innerText = `✓ 已锁定 ${color === '#007bff' ? 'A' : 'B'} <${tag}>`;
    }

    _updateStatus() {
      const el = this.container.querySelector('#cpf-status');
      if (this.pickState === 'pickA') {
        el.style.background = '#e7f1ff';
        el.style.borderLeftColor = '#007bff';
        el.style.color = '#084298';
        el.innerHTML = '⏳ 等待框选 <strong>元素 A</strong>... (鼠标悬停高亮,点击锁定)';
      } else if (this.pickState === 'pickB') {
        el.style.background = '#d4edda';
        el.style.borderLeftColor = '#28a745';
        el.style.color = '#155724';
        el.innerHTML = '⏳ 等待框选 <strong>元素 B</strong>... (鼠标悬停高亮,点击锁定)';
      } else {
        el.style.background = '#fff3cd';
        el.style.borderLeftColor = '#ffc107';
        el.style.color = '#856404';
        el.innerHTML = '✅ 框选完成,正在分析相关性...';
      }
    }

    _renderPicks() {
      const out = this.container.querySelector('#cpf-picks');
      const renderCard = (label, el, color) => {
        if (!el) return '';
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = (typeof el.className === 'string' && el.className.trim())
          ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
        return `
          <div style="background:#fff;border:1px solid ${color};border-radius:6px;padding:8px 10px;">
            <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:4px;">${label}</div>
            <code style="font-size:11px;color:#212529;word-break:break-all;">&lt;${tag}${id}${cls}&gt;</code>
          </div>
        `;
      };
      out.innerHTML = renderCard('元素 A', this.elementA, '#007bff') + renderCard('元素 B', this.elementB, '#28a745');
    }

    _resetPicks() {
      this._clearHighlight();
      this.elementA = null;
      this.elementB = null;
      this.container.querySelector('#cpf-picks').innerHTML = '';
      this.container.querySelector('#cpf-results').innerHTML = '';
      this.container.querySelector('#cpf-render-all').disabled = true;
      this.overlay.style.display = 'block';
      this.tooltip.style.display = 'block';
      this._startPicking('pickA');
    }

    // ----------------------- 分析与渲染 -----------------------

    _analyzeAndRender() {
      if (!this.elementA || !this.elementB) return;
      this._updateStatus();

      const pathA = buildPath(this.elementA);
      const pathB = buildPath(this.elementB);
      const result = analyzeCorrelation(pathA, pathB);

      // 持久化供"渲染全部"使用
      this._lastAnalysis = { pathA, pathB, result };
      this._clearHighlight();
      this._highlightLCAAndEdges(result);

      const out = this.container.querySelector('#cpf-results');
      out.innerHTML = this._renderAnalysisHTML(result);
      this.container.querySelector('#cpf-render-all').disabled = !result.separationPoints.length;

      this._updateStatusDone(result);
    }

    _updateStatusDone(result) {
      const el = this.container.querySelector('#cpf-status');
      const lca = result.lcaSegment;
      if (!lca) {
        el.style.background = '#f8d7da';
        el.style.borderLeftColor = '#dc3545';
        el.style.color = '#721c24';
        el.innerHTML = '❌ 两条路径在 <code>&lt;html&gt;</code> 之前就分叉了,无法定位公共祖先';
        return;
      }
      el.style.background = '#d4edda';
      el.style.borderLeftColor = '#28a745';
      el.style.color = '#155724';
      el.innerHTML = `✅ 公共祖先定位到 <code>&lt;${escapeHTML(lca.tag)}${lca.id ? '#' + escapeHTML(lca.id) : ''}&gt;</code>,共 ${result.separationPoints.length} 个分离层级`;
    }

    _highlightLCAAndEdges(result) {
      const ids = new Set();
      const colorize = (el, color) => {
        if (!el || !el.style || ids.has(el)) return;
        ids.add(el);
        el.style.outline = `3px solid ${color}`;
        el.style.outlineOffset = '2px';
        this.highlighted.push(el);
      };
      if (result.lcaSegment) colorize(result.lcaSegment.element, '#ff5722');
      result.aOnly.forEach((s) => colorize(s.element, '#007bff'));
      result.bOnly.forEach((s) => colorize(s.element, '#28a745'));
    }

    _clearHighlight() {
      this.highlighted.forEach((el) => {
        if (el && el.style) {
          el.style.outline = '';
          el.style.outlineOffset = '';
        }
      });
      this.highlighted = [];
    }

    _renderAnalysisHTML(result) {
      const lca = result.lcaSegment;
      if (!lca) {
        return `<div style="background:#f8d7da;border-left:3px solid #dc3545;padding:10px 12px;border-radius:4px;color:#721c24;font-size:13px;">
          两条路径没有可识别的公共祖先(在 html 之前就分叉)。
        </div>`;
      }
      const classTags = lca.classes.length
        ? lca.classes.map((c) => `<code style="background:#28a745;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;margin-right:4px;">.${escapeHTML(c)}</code>`).join('')
        : '<em style="color:#6c757d;font-size:12px;">(无 class)</em>';

      const idTag = lca.id ? `<code style="background:#ffc107;color:#212529;padding:2px 6px;border-radius:3px;font-size:11px;">#${escapeHTML(lca.id)}</code>` : '';

      let html = `
        <div style="background:#fff;border:1px solid #28a745;border-left:4px solid #28a745;border-radius:6px;padding:12px;margin-bottom:12px;">
          <div style="font-size:13px;font-weight:600;color:#155724;margin-bottom:6px;">🎯 公共祖先 (LCA)</div>
          <div style="margin-bottom:8px;">
            <code style="background:#f8f9fa;padding:3px 8px;border-radius:4px;font-size:12px;">&lt;${escapeHTML(lca.tag)}${lca.id ? '#' + escapeHTML(lca.id) : ''}${lca.classes.length ? '.' + escapeHTML(lca.classes[0]) : ''}&gt;</code>
            ${idTag}
          </div>
          <div style="font-size:12px;color:#495057;margin-bottom:6px;"><strong>共同 class (最细致优先):</strong></div>
          <div style="margin-bottom:8px;">${classTags}</div>
          <div style="font-size:11px;color:#6c757d;">XPath: <code style="background:#f8f9fa;padding:1px 4px;">${escapeHTML(getElementXPath(lca.element))}</code></div>
          <div style="margin-top:8px;display:flex;gap:6px;">
            <button class="cpf-copy" data-kind="lca-xpath" style="flex:1;padding:6px;border:1px solid #007bff;background:#007bff;color:#fff;border-radius:4px;cursor:pointer;font-size:11px;">复制 LCA XPath</button>
            <button class="cpf-copy" data-kind="lca-class" style="flex:1;padding:6px;border:1px solid #28a745;background:#28a745;color:#fff;border-radius:4px;cursor:pointer;font-size:11px;">复制 class 链</button>
          </div>
        </div>

        <div style="background:#fff;border:1px solid #dee2e6;border-radius:6px;padding:12px;margin-bottom:12px;">
          <div style="font-size:13px;font-weight:600;color:#495057;margin-bottom:8px;">🔀 XPath 分离点 (${result.separationPoints.length} 层)</div>
          <div id="cpf-sep-summary" style="font-size:12px;color:#212529;">
            ${this._renderSeparationSummary(result.separationPoints)}
          </div>
        </div>

        <div style="background:#fff;border:1px solid #dee2e6;border-radius:6px;padding:12px;">
          <div style="font-size:13px;font-weight:600;color:#495057;margin-bottom:8px;">📐 A / B 各自独有路径片段</div>
          <div style="margin-bottom:8px;">
            <span style="display:inline-block;padding:2px 8px;background:#007bff;color:#fff;border-radius:3px;font-size:11px;font-weight:600;margin-right:6px;">A 路径</span>
            <code style="background:#f8f9fa;padding:2px 6px;border-radius:3px;font-size:11px;">${escapeHTML(result.aOnly.map((s) => `${s.tag}[${s.nth}]`).join(' / ') || '(无,直接命中 LCA)')}</code>
          </div>
          <div>
            <span style="display:inline-block;padding:2px 8px;background:#28a745;color:#fff;border-radius:3px;font-size:11px;font-weight:600;margin-right:6px;">B 路径</span>
            <code style="background:#f8f9fa;padding:2px 6px;border-radius:3px;font-size:11px;">${escapeHTML(result.bOnly.map((s) => `${s.tag}[${s.nth}]`).join(' / ') || '(无,直接命中 LCA)')}</code>
          </div>
        </div>
      `;
      // 延迟绑定复制按钮(因为 innerHTML 重写后才存在)
      setTimeout(() => this._bindResultCopyButtons(result), 0);
      return html;
    }

    _renderSeparationSummary(separations) {
      if (!separations.length) {
        return `<div style="color:#28a745;font-size:12px;">✅ A 和 B 在同一精确节点上 — 无分离层级</div>`;
      }
      const rows = separations.map((sp, idx) => {
        const aTag = sp.a ? `<code style="background:#cfe2ff;padding:1px 5px;border-radius:3px;font-size:11px;">&lt;${escapeHTML(sp.a.tag)}[${sp.a.nth}]&gt;</code>` : '<em style="color:#6c757d;">—</em>';
        const bTag = sp.b ? `<code style="background:#d1e7dd;padding:1px 5px;border-radius:3px;font-size:11px;">&lt;${escapeHTML(sp.b.tag)}[${sp.b.nth}]&gt;</code>` : '<em style="color:#6c757d;">—</em>';
        const sameTag = sp.sameTag ? '<span style="color:#28a745;">✓</span>' : '<span style="color:#dc3545;">✗</span>';
        const sameClass = sp.sameClasses ? '<span style="color:#28a745;">✓</span>' : '<span style="color:#dc3545;">✗</span>';
        const sameNth = sp.sameNth ? '<span style="color:#28a745;">✓</span>' : '<span style="color:#dc3545;">✗</span>';
        return `
          <tr style="border-bottom:1px solid #e9ecef;">
            <td style="padding:6px 4px;text-align:center;color:#6c757d;font-size:11px;">${idx + 1}</td>
            <td style="padding:6px 4px;">${aTag}</td>
            <td style="padding:6px 4px;">${bTag}</td>
            <td style="padding:6px 4px;text-align:center;">${sameTag}</td>
            <td style="padding:6px 4px;text-align:center;">${sameClass}</td>
            <td style="padding:6px 4px;text-align:center;">${sameNth}</td>
          </tr>
        `;
      }).join('');

      return `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#f8f9fa;color:#495057;font-size:11px;">
              <th style="padding:6px 4px;text-align:center;">#</th>
              <th style="padding:6px 4px;">A 节点</th>
              <th style="padding:6px 4px;">B 节点</th>
              <th style="padding:6px 4px;text-align:center;">tag</th>
              <th style="padding:6px 4px;text-align:center;">class</th>
              <th style="padding:6px 4px;text-align:center;">nth</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }

    _bindResultCopyButtons(result) {
      const btns = this.container.querySelectorAll('.cpf-copy');
      btns.forEach((btn) => {
        btn.onclick = () => {
          let txt = '';
          if (btn.dataset.kind === 'lca-xpath') txt = getElementXPath(result.lcaSegment.element);
          else if (btn.dataset.kind === 'lca-class') txt = result.lcaSegment.classes.join(' ');
          this._copyToClipboard(txt, btn);
        };
      });
    }

    _renderAllSeparations() {
      if (!this._lastAnalysis) return;
      const { result } = this._lastAnalysis;
      const out = this.container.querySelector('#cpf-results');
      const existing = out.innerHTML;
      const detailed = this._renderSeparationDetail(result);
      out.innerHTML = existing + detailed;
      // 滚动到详细区域
      const detailEl = this.container.querySelector('#cpf-sep-detail');
      if (detailEl) detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 禁用按钮避免重复渲染
      this.container.querySelector('#cpf-render-all').disabled = true;
      this.container.querySelector('#cpf-render-all').innerText = '✓ 已展开';
    }

    _renderSeparationDetail(result) {
      const seps = result.separationPoints;
      if (!seps.length) return '';

      const renderSegment = (seg, side, color) => {
        if (!seg) return `<div style="color:#6c757d;font-style:italic;font-size:11px;">— 路径已到顶 —</div>`;
        const clsTags = seg.classes.length
          ? seg.classes.map((c) => `<code style="background:#e9ecef;padding:1px 4px;border-radius:3px;font-size:10px;margin-right:2px;">.${escapeHTML(c)}</code>`).join('')
          : '<em style="color:#6c757d;font-size:10px;">(无 class)</em>';
        return `
          <div style="background:#fff;border-left:3px solid ${color};padding:6px 8px;margin-bottom:4px;border-radius:4px;">
            <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:2px;">${side} · 层级 ${seg._depth}</div>
            <div style="font-size:11px;color:#212529;margin-bottom:3px;">
              <code style="background:#f8f9fa;padding:1px 5px;border-radius:3px;">&lt;${escapeHTML(seg.tag)}&gt;</code>
              ${seg.id ? `<code style="background:#ffc107;padding:1px 5px;border-radius:3px;">#${escapeHTML(seg.id)}</code>` : ''}
            </div>
            <div style="font-size:10px;color:#6c757d;margin-bottom:3px;">nth-of-type: <strong>${seg.nth}</strong> · xpath: <code style="background:#f8f9fa;padding:1px 4px;">${escapeHTML(seg.tag)}[${seg.nth}]</code></div>
            <div>${clsTags}</div>
          </div>
        `;
      };

      let html = `<div id="cpf-sep-detail" style="background:#fff;border:1px solid #6f42c1;border-radius:6px;padding:12px;margin-top:12px;">
        <div style="font-size:13px;font-weight:600;color:#6f42c1;margin-bottom:10px;">📑 分离点全量详情</div>`;

      seps.forEach((sp, idx) => {
        if (sp.a) sp.a._depth = idx + 1;
        if (sp.b) sp.b._depth = idx + 1;
        const verdictIcon = sp.sameTag && sp.sameClasses && sp.sameNth ? '✅' : '⚠️';
        const verdictColor = sp.sameTag && sp.sameClasses && sp.sameNth ? '#28a745' : '#dc3545';
        html += `
          <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px dashed #dee2e6;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <strong style="color:#495057;font-size:12px;">分离点 #${idx + 1}</strong>
              <span style="background:${verdictColor};color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;">${verdictIcon} ${verdictColor === '#28a745' ? '完全一致' : '存在差异'}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              ${renderSegment(sp.a, 'A 侧', '#007bff')}
              ${renderSegment(sp.b, 'B 侧', '#28a745')}
            </div>
          </div>
        `;
      });

      html += '</div>';
      return html;
    }

    _copyToClipboard(text, btn) {
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
      };
      const after = () => {
        const orig = btn.innerText;
        btn.innerText = '✓ 已复制';
        btn.style.background = '#218838';
        btn.style.borderColor = '#218838';
        setTimeout(() => {
          btn.innerText = orig;
          btn.style.background = btn.dataset._origBg || '';
          btn.style.borderColor = '';
        }, 1200);
      };
      btn.dataset._origBg = btn.style.background;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(after).catch(() => { fallback(); after(); });
      } else {
        fallback();
        after();
      }
    }

    // ----------------------- 清理 -----------------------

    cleanup() {
      this._stopPicking();
      this._clearHighlight();
      if (this.overlay) this.overlay.remove();
      if (this.tooltip) this.tooltip.remove();
      if (this.container) this.container.remove();
      window.__coParentFinderInstance = null;
      console.log('[CoParentFinder] 已关闭');
    }
  }

  window.__coParentFinderInstance = new CoParentFinder();
  console.log('[CoParentFinder] 已启动 — 按提示依次点击 A、B 两个 DOM');
})();
