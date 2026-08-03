/**
 * 设置输入框的拖放事件处理
 * @param {Element} rootEl 视图根元素
 */
export function setupDragDropEvents(rootEl) {
  viewRoot = rootEl;
  const messageInput = rootEl.querySelector("#message-input");

  if (!messageInput) {
    console.error("未找到消息输入框");
    return;
  }

  // 阻止默认拖放行为
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    messageInput.addEventListener(eventName, preventDefaults, false);
  });

  // 添加拖放视觉反馈
  ["dragenter", "dragover"].forEach((eventName) => {
    messageInput.addEventListener(eventName, highlight, false);
  });

  ["dragleave", "drop"].forEach((eventName) => {
    messageInput.addEventListener(eventName, unhighlight, false);
  });

  // 处理拖放文件
  messageInput.addEventListener("drop", handleDrop, false);

  // 监听粘贴事件（仅处理图片）
  messageInput.addEventListener("paste", handlePaste);
}

// 视图根（setupDragDropEvents 时绑定；highlight/unhighlight/handleDrop 中查询使用）
let viewRoot = null;

/**
 * 阻止默认拖放行为
 */
function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * 添加高亮效果
 */
function highlight() {
  const messageInput = viewRoot && viewRoot.querySelector("#message-input");
  if (messageInput) messageInput.classList.add("dragover");
}

/**
 * 移除高亮效果
 */
function unhighlight() {
  const messageInput = viewRoot && viewRoot.querySelector("#message-input");
  if (messageInput) messageInput.classList.remove("dragover", "drop-error");
}

/**
 * 处理拖放事件
 */
async function handleDrop(e) {
  const messageInput = viewRoot && viewRoot.querySelector("#message-input");
  const dt = e.dataTransfer;

  // 获取所有拖放的项目
  const items = dt.items;

  if (!items || items.length === 0) {
    messageInput.classList.add("drop-error");
    return;
  }

  const fileContents = [];
  const processingPromises = [];

  // 处理每个拖放的项目
  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // 创建一个Promise来处理每个项目
    const itemPromise = new Promise((resolve) => {
      // 尝试获取文件系统条目 (使用Chrome支持的webkitGetAsEntry)
      let entry;
      if (item.webkitGetAsEntry) {
        entry = item.webkitGetAsEntry();
      } else if (typeof item.getAsEntry === "function") {
        entry = item.getAsEntry();
      }

      // 如果是文件夹，递归处理
      if (entry && entry.isDirectory) {
        handleDirectoryEntryWithPromise(entry, "", fileContents)
          .then(resolve)
          .catch((error) => {
            console.error("处理目录失败:", error);
            resolve();
          });
      } else {
        // 如果是文件，直接获取文件并读取内容
        const file = item.getAsFile();
        if (file) {
          // 检测是否为图片文件
          if (file && file.type && file.type.startsWith("image/")) {
            readImageAsDataUrl(file).then((dataUrl) => {
              if (typeof window.__onImagePasted === "function") {
                window.__onImagePasted({ dataUrl, fileName: file.name || "dropped-image.png" });
              }
            });
            resolve();
            return;
          }
          readFileContentWithPromise(file, "", fileContents)
            .then(resolve)
            .catch((error) => {
              console.error("读取文件失败:", error);
              resolve();
            });
        } else {
          resolve();
        }
      }
    });

    processingPromises.push(itemPromise);
  }

  // 等待所有项目处理完成
  try {
    await Promise.all(processingPromises);
    appendFileContentsToInput(messageInput, fileContents);
  } catch (error) {
    console.error("处理拖放项目时出错:", error);
    messageInput.classList.add("drop-error");
  }
}

/**
 * 使用Promise递归处理目录条目
 */
function handleDirectoryEntryWithPromise(entry, path, fileContents) {
  return new Promise((resolve) => {
    const reader = entry.createReader();
    const newPath = path ? `${path}/${entry.name}` : entry.name;
    const allEntries = [];

    // 递归读取所有条目
    function readAllEntries() {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            // 所有条目已读取完毕，开始处理
            processEntries(allEntries).then(resolve);
            return;
          }

          // 添加到条目列表
          allEntries.push(...entries);

          // 继续读取更多条目
          readAllEntries();
        },
        (error) => {
          console.error("读取目录条目失败:", error);
          resolve();
        }
      );
    }

    // 处理所有读取到的条目
    async function processEntries(entries) {
      const promises = entries.map((entry) => {
        if (entry.isDirectory) {
          // 递归处理子目录
          return handleDirectoryEntryWithPromise(entry, newPath, fileContents);
        } else {
          // 读取文件内容
          return new Promise((fileResolve) => {
            entry.file(
              (file) => {
                readFileContentWithPromise(file, newPath, fileContents)
                  .then(fileResolve)
                  .catch((error) => {
                    console.error("读取文件内容失败:", error);
                    fileResolve();
                  });
              },
              (error) => {
                console.error("获取文件失败:", error);
                fileResolve();
              }
            );
          });
        }
      });

      // 等待所有条目处理完成
      await Promise.all(promises);
    }

    // 开始读取条目
    readAllEntries();
  });
}

/**
 * 使用Promise读取文件内容
 */
function readFileContentWithPromise(file, path, fileContents) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    const fullPath = path ? `${path}/${file.name}` : file.name;

    // 根据文件大小限制读取策略
    if (file.size > 10 * 1024 * 1024) {
      // 大于10MB的文件
      // 对于大文件，只读取前100KB内容和文件信息
      const blob = file.slice(0, 100 * 1024);
      reader.onload = function (e) {
        const content = e.target.result;
        fileContents.push({
          path: fullPath,
          content: `${content}\n\n[文件过大，仅显示前100KB内容]`,
          size: file.size,
        });
        resolve();
      };
      reader.onerror = function () {
        fileContents.push({
          path: fullPath,
          content: "[无法读取文件内容]",
        });
        resolve();
      };
      reader.readAsText(blob, "utf-8");
    } else {
      // 对于小文件，读取全部内容
      reader.onload = function (e) {
        const content = e.target.result;
        fileContents.push({
          path: fullPath,
          content: content,
          size: file.size,
        });
        resolve();
      };
      reader.onerror = function () {
        fileContents.push({
          path: fullPath,
          content: "[无法读取文件内容]",
        });
        resolve();
      };
      reader.readAsText(file, "utf-8");
    }
  });
}

/**
 * 将文件内容追加到输入框
 */
function appendFileContentsToInput(inputElement, fileContents) {
  if (fileContents.length === 0) {
    inputElement.value += "\n\n[未找到可读取的文件内容]";
    return;
  }

  let contentText = "\n\n=== 相关的文件内容 ===\n";

  fileContents.forEach((item) => {
    contentText += `\n[文件: ${item.path}]\n`;
    contentText += "-------------------\n";
    contentText += item.content + "\n";
    contentText += "===================\n";
  });

  inputElement.value += contentText;
  inputElement.focus();
}

/**
 * 处理粘贴事件 — 仅识别图片
 */
function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type && item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        readImageAsDataUrl(file).then((dataUrl) => {
          // 通知外部（mainUtils.js）有新图片
          if (typeof window.__onImagePasted === "function") {
            window.__onImagePasted({ dataUrl, fileName: file.name || "pasted-image.png" });
          }
        });
      }
      break;
    }
  }
}

/**
 * 读取图片文件为 base64 data URL
 */
function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}
