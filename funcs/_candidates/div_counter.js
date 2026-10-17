/**
 * @fileoverview DOM 元素计数器
 *
 * @scenario    想知道页面上某类元素一共有多少个（按钮、广告位、列表项等）
 * @feature     悬浮选取 DOM 自动生成 CSS 选择器，统计匹配数量，实时更新
 * @effect      注入一个悬浮计数器面板，显示当前选择器命中的元素数；多个选择器并列展示
 * @category    DOM创建
 * @platform    通用
 * @entry       window.DOMCounter
 */

/**
 * DOM 计数器 (Counter) 类。
 * 输入 CSS 选择器统计匹配数，支持悬浮选取 DOM 生成选择器，追踪并列结构稳定性。
 */

// 清理旧实例
if (window.__counterInstance) {
    window.__counterInstance.cleanup();
    window.__counterInstance = null;
}

window.DOMCounter = class DOMCounter {
    constructor() {
        this.selectors = [];
        this.isPicking = false;
        this._pickedElement = null;
        this._hoveredElement = null;

        this._overlay = this._createOverlay();
        this._tooltip = this._createTooltip();
        this._container = this._createContainer();
        this._render();

        window.__counterInstance = this;
        window.__counterCleanup = this.cleanup.bind(this);
        console.log('[DOMCounter] DOM 计数器已启动');
    }

    // --- UI 创建 ---

    _createOverlay() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute', border: '3px solid #ff6600',
            background: 'rgba(255, 102, 0, 0.4)', pointerEvents: 'none',
            zIndex: '999999', transition: 'all 0.08s ease'
        });
        document.body.appendChild(el);
        return el;
    }

    _createTooltip() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'fixed', background: '#212529', color: '#f8f9fa',
            fontSize: '12px', padding: '5px 9px', borderRadius: '5px',
            zIndex: '1000000', pointerEvents: 'none', fontFamily: "'Segoe UI', system-ui, sans-serif",
            fontWeight: '500', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', whiteSpace: 'nowrap'
        });
        document.body.appendChild(el);
        return el;
    }

    _createContainer() {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'fixed', top: '10px', left: '10px', width: '360px',
            maxHeight: '90vh', overflowY: 'auto', background: '#f8f9fa',
            border: '1px solid #dee2e6', borderRadius: '10px', padding: '14px',
            zIndex: '1000002', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontSize: '14px', color: '#212529', display: 'block', userSelect: 'text', lineHeight: '1.5'
        });
        document.body.appendChild(el);
        return el;
    }

    // --- 工具方法 ---

    _escapeHtml(str) {
        if (typeof str !== 'string') return str;
        const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return str.replace(/[&<>"']/g, c => m[c]);
    }

    /**
     * 生成元素的最佳选择器
     * 优先级：id > 单class > 多class > tag+class > nth-of-type > full path
     */
    _generateSelector(el) {
        if (!el || el === document.body || el === document.documentElement) return null;

        // 1. ID 选择器
        if (el.id && document.getElementById(el.id) === el) {
            return '#' + el.id;
        }

        // 2. 单 class 选择器（取第一个）
        if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\s+/).filter(c => c);
            if (classes.length === 1) {
                return '.' + classes[0];
            }
            // 3. 多 class 选择器（尝试完整组合）
            if (classes.length > 1) {
                const fullClass = classes.map(c => '.' + c).join('');
                if (document.querySelectorAll(fullClass).length === 1) {
                    return fullClass;
                }
                // 取前两个class
                if (classes.length >= 2) {
                    const twoClass = '.' + classes.slice(0, 2).join('.');
                    if (document.querySelectorAll(twoClass).length <= 3) {
                        return twoClass;
                    }
                }
            }
        }

        // 4. tag + class
        const tag = el.tagName.toLowerCase();
        if (el.className && typeof el.className === 'string') {
            const cls0 = el.className.trim().split(/\s+/)[0];
            if (cls0) {
                const sel = tag + '.' + cls0;
                if (document.querySelectorAll(sel).length <= 5) return sel;
            }
        }

        // 5. nth-of-type 路径
        const path = this._getNthPath(el);
        if (path) return path;

        // 6. 备用：属性选择器
        if (el.getAttribute('name')) {
            return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
        }

        return null;
    }

    _getNthPath(el) {
        const parts = [];
        let cur = el;
        while (cur && cur !== document.body && cur.nodeType === 1) {
            const tag = cur.tagName.toLowerCase();
            let idx = 1;
            let sib = cur.previousElementSibling;
            while (sib) { if (sib.tagName === cur.tagName) idx++; sib = sib.previousElementSibling; }
            parts.unshift(tag + ':nth-of-type(' + idx + ')');
            cur = cur.parentElement;
        }
        return parts.join(' > ');
    }

    _getSimplePath(el) {
        const parts = [];
        while (el && el.nodeType === 1 && el !== document.body) {
            let s = el.tagName.toLowerCase();
            if (el.id) { s += '#' + el.id; parts.unshift(s); return parts.join(' > '); }
            if (el.className && typeof el.className === 'string') {
                const cls = el.className.trim().split(/\s+/)[0];
                if (cls) s += '.' + cls;
            }
            parts.unshift(s);
            el = el.parentElement;
        }
        return parts.join(' > ');
    }

    _analyzeSelector(selector) {
        try {
            const nodes = Array.from(document.querySelectorAll(selector));
            const childTagCounts = {}, childClassCounts = {};
            nodes.forEach(node => {
                Array.from(node.children).forEach(child => {
                    const tag = child.tagName.toLowerCase();
                    childTagCounts[tag] = (childTagCounts[tag] || 0) + 1;
                    if (child.className && typeof child.className === 'string') {
                        child.className.trim().split(/\s+/).filter(c => c).forEach(c => {
                            childClassCounts[c] = (childClassCounts[c] || 0) + 1;
                        });
                    }
                });
            });
            return {
                count: nodes.length, nodes,
                tagCounts: Object.entries(childTagCounts).sort((a, b) => b[1] - a[1]),
                classCounts: Object.entries(childClassCounts).sort((a, b) => b[1] - a[1]),
                error: null
            };
        } catch (e) {
            return { count: 0, nodes: [], tagCounts: [], classCounts: [], error: e.message };
        }
    }

    // --- 渲染 ---

    _render() {
        const total = this.selectors.reduce((s, it) => s + it.count, 0);

        let html = `
            <h2 style="font-size: 15px; font-weight: 700; margin: 0 0 12px 0; color: #212529; display: flex; align-items: center; gap: 8px;">
                <span style="background:#6c757d; color:#fff; font-size:11px; padding:2px 7px; border-radius:4px; font-weight:600;">DOM</span>
                并列结构计数器
                <span style="margin-left:auto; font-size:20px; font-weight:800; color:${total > 0 ? '#495057' : '#adb5bd'};">${total}</span>
            </h2>`;

        // 选取模式按钮
        html += `
            <button id="counter-pick-btn" style="width:100%; padding:8px 12px; margin-bottom:10px; border:1px solid ${this.isPicking ? '#1e7e34' : '#ced4da'}; border-radius:6px; background:${this.isPicking ? '#1e7e34' : '#f8f9fa'}; color:${this.isPicking ? '#fff' : '#495057'}; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:6px;"
                onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                ${this.isPicking ? '☑ 选取模式 (点击页面元素)' : '☐ 悬浮选取模式'}
            </button>`;

        // 输入区
        html += `
            <div style="display:flex; gap:8px; margin-bottom:10px;">
                <input type="text" id="counter-input" placeholder="输入 CSS 选择器"
                    style="flex:1; padding:8px 10px; border:1px solid #ced4da; border-radius:6px; font-size:12px; font-family:'Consolas',monospace; outline:none; background:#fff;"
                    onfocus="this.style.borderColor='#6c757d'" onblur="this.style.borderColor='#ced4da'" />
                <button id="counter-add-btn" style="padding:8px 14px; border:1px solid #495057; border-radius:6px; background:#495057; color:#fff; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap;"
                    onmouseover="this.style.background='#343a40'" onmouseout="this.style.background='#495057'">添加</button>
            </div>`;

        if (this.selectors.length > 0) {
            html += `<div style="border-top:1px solid #e9ecef; padding-top:10px;">`;
            this.selectors.forEach((item, idx) => {
                const ok = item.count > 0;
                const c = ok ? '#6a8758' : '#9a4f40';
                const bg = ok ? 'rgba(106,135,88,0.12)' : 'rgba(154,79,64,0.12)';
                html += `
                    <div style="margin-bottom:8px; padding:9px 11px; border:1px solid #dee2e6; border-radius:7px; background:#fff;">
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                            <span style="font-size:12px; font-weight:700; color:${c}; font-family:'Consolas',monospace; word-break:break-all;">${this._escapeHtml(item.selector)}</span>
                            <span style="margin-left:auto; font-size:15px; font-weight:800; color:${c}; background:${bg}; padding:1px 7px; border-radius:10px;">${item.count}</span>
                            <button data-idx="${idx}" class="cnt-del" style="border:none; background:none; color:#9a4f40; font-size:14px; cursor:pointer; padding:0 1px; line-height:1;">✕</button>
                        </div>
                        ${item.error ? `<span style="color:#9a4f40; font-size:11px;">✕ ${this._escapeHtml(item.error)}</span>` : ''}
                        ${ok ? `
                        <div style="font-size:11px; color:#6c757d; display:flex; gap:5px; flex-wrap:wrap; margin-top:4px;">
                            <button class="cnt-expand" data-idx="${idx}" style="border:1px solid #ced4da; border-radius:4px; background:#f8f9fa; color:#495057; font-size:11px; padding:2px 6px; cursor:pointer;">${item.expanded ? '收起' : '详情'}</button>
                            <button class="cnt-highlight" data-idx="${idx}" style="border:1px solid #ced4da; border-radius:4px; background:#f8f9fa; color:#495057; font-size:11px; padding:2px 6px; cursor:pointer;">${item.highlighted ? '取消高亮' : '高亮'}</button>
                            <button class="cnt-copy" data-sel="${this._escapeHtml(item.selector)}" style="border:1px solid #ced4da; border-radius:4px; background:#f8f9fa; color:#495057; font-size:11px; padding:2px 6px; cursor:pointer;">复制</button>
                        </div>
                        ${item.expanded ? this._renderDetail(item) : ''}` : ''}
                    </div>`;
            });
            html += `</div>`;
        } else {
            html += `<div style="text-align:center; padding:16px 8px; color:#adb5bd; font-size:13px;">输入选择器或点击上方按钮开始选取</div>`;
        }

        if (this._highlightedNodes) this._renderHighlight();
        this._container.innerHTML = html;
        this._bindEvents();
    }

    _renderDetail(item) {
        const a = item.analysis || {};
        let html = `<div style="margin-top:8px; border-top:1px solid #e9ecef; padding-top:7px;">`;

        if (a.tagCounts?.length) {
            html += `<div style="margin-bottom:7px;">
                <span style="font-size:11px; font-weight:600; color:#6c757d;">子标签</span>
                <div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:3px;">`;
            a.tagCounts.slice(0, 8).forEach(([t, n]) => {
                html += `<span style="font-size:11px; padding:1px 5px; border-radius:3px; background:#e9ecef; color:#495057; font-family:'Consolas',monospace;">${t}×${n}</span>`;
            });
            html += `</div></div>`;
        }

        if (a.classCounts?.length) {
            html += `<div style="margin-bottom:7px;">
                <span style="font-size:11px; font-weight:600; color:#6c757d;">类名分布</span>
                <div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:3px;">`;
            a.classCounts.slice(0, 14).forEach(([cls, n]) => {
                const unstable = n !== item.count;
                const sty = unstable
                    ? 'background:rgba(184,138,74,0.18);color:#8a6428;border:1px solid rgba(184,138,74,0.35);'
                    : 'background:rgba(106,135,88,0.12);color:#4c6740;border:1px solid rgba(106,135,88,0.3);';
                html += `<span style="font-size:11px; padding:1px 5px; border-radius:3px; ${sty} font-family:'Consolas',monospace; cursor:pointer;" class="cnt-add-cls" data-cls="${cls}">${cls}×${n}${unstable?' ⚠':''}</span>`;
            });
            html += `</div></div>`;
        }

        if (a.nodes?.length) {
            html += `<div>
                <span style="font-size:11px; font-weight:600; color:#6c757d;">路径 (前${Math.min(5, a.nodes.length)})</span>
                <div style="margin-top:3px;">`;
            a.nodes.slice(0, 5).forEach((node, i) => {
                const path = this._getSimplePath(node);
                html += `<div style="font-size:10px; color:#6c757d; font-family:'Consolas',monospace; padding:1px 0; border-bottom:1px solid #f8f9fa; word-break:break-all; opacity:${1-i*0.15};">[${i+1}] ${this._escapeHtml(path)}</div>`;
            });
            if (a.nodes.length > 5) html += `<div style="font-size:11px; color:#adb5bd; font-style:italic;">+ 还有 ${a.nodes.length-5} 个</div>`;
            html += `</div></div>`;
        }

        html += `</div>`;
        return html;
    }

    _renderHighlight() {
        document.querySelectorAll('.cnt-hl-overlay').forEach(e => e.remove());
        if (!this._highlightedNodes) return;
        this._highlightedNodes.forEach(node => {
            const r = node.getBoundingClientRect();
            if (!r.width && !r.height) return;
            const ov = document.createElement('div');
            ov.className = 'cnt-hl-overlay';
            Object.assign(ov.style, {
                position: 'absolute', top: (r.top + window.scrollY) + 'px',
                left: (r.left + window.scrollX) + 'px',
                width: r.width + 'px', height: r.height + 'px',
                border: '3px solid #27ae60', background: 'rgba(39, 174, 96, 0.4)',
                pointerEvents: 'none', zIndex: '1000001', boxSizing: 'border-box'
            });
            document.body.appendChild(ov);
        });
        // 监听滚动，实时更新位置
        if (!this._scrollHandler) {
            this._scrollHandler = () => this._renderHighlight();
            window.addEventListener('scroll', this._scrollHandler, true);
        }
    }

    _removeHighlight() {
        document.querySelectorAll('.cnt-hl-overlay').forEach(e => e.remove());
        if (this._scrollHandler) {
            window.removeEventListener('scroll', this._scrollHandler, true);
            this._scrollHandler = null;
        }
    }

    // --- 事件 ---

    _bindEvents() {
        const input = document.getElementById('counter-input');
        const addBtn = document.getElementById('counter-add-btn');
        const pickBtn = document.getElementById('counter-pick-btn');

        if (pickBtn) {
            pickBtn.onclick = () => {
                this.isPicking = !this.isPicking;
                this._updatePicking();
                this._render();
            };
        }

        if (addBtn && input) {
            addBtn.onclick = () => this._add(input.value);
            input.onkeydown = e => { if (e.key === 'Enter') this._add(input.value); };
        }

        document.querySelectorAll('.cnt-del').forEach(btn => {
            btn.onclick = () => {
                const i = +btn.dataset.idx;
                if (this.selectors[i]?.highlighted) {
                    this._removeHighlight();
                    this._highlightedNodes = null;
                }
                this.selectors.splice(i, 1);
                this._render();
            };
        });

        document.querySelectorAll('.cnt-expand').forEach(btn => {
            btn.onclick = () => {
                const i = +btn.dataset.idx;
                this.selectors[i].expanded = !this.selectors[i].expanded;
                this._render();
            };
        });

        document.querySelectorAll('.cnt-highlight').forEach(btn => {
            btn.onclick = () => {
                const i = +btn.dataset.idx;
                if (this.selectors[i].highlighted) {
                    this.selectors[i].highlighted = false;
                    this._removeHighlight();
                    this._highlightedNodes = null;
                } else {
                    this.selectors.forEach(s => s.highlighted = false);
                    this._removeHighlight();
                    this.selectors[i].highlighted = true;
                    this._highlightedNodes = this.selectors[i].analysis?.nodes || [];
                    this._renderHighlight();
                }
                this._render();
            };
        });

        document.querySelectorAll('.cnt-copy').forEach(btn => {
            btn.onclick = () => {
                const sel = btn.dataset.sel;
                navigator.clipboard.writeText(sel).then(() => {
                    const orig = btn.innerText;
                    btn.innerText = '✓';
                    btn.style.color = '#1e7e34';
                    setTimeout(() => { btn.innerText = orig; btn.style.color = '#495057'; }, 1200);
                });
            };
        });

        document.querySelectorAll('.cnt-add-cls').forEach(span => {
            span.onclick = () => this._add('.' + span.dataset.cls);
        });
    }

    _updatePicking() {
        if (this.isPicking) {
            document.addEventListener('mousemove', this._onMove, true);
            document.addEventListener('click', this._onClick, true);
            this._overlay.style.display = 'block';
            this._tooltip.style.display = 'block';
        } else {
            document.removeEventListener('mousemove', this._onMove, true);
            document.removeEventListener('click', this._onClick, true);
            this._overlay.style.display = 'none';
            this._tooltip.style.display = 'none';
        }
    }

    _onMove = e => {
        let el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === this._overlay || el === this._tooltip || this._container.contains(el)) {
            el = this._hoveredElement;
        }
        if (!el) return;
        this._hoveredElement = el;

        const r = el.getBoundingClientRect();
        Object.assign(this._overlay.style, {
            top: (r.top + scrollY) + 'px', left: (r.left + scrollX) + 'px',
            width: r.width + 'px', height: r.height + 'px'
        });
        const sel = this._generateSelector(el);
        this._tooltip.innerHTML = sel
            ? `<span style="color:#adb5bd;font-size:11px;">选择器: </span><span style="font-family:'Consolas',monospace;">${this._escapeHtml(sel)}</span>`
            : `<span style="color:#adb5bd;">无选择器</span>`;
        this._tooltip.style.top = (r.top - 26) + 'px';
        this._tooltip.style.left = Math.max(4, r.left) + 'px';
    };

    _onClick = e => {
        if (this._container.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const el = this._hoveredElement;
        if (!el) return;
        const sel = this._generateSelector(el);
        if (sel) {
            this._add(sel);
            // 自动停止选取模式
            this.isPicking = false;
            this._updatePicking();
        }
    };

    // --- 核心操作 ---

    _add(raw) {
        const selector = raw.trim();
        if (!selector) return;
        if (this.selectors.some(s => s.selector === selector)) {
            const input = document.getElementById('counter-input');
            if (input) { input.style.borderColor = '#9a4f40'; input.placeholder = '已存在'; setTimeout(() => { input.style.borderColor = ''; input.placeholder = '输入 CSS 选择器'; }, 1200); }
            return;
        }
        const r = this._analyzeSelector(selector);
        this.selectors.push({
            selector, count: r.count, error: r.error,
            expanded: false, highlighted: false,
            analysis: { tagCounts: r.tagCounts, classCounts: r.classCounts, nodes: r.nodes }
        });
        this._render();
    }

    cleanup() {
        this.isPicking = false;
        document.removeEventListener('mousemove', this._onMove, true);
        document.removeEventListener('click', this._onClick, true);
        this._removeHighlight();
        this._overlay.remove();
        this._tooltip.remove();
        this._container.remove();
        window.__counterInstance = null;
        window.__counterCleanup = undefined;
        console.log('[DOMCounter] 已关闭');
    }
};

// 直接执行：创建实例
if (window.__counterInstance) window.__counterInstance.cleanup();
window.__counterInstance = new DOMCounter();


// ds: div.ds-message
//元宝  .agent-chat__list__item__content