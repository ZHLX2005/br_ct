import {
  initializePopup,
  setupEventListeners,
  loadStoredData,
  initializeResponseDisplay,
} from "./mainUtils.js";
import { initializePlatformOptions } from "../../popup/main/platformRenderer.js";

document.addEventListener("DOMContentLoaded", async function () {
  try {
    console.log("[Sidebar] DOMContentLoaded");
    initializePlatformOptions();
    await initializePopup();
    console.log("[Sidebar] initializePopup done");
    initializeResponseDisplay();
    console.log("[Sidebar] initializeResponseDisplay done");
    await loadStoredData();
    setupEventListeners();
    setupDragDrop();
  } catch (error) {
    console.error("初始化popup失败:", error);
  }
});

function setupDragDrop() {
  const messageInput = document.getElementById("chat-input");
  if (!messageInput) return;

  function preventDefaults(e) { e.preventDefault(); }
  function highlight() { messageInput.classList.add("dragover"); }
  function unhighlight() { messageInput.classList.remove("dragover", "drop-error"); }

  ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
    messageInput.addEventListener(eventName, preventDefaults, false);
  });
  ["dragenter", "dragover"].forEach(eventName => {
    messageInput.addEventListener(eventName, highlight, false);
  });
  ["dragleave", "drop"].forEach(eventName => {
    messageInput.addEventListener(eventName, unhighlight, false);
  });

  messageInput.addEventListener("drop", async (e) => {
    unhighlight();
    const files = e.dataTransfer?.files;
    if (!files?.length) return;

    const isSingleFile = files.length === 1;
    if (isSingleFile && files[0].type === "text/html") {
      handleHtmlDrop(files[0], messageInput);
    } else if (isSingleFile && files[0].name?.endsWith(".md")) {
      handleMdDrop(files[0], messageInput);
    } else {
      handleFileDrop(files, messageInput);
    }
  });
}

async function handleHtmlDrop(file, input) {
  try {
    const text = await file.text();
    input.value = text;
    input.dispatchEvent(new Event("input"));
  } catch (err) {
    console.error("读取 HTML 文件失败:", err);
    input.classList.add("drop-error");
  }
}

async function handleMdDrop(file, input) {
  try {
    const text = await file.text();
    input.value = text;
    input.dispatchEvent(new Event("input"));
  } catch (err) {
    console.error("读取 Markdown 文件失败:", err);
    input.classList.add("drop-error");
  }
}

async function handleFileDrop(files, input) {
  const fileNames = Array.from(files).map(f => f.name).join("\n");
  const header = `[已拖放 ${files.length} 个文件]:\n${fileNames}\n\n`;
  input.value = input.value + header;
  input.dispatchEvent(new Event("input"));
}
