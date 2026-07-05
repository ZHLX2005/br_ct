/**
 * sidebar/main/aichat/dragDropImageHandler.js
 * aichat 输入框的图片拖放 + 粘贴处理
 */
export function setupImageDragDrop({ chatInput, onImage }) {
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    chatInput.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  chatInput.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    const items = dt?.items;
    if (!items || items.length === 0) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          readImageAsDataUrl(file).then((dataUrl) => {
            onImage({ dataUrl, fileName: file.name || "dropped-image.png" });
          });
        }
        break;
      }
    }
  });

  chatInput.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          readImageAsDataUrl(file).then((dataUrl) => {
            onImage({ dataUrl, fileName: file.name || "pasted-image.png" });
          });
        }
        break;
      }
    }
  });
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}