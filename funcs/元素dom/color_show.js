/**
 * @fileoverview 开发者色彩搭配工具
 *
 * @scenario    开发者需要快速对比/挑选/导出配色方案
 * @feature     注入可拖动浮动面板，添加/复制/导入导出调色板
 * @effect      在页面中创建浮动调色板面板DOM，支持 HEX/RGB 切换
 * @category    DOM创建
 * @platform    通用
 * @entry       main()
 */

/*
 * 🎨 开发者色彩搭配工具 - 控制台脚本版本 (多格式输入支持版)
 *
 * 功能:
 * - 动态创建可拖动、可折叠的浮动面板
 * - 支持多种颜色输入格式 (#HEX、rgb(...)、R,G,B)
 * - 添加、删除、展示颜色
 * - 一键复制 HEX / RGB 格式
 * - 导出/导入调色板 (JSON)
 * - 内置预设调色板示例（可自行扩展）
 *
 * 使用方法:
 * 1. 打开任意网页 → 按 F12 / Ctrl+Shift+I 打开控制台
 * 2. 切换到 Console 标签
 * 3. 粘贴本脚本全部内容 → 按回车运行
 */

function main(){
(function() {
    'use strict';

    // --- 1. 预设调色板 (示例，可自行扩展) ---
    const CELESTE_PALETTE = [
      
    ];

    // --- 2. 工具主逻辑 ---
    class ColorPaletteTool {
        constructor() {
            this.colors = [];
            this.isDragging = false;
            this.currentX;
            this.currentY;
            this.initialX;
            this.initialY;
            this.xOffset = 0;
            this.yOffset = 0;

            this.init();
        }

        init() {
            this.injectStyles();
            this.createUI();
            this.loadPreset(CELESTE_PALETTE);
            this.renderAllColors();
            this.attachEventListeners();
        }

        // --- DOM 样式与结构 ---
        injectStyles() {
            const styleId = 'color-palette-tool-styles';
            if (document.getElementById(styleId)) return;

            const css = `
                #color-palette-tool {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 320px;
                    max-height: 80vh;
                    background: #2c2c2e;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                    color: #f2f2f7;
                    z-index: 10000;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    transition: max-height 0.3s ease-in-out;
                }
                #color-palette-tool.collapsed { max-height: 50px; }
                #cpt-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    background: #1c1c1e;
                    cursor: move;
                    user-select: none;
                }
                #cpt-title { font-size: 16px; font-weight: 600; }
                #cpt-toggle-btn, #cpt-close-btn {
                    background: none;
                    border: none;
                    color: #f2f2f7;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0;
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #cpt-close-btn {
                    color: #ff453a;
                    font-weight: bold;
                    border-radius: 50%;
                    transition: all 0.2s;
                }
                #cpt-close-btn:hover {
                    background: #ff453a;
                    color: white;
                    transform: scale(1.1);
                }
                #cpt-body { padding: 16px; overflow-y: auto; }
                #cpt-controls { display: flex; gap: 8px; margin-bottom: 16px; }
                #cpt-input {
                    flex-grow: 1;
                    padding: 8px 12px;
                    border: 1px solid #48484a;
                    border-radius: 8px;
                    background: #1c1c1e;
                    color: #f2f2f7;
                    font-size: 14px;
                }
                #cpt-input::placeholder { color: #8e8e93; }
                #cpt-add-btn, #cpt-export-btn, #cpt-import-btn {
                    padding: 8px 12px;
                    border: none;
                    border-radius: 8px;
                    background: #007aff;
                    color: white;
                    font-size: 14px;
                    cursor: pointer;
                    white-space: nowrap;
                    transition: background-color 0.2s;
                }
                #cpt-add-btn:hover, #cpt-export-btn:hover, #cpt-import-btn:hover { background: #005ecb; }
                #cpt-colors-container {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 12px;
                }
                .color-card {
                    background: #3a3a3c;
                    border-radius: 10px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .color-card:hover { transform: translateY(-4px); box-shadow: 0 8px 20px rgba(0,0,0,0.3); }
                .color-preview { height: 80px; width: 100%; }
                .color-info { padding: 10px; }
                .color-name { font-size: 13px; font-weight: 600; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .color-codes { display: flex; flex-direction: column; gap: 4px; }
                .color-code-btn {
                    background: #48484a;
                    border: none;
                    padding: 4px 8px;
                    border-radius: 5px;
                    color: #d1d1d6;
                    font-size: 11px;
                    font-family: 'Monaco', 'Menlo', monospace;
                    cursor: pointer;
                    text-align: left;
                    transition: background-color 0.2s;
                }
                .color-code-btn:hover { background: #636366; }
                .delete-btn {
                    margin-top: 8px;
                    width: 100%;
                    padding: 6px;
                    border: 1px solid #ff453a;
                    background: transparent;
                    color: #ff453a;
                    border-radius: 5px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .delete-btn:hover { background: #ff453a; color: white; }
            `;
            const styleSheet = document.createElement('style');
            styleSheet.id = styleId;
            styleSheet.innerText = css;
            document.head.appendChild(styleSheet);
        }

        createUI() {
            this.toolEl = document.createElement('div');
            this.toolEl.id = 'color-palette-tool';
            this.toolEl.innerHTML = `
                <div id="cpt-header">
                    <span id="cpt-title">🎨 色彩搭配工具</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button id="cpt-toggle-btn">▼</button>
                        <button id="cpt-close-btn">×</button>
                    </div>
                </div>
                <div id="cpt-body">
                    <div id="cpt-controls">
                        <input type="text" id="cpt-input" placeholder="名称 + 颜色值 (如: 天空蓝 #87ceeb / 草地绿 34,139,34)">
                        <button id="cpt-add-btn">添加</button>
                    </div>
                    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                        <button id="cpt-export-btn">导出 JSON</button>
                        <button id="cpt-import-btn">导入 JSON</button>
                    </div>
                    <div id="cpt-colors-container"></div>
                </div>
            `;
            document.body.appendChild(this.toolEl);

            this.headerEl = this.toolEl.querySelector('#cpt-header');
            this.bodyEl = this.toolEl.querySelector('#cpt-body');
            this.toggleBtn = this.toolEl.querySelector('#cpt-toggle-btn');
            this.closeBtn = this.toolEl.querySelector('#cpt-close-btn');
            this.inputEl = this.toolEl.querySelector('#cpt-input');
            this.addBtn = this.toolEl.querySelector('#cpt-add-btn');
            this.exportBtn = this.toolEl.querySelector('#cpt-export-btn');
            this.importBtn = this.toolEl.querySelector('#cpt-import-btn');
            this.colorsContainer = this.toolEl.querySelector('#cpt-colors-container');
        }

        // --- 支持多格式颜色解析 ---
        parseColorInput(input) {
            input = input.trim();

            // HEX (#fff / #ffffff)
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(input)) {
                let hex = input.toLowerCase();
                if (hex.length === 4) {
                    hex = '#' + [...hex.slice(1)].map(x => x + x).join('');
                }
                return { hex, rgb: this.hexToRgb(hex) };
            }

            // rgb(255, 100, 0)
            if (/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(input)) {
                const [r, g, b] = input.match(/\d+/g).map(Number);
                const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
                return { hex, rgb: { r, g, b } };
            }

            // 纯数字逗号格式: 255,100,0
            if (/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(input)) {
                const [r, g, b] = input.split(',').map(x => parseInt(x.trim(), 10));
                if ([r, g, b].some(n => isNaN(n) || n < 0 || n > 255)) return null;
                const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
                return { hex, rgb: { r, g, b } };
            }

            return null;
        }

        // --- 颜色管理 ---
        loadPreset(palette) {
            this.colors = palette.map(c => ({
                id: Date.now() + Math.random(),
                name: c.name,
                hex: c.hex,
                rgb: this.hexToRgb(c.hex)
            }));
        }

        addColor(name, colorInput) {
            const parsed = this.parseColorInput(colorInput);
            if (!parsed) {
                alert('无法识别的颜色格式，请输入 #HEX、rgb(...) 或 R,G,B 格式。\n例如: 天空蓝 #87ceeb 或 暖橙 255,140,0');
                return;
            }

            const newColor = {
                id: Date.now(),
                name,
                hex: parsed.hex,
                rgb: parsed.rgb
            };
            this.colors.push(newColor);
            this.renderAllColors();
        }

        handleAddColor() {
            const value = this.inputEl.value.trim();
            if (!value) return alert('请输入颜色名称和颜色值！');

            const match = value.match(/(#[0-9a-f]{3,6}|rgb\([^)]*\)|\d+\s*,\s*\d+\s*,\s*\d+)$/i);
            if (!match) {
                alert('格式错误！请输入 "名称 颜色值"。\n例如: 天空蓝 #87ceeb 或 暖橙 255,140,0');
                return;
            }

            const colorPart = match[1];
            const namePart = value.replace(colorPart, '').trim() || '未命名颜色';
            this.addColor(namePart, colorPart);
            this.inputEl.value = '';
        }

        deleteColor(id) {
            this.colors = this.colors.filter(c => c.id !== id);
            this.renderAllColors();
        }

        renderAllColors() {
            this.colorsContainer.innerHTML = '';
            this.colors.forEach(color => this.renderColorCard(color));
        }

        renderColorCard(color) {
            const card = document.createElement('div');
            card.className = 'color-card';
            card.dataset.colorId = color.id;

            card.innerHTML = `
                <div class="color-preview" style="background-color: ${color.hex};"></div>
                <div class="color-info">
                    <div class="color-name">${color.name}</div>
                    <div class="color-codes">
                        <button class="color-code-btn" data-copy="${color.hex}">HEX: ${color.hex}</button>
                        <button class="color-code-btn" data-copy="rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})">RGB: ${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b}</button>
                    </div>
                    <button class="delete-btn" data-delete-id="${color.id}">删除</button>
                </div>
            `;
            this.colorsContainer.appendChild(card);
        }

        // --- 交互事件 ---
        attachEventListeners() {
            this.addBtn.addEventListener('click', () => this.handleAddColor());
            this.inputEl.addEventListener('keypress', e => { if (e.key === 'Enter') this.handleAddColor(); });

            this.colorsContainer.addEventListener('click', e => {
                if (e.target.classList.contains('color-code-btn')) {
                    this.copyToClipboard(e.target.dataset.copy);
                } else if (e.target.classList.contains('delete-btn')) {
                    this.deleteColor(parseInt(e.target.dataset.deleteId, 10));
                }
            });

            this.exportBtn.addEventListener('click', () => this.exportPalette());
            this.importBtn.addEventListener('click', () => this.importPalette());

            this.toggleBtn.addEventListener('click', () => {
                this.toolEl.classList.toggle('collapsed');
                this.toggleBtn.textContent = this.toolEl.classList.contains('collapsed') ? '▶' : '▼';
            });

            this.closeBtn.addEventListener('click', () => {
                this.cleanup();
            });

            this.headerEl.addEventListener('mousedown', e => this.dragStart(e));
            document.addEventListener('mousemove', e => this.drag(e));
            document.addEventListener('mouseup', () => this.dragEnd());
        }

        // --- 复制与导入导出 ---
        copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                console.log(`已复制: ${text}`);
            }).catch(err => console.error('复制失败:', err));
        }

        exportPalette() {
            const paletteToExport = this.colors.map(({ name, hex }) => ({ name, hex }));
            const jsonString = JSON.stringify(paletteToExport, null, 2);
            this.copyToClipboard(jsonString);
            alert('调色板已复制为 JSON 格式到剪贴板！');
        }

        importPalette() {
            const jsonString = prompt('请粘贴您要导入的 JSON 数据:');
            if (jsonString) {
                try {
                    const importedPalette = JSON.parse(jsonString);
                    if (Array.isArray(importedPalette)) {
                        this.loadPreset(importedPalette);
                        this.renderAllColors();
                        alert('调色板导入成功！');
                    } else {
                        alert('无效的 JSON 格式，请确保是一个数组。');
                    }
                } catch (e) {
                    alert('JSON 解析失败，请检查数据格式是否正确。');
                }
            }
        }

        // --- 拖动功能 ---
        dragStart(e) {
            this.initialX = e.clientX - this.xOffset;
            this.initialY = e.clientY - this.yOffset;
            if (e.target === this.headerEl) this.isDragging = true;
        }

        drag(e) {
            if (this.isDragging) {
                e.preventDefault();
                this.currentX = e.clientX - this.initialX;
                this.currentY = e.clientY - this.initialY;
                this.xOffset = this.currentX;
                this.yOffset = this.currentY;
                this.toolEl.style.transform = `translate3d(${this.currentX}px, ${this.currentY}px, 0)`;
            }
        }

        dragEnd() {
            this.initialX = this.currentX;
            this.initialY = this.currentY;
            this.isDragging = false;
        }

        // --- 工具函数 ---
        hexToRgb(hex) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : null;
        }

        // --- 清理功能 ---
        cleanup() {
            // 移除工具元素
            if (this.toolEl && this.toolEl.parentNode) {
                this.toolEl.parentNode.removeChild(this.toolEl);
            }

            // 移除注入的样式表
            const styleSheet = document.getElementById('color-palette-tool-styles');
            if (styleSheet && styleSheet.parentNode) {
                styleSheet.parentNode.removeChild(styleSheet);
            }

            // 清理对象引用
            this.toolEl = null;
            this.headerEl = null;
            this.bodyEl = null;
            this.toggleBtn = null;
            this.closeBtn = null;
            this.inputEl = null;
            this.addBtn = null;
            this.exportBtn = null;
            this.importBtn = null;
            this.colorsContainer = null;
            this.colors = [];

            console.log('%c🎨 色彩搭配工具已关闭', 'color: #ff453a; font-weight: bold; font-size: 14px;');
        }
    }

    // --- 启动 ---
    if (!document.getElementById('color-palette-tool')) {
        new ColorPaletteTool();
        console.log('%c🎨 色彩搭配工具已启动！', 'color: #007aff; font-weight: bold; font-size: 14px;');
    } else {
        console.log('%c色彩工具已经运行。', 'color: #ff9500; font-weight: bold;');
    }

})();
}
