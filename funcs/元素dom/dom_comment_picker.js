/**
 * @fileoverview DOM评论拾取器，一键生成AI编程提示词
 *
 * @scenario    开发调试时选中页面元素并评论（点赞/点踩/批注），把元素定位+评论构建成提示词交给 AI 编程
 * @feature     悬浮高亮元素（无面板），点击立即弹出黑白灰评论框，内置点赞/点踩与快捷模板，提交后构建提示词结构并复制剪贴板
 * @effect      注入高亮层+评论浮层，评论记录（URL+DOM定位）经后台统一存储，评论历史在独立页面 dom_comments/index.html 查看
 * @category    DOM创建
 * @platform    通用
 * @entry       main()
 */

// 清理旧实例（如果存在）
if (window.__domCommentPickerInstance) {
    window.__domCommentPickerInstance.cleanup();
    window.__domCommentPickerInstance = null;
}

// 内置评价文案（与 shared/domComments/domCommentsPrompt.js 保持一致）
const VERDICT_LABELS = {
    like: '点赞',
    dislike: '点踩',
    none: '无'
};

// 内置快捷评论模板（点击填入输入框）
const QUICK_TEMPLATES = ['删除该元素', '样式需要调整', '点击无响应', '文案需要修改'];

// 黑白灰主题色
const THEME = {
    ink: '#212529',        // 主文字 / 主按钮底
    body: '#495057',       // 次文字
    muted: '#6c757d',      // 辅助文字
    faint: '#adb5bd',      // 弱文字
    line: '#dee2e6',       // 边框
    lineSoft: '#e9ecef',   // 弱分隔
    bgSoft: '#f8f9fa',     // 浅底
    bgSofter: '#e9ecef'    // 更浅底
};

/**
 * DOM 评论拾取器。
 * 无常驻面板：仅注入高亮层 + 跟随提示，点击元素后在其附近弹出评论浮层，
 * 提交后构建提示词复制到剪贴板，评论记录经后台消息统一入库。
 */
window.DomCommentPicker = class DomCommentPicker {
    constructor() {
        this.state = 'picking';          // picking | dialog
        this.currentElement = null;      // 实时悬停元素
        this.picked = null;              // 点击锁定后的元素信息快照
        this.verdict = '';               // '' | like | dislike

        // 1. UI 初始化（仅高亮层 + 提示框，无面板）
        this.overlay = this._createOverlay();
        this.tooltip = this._createTooltip();

        // 2. 启动事件监听（keydown 独立于拾取监听，评论浮层打开时 ESC 仍生效）
        this._startPicking();
        document.addEventListener('keydown', this._onKeydown, true);

        console.log('[DomCommentPicker] 评论拾取已启动：移动鼠标选择元素，点击评论，ESC 退出');
        this._showToast('DOM 评论拾取已启动：点击元素添加评论，ESC 退出');
        // 注册到统一停止协议（popup 函数执行页可远程开关）
        window.__funcScriptRegistry = window.__funcScriptRegistry || {};
        window.__funcScriptRegistry['元素dom/dom_comment_picker.js'] = () => this.cleanup();
        window.__domCommentPickerInstance = this;
    }

    // --- UI 三件套（面板型脚本规范：overlay / tooltip / 按需 dialog）---

    _createOverlay() {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'absolute',
            border: '2px solid #6c757d',
            background: 'rgba(108, 117, 125, 0.2)',
            pointerEvents: 'none',          // 不阻挡鼠标事件
            zIndex: '2147483645',
            transition: 'all 0.12s ease-in-out'
        });
        document.body.appendChild(overlay);
        return overlay;
    }

    _createTooltip() {
        const tooltip = document.createElement('div');
        Object.assign(tooltip.style, {
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
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            display: 'none'
        });
        document.body.appendChild(tooltip);
        return tooltip;
    }

    /** 一次性启动提示（3 秒后自动消失，非常驻面板） */
    _showToast(text) {
        const toast = document.createElement('div');
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#212529',
            color: '#f8f9fa',
            fontSize: '13px',
            padding: '10px 18px',
            borderRadius: '8px',
            zIndex: '2147483647',
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
            transition: 'opacity 0.4s ease'
        });
        toast.textContent = text;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; }, 2500);
        setTimeout(() => { toast.remove(); }, 3000);
    }

    // --- 事件处理（箭头函数确保 this 绑定 + 捕获阶段）---

    _onMove = (e) => {
        if (this.state !== 'picking') return;

        let el = document.elementFromPoint(e.clientX, e.clientY);
        // 忽略工具自身元素
        if (!el || el === this.overlay || el === this.tooltip
            || (this.dialog && this.dialog.contains(el))) {
            return;
        }
        this.currentElement = el;

        const rect = el.getBoundingClientRect();
        this.overlay.style.top = rect.top + window.scrollY + 'px';
        this.overlay.style.left = rect.left + window.scrollX + 'px';
        this.overlay.style.width = rect.width + 'px';
        this.overlay.style.height = rect.height + 'px';

        this.tooltip.style.top = Math.max(4, rect.top - 30) + 'px';
        this.tooltip.style.left = rect.left + 'px';
        this.tooltip.style.display = 'block';
        this.tooltip.innerText = `点击评论 <${el.tagName.toLowerCase()}> · ESC 退出`;
    }

    _onClick = (e) => {
        if (this.state !== 'picking') return;
        if (this.dialog && this.dialog.contains(e.target)) return; // 浮层内点击不拾取

        let el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === this.overlay || el === this.tooltip) return;

        e.preventDefault();
        e.stopPropagation();

        this._openDialog(el, e.clientX, e.clientY);
    }

    _onKeydown = (e) => {
        if (e.key !== 'Escape') return;
        if (this.state === 'dialog') {
            e.preventDefault();
            e.stopPropagation();
            this._closeDialog();
        } else {
            // 用户正在页面输入框打字时不退出，避免误杀
            const el = document.activeElement;
            const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
            if (!isTyping) this.cleanup();
        }
    }

    // --- 启动与暂停拾取 ---

    _startPicking() {
        this.state = 'picking';
        document.addEventListener('mousemove', this._onMove, true);
        document.addEventListener('click', this._onClick, true);
    }

    _stopPicking() {
        document.removeEventListener('mousemove', this._onMove, true);
        document.removeEventListener('click', this._onClick, true);
    }

    // --- 元素信息快照 ---

    /**
     * 锁定元素时生成信息快照（选择器 + 截断 HTML），后续提示词与入库都基于快照
     */
    _snapshotElement(el) {
        return {
            time: new Date().toISOString(),
            url: window.location.href,
            title: document.title || '',
            tag: this._shortTag(el),
            selectors: this._generateSelectors(el),
            verdict: '',
            comment: '',
            html: this._truncate(el.outerHTML, 2500)
        };
    }

    /** 短标签描述：tag.class1.class2#id */
    _shortTag(el) {
        let desc = el.tagName.toLowerCase();
        if (el.id) {
            desc += '#' + el.id;
        } else if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (classes) desc += '.' + classes;
        }
        return desc;
    }

    _truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.slice(0, max) + '\n... (已截断)' : str;
    }

    /**
     * 生成四种定位选择器（与 div_Img_wrapper.js 保持一致）
     */
    _generateSelectors(el) {
        // 1. CSS 选择器
        const getCssSelector = (node) => {
            if (node.id) return `#${node.id}`;
            if (node.className && typeof node.className === 'string') {
                const classSelector = '.' + node.className.trim().split(/\s+/).join('.');
                return `${node.tagName.toLowerCase()}${classSelector}`;
            }
            return node.tagName.toLowerCase();
        };

        // 2. JS 路径 (querySelector)
        const getJsPath = (node) => {
            let path = '';
            while (node && node.nodeType === 1 && node !== document.body) {
                let selector = node.nodeName.toLowerCase();
                if (node.id) {
                    selector += '#' + node.id;
                    path = selector + (path ? ' > ' + path : '');
                    break;
                }
                let sib = node, nth = 1;
                while (sib.previousElementSibling) {
                    sib = sib.previousElementSibling;
                    if (sib.nodeName === node.nodeName) nth++;
                }
                selector += `:nth-of-type(${nth})`;
                path = selector + (path ? ' > ' + path : '');
                node = node.parentElement;
            }
            return 'document.querySelector("' + path + '")';
        };

        // 3. 简版 XPath（从最近带 id 的祖先开始）
        const getXPath = (node) => {
            if (node.id) return `//*[@id="${node.id}"]`;
            if (node === document.body) return '/html/body';
            let ix = 0;
            const siblings = node.parentNode ? node.parentNode.childNodes : [];
            for (let i = 0; i < siblings.length; i++) {
                if (siblings[i] === node) {
                    return getXPath(node.parentNode) + '/' + node.tagName.toLowerCase() + '[' + (ix + 1) + ']';
                }
                if (siblings[i].nodeType === 1 && siblings[i].tagName === node.tagName) ix++;
            }
            return '';
        };

        // 4. 完整 XPath（从 html 开始）
        const getFullXPath = (node) => {
            const path = [];
            while (node && node.nodeType === 1) {
                let index = 0;
                let sibling = node.previousSibling;
                while (sibling) {
                    if (sibling.nodeType === 1 && sibling.nodeName === node.nodeName) index++;
                    sibling = sibling.previousSibling;
                }
                path.unshift(node.nodeName.toLowerCase() + '[' + (index + 1) + ']');
                node = node.parentNode;
            }
            return '/' + path.join('/');
        };

        return {
            css: getCssSelector(el),
            jsPath: getJsPath(el),
            xpath: getXPath(el),
            fullXPath: getFullXPath(el)
        };
    }

    // --- 提示词构建（与 shared/domComments/domCommentsPrompt.js 保持一致）---

    /**
     * 把元素定位信息 + 用户评价构建成面向 AI 编程的提示词结构
     */
    _buildPrompt(info) {
        const lines = [];
        lines.push('## DOM 元素定位与评论（AI 编程辅助）');
        lines.push('');
        lines.push('### 1. 页面信息');
        lines.push(`- 页面 URL: ${info.url}`);
        if (info.title) lines.push(`- 页面标题: ${info.title}`);
        lines.push('');
        lines.push('### 2. 元素定位');
        lines.push(`- 元素标签: ${info.tag}`);
        lines.push(`- CSS 选择器: ${info.selectors.css}`);
        lines.push(`- JS 路径: ${info.selectors.jsPath}`);
        lines.push(`- XPath: ${info.selectors.xpath}`);
        lines.push(`- 完整 XPath: ${info.selectors.fullXPath}`);
        lines.push('');
        lines.push('### 3. 元素 HTML');
        lines.push('```html');
        lines.push(info.html);
        lines.push('```');
        lines.push('');
        lines.push('### 4. 用户评价');
        const verdictLabel = VERDICT_LABELS[info.verdict] || VERDICT_LABELS.none;
        lines.push(`- 评价: ${verdictLabel}`);
        lines.push(`- 评论: ${info.comment || '（无补充评论）'}`);
        lines.push('');
        lines.push('### 5. 任务');
        lines.push('请根据以上定位信息在项目源码中定位对应组件/模板，并结合用户评价说明处理意图。');
        return lines.join('\n');
    }

    // --- 评论浮层（无常驻面板，点击时按需创建，黑白灰无色块）---

    _openDialog(el, x, y) {
        this.picked = this._snapshotElement(el);
        this.verdict = '';
        this._stopPicking();

        // 锁定态高亮：3px 加粗 + 深色
        const rect = el.getBoundingClientRect();
        this.overlay.style.top = rect.top + window.scrollY + 'px';
        this.overlay.style.left = rect.left + window.scrollX + 'px';
        this.overlay.style.width = rect.width + 'px';
        this.overlay.style.height = rect.height + 'px';
        this.overlay.style.border = '3px solid #495057';
        this.overlay.style.background = 'rgba(73, 80, 87, 0.25)';
        this.tooltip.style.display = 'none';

        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            position: 'fixed',
            width: '380px',
            maxHeight: '85vh',
            overflowY: 'auto',
            background: THEME.bgSoft,
            border: `1px solid ${THEME.line}`,
            borderRadius: '8px',
            padding: '14px',
            zIndex: '2147483647',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontSize: '13px',
            color: THEME.ink,
            lineHeight: '1.5',
            userSelect: 'text'
        });

        const tagShort = this._escapeHtml(this._truncate(this.picked.tag, 40));
        const cssShort = this._escapeHtml(this._truncate(this.picked.selectors.css, 60));

        dialog.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                <div style="font-weight: 600; font-size: 14px;">评论元素 <span style="color: ${THEME.body}; font-family: Consolas, monospace; font-size: 12px;">&lt;${tagShort}&gt;</span></div>
                <button data-act="close" style="border: none; background: transparent; cursor: pointer; font-size: 16px; color: ${THEME.muted}; padding: 2px 6px;" title="关闭 (ESC)">×</button>
            </div>
            <div style="font-size: 11px; color: ${THEME.body}; font-family: Consolas, monospace; background: ${THEME.bgSofter}; border-radius: 4px; padding: 6px 8px; margin-bottom: 10px; word-break: break-all;">${cssShort}</div>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <button data-act="verdict" data-value="like" style="flex: 1; padding: 8px 0; border: 1px solid ${THEME.line}; border-radius: 6px; cursor: pointer; background: ${THEME.bgSoft}; color: ${THEME.ink}; font-size: 13px;">点赞</button>
                <button data-act="verdict" data-value="dislike" style="flex: 1; padding: 8px 0; border: 1px solid ${THEME.line}; border-radius: 6px; cursor: pointer; background: ${THEME.bgSoft}; color: ${THEME.ink}; font-size: 13px;">点踩</button>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
                ${QUICK_TEMPLATES.map(t => `<button data-act="template" data-value="${t}" style="padding: 4px 10px; border: 1px solid ${THEME.line}; border-radius: 12px; cursor: pointer; background: #ffffff; font-size: 12px; color: ${THEME.body};">${t}</button>`).join('')}
            </div>
            <textarea id="dcp-comment-input" placeholder="补充评论（可留空），如：这个按钮点击无响应…" style="width: 100%; box-sizing: border-box; height: 64px; padding: 8px 10px; border: 1px solid ${THEME.line}; border-radius: 6px; font-size: 13px; font-family: inherit; resize: vertical; outline: none; margin-bottom: 4px; background: #ffffff; color: ${THEME.ink};"></textarea>
            <div id="dcp-hint" style="font-size: 11px; color: ${THEME.muted}; font-style: italic; margin-bottom: 6px; display: none;">请先选择评价或填写评论</div>
            <button data-act="submit" style="width: 100%; padding: 10px 0; margin-bottom: 8px; border: 1px solid ${THEME.ink}; border-radius: 6px; cursor: pointer; background: ${THEME.ink}; color: #f8f9fa; font-size: 14px; font-weight: 500;">构建提示词并复制</button>
            <button data-act="open-panel" style="width: 100%; padding: 8px 0; border: 1px solid ${THEME.line}; border-radius: 6px; cursor: pointer; background: #ffffff; color: ${THEME.body}; font-size: 12px;">打开评论区</button>
        `;

        document.body.appendChild(dialog);
        this.dialog = dialog;
        this.state = 'dialog';

        // 视口内定位（先渲染再测量）
        const dw = dialog.offsetWidth, dh = dialog.offsetHeight;
        dialog.style.left = Math.max(8, Math.min(x + 12, window.innerWidth - dw - 8)) + 'px';
        dialog.style.top = Math.max(8, Math.min(y + 12, window.innerHeight - dh - 8)) + 'px';

        // 阻止浮层内按键冒泡到页面（不影响 document 捕获阶段的 ESC 处理）
        dialog.addEventListener('keydown', (ev) => ev.stopPropagation());
        dialog.addEventListener('click', (ev) => this._onDialogClick(ev));

        setTimeout(() => dialog.querySelector('#dcp-comment-input')?.focus(), 50);
    }

    _closeDialog() {
        if (this.dialog) {
            this.dialog.remove();
            this.dialog = null;
        }

        // 恢复拾取态高亮
        this.overlay.style.border = '2px solid #6c757d';
        this.overlay.style.background = 'rgba(108, 117, 125, 0.2)';
        this._startPicking();
    }

    _onDialogClick(e) {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();

        switch (btn.dataset.act) {
            case 'close':
                this._closeDialog();
                break;
            case 'verdict':
                this.verdict = this.verdict === btn.dataset.value ? '' : btn.dataset.value;
                this.dialog.querySelectorAll('[data-act="verdict"]').forEach(b => {
                    const active = b.dataset.value === this.verdict;
                    // 黑白灰：选中态用黑底白字，不用色块
                    b.style.background = active ? THEME.ink : THEME.bgSoft;
                    b.style.borderColor = active ? THEME.ink : THEME.line;
                    b.style.color = active ? '#f8f9fa' : THEME.ink;
                });
                break;
            case 'template': {
                const input = this.dialog.querySelector('#dcp-comment-input');
                if (!input) return;
                input.value = input.value ? `${input.value}；${btn.dataset.value}` : btn.dataset.value;
                input.focus();
                break;
            }
            case 'submit':
                this._submit(btn);
                break;
            case 'open-panel':
                this._sendMessage('domComment.openPanel');
                this._closeDialog();
                break;
        }
    }

    _submit(btn) {
        const input = this.dialog.querySelector('#dcp-comment-input');
        const comment = (input?.value || '').trim();

        if (!comment && !this.verdict) {
            const hint = this.dialog.querySelector('#dcp-hint');
            if (hint) hint.style.display = 'block';
            return;
        }
        const hint = this.dialog.querySelector('#dcp-hint');
        if (hint) hint.style.display = 'none';

        // 基于快照构建提示词（记录与剪贴板内容同源）
        const record = { ...this.picked, verdict: this.verdict, comment };
        const promptText = this._buildPrompt(record);

        this._copyText(promptText, btn, () => {
            // 复制成功后再入库并关闭（入库失败不影响剪贴板结果）
            this._saveRecord(record);
            this._closeDialog();
            this._showToast('提示词已复制到剪贴板');
        });
    }

    // --- 数据存取（统一走后台消息，禁止直接操作 storage）---

    _sendMessage(action, payload) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ action, payload }, (resp) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[DomCommentPicker] 消息失败:', chrome.runtime.lastError.message);
                        resolve(null);
                        return;
                    }
                    resolve(resp || null);
                });
            } catch (err) {
                console.warn('[DomCommentPicker] 消息异常:', err);
                resolve(null);
            }
        });
    }

    async _saveRecord(record) {
        const resp = await this._sendMessage('domComment.add', record);
        if (!resp || resp.status !== 'success') {
            console.warn('[DomCommentPicker] 评论记录保存失败（剪贴板内容不受影响）');
        }
    }

    // --- 剪贴板（clipboard API 优先，textarea 兜底）---

    _copyText(text, btn, onDone) {
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position: fixed; opacity: 0; pointer-events: none;';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                this._flashButton(btn, onDone);
            } catch (err) {
                console.error('[DomCommentPicker] 复制失败:', err);
                this._flashButton(btn, null, true);
            }
            ta.remove();
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this._flashButton(btn, onDone);
            }).catch(fallback);
        } else {
            fallback();
        }
    }

    /** 复制反馈：按钮短暂反色（黑底白字），可选回调在反馈后触发 */
    _flashButton(btn, onDone, failed) {
        if (!btn) {
            if (!failed && onDone) onDone();
            return;
        }
        const origText = btn.innerText;
        const origBg = btn.style.background;
        const origColor = btn.style.color;
        const origBorder = btn.style.borderColor;

        btn.innerText = failed ? '复制失败' : '已复制';
        btn.style.background = THEME.bgSoft;
        btn.style.color = THEME.ink;
        btn.style.borderColor = THEME.ink;

        setTimeout(() => {
            // 按钮可能已随浮层一起被移除
            if (btn.isConnected) {
                btn.innerText = origText;
                btn.style.background = origBg;
                btn.style.color = origColor;
                btn.style.borderColor = origBorder;
            }
            if (!failed && onDone) onDone();
        }, 800);
    }

    // --- 工具方法 ---

    _escapeHtml(str) {
        if (typeof str !== 'string') return str;
        const escapeMap = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        };
        return str.replace(/[&<>"']/g, match => escapeMap[match]);
    }

    // --- 清理 ---

    cleanup() {
        this._stopPicking();
        if (this.dialog) {
            this.dialog.remove();
            this.dialog = null;
        }
        if (this.overlay) this.overlay.remove();
        if (this.tooltip) this.tooltip.remove();
        document.removeEventListener('keydown', this._onKeydown, true);
        if (window.__funcScriptRegistry) {
            delete window.__funcScriptRegistry['元素dom/dom_comment_picker.js'];
        }
        this.picked = null;
        window.__domCommentPickerInstance = null;
        console.log('[DomCommentPicker] 评论拾取已退出');
    }
};

// -------------------------------------------------------------------
// --- 启动脚本（popup / 快捷键注入后调用 main()）---
// -------------------------------------------------------------------

function main() {
    if (window.__domCommentPickerInstance) {
        window.__domCommentPickerInstance.cleanup();
    }
    window.__domCommentPickerInstance = new window.DomCommentPicker();
    return { success: true };
}
