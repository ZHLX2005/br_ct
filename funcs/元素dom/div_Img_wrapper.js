/**
 * @fileoverview 实时资源嗅探选择器
 *
 * @scenario    调试时需要嗅探页面上元素对应的图片/链接等资源
 * @feature     悬浮高亮元素，嗅探并展示关联的图片/链接等资源
 * @effect      注入悬浮面板DOM，展示选中元素的资源嗅探结果
 * @category    DOM创建
 * @platform    通用
 * @entry       自动执行
 */

/**
 * 实时资源选择器 (Resource Picker) 类。
 * 将所有 UI 元素、状态和事件处理逻辑封装在一起，提高可维护性。
 */

// 清理旧实例（如果存在）
if (window.__pickerInstance) {
    window.__pickerInstance.cleanup();
    window.__pickerInstance = null;
}

// 定义 ResourcePicker 类
window.ResourcePicker = class ResourcePicker {
    constructor() {
        this.isLocked = false;
        this.currentElement = null;
        this.htmlId = 'target-element-html-content';

        // 1. UI 元素初始化
        this.overlay = this._createOverlay();
        this.tooltip = this._createTooltip();
        this.container = this._createContainer();

        // 2. 启动事件监听
        this._startPicking();

        console.log("实时资源嗅探已启动 (零资源时显示 HTML 结构)");
        // 暴露实例和清理方法
        window.__pickerInstance = this;
        window.__pickerCleanup = this.cleanup.bind(this);
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

    // --- 核心工具方法 ---

    /**
     * 将 URL 转换为绝对 URL 或处理 Data URI
     */
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

    /**
     * 嗅探当前元素及其子元素中的资源
     */
    _gatherResources(element) {
        const resources = {
            images: new Set(),
            links: new Set(),
            media: new Set(),
            other: new Set()
        };
        if (!element) return { images: [], links: [], media: [], other: [] };

        // 收集所有 IMG 元素 (包括自身)
        const elementsToCheck = element.tagName === 'IMG' ? [element] : Array.from(element.querySelectorAll('img'));

        elementsToCheck.forEach(img => {
            this._addResource(resources.images, img.src);
            if (img.srcset) {
                img.srcset.split(',').forEach(part => {
                    this._addResource(resources.images, part.trim().split(/\s+/)[0]);
                });
            }
            const lazySrc = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-srcset');
            if (lazySrc) {
                if (lazySrc.includes(',')) {
                    lazySrc.split(',').forEach(part => {
                        this._addResource(resources.images, part.trim().split(/\s+/)[0]);
                    });
                } else {
                    this._addResource(resources.images, lazySrc);
                }
            }
        });

        element.querySelectorAll('video, audio').forEach(media => {
            this._addResource(resources.media, media.src);
        });
        element.querySelectorAll('source').forEach(source => {
            if (source.type && source.type.startsWith('image/')) {
                this._addResource(resources.images, source.srcset || source.src);
            } else {
                this._addResource(resources.media, source.src);
            }
        });

        element.querySelectorAll('a[href]').forEach(a => {
            this._addResource(resources.links, a.href);
        });

        element.querySelectorAll('link[href]').forEach(link => {
            const rel = link.getAttribute('rel');
            if (rel && (rel.includes('icon') || rel.includes('apple-touch-icon'))) {
                this._addResource(resources.images, link.href);
            } else if (rel && rel !== 'stylesheet') {
                this._addResource(resources.other, `[LINK:${rel}] ${link.href}`);
            }
        });

        return {
            images: Array.from(resources.images),
            links: Array.from(resources.links),
            media: Array.from(resources.media),
            other: Array.from(resources.other)
        };
    }

    /**
     * 检查资源是否为空
     */
    _hasNoResources(resources) {
        return (
            resources.images.length === 0 &&
            resources.links.length === 0 &&
            resources.media.length === 0 &&
            resources.other.length === 0
        );
    }

    /**
     * 对 HTML 代码进行简单的格式化，以便于阅读
     * 保持与原代码中格式化逻辑的一致性，使用四个空格缩进
     */
    _formatHTML(html) {
        let result = '';
        let indent = 0;
        const INDENT_SPACES = '    '; 
        
        const tokens = html.match(/<(?:\w+|[^>]+)>/g) || [];
        let lastIndex = 0;

        tokens.forEach(token => {
            const textContent = html.substring(lastIndex, html.indexOf(token, lastIndex)).trim();
            if (textContent.length > 0) {
                if (result.length > 0 && result.slice(-1) !== '\n') {
                     result += '\n' + INDENT_SPACES.repeat(indent);
                }
                result += textContent;
            }

            if (token.startsWith('</')) { 
                indent--;
                result += '\n' + INDENT_SPACES.repeat(indent) + token;
            } else if (token.endsWith('/>') || token.endsWith('-->')) { 
                result += '\n' + INDENT_SPACES.repeat(indent) + token;
            } else if (token.startsWith('<')) { 
                if (result.length > 0 && !result.endsWith('\n')) {
                    result += '\n';
                }
                result += INDENT_SPACES.repeat(indent) + token;
                indent++;
            }
            lastIndex = html.indexOf(token, lastIndex) + token.length;
        });
        
        const remainingText = html.substring(lastIndex).trim();
        if (remainingText.length > 0) {
             if (result.length > 0 && !result.endsWith('\n')) {
                result += '\n' + INDENT_SPACES.repeat(indent);
            }
            result += remainingText;
        }

        return result.trim().replace(/\n\s*\n/g, '\n');
    }

    // --- UI 渲染方法 ---

    /**
     * 生成资源列表的 HTML 并更新容器 (预览模式)
     */
    _createResourceListHTML(resources) {
        let html = '<h2 style="font-size: 18px; font-weightkont-size: 18px; font-weight: 600; margin: 0 0 16px 0; color: #212529;">资源嗅探结果</h2>';

        const buttonText = this.isLocked ? "✅ 已锁定 (点击解锁)" : "🖱️ 实时预览 (点击锁定)";
        const buttonStyle = this.isLocked ?
            "background: #6c757d; color: #f8f9fa; border-color: #6c757d;" :
            "background: #f8f9fa; color: #212529; border-color: #ced4da;";
        html += `<button id="toggle-resource-picker" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #ced4da; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s ease; ${buttonStyle}">${buttonText}</button>`;
        html += `<button id="close-all-picker" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; background: #dc3545; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">完全关闭</button>`;

        if (this._hasNoResources(resources) && this.currentElement) {
            html += `<div style="background: #e9ecef; border-radius: 6px; padding: 12px; margin: 12px 0;">
                <h3 style="font-size: 14px; margin: 0 0 8px 0; color: #495057; font-weight: 600;">未检测到可下载资源</h3>
                <p style="font-size: 13px; margin: 0; color: #6c757d; line-height: 1.4;">点击锁定后将显示该元素的<strong>格式化原始 HTML 结构</strong></p>
            </div>`;
        } else {
            const generateList = (title, items, limit) => {
                let listHtml = `<div style="margin: 16px 0;">
                    <h3 style="font-size: 15px; margin: 0 0 8px 0; color: #495057; font-weight: 600; border-bottom: 1px solid #e9ecef; padding-bottom: 4px;">${title} (${items.length})</h3>
                    <ul style="list-style: none; padding: 0; margin: 0;">`;
                if (items.length === 0) {
                    listHtml += '<li style="color: #6c757d; font-size: 13px; padding: 4px 0; font-style: italic;">未找到资源</li>';
                } else {
                    items.slice(0, limit).forEach(url => {
                        const displayUrl = url.startsWith('[') ? url : (url.substring(url.lastIndexOf('/') + 1) || new URL(url).hostname);
                        listHtml += `<li style="font-size: 13px; margin-bottom: 4px; padding: 4px 0; border-bottom: 1px solid #f8f9fa;">
                            <a href="${url.startsWith('[') ? '#' : url}" target="_blank" title="${url}" style="color: #007bff; text-decoration: none; word-break: break-all; transition: color 0.2s ease;"
                               onmouseover="this.style.color='#0056b3'; this.style.textDecoration='underline';"
                               onmouseout="this.style.color='#007bff'; this.style.textDecoration='none';">${displayUrl}</a>
                        </li>`;
                    });
                    if (items.length > limit) {
                        listHtml += `<li style="font-size: 13px; color: #6c757d; padding: 4px 0; font-style: italic;">... 还有 ${items.length - limit} 个未显示</li>`;
                    }
                }
                listHtml += '</ul></div>';
                return listHtml;
            };

            html += generateList('图片/图标', resources.images, 5);
            html += generateList('媒体', resources.media, 3);
            html += generateList('链接', resources.links, 5);
            html += generateList('其他资源', resources.other, 2);
        }

        this.container.innerHTML = html;
        this._bindButtonEvents();
    }

    // === 在 ResourcePicker 类里新增方法 ===
_generateSelectors(element) {
    if (!element) return {};

    // 1. CSS 选择器 (带唯一性)
    const getCssSelector = (el) => {
        if (el.id) return `#${el.id}`;
        if (el.className) {
            const classSelector = "." + el.className.trim().split(/\s+/).join(".");
            return `${el.tagName.toLowerCase()}${classSelector}`;
        }
        return el.tagName.toLowerCase();
    };

    // 2. JS 路径 (querySelector)
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

    // 3. 简单 XPath
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
            if (sibling.nodeType === 1 && sibling.tagName === el.tagName) {
                ix++;
            }
        }
        return "";
    };

    // 4. 完整 XPath (从 html 开始)
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

/**
 * 绑定"一键复制所有路径"按钮事件
 */
_bindCopyAllPathsButton(element) {
  const copyAllBtn = document.getElementById('copy-all-paths-btn');
  if (copyAllBtn) {
    copyAllBtn.onclick = () => {
      const paths = this._generateSelectors(element);

      // 构建格式化文本: css: xxx ; jsPath: xxx ; xpath: xxx ; fullXPath: xxx
      const formattedText = `css: ${paths.css} ; jsPath: ${paths.jsPath} ; xpath: ${paths.xpath} ; fullXPath: ${paths.fullXPath}`;

      navigator.clipboard.writeText(formattedText).then(() => {
        // 复制成功的视觉反馈
        const originalText = copyAllBtn.innerText;
        const originalBg = copyAllBtn.style.background;
        const originalBorder = copyAllBtn.style.borderColor;

        copyAllBtn.innerText = "✓ 已复制所有路径";
        copyAllBtn.style.background = '#1e7e34';
        copyAllBtn.style.borderColor = '#1e7e34';

        setTimeout(() => {
          copyAllBtn.innerText = originalText;
          copyAllBtn.style.background = originalBg;
          copyAllBtn.style.borderColor = originalBorder;
        }, 2000);
      }).catch(err => {
        // 复制失败的视觉反馈
        const originalText = copyAllBtn.innerText;
        const originalBg = copyAllBtn.style.background;
        const originalBorder = copyAllBtn.style.borderColor;

        copyAllBtn.innerText = "✗ 复制失败";
        copyAllBtn.style.background = '#dc3545';
        copyAllBtn.style.borderColor = '#dc3545';

        setTimeout(() => {
          copyAllBtn.innerText = originalText;
          copyAllBtn.style.background = originalBg;
          copyAllBtn.style.borderColor = originalBorder;
        }, 2000);
      });
    };
  }
}

_bindPathButtonEvent(element) {
  const pathBtn = document.getElementById('get-paths-btn');
  if (pathBtn) {
    pathBtn.onclick = () => {
      const paths = this._generateSelectors(element);

      // 创建路径显示区域的HTML
      let html = `
        <div style="margin-top: 16px; border-top: 1px solid #e9ecef; padding-top: 16px;">
          <h3 style="font-size: 15px; margin: 0 0 12px 0; color: #495057; font-weight: 600; border-bottom: 1px solid #e9ecef; padding-bottom: 6px;">多种选择器路径</h3>
          <div style="display: flex; flex-direction: column; gap: 12px;">
      `;

      for (const [key, value] of Object.entries(paths)) {
        const escapedKey = this._escapeHtml(key);
        const escapedValue = this._escapeHtml(value);

        // 根据不同类型显示不同的标签颜色
        let labelColor = '#6c757d';
        let labelText = escapedKey.toUpperCase();

        if (escapedKey === 'css') {
          labelColor = '#007bff';
          labelText = 'CSS';
        } else if (escapedKey === 'jsPath') {
          labelColor = '#28a745';
          labelText = 'JS';
        } else if (escapedKey === 'xpath') {
          labelColor = '#fd7e14';
          labelText = 'XPath';
        } else if (escapedKey === 'fullXPath') {
          labelColor = '#6f42c1';
          labelText = 'Full XPath';
        }

        html += `
          <div style="display: flex; flex-direction: column; gap: 6px; padding: 12px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid ${labelColor};">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="background: ${labelColor}; color: #f8f9fa; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px;">${labelText}</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: stretch;">
              <input
                type="text"
                value="${escapedValue}"
                readonly
                style="flex: 1; padding: 8px 12px; border: 1px solid #ced4da; border-radius: 4px; background: #ffffff; color: #495057; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 11px; line-height: 1.4; outline: none; cursor: text;"
              />
              <button
                class="copy-path-btn"
                data-value="${escapedValue}"
                style="padding: 8px 12px; border: 1px solid #007bff; border-radius: 4px; background: #007bff; color: #f8f9fa; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s ease; white-space: nowrap; min-width: 60px;"
                onmouseover="this.style.background='#0056b3'; this.style.borderColor='#0056b3';"
                onmouseout="this.style.background='#007bff'; this.style.borderColor='#007bff';"
              >复制</button>
            </div>
          </div>
        `;
      }

      html += `
          </div>
        </div>
      `;

      this.container.insertAdjacentHTML("beforeend", html);

      // 绑定复制按钮事件
      this.container.querySelectorAll(".copy-path-btn").forEach(btn => {
        btn.onclick = () => {
          const value = btn.getAttribute("data-value");
          navigator.clipboard.writeText(value).then(() => {
            // 复制成功的视觉反馈
            const originalText = btn.innerText;
            const originalBg = btn.style.background;
            const originalBorder = btn.style.borderColor;

            btn.innerText = "✓ 已复制";
            btn.style.background = '#28a745';
            btn.style.borderColor = '#28a745';

            setTimeout(() => {
              btn.innerText = originalText;
              btn.style.background = originalBg;
              btn.style.borderColor = originalBorder;
            }, 1500);
          }).catch(err => {
            // 复制失败的视觉反馈
            const originalText = btn.innerText;
            const originalBg = btn.style.background;
            const originalBorder = btn.style.borderColor;

            btn.innerText = "✗ 复制失败";
            btn.style.background = '#dc3545';
            btn.style.borderColor = '#dc3545';

            setTimeout(() => {
              btn.innerText = originalText;
              btn.style.background = originalBg;
              btn.style.borderColor = originalBorder;
            }, 1500);
          });
        };
      });
    };
  }
}

/**
 * 绑定快速复制全部路径按钮事件
 * 格式: css:xxx;xpath:xxx;jsPath:xxx;fullXPath:xxx
 */
_bindCopyAllPathsEvent(element) {
  const copyAllBtn = document.getElementById('copy-all-paths-btn');
  if (!copyAllBtn) return;

  copyAllBtn.onclick = () => {
    const paths = this._generateSelectors(element);
    // 格式化所有路径为 css:xxx;xpath:xxx;jsPath:xxx;fullXPath:xxx 格式
    const allPathsText = `css:${paths.css};xpath:${paths.xpath};jsPath:${paths.jsPath};fullXPath:${paths.fullXPath}`;

    navigator.clipboard.writeText(allPathsText).then(() => {
      // 复制成功视觉反馈
      const originalText = copyAllBtn.innerText;
      const originalBg = copyAllBtn.style.background;
      const originalBorder = copyAllBtn.style.borderColor;

      copyAllBtn.innerText = "✓ 已复制全部路径";
      copyAllBtn.style.background = '#218838';
      copyAllBtn.style.borderColor = '#218838';

      setTimeout(() => {
        copyAllBtn.innerText = originalText;
        copyAllBtn.style.background = originalBg;
        copyAllBtn.style.borderColor = originalBorder;
      }, 1500);
    }).catch(err => {
      // 复制失败视觉反馈
      const originalText = copyAllBtn.innerText;
      const originalBg = copyAllBtn.style.background;
      const originalBorder = copyAllBtn.style.borderColor;

      copyAllBtn.innerText = "✗ 复制失败";
      copyAllBtn.style.background = '#c82333';
      copyAllBtn.style.borderColor = '#c82333';

      setTimeout(() => {
        copyAllBtn.innerText = originalText;
        copyAllBtn.style.background = originalBg;
        copyAllBtn.style.borderColor = originalBorder;
      }, 1500);
    });
  };
}

/**
 * HTML 转义函数：将特殊字符转换为文本实体，避免被解析为 HTML
 * @param {string} str - 需要转义的原始文本
 * @returns {string} 转义后的安全文本
 */
_escapeHtml(str) {
  if (typeof str !== 'string') return str; // 非字符串直接返回
  // 映射表：key 是原始特殊字符，value 是对应的 HTML 实体
  const escapeMap = {
    '&': '&amp;',  // 与符号：避免解析为 HTML 实体的开始
    '<': '&lt;',   // 小于号：避免解析为 HTML 标签的开始
    '>': '&gt;',   // 大于号：避免解析为 HTML 标签的结束
    '"': '&quot;', // 双引号：避免提前闭合 HTML 属性（如 value=""）
    "'": '&#39;'   // 单引号：避免提前闭合 HTML 属性（如 onclick=''）
  };
  // 替换所有特殊字符
  return str.replace(/[&<>"']/g, match => escapeMap[match]);
}
    /**
     * 生成完整的资源列表 (锁定状态下使用) 或 HTML 结构
     */
 _createFullResourceList(resources, tagName, element) {
    // 初始化 HTML 折叠状态（默认折叠）
    this.htmlCollapsed = true;
    let html = `<h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0; color: #212529;">已锁定元素 &lt;${tagName}&gt; 的资源</h2>`;

    // 操作按钮组
    html += `<div style="margin-bottom: 16px;">`;
    html += `<button id="toggle-resource-picker" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #6c757d; border-radius: 6px; cursor: pointer; background: #6c757d; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">✅ 已锁定 (点击解锁)</button>`;
    html += `<button id="close-all-picker" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; background: #dc3545; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">完全关闭</button>`;
    html += `<button id="get-paths-btn" style="width: 100%; padding: 10px 12px; margin-bottom: 8px; border: 1px solid #17a2b8; border-radius: 6px; cursor: pointer; background: #17a2b8; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">📋 获得多种可能路径</button>`;
    html += `<button id="copy-all-paths-btn" style="width: 100%; padding: 10px 12px; margin-bottom: 8px; border: 1px solid #28a745; border-radius: 6px; cursor: pointer; background: #28a745; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">📄 一键复制所有路径</button>`;
    html += `<button id="copy-html-btn" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #9333ea; border-radius: 6px; cursor: pointer; background: #9333ea; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">📋 一键复制 HTML</button>`;
    html += `</div>`;

    // 总是显示资源列表（如果有资源的话）
    if (!this._hasNoResources(resources)) {
        const generateFullList = (title, items) => {
            let listHtml = `<div style="margin: 16px 0;">
                <h3 style="font-size: 15px; margin: 0 0 12px 0; color: #495057; font-weight: 600; border-bottom: 1px solid #e9ecef; padding-bottom: 6px;">${title} (${items.length})</h3>
                <ul style="list-style: none; padding: 0; margin: 0;">`;
            if (items.length === 0) {
                listHtml += '<li style="color: #6c757d; font-size: 13px; padding: 6px 0; font-style: italic;">未找到资源</li>';
            } else {
                items.forEach(url => {
                    const displayUrl = url.startsWith('[') ? url : (url.substring(url.lastIndexOf('/') + 1) || new URL(url).hostname);
                    listHtml += `<li style="font-size: 13px; margin-bottom: 6px; padding: 8px; background: #f8f9fa; border-radius: 4px; border-left: 3px solid #007bff;">
                        <a href="${url.startsWith('[') ? '#' : url}" target="_blank" title="${url}" style="color: #007bff; text-decoration: none; word-break: break-all; transition: color 0.2s ease; font-weight: 500;"
                           onmouseover="this.style.color='#0056b3'; this.style.textDecoration='underline';"
                           onmouseout="this.style.color='#007bff'; this.style.textDecoration='none';">${displayUrl}</a>
                    </li>`;
                });
                if (title.includes('图片')) {
                    listHtml += '<p style="font-size: 12px; margin-top: 8px; color: #6c757d; font-style: italic;">💡 提示：请右键点击链接 → 另存为</p>';
                }
            }
            listHtml += '</ul></div>';
            return listHtml;
        };

        html += generateFullList('图片/图标 (IMG, SVG, Background)', resources.images);
        html += generateFullList('媒体文件 (VIDEO, AUDIO)', resources.media);
        html += generateFullList('其他链接 (A HREF)', resources.links);
        html += generateFullList('其他可下载资源 (LINK)', resources.other);
    }

    // HTML 结构区域（始终显示）
    const formattedHtml = this._formatHTML(element.outerHTML);
    html += `
        <div style="margin: 20px 0 0 0; border-top: 1px solid #e9ecef; padding-top: 16px;">
            <button id="toggle-html-collapse" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #6c757d; border-radius: 6px; cursor: pointer; background: #f8f9fa; color: #495057; font-size: 14px; font-weight: 500; transition: all 0.2s ease; text-align: left;">
                🔽 展开 HTML 结构 (共 ${formattedHtml.split('\n').length} 行)
            </button>
            <pre id="${this.htmlId}" style="white-space: pre-wrap; word-wrap: break-word; font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 11px; padding: 12px; border: 1px solid #e9ecef; border-radius: 6px; background: #ffffff; max-height: 400px; overflow: auto; color: #495057; line-height: 1.4; display: none;"></pre>
        </div>
    `;

    this.container.innerHTML = html;

    // 插入 HTML 内容（纯文本避免渲染）
    const preElement = document.getElementById(this.htmlId);
    if (preElement) {
        preElement.textContent = formattedHtml;
    }

    // 绑定事件
    this._bindHtmlCollapseEvent();
    this._bindButtonEvents(element);
    this._bindPathButtonEvent(element);
    this._bindCopyAllPathsButton(element);
}

/**
 * 绑定 HTML 结构折叠/展开按钮事件
 */
_bindHtmlCollapseEvent() {
    const collapseBtn = document.getElementById('toggle-html-collapse');
    const htmlContainer = document.getElementById(this.htmlId);
    if (!collapseBtn || !htmlContainer) return;

    // 折叠/展开逻辑
    collapseBtn.onclick = () => {
        if (this.htmlCollapsed) {
            // 展开：显示 HTML 内容 + 切换按钮样式
            htmlContainer.style.display = 'block';
            collapseBtn.innerHTML = '🔼 折叠 HTML 结构 (共 ' + htmlContainer.textContent.split('\n').length + ' 行)';
            collapseBtn.style.background = '#6c757d';
            collapseBtn.style.color = '#f8f9fa';
            collapseBtn.style.borderColor = '#6c757d';
            this.htmlCollapsed = false;
        } else {
            // 折叠：隐藏 HTML 内容 + 切换按钮样式
            htmlContainer.style.display = 'none';
            collapseBtn.innerHTML = '🔽 展开 HTML 结构 (共 ' + htmlContainer.textContent.split('\n').length + ' 行)';
            collapseBtn.style.background = '#f8f9fa';
            collapseBtn.style.color = '#495057';
            collapseBtn.style.borderColor = '#6c757d';
            this.htmlCollapsed = true;
        }
    };
}


    _bindButtonEvents(element) {
        const toggleBtn = document.getElementById('toggle-resource-picker');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                if (this.isLocked) {
                    this.isLocked = false;
                    this._startPicking(); // 解锁，恢复预览
                } else {
                    // 在预览模式下，这个按钮实际触发的是锁定功能。
                    // 但由于 onClick 已经处理了锁定逻辑，这里主要处理解锁/关闭逻辑，
                    // 在预览模式下它会触发 startPicking 保持状态，或在初始状态下触发 onClick 锁定。
                    this.cleanup();
                }
            };
        }
        const closeBtn = document.getElementById('close-all-picker');
        if (closeBtn) {
            closeBtn.onclick = this.cleanup.bind(this);
        }

        // 绑定复制 HTML 按钮
        console.log('[_bindButtonEvents] element:', element);
        const copyHtmlBtn = document.getElementById('copy-html-btn');
        console.log('[_bindButtonEvents] copyHtmlBtn:', copyHtmlBtn);
        if (copyHtmlBtn) {
            console.log('[_bindButtonEvents] 绑定点击事件');
            // 直接使用传入的 element 参数，避免 this._lockedElement 可能为空的问题
            copyHtmlBtn.onclick = () => {
                console.log('[_bindButtonEvents] 点击事件触发, element:', element);
                if (!element) {
                    console.error('没有锁定的元素');
                    return;
                }
                const html = element.outerHTML || element.innerHTML;
                console.log('[_bindButtonEvents] 复制 HTML:', html.substring(0, 100));
                navigator.clipboard.writeText(html).then(() => {
                    const originalText = copyHtmlBtn.innerText;
                    copyHtmlBtn.innerText = "✓ HTML 已复制";
                    copyHtmlBtn.style.background = '#6f42c1';
                    copyHtmlBtn.style.borderColor = '#6f42c1';
                    setTimeout(() => {
                        copyHtmlBtn.innerText = originalText;
                        copyHtmlBtn.style.background = '#9333ea';
                        copyHtmlBtn.style.borderColor = '#9333ea';
                    }, 2000);
                }).catch((err) => {
                    const originalText = copyHtmlBtn.innerText;
                    copyHtmlBtn.innerText = "✗ 复制失败";
                    copyHtmlBtn.style.background = '#dc3545';
                    copyHtmlBtn.style.borderColor = '#dc3545';
                    setTimeout(() => {
                        copyHtmlBtn.innerText = originalText;
                        copyHtmlBtn.style.background = '#9333ea';
                        copyHtmlBtn.style.borderColor = '#9333ea';
                    }, 2000);
                    console.error('复制 HTML 失败:', err);
                });
            };
        }
    }
    

    // --- 事件处理程序 (使用箭头函数确保 this 绑定) ---

    _onMove = (e) => {
        if (this.isLocked) return;

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
        this.tooltip.innerText = `预览 <${el.tagName.toLowerCase()}>`;

        // 实时嗅探和更新列表
        const resources = this._gatherResources(el);
        this._createResourceListHTML(resources);
    }

    _onClick = (e) => {
        // 如果点击在工具箱内，不处理（让按钮自己的 onclick 正常触发）
        if (this.container.contains(e.target)) return;

        e.preventDefault();
        e.stopPropagation();

        let el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === this.overlay || el === this.tooltip || this.container.contains(el)) return;

        this.currentElement = el;

        if (!this.isLocked) {
            this.isLocked = true;
            this._lockedElement = el;  // 保存锁定元素的引用
            document.removeEventListener("mousemove", this._onMove, true);

            // 切换到锁定样式
            this.overlay.style.border = "3px solid #495057";
            this.overlay.style.background = "rgba(73, 80, 87, 0.25)";
            this.tooltip.innerText = `已锁定 <${el.tagName.toLowerCase()}>`;

            // 锁定并生成完整列表/HTML
            const resources = this._gatherResources(el);
            this._createFullResourceList(resources, el.tagName.toLowerCase(), el);

            console.log(`资源嗅探已锁定在元素 <${el.tagName.toLowerCase()}>`);
        } else {
            this.isLocked = false;
            this._lockedElement = null;  // 清除锁定元素引用
            this._startPicking();
            console.log("资源嗅探已解锁，恢复实时预览");
        }
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

        if (!this.currentElement) {
            // 初始启动界面
            this.container.innerHTML = '<h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px 0; color: #212529;">资源嗅探工具</h2><p style="color: #6c757d; margin-bottom: 16px; line-height: 1.5;">将鼠标移动到页面元素上开始实时预览。</p><button id="toggle-resource-picker" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #ced4da; border-radius: 6px; cursor: pointer; background: #f8f9fa; color: #212529; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">🖱️ 实时预览 (点击锁定)</button><button id="close-all-picker" style="width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; background: #dc3545; color: #f8f9fa; font-size: 14px; font-weight: 500; transition: all 0.2s ease;">完全关闭</button>';
            this._bindButtonEvents();
        } else {
            const resources = this._gatherResources(this.currentElement);
            this._createResourceListHTML(resources);
        }
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
        this._lockedElement = null;  // 清理锁定元素引用
        window.__pickerCleanup = undefined;
        window.__pickerInstance = null;  // 清理实例引用，允许重新创建
        console.log("资源嗅探工具已完全关闭");
    }
};

// -------------------------------------------------------------------
// --- 启动脚本 (保持原入口函数逻辑)
// -------------------------------------------------------------------

function realTimeResourcePicker() {
    // 确保只运行一次
    if (window.__pickerInstance) {
        window.__pickerInstance.cleanup();
    }
    window.__pickerInstance = new window.ResourcePicker();
}

function main() {
    // 防止重复运行
    if (window.__pickerInstance) {
        console.log('[ResourcePicker] 选择器已在运行中，跳过');
        return;
    }
    // 调用主函数启动
    realTimeResourcePicker();
}
