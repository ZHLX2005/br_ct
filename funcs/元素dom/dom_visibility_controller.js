/**
 * @fileoverview DOM可见性控制器
 *
 * @scenario    信息流页面干扰元素太多，需要屏蔽指定元素
 * @feature     选取DOM元素并控制其显隐，支持配置导入导出
 * @effect      修改目标元素的display/visibility样式，控制其显隐
 * @category    视觉展示
 * @platform    通用
 * @entry       自动执行
 */

/**
 * DOM 可见性控制器 (DOM Visibility Controller) 类。
 * 用于选择 DOM 元素并控制其可见性，帮助屏蔽过多的信息流。
 * 支持隐藏模式、正常浏览模式，以及配置的导入和导出功能。
 */
class DomVisibilityController {
    constructor() {
        this.mode = 'hide'; // 只保留隐藏模式
        this.isPaused = false; // 暂停状态
        this.isNormalMode = false; // 正常模式状态
        this.currentElement = null;
        this.hiddenElements = new Map(); // 存储隐藏的元素和原始样式
        this.originalStates = new Map(); // 存储所有元素的原始状态（用于回退）
        this.htmlId = 'hidden-elements-list';
        this.history = []; // 历史操作记录，用于回退功能

        // 1. UI 元素初始化
        this.overlay = this._createOverlay();
        this.tooltip = this._createTooltip();
        this.container = this._createContainer();

        // 2. 保存所有元素的原始状态
        this._saveOriginalStates();

        // 3. 启动事件监听
        this._startPicking();

        console.log("DOM 可见性控制器已启动 (隐藏模式)");
        // 暴露清理方法，以便外部脚本可以停止工具
        window.__visibilityControllerCleanup = this.cleanup.bind(this);
    }

    // --- 辅助 UI 创建方法 ---

    _createOverlay() {
        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
            position: "absolute",
            border: "2px solid #6c757d",
            background: "rgba(108, 117, 125, 0.2)",
            pointerEvents: "none",
            zIndex: "999999",
            transition: "all 0.15s ease-in-out"
        });
        document.body.appendChild(overlay);
        return overlay;
    }

    _createTooltip() {
        const tooltip = document.createElement("div");
        Object.assign(tooltip.style, {
            position: "fixed",
            background: "#212529",
            color: "#f8f9fa",
            fontSize: "12px",
            padding: "6px 10px",
            borderRadius: "6px",
            zIndex: "1000000",
            pointerEvents: "none",
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontWeight: "500",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)"
        });
        document.body.appendChild(tooltip);
        return tooltip;
    }

    _createContainer() {
        const container = document.createElement("div");
        Object.assign(container.style, {
            position: "fixed",
            top: "10px",
            right: "10px",
            width: "320px",
            maxHeight: "90vh",
            overflowY: "auto",
            background: "#f8f9fa",
            border: "1px solid #dee2e6",
            borderRadius: "8px",
            padding: "16px",
            zIndex: "1000001",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
            fontSize: "14px",
            color: "#212529",
            display: "block",
            userSelect: "text",
            lineHeight: "1.5"
        });
        document.body.appendChild(container);
        return container;
    }

    // --- 状态管理方法 ---

    _saveOriginalStates() {
        const allElements = Array.from(document.body.querySelectorAll('*'));
        allElements.forEach(element => {
            this.originalStates.set(element, {
                display: element.style.display,
                visibility: element.style.visibility,
                opacity: element.style.opacity,
                position: element.style.position,
                transform: element.style.transform
            });
        });
    }

    // --- 核心工具方法 ---

    /**
     * 隐藏指定元素
     */
    _hideElement(element) {
        if (!element || this.hiddenElements.has(element)) return;

        // 保存原始样式（如果还没有保存）
        if (!this.originalStates.has(element)) {
            this.originalStates.set(element, {
                display: element.style.display,
                visibility: element.style.visibility,
                opacity: element.style.opacity,
                position: element.style.position,
                transform: element.style.transform
            });
        }

        // 隐藏元素
        element.style.display = 'none';
        element.style.visibility = 'hidden';
        element.style.opacity = '0';

        // 保存到隐藏列表
        this.hiddenElements.set(element, this.originalStates.get(element));

        // 记录操作历史
        this._addToHistory({
            type: 'hide',
            element: element
        });

        // 更新 UI
        this._updateHiddenElementsList();
    }

    /**
     * 显示指定元素
     */
    _showElement(element) {
        if (!element || !this.hiddenElements.has(element)) return;

        // 恢复原始样式
        const originalStyle = this.hiddenElements.get(element);
        element.style.display = originalStyle.display;
        element.style.visibility = originalStyle.visibility;
        element.style.opacity = originalStyle.opacity;
        element.style.position = originalStyle.position;
        element.style.transform = originalStyle.transform;

        // 从隐藏列表中移除
        this.hiddenElements.delete(element);

        // 记录操作历史
        this._addToHistory({
            type: 'show',
            element: element
        });

        // 更新 UI
        this._updateHiddenElementsList();
    }

    /**
     * 切换正常模式和隐藏状态
     */
    _toggleNormalMode() {
        this.isNormalMode = !this.isNormalMode;

        if (this.isNormalMode) {
            // 进入正常模式：显示所有隐藏的元素
            this.hiddenElements.forEach((originalStyle, element) => {
                element.style.display = originalStyle.display;
                element.style.visibility = originalStyle.visibility;
                element.style.opacity = originalStyle.opacity;
                element.style.position = originalStyle.position;
                element.style.transform = originalStyle.transform;
            });
        } else {
            // 退出正常模式：重新隐藏之前隐藏的元素
            this.hiddenElements.forEach((_, element) => {
                element.style.display = 'none';
                element.style.visibility = 'hidden';
                element.style.opacity = '0';
            });
        }

        // 记录操作历史
        this._addToHistory({
            type: 'toggleNormalMode',
            state: this.isNormalMode
        });

        this._updateHiddenElementsList();
    }

    /**
     * 添加操作到历史记录
     */
    _addToHistory(action) {
        this.history.push(action);
        // 限制历史记录数量，避免内存泄漏
        if (this.history.length > 50) {
            this.history.shift();
        }
    }

    /**
     * 回退上一步操作
     */
    _undo() {
        if (this.history.length === 0) {
            alert('没有可回退的操作');
            return;
        }

        const lastAction = this.history.pop();
        const tempHistoryLength = this.history.length; // 保存回退前的历史长度

        switch (lastAction.type) {
            case 'hide':
                // 显示元素，不记录到历史
                if (lastAction.element && this.hiddenElements.has(lastAction.element)) {
                    const originalStyle = this.hiddenElements.get(lastAction.element);
                    lastAction.element.style.display = originalStyle.display;
                    lastAction.element.style.visibility = originalStyle.visibility;
                    lastAction.element.style.opacity = originalStyle.opacity;
                    lastAction.element.style.position = originalStyle.position;
                    lastAction.element.style.transform = originalStyle.transform;
                    this.hiddenElements.delete(lastAction.element);
                }
                break;
            case 'show':
                // 隐藏元素，不记录到历史
                if (lastAction.element && !this.hiddenElements.has(lastAction.element)) {
                    if (!this.originalStates.has(lastAction.element)) {
                        this.originalStates.set(lastAction.element, {
                            display: lastAction.element.style.display,
                            visibility: lastAction.element.style.visibility,
                            opacity: lastAction.element.style.opacity,
                            position: lastAction.element.style.position,
                            transform: lastAction.element.style.transform
                        });
                    }
                    lastAction.element.style.display = 'none';
                    lastAction.element.style.visibility = 'hidden';
                    lastAction.element.style.opacity = '0';
                    this.hiddenElements.set(lastAction.element, this.originalStates.get(lastAction.element));
                }
                break;
            case 'showAll':
                // 重新隐藏所有元素（需要保存之前的隐藏状态）
                // 这里需要更复杂的实现，暂时简单处理
                this._toggleNormalMode();
                break;
        }

        // 确保回退操作本身不被记录到历史中
        if (this.history.length > tempHistoryLength) {
            this.history.pop();
        }

        this._updateHiddenElementsList();
    }

    /**
     * 获取元素的唯一标识
     */
    _getElementIdentifier(element) {
        if (element.id) return `#${element.id}`;
        if (element.className) {
            // className 可能是 DOMTokenList 或其他类型，需要转换为字符串
            const classNameStr = String(element.className || '').trim();
            if (classNameStr) {
                const classSelector = "." + classNameStr.split(/\s+/).join(".");
                return `${element.tagName.toLowerCase()}${classSelector}`;
            }
        }
        // 尝试生成 XPath
        let xpath = "";
        let el = element;
        while (el && el.nodeType === 1 && el !== document.body) {
            let index = 0;
            let sibling = el.previousSibling;
            while (sibling) {
                if (sibling.nodeType === 1 && sibling.nodeName === el.nodeName) index++;
                sibling = sibling.previousSibling;
            }
            const tagName = el.nodeName.toLowerCase();
            const step = tagName + "[" + (index + 1) + "]";
            xpath = step + "/" + xpath;
            el = el.parentNode;
        }
        return xpath || element.tagName.toLowerCase();
    }

    /**
     * 导出配置
     */
    _exportConfig() {
        const config = {
            hiddenElements: Array.from(this.hiddenElements.keys()).map(element => {
                return {
                    identifier: this._getElementIdentifier(element),
                    xpath: this._getFullXPath(element)
                };
            }),
            exportTime: new Date().toISOString()
        };

        const dataStr = JSON.stringify(config, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        const exportFileDefaultName = `dom-visibility-config-${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    }

    /**
     * 导入配置
     */
    _importConfig(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const config = JSON.parse(e.target.result);
                if (config.hiddenElements && Array.isArray(config.hiddenElements)) {
                    // 先显示所有元素
                    this._toggleNormalMode();

                    // 隐藏配置中指定的元素
                    config.hiddenElements.forEach(configElement => {
                        // 尝试通过 XPath 查找元素
                        let element = null;
                        if (configElement.xpath) {
                            try {
                                const result = document.evaluate(configElement.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                                element = result.singleNodeValue;
                            } catch (error) {
                                console.error('XPath 查找失败:', configElement.xpath, error);
                            }
                        }

                        // 如果 XPath 查找失败，尝试通过标识符查找
                        if (!element && configElement.identifier) {
                            try {
                                if (configElement.identifier.startsWith('#')) {
                                    // ID 选择器
                                    element = document.getElementById(configElement.identifier.substring(1));
                                } else if (configElement.identifier.startsWith('.')) {
                                    // 类选择器
                                    element = document.querySelector(configElement.identifier);
                                } else {
                                    // 标签选择器或其他
                                    element = document.querySelector(configElement.identifier);
                                }
                            } catch (error) {
                                console.error('选择器查找失败:', configElement.identifier, error);
                            }
                        }

                        if (element) {
                            this._hideElement(element);
                        }
                    });

                    alert(`成功导入配置，隐藏了 ${this.hiddenElements.size} 个元素`);
                }
            } catch (error) {
                alert('配置导入失败: ' + error.message);
            }
        };
        reader.readAsText(file);
    }

    /**
     * 获取完整的 XPath
     */
    _getFullXPath(element) {
        const path = [];
        while (element && element.nodeType === 1) {
            let index = 0;
            let sibling = element.previousSibling;
            while (sibling) {
                if (sibling.nodeType === 1 && sibling.nodeName === element.nodeName) index++;
                sibling = sibling.previousSibling;
            }
            const tagName = element.nodeName.toLowerCase();
            const step = tagName + "[" + (index + 1) + "]";
            path.unshift(step);
            element = element.parentNode;
        }
        return "/" + path.join("/");
    }

    /**
     * 更新隐藏元素列表 UI
     */
    _updateHiddenElementsList() {
        const listContainer = document.getElementById(this.htmlId);
        if (!listContainer) return;

        listContainer.innerHTML = '';

        if (this.hiddenElements.size === 0) {
            listContainer.innerHTML = '<li style="color: #6c757d; font-size: 13px; padding: 6px 0; font-style: italic;">没有隐藏的元素</li>';
            return;
        }

        this.hiddenElements.forEach((_, element) => {
            const identifier = this._getElementIdentifier(element);
            const listItem = document.createElement('li');
            listItem.style.cssText = 'font-size: 13px; margin-bottom: 6px; padding: 8px; background: #ffffff; border-radius: 4px; border-left: 3px solid #dc3545; display: flex; justify-content: space-between; align-items: center;';

            const text = document.createElement('span');
            text.textContent = identifier;
            text.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

            const showButton = document.createElement('button');
            showButton.textContent = '显示';
            showButton.style.cssText = 'padding: 4px 8px; border: 1px solid #28a745; border-radius: 4px; background: #28a745; color: #f8f9fa; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.2s ease;';
            showButton.onmouseover = () => {
                showButton.style.background = '#218838';
                showButton.style.borderColor = '#218838';
            };
            showButton.onmouseout = () => {
                showButton.style.background = '#28a745';
                showButton.style.borderColor = '#28a745';
            };
            showButton.onclick = () => {
                this._showElement(element);
            };

            listItem.appendChild(text);
            listItem.appendChild(showButton);
            listContainer.appendChild(listItem);
        });
    }

    // --- UI 渲染方法 ---

    /**
     * 生成控制面板 HTML
     */
    _createControlPanelHTML() {
        let html = `<h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0; color: #212529;">DOM 可见性控制器</h2>`;

        const pauseButtonText = this.isPaused ? '▶️ 恢复拾取' : '⏸️ 暂停拾取';
        const pauseButtonColor = this.isPaused ? '#28a745' : '#ffc107';

        html += `<div style="margin-bottom: 12px; padding: 12px; background: #e9ecef; border-radius: 6px; font-size: 13px; color: #495057;">
            当前模式：<strong style="color: #212529;">${this.isPaused ? '暂停模式' : '隐藏模式'}</strong><br>
            ${this.isPaused ? '点击"恢复拾取"继续操作' : '点击元素隐藏它'}
        </div>`;

        html += `<button id="pause-btn" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid ${pauseButtonColor}; border-radius: 6px; cursor: pointer; background: ${pauseButtonColor}; color: #212529; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">${pauseButtonText}</button>`;

        html += `<button id="undo-btn" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #6c757d; border-radius: 6px; cursor: pointer; background: #6c757d; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">↩️ 回退上一步</button>`;

        html += `<button id="show-all-btn" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #28a745; border-radius: 6px; cursor: pointer; background: #28a745; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">显示所有隐藏元素（正常模式）</button>`;

        html += `<div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <button id="export-config-btn" style="flex: 1; padding: 10px 12px; border: 1px solid #17a2b8; border-radius: 6px; cursor: pointer; background: #17a2b8; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">导出配置</button>
            <label id="import-config-btn" style="flex: 1; padding: 10px 12px; border: 1px solid #fd7e14; border-radius: 6px; cursor: pointer; background: #fd7e14; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease; text-align: center;">
                导入配置
                <input type="file" id="import-file-input" accept=".json" style="display: none;">
            </label>
        </div>`;

        html += `<button id="close-control-panel" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; background: #dc3545; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">完全关闭</button>`;

        // 隐藏元素列表
        html += `<div style="margin: 16px 0;">
            <h3 style="font-size: 15px; margin: 0 0 8px 0; color: #495057; font-weight: 600; border-bottom: 1px solid #e9ecef; padding-bottom: 4px;">隐藏的元素 (${this.hiddenElements.size})</h3>
            <ul id="${this.htmlId}" style="list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto; border: 1px solid #e9ecef; border-radius: 6px; padding: 8px;">
                <li style="color: #6c757d; font-size: 13px; padding: 6px 0; font-style: italic;">没有隐藏的元素</li>
            </ul>
        </div>`;

        this.container.innerHTML = html;
        this._bindButtonEvents();
    }

    /**
     * 暂停/恢复功能
     */
    _togglePause() {
        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            // 暂停：移除事件监听器，隐藏高亮和提示框
            document.removeEventListener("mousemove", this._onMove, true);
            document.removeEventListener("click", this._onClick, true);
            this.overlay.style.display = 'none';
            this.tooltip.style.display = 'none';
        } else {
            // 恢复：重新添加事件监听器，显示高亮和提示框
            document.addEventListener("mousemove", this._onMove, true);
            document.addEventListener("click", this._onClick, true);
            this.overlay.style.display = 'block';
            this.tooltip.style.display = 'block';
        }

        // 更新控制面板 UI
        this._createControlPanelHTML();
    }

    /**
     * 绑定按钮事件
     */
    _bindButtonEvents() {
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) {
            pauseBtn.onclick = () => {
                this._togglePause();
            };
        }

        const undoBtn = document.getElementById('undo-btn');
        if (undoBtn) {
            undoBtn.onclick = () => {
                this._undo();
            };
        }

        const showAllBtn = document.getElementById('show-all-btn');
        if (showAllBtn) {
            showAllBtn.onclick = () => {
                this._toggleNormalMode();
            };
        }

        const exportBtn = document.getElementById('export-config-btn');
        if (exportBtn) {
            exportBtn.onclick = () => {
                this._exportConfig();
            };
        }

        const importBtn = document.getElementById('import-config-btn');
        const importFileInput = document.getElementById('import-file-input');
        if (importBtn && importFileInput) {
            importBtn.onclick = () => {
                importFileInput.click();
            };

            importFileInput.onchange = (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this._importConfig(e.target.files[0]);
                    // 清空文件输入
                    e.target.value = '';
                }
            };
        }

        const closeBtn = document.getElementById('close-control-panel');
        if (closeBtn) {
            closeBtn.onclick = this.cleanup.bind(this);
        }
    }

    // --- 事件处理程序 (使用箭头函数确保 this 绑定) ---

    _onMove = (e) => {
        if (this.isPaused) return;

        let el = document.elementFromPoint(e.clientX, e.clientY);
        // 忽略工具本身元素
        if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) {
            el = this.currentElement;
        }
        if (!el) return;
        this.currentElement = el;

        // 更新高亮和提示框
        const rect = el.getBoundingClientRect();
        this.overlay.style.top = rect.top + window.scrollY + "px";
        this.overlay.style.left = rect.left + window.scrollX + "px";
        this.overlay.style.width = rect.width + "px";
        this.overlay.style.height = rect.height + "px";
        this.overlay.style.border = "2px solid #6c757d";
        this.overlay.style.background = "rgba(108, 117, 125, 0.2)";
        this.tooltip.style.top = rect.top - 30 + "px";
        this.tooltip.style.left = rect.left + "px";
        this.tooltip.innerText = `点击隐藏 <${el.tagName.toLowerCase()}>`;
    }

    _onClick = (e) => {
        if (this.isPaused) return;

        // 如果点击在工具箱内，不进行操作
        if (this.container.contains(e.target)) return;

        e.preventDefault();
        e.stopPropagation();

        let el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) return;

        this.currentElement = el;

        // 隐藏模式：点击元素时隐藏它
        this._hideElement(el);
        console.log(`元素 <${el.tagName.toLowerCase()}> 已隐藏`);
    }

    // --- 启动与清理 ---

    /**
     * 启动/重置拾取状态
     */
    _startPicking() {
        document.addEventListener("mousemove", this._onMove, true);
        document.addEventListener("click", this._onClick, true);

        this.overlay.style.border = "2px solid #6c757d";
        this.overlay.style.background = "rgba(108, 117, 125, 0.2)";

        // 初始化控制面板
        this._createControlPanelHTML();
    }

    /**
     * 清理所有 UI 和事件监听
     */
    cleanup() {
        document.removeEventListener("mousemove", this._onMove, true);
        document.removeEventListener("click", this._onClick, true);
        this.overlay.remove();
        this.tooltip.remove();
        this.container.remove();
        window.__visibilityControllerCleanup = undefined;
        console.log("DOM 可见性控制器已完全关闭");
    }
}

// -------------------------------------------------------------------
// --- 启动脚本 (保持原入口函数逻辑)
// -------------------------------------------------------------------

function startDomVisibilityController() {
    // 确保只运行一次
    if (window.__visibilityControllerInstance) {
        window.__visibilityControllerInstance.cleanup();
    }
    window.__visibilityControllerInstance = new DomVisibilityController();
}

function main() {
    // 调用主函数启动
    startDomVisibilityController();
}
