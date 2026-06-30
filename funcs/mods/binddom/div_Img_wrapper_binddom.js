/**
 * 实时资源选择器 + 选择器确认功能
 * 基于 div_Img_wrapper.js，添加确认选择器按钮
 */

/**
 * @fileoverview 页面元素拾取与确认
 *
 * @scenario    用户启动 BindDom 选择器时
 * @feature     提供悬浮高亮 overlay、tooltip 实时选中页面元素
 * @effect      创建遮罩/提示/容器 DOM 元素，高亮鼠标悬停的元素
 * @category    工具辅助
 * @platform    通用
 * @entry       ResourcePicker 构造函数自动执行
 */
console.log('[BindDom] 脚本开始加载');

// 防止重复加载
if (window._binddomPickerLoaded) {
    console.log('[BindDom] 脚本已加载，跳过');
} else {
    window._binddomPickerLoaded = true;

    class ResourcePicker {
        constructor() {
            this.isLocked = false;
            this.currentElement = null;
            this.htmlId = 'target-element-html-content';
            this._dragHeader = null;

            this.overlay = this._createOverlay();
            this.tooltip = this._createTooltip();
            this.container = this._createContainer();

            this._startPicking();
            window.__pickerCleanup = this.cleanup.bind(this);
        }

        _createOverlay() {
            const overlay = document.createElement("div");
            Object.assign(overlay.style, {
                position: "absolute",
                border: "2px solid #8b5cf6",
                background: "rgba(139, 92, 246, 0.2)",
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
                background: "#1f2937",
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

            // 添加拖拽头部
            const header = document.createElement("div");
            header.textContent = "⋮⋮ 拖动面板";
            Object.assign(header.style, {
                position: "relative",
                margin: "-16px -16px 12px -16px",
                padding: "8px 12px",
                background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
                color: "white",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "move",
                borderRadius: "8px 8px 0 0",
                userSelect: "none"
            });
            container.appendChild(header);
            this._dragHeader = header;

            // 拖拽逻辑
            let isDragging = false;
            let dragOffsetX = 0;
            let dragOffsetY = 0;

            header.addEventListener("mousedown", (e) => {
                if (e.target !== header) return;
                isDragging = true;
                const rect = container.getBoundingClientRect();
                dragOffsetX = e.clientX - rect.left;
                dragOffsetY = e.clientY - rect.top;
                header.style.cursor = "grabbing";
                e.preventDefault();
            });

            document.addEventListener("mousemove", (e) => {
                if (!isDragging) return;
                const x = e.clientX - dragOffsetX;
                const y = e.clientY - dragOffsetY;
                // 限制在视口内
                const maxX = window.innerWidth - container.offsetWidth;
                const maxY = window.innerHeight - container.offsetHeight;
                container.style.left = Math.max(0, Math.min(x, maxX)) + "px";
                container.style.top = Math.max(0, Math.min(y, maxY)) + "px";
                container.style.right = "auto"; // 切换为 left 定位
            });

            document.addEventListener("mouseup", () => {
                if (isDragging) {
                    isDragging = false;
                    header.style.cursor = "move";
                }
            });

            document.body.appendChild(container);
            return container;
        }

        _addResource(set, url) {
            if (url && typeof url === 'string' && url.trim().length > 0) {
                if (url.startsWith('data:')) {
                    const typeMatch = url.match(/^data:([^;,]+)/);
                    const type = typeMatch ? typeMatch[1] : 'unknown';
                    const sizeKB = Math.ceil((url.length * 0.75) / 1024);
                    set.add(`[DATA URI] Type: ${type}, Size: ${sizeKB} KB`);
                } else {
                    set.add(new URL(url, window.location.href).href);
                }
            }
        }

        _gatherResources(element) {
            const resources = { images: new Set(), links: new Set(), media: new Set(), other: new Set() };
            if (!element) return { images: [], links: [], media: [], other: [] };

            const elementsToCheck = element.tagName === 'IMG' ? [element] : Array.from(element.querySelectorAll('img'));
            elementsToCheck.forEach(img => {
                this._addResource(resources.images, img.src);
                if (img.srcset) {
                    img.srcset.split(',').forEach(part => {
                        this._addResource(resources.images, part.trim().split(/\s+/)[0]);
                    });
                }
                const lazySrc = img.getAttribute('data-src') || img.getAttribute('data-original');
                if (lazySrc) this._addResource(resources.images, lazySrc);
            });

            element.querySelectorAll('video, audio').forEach(media => {
                this._addResource(resources.media, media.src);
            });
            element.querySelectorAll('a[href]').forEach(a => {
                this._addResource(resources.links, a.href);
            });

            return {
                images: Array.from(resources.images),
                links: Array.from(resources.links),
                media: Array.from(resources.media),
                other: Array.from(resources.other)
            };
        }

        _hasNoResources(resources) {
            return resources.images.length === 0 && resources.links.length === 0 && resources.media.length === 0 && resources.other.length === 0;
        }

        _generateSelectors(element) {
            if (!element) return {};

            const getCssSelector = (el) => {
                if (el.id) return `#${el.id}`;
                if (el.className) {
                    const classSelector = "." + el.className.trim().split(/\s+/).join(".");
                    return `${el.tagName.toLowerCase()}${classSelector}`;
                }
                return el.tagName.toLowerCase();
            };

            const getJsPath = (el) => {
                let path = "";
                while (el && el.nodeType === 1 && el !== document.body) {
                    let selector = el.nodeName.toLowerCase();
                    if (el.id) {
                        selector += "#" + el.id;
                        path = selector + (path ? " > " + path : "");
                        break;
                    } else {
                        let sib = el, nth = 1;
                        while (sib.previousElementSibling) {
                            sib = sib.previousElementSibling;
                            if (sib.nodeName === el.nodeName) nth++;
                        }
                        selector += `:nth-of-type(${nth})`;
                    }
                    path = selector + (path ? " > " + path : "");
                    el = el.parentElement;
                }
                return "document.querySelector(\"" + path + "\")";
            };

            const getXPath = (el) => {
                if (el.id) return `//*[@id="${el.id}"]`;
                if (el === document.body) return "/html/body";
                let ix = 0;
                const siblings = el.parentNode ? el.parentNode.childNodes : [];
                for (let i = 0; i < siblings.length; i++) {
                    const sibling = siblings[i];
                    if (sibling === el) {
                        return getXPath(el.parentNode) + "/" + el.tagName.toLowerCase() + "[" + (ix + 1) + "]";
                    }
                    if (sibling.nodeType === 1 && sibling.tagName === el.tagName) ix++;
                }
                return "";
            };

            const getFullXPath = (el) => {
                const path = [];
                while (el && el.nodeType === 1) {
                    let index = 0;
                    let sibling = el.previousSibling;
                    while (sibling) {
                        if (sibling.nodeType === 1 && sibling.nodeName === el.nodeName) index++;
                        sibling = sibling.previousSibling;
                    }
                    const tagName = el.nodeName.toLowerCase();
                    const step = tagName + "[" + (index + 1) + "]";
                    path.unshift(step);
                    el = el.parentNode;
                }
                return "/" + path.join("/");
            };

            return {
                css: getCssSelector(element),
                jsPath: getJsPath(element),
                xpath: getXPath(element),
                fullXPath: getFullXPath(element)
            };
        }

        _createResourceListHTML(resources) {
            let html = '<h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0; color: #8b5cf6;">🎯 元素选择器</h2>';

            const buttonText = this.isLocked ? "✅ 已锁定" : "🖱️ 预览模式";
            const buttonStyle = this.isLocked ?
                "background: #8b5cf6; color: #f8f9fa; border-color: #8b5cf6;" :
                "background: #f8f9fa; color: #212529; border-color: #8b5cf6;";
            html += `<button id="toggle-resource-picker" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #8b5cf6; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s ease; ${buttonStyle}">${buttonText}</button>`;
            html += `<button id="close-all-picker" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; background: #dc3545; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">关闭</button>`;

            if (this._hasNoResources(resources) && this.currentElement) {
                html += `<div style="background: #f3e8ff; border-radius: 6px; padding: 12px; margin: 12px 0;">
                    <p style="font-size: 13px; margin: 0; color: #6d28d9;">点击锁定后可选择该元素</p>
                </div>`;
            } else {
                const generateList = (title, items, limit) => {
                    let listHtml = `<div style="margin: 12px 0;">
                        <h3 style="font-size: 14px; margin: 0 0 8px 0; color: #495057; font-weight: 600;">${title} (${items.length})</h3>
                        <ul style="list-style: none; padding: 0; margin: 0;">`;
                    if (items.length === 0) {
                        listHtml += '<li style="color: #6c757d; font-size: 12px; padding: 4px 0;">无</li>';
                    } else {
                        items.slice(0, limit).forEach(url => {
                            const displayUrl = url.startsWith('[') ? url : (url.substring(url.lastIndexOf('/') + 1) || new URL(url).hostname);
                            listHtml += `<li style="font-size: 12px; margin-bottom: 4px; padding: 4px 0; border-bottom: 1px solid #f8f9fa;">
                                <a href="${url.startsWith('[') ? '#' : url}" target="_blank" title="${url}" style="color: #8b5cf6; text-decoration: none; word-break: break-all;">${displayUrl}</a>
                            </li>`;
                        });
                    }
                    listHtml += '</ul></div>';
                    return listHtml;
                };

                html += generateList('图片', resources.images, 5);
                html += generateList('链接', resources.links, 5);
            }

            this._setContent(html);
            this._bindButtonEvents();
        }

        _createFullResourceList(resources, tagName, element) {
            this.htmlCollapsed = true;
            const paths = this._generateSelectors(element);
            const currentUrl = window.location.href;

            // 简化UI：只显示URL和CSS选择器
            let html = `<h2 style="font-size: 16px; font-weight: 600; margin: 0 0 12px 0; color: #8b5cf6;">🎯 绑定设置</h2>`;

            html += `<button id="close-all-picker" style="position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; border: none; border-radius: 4px; background: #dc3545; color: white; font-size: 16px; cursor: pointer; line-height: 24px;">×</button>`;

            // URL 显示
            html += `<div style="margin-bottom: 12px;">
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 4px;">📍 当前页面 URL</div>
                <div style="font-size: 12px; font-family: monospace; background: #f3f4f6; padding: 8px; border-radius: 4px; word-break: break-all; color: #333;">${this._escapeHtml(currentUrl)}</div>
            </div>`;

            // 选择器显示
            html += `<div style="margin-bottom: 12px;">
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 4px;">🎯 CSS 选择器</div>
                <div style="font-size: 12px; font-family: monospace; background: #e9ecef; padding: 8px; border-radius: 4px; word-break: break-all; color: #333;">${this._escapeHtml(paths.css)}</div>
            </div>`;

            // 描述输入
            html += `<div style="margin-bottom: 12px;">
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 4px;">📝 描述（可选）</div>
                <input type="text" id="binddom-desc-input" placeholder="如：导航菜单" style="width: 100%; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
            </div>`;

            // 确认保存按钮
            html += `<button id="confirm-selector-btn" style="width: 100%; padding: 12px; border: none; border-radius: 6px; cursor: pointer; background: #28a745; color: white; font-size: 14px; font-weight: 600;">✅ 保存绑定</button>`;

            // 继续选择按钮
            html += `<button id="continue-picker-btn" style="width: 100%; padding: 8px; margin-top: 8px; border: 1px solid #8b5cf6; border-radius: 6px; cursor: pointer; background: white; color: #8b5cf6; font-size: 12px;">继续选择其他元素</button>`;

            this._setContent(html);

            // 保存绑定
            const confirmBtn = document.getElementById('confirm-selector-btn');
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    const desc = document.getElementById('binddom-desc-input')?.value || '';
                    const selector = `css:${paths.css};xpath:${paths.xpath};jsPath:${paths.jsPath};fullXPath:${paths.fullXPath}`;

                    console.log('[BindDom] 保存绑定:', { url: currentUrl, selector, desc });

                    // 发送到 background 保存
                    chrome.runtime.sendMessage({
                        action: 'binddom.addBinding',
                        url: currentUrl,
                        selector: selector,
                        desc: desc
                    }, (response) => {
                        console.log('[BindDom] 保存响应:', response);
                        if (response && response.success) {
                            this.cleanup();
                            alert('绑定已保存！');
                        } else {
                            alert('保存失败: ' + (response?.error || '未知错误'));
                        }
                    });
                };
            }

            // 继续选择
            const continueBtn = document.getElementById('continue-picker-btn');
            if (continueBtn) {
                continueBtn.onclick = () => {
                    this.isLocked = false;
                    this._startPicking();
                };
            }

            this._bindButtonEvents();
        }

        _escapeHtml(str) {
            if (typeof str !== 'string') return str;
            const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return str.replace(/[&<>"']/g, match => escapeMap[match]);
        }

        // 设置面板内容（保留拖拽头部）
        _setContent(html) {
            this.container.innerHTML = '';
            if (this._dragHeader) {
                this.container.appendChild(this._dragHeader);
            }
            const content = document.createElement('div');
            content.innerHTML = html;
            this.container.appendChild(content);
        }

        _bindButtonEvents() {
            const toggleBtn = document.getElementById('toggle-resource-picker');
            if (toggleBtn) {
                toggleBtn.onclick = () => {
                    if (this.isLocked) {
                        this.isLocked = false;
                        this._startPicking();
                    } else {
                        this.cleanup();
                    }
                };
            }
            const closeBtn = document.getElementById('close-all-picker');
            if (closeBtn) {
                closeBtn.onclick = this.cleanup.bind(this);
            }
        }

        _onMove = (e) => {
            if (this.isLocked) return;

            let el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) {
                el = this.currentElement;
            }
            if (!el) return;
            this.currentElement = el;

            const rect = el.getBoundingClientRect();
            this.overlay.style.top = rect.top + window.scrollY + "px";
            this.overlay.style.left = rect.left + window.scrollX + "px";
            this.overlay.style.width = rect.width + "px";
            this.overlay.style.height = rect.height + "px";
            this.overlay.style.border = "2px solid #8b5cf6";
            this.tooltip.style.top = rect.top - 30 + "px";
            this.tooltip.style.left = rect.left + "px";
            this.tooltip.innerText = `<${el.tagName.toLowerCase()}>`;

            const resources = this._gatherResources(el);
            this._createResourceListHTML(resources);
        }

        _onClick = (e) => {
            if (this.container.contains(e.target)) return;

            e.preventDefault();
            e.stopPropagation();

            let el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) return;

            this.currentElement = el;

            if (!this.isLocked) {
                this.isLocked = true;
                document.removeEventListener("mousemove", this._onMove, true);

                this.overlay.style.border = "3px solid #6d28d9";
                this.overlay.style.background = "rgba(109, 40, 217, 0.25)";
                this.tooltip.innerText = `锁定 <${el.tagName.toLowerCase()}>`;

                const resources = this._gatherResources(el);
                this._createFullResourceList(resources, el.tagName.toLowerCase(), el);

                console.log(`元素已锁定: ${el.tagName}`);
            } else {
                this.isLocked = false;
                this._startPicking();
            }
        }

        _startPicking() {
            document.addEventListener("mousemove", this._onMove, true);
            document.addEventListener("click", this._onClick, true);

            this.overlay.style.border = "2px solid #8b5cf6";
            this.overlay.style.background = "rgba(139, 92, 246, 0.2)";

            if (!this.currentElement) {
                this._setContent('<h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0; color: #8b5cf6;">🎯 元素选择器</h2><p style="color: #6c757d; margin-bottom: 16px; line-height: 1.5;">将鼠标移动到页面元素上，点击锁定后确认选择。</p><button id="close-all-picker" style="width: 100%; padding: 10px 12px; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; background: #dc3545; color: #f8f9fa; font-size: 14px; font-weight: 500;">关闭</button>');
                this._bindButtonEvents();
            } else {
                const resources = this._gatherResources(this.currentElement);
                this._createResourceListHTML(resources);
            }
        }

        cleanup() {
            document.removeEventListener("mousemove", this._onMove, true);
            document.removeEventListener("click", this._onClick, true);
            this.overlay.remove();
            this.tooltip.remove();
            this.container.remove();
            window.__pickerCleanup = undefined;
            console.log("元素选择器已关闭");
        }
    }

    // 暴露到 window
    window.ResourcePicker = ResourcePicker;
}

// 主函数
function main() {
    if (window._binddomPickerRunning) {
        console.log('[BindDom] 选择器已在运行中，跳过');
        return;
    }
    window._binddomPickerRunning = true;

    try {
        console.log('[BindDom] 开始启动选择器, readyState:', document.readyState);
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                console.log('[BindDom] DOM已就绪，启动选择器');
                new window.ResourcePicker();
            });
        } else {
            console.log('[BindDom] DOM已就绪，立即启动选择器');
            new window.ResourcePicker();
        }
    } catch (e) {
        console.error('[BindDom] 启动失败:', e);
        window._binddomPickerRunning = false;
    }
}

main();
