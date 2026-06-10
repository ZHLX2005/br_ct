import { mount as mountAichat, unmount as unmountAichat } from "./aichat/aichat.js";
import { mount as mountCc, unmount as unmountCc } from "./cc/cc.js";

const MODES = { AICHAT: "aichat", CLAUDE_CODE: "claude-code" };
let currentMode = MODES.AICHAT;

function setMode(mode) {
  if (mode === currentMode) return;
  const prev = currentMode;
  currentMode = mode;

  document.getElementById("app-shell").dataset.mode = mode;
  const toggleBtn = document.getElementById("cc-toggle");
  if (toggleBtn) toggleBtn.title = mode === MODES.CLAUDE_CODE ? "切换到 AI Chat 模式" : "切换到 Claude Code 模式";

  const view = document.getElementById("app-view");
  if (!view) return;

  // 完全卸载旧视图
  if (prev === MODES.AICHAT) unmountAichat(view);
  else unmountCc(view);

  // 挂载新视图
  if (mode === MODES.AICHAT) mountAichat(view);
  else mountCc(view);
}

function toggleMode() {
  setMode(currentMode === MODES.AICHAT ? MODES.CLAUDE_CODE : MODES.AICHAT);
}

// 首次加载
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("cc-toggle")?.addEventListener("click", toggleMode);
  mountAichat(document.getElementById("app-view"));
});
