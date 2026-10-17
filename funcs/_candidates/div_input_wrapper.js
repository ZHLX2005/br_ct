/**
 * @fileoverview 输入框双向绑定工具
 *
 * @scenario    想给任意网页的输入框套一个外置"遥控输入面板"，两端实时同步
 * @feature     悬浮选取 DOM → 创建伴生输入框 → 与原元素双向绑定
 * @effect      注入一个可拖拽的悬浮输入框；改动原元素或悬浮框任一侧，另一侧实时同步
 * @category    DOM创建
 * @platform    通用
 * @entry       new InputBindingPicker()
 */

/**
 * 输入框双向绑定工具
 * 功能：
 * 1. 通过框选智能发现可输入的第一个DOM元素
 * 2. 创建悬浮输入框与原元素双向绑定
 * 3. 支持 input、textarea、contenteditable 等多种输入类型
 */

class InputBindingPicker {
    constructor() {
        // 当前选中的元素
        this.currentElement = null;

        // 是否已锁定绑定
        this.isLocked = false;

        // 创建UI元素
        this._createUI();

        // 启动拾取模式
        this._startPicking();
    }

    // ==================== UI 创建 ====================

    _createUI() {
        // 高亮遮罩层
        this.overlay = document.createElement("div");
        this.overlay.style.cssText = `
            position: absolute;
            pointer-events: none;
            border: 2px solid #28a745;
            background: rgba(40, 167, 69, 0.15);
            z-index: 999998;
            transition: all 0.15s ease;
            display: none;
        `;
        document.body.appendChild(this.overlay);

        // 提示框
        this.tooltip = document.createElement("div");
        this.tooltip.style.cssText = `
            position: absolute;
            background: #28a745;
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 999999;
            pointer-events: none;
            white-space: nowrap;
        `;
        document.body.appendChild(this.tooltip);

        // 悬浮输入框容器
        this.container = document.createElement("div");
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 400px;
            max-height: 80vh;
            overflow-y: auto;
            background: #ffffff;
            border: 1px solid #28a745;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            padding: 16px;
        `;
        document.body.appendChild(this.container);

        // 创建悬浮输入框
        this.floatingInput = document.createElement("textarea");
        this.floatingInput.style.cssText = `
            width: 100%;
            min-height: 100px;
            padding: 12px;
            border: 2px solid #e9ecef;
            border-radius: 6px;
            font-size: 14px;
            font-family: inherit;
            resize: vertical;
            outline: none;
            transition: border-color 0.2s ease;
            background: #f8f9fa;
        `;
        this.floatingInput.placeholder = "输入内容将同步到绑定的元素...";

        // 输入框焦点效果
        this.floatingInput.addEventListener("focus", () => {
            this.floatingInput.style.borderColor = "#28a745";
            this.floatingInput.style.background = "#ffffff";
        });
        this.floatingInput.addEventListener("blur", () => {
            this.floatingInput.style.borderColor = "#e9ecef";
            this.floatingInput.style.background = "#f8f9fa";
        });

        // 初始界面
        this._showInitialUI();
    }

    _showInitialUI() {
        this.container.innerHTML = `
            <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0; color: #212529; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">🔗</span> 输入框双向绑定工具
            </h2>
            <p style="color: #6c757d; margin-bottom: 16px; line-height: 1.5; font-size: 13px;">
                将鼠标移动到页面上，自动高亮可输入的元素。<br>
                <strong>点击</strong>任意位置锁定选中的输入元素，建立双向绑定。
            </p>
            <div style="background: #e8f5e9; border-left: 3px solid #28a745; padding: 10px 12px; margin-bottom: 16px; border-radius: 4px;">
                <p style="margin: 0; font-size: 12px; color: #2e7d32;">
                    💡 支持类型：input、textarea、select、contenteditable
                </p>
            </div>
            <button id="close-binding-tool" style="width: 100%; padding: 10px 12px; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; background: #dc3545; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">
                完全关闭
            </button>
        `;

        // 隐藏输入框容器，初始不显示
        this.inputContainer = null;

        this._bindButtonEvents();
    }

    _showBoundUI(element) {
        const elementType = this._getElementTypeInfo(element);
        const elementId = element.id ? `#${element.id}` : '';
        const elementClass = element.className ? `.${element.className.trim().split(/\s+/)[0]}` : '';

        this.container.innerHTML = `
            <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0; color: #212529; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px;">✅</span> 双向绑定已建立
            </h2>

            <div style="background: #e8f5e9; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
                <h3 style="font-size: 13px; margin: 0 0 8px 0; color: #2e7d32; font-weight: 600;">绑定目标</h3>
                <code style="display: block; background: #fff; padding: 8px; border-radius: 4px; font-size: 11px; color: #495057; font-family: 'Consolas', monospace; word-break: break-all;">
                    &lt;${element.tagName.toLowerCase()}${elementId}${elementClass}&gt; - ${elementType}
                </code>
            </div>

            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 13px; font-weight: 500; color: #495057; margin-bottom: 8px;">
                    📝 悬浮输入框 <span style="color: #28a745; font-weight: 600;">(双向同步)</span>
                </label>
                <div id="floating-input-wrapper"></div>
            </div>

            <div style="display: flex; gap: 8px;">
                <button id="sync-to-target" style="flex: 1; padding: 10px 12px; border: 1px solid #007bff; border-radius: 6px; cursor: pointer; background: #007bff; color: #f8f9fa; font-size: 13px; font-weight: 500; transition: all 0.2s ease;">
                    🔄 立即同步到目标
                </button>
                <button id="sync-from-target" style="flex: 1; padding: 10px 12px; border: 1px solid #17a2b8; border-radius: 6px; cursor: pointer; background: #17a2b8; color: #f8f9fa; font-size: 13px; font-weight: 500; transition: all 0.2s ease;">
                    📥 从目标获取
                </button>
            </div>

            <div style="margin-top: 12px; display: flex; gap: 8px;">
                <button id="unbind-element" style="flex: 1; padding: 10px 12px; border: 1px solid #ffc107; border-radius: 6px; cursor: pointer; background: #ffc107; color: #212529; font-size: 13px; font-weight: 500; transition: all 0.2s ease;">
                    🔓 解除绑定
                </button>
                <button id="close-binding-tool" style="flex: 1; padding: 10px 12px; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; background: #dc3545; color: #f8f9fa; font-size: 13px; font-weight: 500; transition: all 0.2s ease;">
                    ❌ 完全关闭
                </button>
            </div>

            <div style="margin-top: 16px; padding: 10px; background: #fff3cd; border-radius: 4px; font-size: 11px; color: #856404;">
                💡 提示：在两个输入框中的任意一个输入，内容会自动同步到另一个
            </div>
        `;

        // 将输入框添加到容器中
        const wrapper = this.container.querySelector('#floating-input-wrapper');
        wrapper.appendChild(this.floatingInput);

        // 初始化输入框的值
        this._syncFromTarget();

        this._bindButtonEvents();
        this._bindInputEvents(element);
    }

    // ==================== 元素检测 ====================

    /**
     * 检查元素是否为可输入元素
     */
    _isInputableElement(element) {
        if (!element || element === document.body || element === document.documentElement) {
            return false;
        }

        // 检查是否有 contenteditable 属性
        if (element.isContentEditable) {
            return true;
        }

        // 检查常见的输入标签
        const inputTags = ['INPUT', 'TEXTAREA', 'SELECT'];
        if (inputTags.includes(element.tagName)) {
            // 排除某些 input 类型（如 checkbox, radio, file 等）
            if (element.tagName === 'INPUT') {
                const excludeTypes = ['checkbox', 'radio', 'file', 'submit', 'reset', 'button', 'image', 'hidden'];
                if (excludeTypes.includes(element.type)) {
                    return false;
                }
            }
            return true;
        }

        return false;
    }

    /**
     * 在元素及其子树中查找第一个可输入的元素
     */
    _findFirstInputable(element) {
        // 先检查元素自身
        if (this._isInputableElement(element)) {
            return element;
        }

        // 深度优先搜索子元素
        const inputable = element.querySelector('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
        return inputable;
    }

    /**
     * 获取元素类型描述
     */
    _getElementTypeInfo(element) {
        if (element.isContentEditable) {
            return 'contenteditable';
        }
        if (element.tagName === 'INPUT') {
            return element.type || 'text';
        }
        return element.tagName.toLowerCase();
    }

    /**
     * 查找元素内所有的可输入元素
     */
    _findAllInputable(element) {
        const results = [];

        // 检查自身
        if (this._isInputableElement(element)) {
            results.push(element);
        }

        // 查找子元素
        const inputs = element.querySelectorAll('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
        inputs.forEach(el => {
            if (this._isInputableElement(el)) {
                results.push(el);
            }
        });

        return results;
    }

    // ==================== 双向绑定 ====================

    /**
     * 绑定输入事件
     */
    _bindInputEvents(targetElement) {
        // 悬浮输入框 → 目标元素
        this._floatingInputHandler = () => {
            this._syncToTarget(targetElement);
        };

        this.floatingInput.addEventListener('input', this._floatingInputHandler);

        // 目标元素 → 悬浮输入框
        this._targetInputHandler = () => {
            this._syncFromTargetElement(targetElement);
        };

        const eventType = targetElement.isContentEditable ? 'input' : 'input';
        targetElement.addEventListener(eventType, this._targetInputHandler);

        // 保存绑定信息
        this.boundElement = targetElement;
    }

    /**
     * 解除绑定事件
     */
    _unbindInputEvents() {
        if (this._floatingInputHandler && this.floatingInput) {
            this.floatingInput.removeEventListener('input', this._floatingInputHandler);
        }
        if (this._targetInputHandler && this.boundElement) {
            const eventType = this.boundElement.isContentEditable ? 'input' : 'input';
            this.boundElement.removeEventListener(eventType, this._targetInputHandler);
        }
        this.boundElement = null;
        this._floatingInputHandler = null;
        this._targetInputHandler = null;
    }

    /**
     * 从悬浮框同步到目标元素
     */
    _syncToTarget(targetElement) {
        if (!targetElement) return;

        const value = this.floatingInput.value;

        if (targetElement.isContentEditable) {
            targetElement.innerText = value;
        } else if (targetElement.tagName === 'SELECT') {
            // 对于 select，尝试匹配选项
            targetElement.value = value;
        } else {
            targetElement.value = value;
        }

        // 触发 input 事件以确保其他监听器能响应
        const event = new Event('input', { bubbles: true, cancelable: true });
        targetElement.dispatchEvent(event);
    }

    /**
     * 从目标元素同步到悬浮框
     */
    _syncFromTarget() {
        if (this.boundElement) {
            this._syncFromTargetElement(this.boundElement);
        }
    }

    /**
     * 从目标元素同步到悬浮框（内部方法）
     */
    _syncFromTargetElement(targetElement) {
        let value = '';

        if (targetElement.isContentEditable) {
            value = targetElement.innerText || targetElement.textContent;
        } else if (targetElement.tagName === 'SELECT') {
            value = targetElement.value;
        } else {
            value = targetElement.value;
        }

        // 只有当值真正改变时才更新，避免光标问题
        if (this.floatingInput.value !== value) {
            this.floatingInput.value = value;
        }
    }

    // ==================== 事件处理 ====================

    _bindButtonEvents() {
        // 完全关闭按钮
        const closeBtn = document.getElementById('close-binding-tool');
        if (closeBtn) {
            closeBtn.onclick = () => this.cleanup();
        }

        // 同步到目标按钮
        const syncToBtn = document.getElementById('sync-to-target');
        if (syncToBtn) {
            syncToBtn.onclick = () => {
                if (this.boundElement) {
                    this._syncToTarget(this.boundElement);
                    this._showSyncFeedback(syncToBtn, '✓ 已同步');
                }
            };
        }

        // 从目标获取按钮
        const syncFromBtn = document.getElementById('sync-from-target');
        if (syncFromBtn) {
            syncFromBtn.onclick = () => {
                if (this.boundElement) {
                    this._syncFromTarget();
                    this._showSyncFeedback(syncFromBtn, '✓ 已获取');
                }
            };
        }

        // 解除绑定按钮
        const unbindBtn = document.getElementById('unbind-element');
        if (unbindBtn) {
            unbindBtn.onclick = () => {
                this._unbindInputEvents();
                this.isLocked = false;
                this.overlay.style.display = 'none';
                this.tooltip.style.display = 'none';
                this._showInitialUI();
                this._startPicking();
            };
        }
    }

    _showSyncFeedback(button, text) {
        const originalText = button.innerText;
        const originalBg = button.style.background;

        button.innerText = text;
        button.style.background = '#28a745';

        setTimeout(() => {
            button.innerText = originalText;
            button.style.background = originalBg;
        }, 1000);
    }

    // ==================== 鼠标事件 ====================

    _onMove = (e) => {
        if (this.isLocked) return;

        let el = document.elementFromPoint(e.clientX, e.clientY);

        // 忽略工具自身元素
        if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) {
            return;
        }

        // 查找第一个可输入元素
        const inputable = this._findFirstInputable(el);

        if (!inputable) {
            this.overlay.style.display = 'none';
            this.tooltip.style.display = 'none';
            return;
        }

        this.currentElement = inputable;

        // 更新高亮和提示
        const rect = inputable.getBoundingClientRect();
        this.overlay.style.display = 'block';
        this.overlay.style.top = rect.top + window.scrollY + "px";
        this.overlay.style.left = rect.left + window.scrollX + "px";
        this.overlay.style.width = rect.width + "px";
        this.overlay.style.height = rect.height + "px";
        this.overlay.style.border = "2px solid #28a745";
        this.overlay.style.background = "rgba(40, 167, 69, 0.2)";

        this.tooltip.style.display = 'block';
        this.tooltip.style.top = rect.top - 30 + "px";
        this.tooltip.style.left = rect.left + "px";

        const elementType = this._getElementTypeInfo(inputable);
        this.tooltip.innerText = `点击绑定 <${inputable.tagName.toLowerCase()}> (${elementType})`;
    }

    _onClick = (e) => {
        // 如果点击在工具箱内，不处理
        if (this.container.contains(e.target)) return;

        e.preventDefault();
        e.stopPropagation();

        let el = document.elementFromPoint(e.clientX, e.clientY);

        // 忽略工具自身元素
        if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) return;

        // 查找第一个可输入元素
        const inputable = this._findFirstInputable(el);

        if (!inputable) return;

        this.currentElement = inputable;

        if (!this.isLocked) {
            this.isLocked = true;
            document.removeEventListener("mousemove", this._onMove, true);
            document.removeEventListener("click", this._onClick, true);

            // 锁定样式
            this.overlay.style.border = "3px solid #155724";
            this.overlay.style.background = "rgba(21, 87, 36, 0.3)";

            this.tooltip.style.display = 'block';
            this.tooltip.style.background = '#155724';
            this.tooltip.innerText = `✓ 已绑定 <${inputable.tagName.toLowerCase()}>`;

            // 显示绑定UI并建立双向绑定
            this._showBoundUI(inputable);

            console.log(`[InputBinding] 已绑定到元素 <${inputable.tagName.toLowerCase()}>`, inputable);
        }
    }

    // ==================== 启动与清理 ====================

    _startPicking() {
        document.addEventListener("mousemove", this._onMove, true);
        document.addEventListener("click", this._onClick, true);

        this.overlay.style.display = 'none';
        this.tooltip.style.display = 'none';
    }

    cleanup() {
        // 解除事件绑定
        this._unbindInputEvents();

        document.removeEventListener("mousemove", this._onMove, true);
        document.removeEventListener("click", this._onClick, true);

        // 移除UI
        if (this.overlay) this.overlay.remove();
        if (this.tooltip) this.tooltip.remove();
        if (this.container) this.container.remove();

        // 清理全局引用
        delete window.__inputBindingPickerInstance;

        console.log("[InputBinding] 输入框双向绑定工具已关闭");
    }
}

// ==================== 入口函数 ====================

/**
 * 主入口函数
 */
function main() {
    // 确保只运行一个实例
    if (window.__inputBindingPickerInstance) {
        window.__inputBindingPickerInstance.cleanup();
    }

    window.__inputBindingPickerInstance = new InputBindingPicker();

    console.log("[InputBinding] 输入框双向绑定工具已启动");

    return {
        success: true,
        message: "输入框双向绑定工具已启动"
    };
}
// main()