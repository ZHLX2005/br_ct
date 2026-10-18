/**
 * @fileoverview funcs 脚本用户自定义快捷键监听
 *
 * @scenario    用户在 popup 函数执行页为脚本录制快捷键后，在任意页面按键触发脚本注入
 * @feature     读取 funcShortcuts 存储的「修饰键+主键」组合，捕获阶段匹配后通知后台注入对应脚本
 * @effect      匹配按键时拦截原生行为并向 background 发送 executeFunctionScript
 * @category    行为Hook
 * @platform    通用
 * @entry       自动执行（content_scripts 静态注入）
 *
 * @note        存储键与 shared/core/storageKeys.js 的 FUNC_SHORTCUTS 保持一致
 *              （静态 content script 无法 import ES Module，故此处直接读 chrome.storage，
 *              与 content-ocr.js 读 translation.ocr.shortcut 为同一先例）
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'funcShortcuts';
    let shortcuts = {}; // { [file]: { ctrlKey, altKey, shiftKey, metaKey, key } }

    function loadShortcuts() {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
            shortcuts = result?.[STORAGE_KEY] || {};
        });
    }

    /** 四个修饰键 + 主键全等比较（参照 sidebar-tab-switch.js isShortcutMatch） */
    function isShortcutMatch(e, config) {
        if (!config || !config.key) return false;
        if (config.enabled === false) return false;
        return (
            e.ctrlKey === !!config.ctrlKey &&
            e.altKey === !!config.altKey &&
            e.shiftKey === !!config.shiftKey &&
            e.metaKey === !!config.metaKey &&
            e.key === config.key
        );
    }

    document.addEventListener('keydown', (e) => {
        for (const [file, config] of Object.entries(shortcuts)) {
            if (isShortcutMatch(e, config)) {
                // 拦截原生快捷键：捕获阶段 + preventDefault + stopPropagation
                e.preventDefault();
                e.stopPropagation();
                chrome.runtime.sendMessage({ action: 'executeFunctionScript', file });
                return;
            }
        }
    }, true);

    // 改键后立即生效（兜底通道，与 popup 写入时的广播并行）
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE_KEY]) {
            shortcuts = changes[STORAGE_KEY].newValue || {};
        }
    });

    loadShortcuts();
    console.log('[FuncShortcuts] 监听已启动');
})();
