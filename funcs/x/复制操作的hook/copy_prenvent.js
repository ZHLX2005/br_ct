/**
 * @fileoverview 剪贴板写入 Hook + 模拟复制点击
 *
 * @scenario    在 DevTools Console 手动执行，调试 ChatGPT 等站点复制按钮行为
 * @feature     Hook navigator.clipboard.writeText/write、copy 事件、模拟按钮点击
 * @effect      拦截所有写入剪贴板的内容，提供 simulateCopy()/getCapturedText() 全局函数
 * @category    行为Hook
 * @platform    通用
 * @entry       IIFE 自动执行
 */

(function() {
    'use strict';

    var capturedText = null;

    // 1. Deep hook Clipboard API via Object.defineProperty
    var clipProto = Object.getPrototypeOf(navigator.clipboard);
    var origWriteText = clipProto.writeText;
    Object.defineProperty(clipProto, 'writeText', {
        value: function(text) {
            capturedText = text;
            console.log('%c[Hook] clipboard.writeText:', 'color: #00ff00; font-weight: bold;', text);
            return Promise.resolve();
        },
        configurable: true,
        writable: true
    });

    // 2. Hook clipboard.write (some platforms use this)
    var origWrite = clipProto.write;
    Object.defineProperty(clipProto, 'write', {
        value: function(items) {
            if (items && items[0]) {
                items[0].getType('text/plain').then(function(blob) {
                    var reader = new FileReader();
                    reader.onload = function() {
                        capturedText = reader.result;
                        console.log('%c[Hook] clipboard.write:', 'color: #00ff00; font-weight: bold;', capturedText);
                    };
                    reader.readAsText(blob);
                });
            }
            return Promise.resolve();
        },
        configurable: true,
        writable: true
    });

    // 3. Hook copy event
    document.addEventListener('copy', function(e) {
        if (e.clipboardData) {
            var text = e.clipboardData.getData('text/plain');
            if (text) {
                capturedText = text;
                console.log('%c[Hook] copy event:', 'color: #00ff00;', text);
            }
        }
        e.preventDefault();
    }, true);

    // 4. Simulate copy button click
    window.simulateCopy = function(selector) {
        var btnSelector = selector || "div#thread > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(2) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(2) > div:nth-of-type(1) > button:nth-of-type(1) > span:nth-of-type(1)";
        var el = document.querySelector(btnSelector);
        if (!el) {
            console.log('%c[Error] Button not found', 'color: red;');
            return;
        }
        capturedText = null;
        var btn = el.closest("button") || el;

        // React needs native .click(), not dispatchEvent
        // Full mouse event chain: pointerdown -> mousedown -> mouseup -> click
        var rect = btn.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

        btn.dispatchEvent(new PointerEvent("pointerdown", opts));
        btn.dispatchEvent(new MouseEvent("mousedown", opts));
        btn.dispatchEvent(new PointerEvent("pointerup", opts));
        btn.dispatchEvent(new MouseEvent("mouseup", opts));
        btn.click();

        setTimeout(function() {
            if (capturedText) {
                console.log('%c[Copied]', 'color: #00ccff; font-size: 14px; font-weight: bold;', capturedText);
            } else {
                // Fallback: read text directly from DOM
                var statusEl = btn.closest('[data-id]') || btn.closest('article') || btn.closest('section');
                if (statusEl) {
                    var contentEl = statusEl.querySelector('.status__content, .entry-content, [class*="content"], [class*="text"]');
                    if (contentEl) {
                        capturedText = contentEl.innerText;
                        console.log('%c[Fallback DOM] Content:', 'color: #00ccff; font-size: 14px; font-weight: bold;', capturedText);
                        return;
                    }
                }
                console.log('%c[Warn] Nothing captured. Try: simulateCopy("CSS selector")', 'color: orange;');
            }
        }, 500);
    };

    window.getCapturedText = function() {
        return capturedText;
    };

    console.log('%c[Copy Hook Ready] Call simulateCopy()', 'color: #00ff00; font-size: 14px;');
})();
