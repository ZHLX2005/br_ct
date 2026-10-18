// 函数执行视图：funcs 脚本自动注册 + 用户自定义快捷键 + 长运行脚本开关
//
// - 自动注册：扫描扩展包 funcs/ 目录（排除 x/ mods/），仅收录含 main() 入口的脚本，
//   展示名取自脚本头 @fileoverview（缺省用文件名）
// - 快捷键：参照划词翻译录制模式（popup 录制 → funcShortcuts 存储 →
//   runjs/funcs_shortcut_listener.js 常驻监听 → executeFunctionScript）
// - 开关：支持 __funcScriptRegistry 停止协议的脚本可查询/远程停止运行实例

import {
  loadFuncShortcuts,
  saveFuncShortcut,
  removeFuncShortcut,
} from "../../shared/funcShortcuts/funcShortcutsStore.js";

// 自动扫描排除目录（候选/测试脚本、底层模块，不作为正式入口注册）
const EXCLUDED_PREFIXES = ["x/", "mods/", "_candidates/"];

// 快捷键录制状态
let recordingFile = null; // 正在录制的脚本 file
let pendingCombo = null;  // keydown 阶段暂存的组合字符串

let rootEl = null;        // 视图根元素（teardown 时仍在 DOM 外，用于安全查询）
let shortcuts = {};       // { [file]: shortcut } 来自统一存储
let runningFiles = new Set(); // 当前活跃标签页运行中的脚本
let scripts = [];         // 发现的脚本清单
let scanError = "";       // 自动扫描失败原因

export function init(viewRootEl) {
  rootEl = viewRootEl;
  bindEvents();
  loadAll();
}

export function onActivate() {
  // 每次切回视图刷新运行状态（注入实例随页面导航销毁，状态是活的）
  refreshRunningState();
}

export function teardown() {
  // 强制结束未完成的快捷键录制（对齐 translation.js 的 teardown 契约）
  if (recordingFile) finishRecording(new Event("keyup"), { silent: true });
  rootEl = null;
}

// ==================== 脚本发现（自动注册） ====================

function getPackageDir() {
  return new Promise((resolve, reject) => {
    if (typeof chrome.runtime.getPackageDirectoryEntry !== "function") {
      reject(new Error("getPackageDirectoryEntry 不可用"));
      return;
    }
    chrome.runtime.getPackageDirectoryEntry((dirEntry) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(dirEntry);
    });
  });
}

/** 递归列出目录下全部 .js 文件（相对扩展根的路径，如 "funcs/元素dom/xx.js"） */
function listFilesRecursively(dirEntry, prefix, out) {
  return new Promise((resolve) => {
    const reader = dirEntry.createReader();
    const readBatch = () => {
      reader.readEntries(async (entries) => {
        if (entries.length === 0) {
          resolve(out);
          return;
        }
        for (const entry of entries) {
          const path = `${prefix}${entry.name}`;
          if (entry.isDirectory) {
            await listFilesRecursively(entry, `${path}/`, out);
          } else if (entry.name.endsWith(".js")) {
            out.push(path);
          }
        }
        readBatch();
      }, () => resolve(out)); // 读失败按目录为空处理
    };
    readBatch();
  });
}

/** 从脚本源码解析元信息（统一头标注 + 可执行性 + 停止协议） */
function parseScriptMeta(source, file) {
  const overview = (source.match(/@fileoverview\s+(.+)/) || [])[1]?.trim();
  const platform = (source.match(/@platform\s+(.+)/) || [])[1]?.trim();
  const fileName = file.split("/").pop().replace(/\.js$/, "");
  return {
    file,
    name: overview || fileName,
    platform: platform || "",
    hasMain: /\bfunction\s+main\b/.test(source),
    toggleable: /__funcScriptRegistry/.test(source),
  };
}

async function discoverScripts() {
  scanError = "";
  try {
    const dirEntry = await getPackageDir();
    const funcsDir = dirEntry.isDirectory && dirEntry.name === "funcs"
      ? dirEntry
      : await new Promise((resolve, reject) => {
        dirEntry.getDirectory("funcs", {}, (entry) => resolve(entry), reject);
      });

    const paths = await listFilesRecursively(funcsDir, "", []);
    const relFiles = paths
      .map((p) => p.replace(/^\/?funcs\//, ""))
      .filter((f) => !EXCLUDED_PREFIXES.some((prefix) => f.startsWith(prefix)))
      .sort();

    const metas = await Promise.all(relFiles.map(async (file) => {
      try {
        const resp = await fetch(chrome.runtime.getURL(`funcs/${file}`));
        const source = await resp.text();
        return parseScriptMeta(source, file);
      } catch (err) {
        console.warn(`[FuncExec] 读取 ${file} 失败:`, err);
        return null;
      }
    }));

    // 只注册真正可执行的脚本：executeFunctionScript 只调用 main()，
    // 无 main() 的文件（模块/依赖/片段）一律不收录
    return metas.filter((meta) => meta && meta.hasMain);
  } catch (err) {
    console.warn("[FuncExec] 自动扫描失败:", err.message);
    scanError = err.message;
    return [];
  }
}

// ==================== 运行状态（开关） ====================

function queryRunningFiles() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getRunningFuncScripts" }, (resp) => {
      if (chrome.runtime.lastError || !resp || resp.status !== "success") {
        resolve(new Set());
        return;
      }
      resolve(new Set(resp.files || []));
    });
  });
}

async function refreshRunningState() {
  runningFiles = await queryRunningFiles();
  renderRunningStates();
}

/** 只更新每张卡片的开关按钮态，不重建列表（避免打断录制/输入） */
function renderRunningStates() {
  if (!rootEl) return;
  rootEl.querySelectorAll(".script-item").forEach((item) => {
    const file = item.dataset.file;
    const toggleBtn = item.querySelector(".toggle-button");
    if (!toggleBtn) return;
    const running = runningFiles.has(file);
    toggleBtn.dataset.running = running ? "1" : "0";
    toggleBtn.textContent = running ? "停止" : "执行";
    toggleBtn.classList.toggle("running", running);
  });
}

// ==================== 渲染 ====================

function formatShortcutDisplay(shortcut) {
  if (!shortcut || !shortcut.key) return "";
  const parts = [];
  if (shortcut.ctrlKey) parts.push("Ctrl");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");
  if (shortcut.metaKey) parts.push("Cmd");
  parts.push(shortcut.key);
  return parts.join("+");
}

function render() {
  const scriptList = rootEl?.querySelector("#script-list");
  const statsCount = rootEl?.querySelector("#stats-count");
  if (!scriptList) return;

  if (statsCount) statsCount.textContent = String(scripts.length);

  if (scripts.length === 0) {
    scriptList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">${scanError ? `脚本扫描失败：${escapeHtml(scanError)}` : "暂无可执行的脚本"}</div>
      </div>
    `;
    return;
  }

  scriptList.innerHTML = scripts.map((script) => {
    const shortcut = shortcuts[script.file];
    const shortcutText = shortcut ? formatShortcutDisplay(shortcut) : "";
    const platformTag = script.platform && script.platform !== "通用"
      ? `<span class="script-platform">${escapeHtml(script.platform)}</span>` : "";
    // 可开关脚本只保留一个按钮（执行/停止二态），避免与普通执行按钮重复
    const actionBtn = script.toggleable
      ? `<button class="toggle-button" data-act="toggle" data-running="0">执行</button>`
      : `<button class="execute-button" data-act="execute">执行</button>`;
    return `
      <div class="script-item" data-file="${escapeHtml(script.file)}">
        <div class="script-content">
          <div class="script-name">${escapeHtml(script.name)} ${platformTag}</div>
          <div class="script-path">${escapeHtml(script.file)}</div>
        </div>
        <div class="script-actions">
          <button class="shortcut-button ${shortcutText ? "" : "unset"}" data-act="shortcut" title="录制快捷键（需至少一个修饰键）">${shortcutText ? escapeHtml(shortcutText) : "设置快捷键"}</button>
          ${shortcutText ? `<button class="shortcut-clear" data-act="clear-shortcut" title="清除快捷键">×</button>` : ""}
          ${actionBtn}
        </div>
      </div>
    `;
  }).join("");

  renderRunningStates();
}

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  const escapeMap = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (match) => escapeMap[match]);
}

// ==================== 数据加载 ====================

async function loadAll() {
  [scripts, shortcuts] = await Promise.all([
    discoverScripts(),
    loadFuncShortcuts(),
  ]);
  render();
  refreshRunningState();
}

// ==================== 快捷键录制（参照 translation.js） ====================

function startRecording(file, btn) {
  if (recordingFile) finishRecording(new Event("keyup"), { silent: true });

  recordingFile = file;
  pendingCombo = null;
  btn.classList.add("recording");
  btn.textContent = "请按下快捷键组合...";

  document.addEventListener("keydown", onRecordingKeydown, true);
  document.addEventListener("keyup", onRecordingKeyup, true);
}

function onRecordingKeydown(e) {
  e.preventDefault();
  e.stopPropagation();

  const modifiers = [];
  if (e.ctrlKey) modifiers.push("Ctrl");
  if (e.altKey) modifiers.push("Alt");
  if (e.shiftKey) modifiers.push("Shift");
  if (e.metaKey) modifiers.push("Meta");

  if (modifiers.length === 0) {
    pendingCombo = null;
    setRecordingText("请至少按下一个修饰键 (Ctrl/Alt/Shift/Meta)");
    return;
  }

  pendingCombo = [...modifiers, e.key].join("+");
  setRecordingText(pendingCombo);
}

function onRecordingKeyup(e) {
  e.preventDefault();
  e.stopPropagation();
  finishRecording(e);
}

function finishRecording(_e, { silent = false } = {}) {
  document.removeEventListener("keydown", onRecordingKeydown, true);
  document.removeEventListener("keyup", onRecordingKeyup, true);

  const file = recordingFile;
  const btn = rootEl?.querySelector(`.script-item[data-file="${CSS.escape(file || "")}"] .shortcut-button`);
  recordingFile = null;

  const combo = pendingCombo;
  pendingCombo = null;

  if (btn) {
    btn.classList.remove("recording");
  }
  if (!file) return;

  if (!combo || combo.includes("请按下") || combo.includes("请至少")) {
    // 未完成有效组合：还原显示
    if (!silent) render();
    return;
  }

  const parts = combo.split("+");
  const shortcut = {
    ctrlKey: parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    metaKey: parts.includes("Meta"),
    key: parts[parts.length - 1],
  };

  saveFuncShortcut(file, shortcut)
    .then(() => {
      shortcuts = { ...shortcuts, [file]: shortcut };
      render();
    })
    .catch((err) => {
      console.error("[FuncExec] 快捷键保存失败:", err);
      if (!silent) render();
    });
}

function setRecordingText(text) {
  const btn = rootEl?.querySelector(".shortcut-button.recording");
  if (btn) btn.textContent = text;
}

// ==================== 事件绑定 ====================

function bindEvents() {
  const scriptList = rootEl?.querySelector("#script-list");
  if (!scriptList) return;

  scriptList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn || btn.disabled) return;

    const item = btn.closest(".script-item");
    if (!item) return;
    const file = item.dataset.file;

    switch (btn.dataset.act) {
      case "execute":
        onExecute(file, btn, { closeAfter: true });
        break;
      case "toggle": {
        const running = btn.dataset.running === "1";
        if (running) {
          btn.textContent = "停止中...";
          btn.disabled = true;
          chrome.runtime.sendMessage({ action: "stopFuncScript", file }, () => {
            void chrome.runtime.lastError; // 忽略通道错误，状态以刷新为准
            refreshRunningState().then(() => { btn.disabled = false; });
          });
        } else {
          onExecute(file, btn, { closeAfter: false });
        }
        break;
      }
      case "shortcut":
        startRecording(file, btn);
        break;
      case "clear-shortcut":
        removeFuncShortcut(file)
          .then(async () => {
            shortcuts = await loadFuncShortcuts();
            render();
          })
          .catch((err) => console.error("[FuncExec] 快捷键清除失败:", err));
        break;
    }
  });
}

function onExecute(file, btn, { closeAfter }) {
  const originalText = btn.textContent;
  btn.textContent = "执行中...";
  btn.disabled = true;

  chrome.runtime.sendMessage(
    { action: "executeFunctionScript", file },
    (response) => {
      if (response && response.status === "success") {
        console.log(`脚本 ${file} 执行成功`);
      } else {
        alert(`脚本 ${file} 执行失败: ${response?.message || "未知错误"}`);
      }

      btn.textContent = originalText;
      btn.disabled = false;

      if (closeAfter) {
        // 保留旧行为：普通执行后关闭 popup
        window.close();
      } else {
        // 开关式执行：留在原地刷新运行态
        refreshRunningState();
      }
    }
  );
}
