/**
 * @fileoverview 剪贴板内容保存为文件
 *
 * @scenario    看到一段文本想立即存下来当文件，而不是先粘到编辑器再另存为
 * @feature     读取系统剪贴板内容，弹出保存对话框让用户下载为文件
 * @effect      触发浏览器下载，文件名由用户或自动推断，文件落盘到本地
 * @category    数据提取
 * @platform    通用
 * @entry       main()
 */

// 保存剪切板为文件 然后下载 

function main() {
  (async function () {
    // 提示用户交互触发
    const infoDiv = document.createElement("div");
    infoDiv.textContent = "请点击页面或按任意键以读取剪贴板内容";
    infoDiv.style.position = "fixed";
    infoDiv.style.top = "20px";
    infoDiv.style.left = "20px";
    infoDiv.style.zIndex = 10000;
    infoDiv.style.background = "rgba(0,0,0,0.7)";
    infoDiv.style.color = "#fff";
    infoDiv.style.padding = "10px";
    infoDiv.style.borderRadius = "8px";
    infoDiv.style.fontFamily = "sans-serif";
    infoDiv.style.pointerEvents = "none";
    document.body.appendChild(infoDiv);

    const triggerHandler = async () => {
      document.removeEventListener("click", triggerHandler);
      document.removeEventListener("keydown", triggerHandler);
      infoDiv.remove();

      if (!navigator.clipboard) {
        console.warn("当前浏览器不支持 Clipboard API 或未在 HTTPS 页面");
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        if (!text) {
          console.log("剪贴板为空");
          return;
        }

        // 创建临时悬浮 div 显示前三行
        const previewDiv = document.createElement("div");
        previewDiv.style.position = "fixed";
        previewDiv.style.top = "60px";
        previewDiv.style.left = "20px";
        previewDiv.style.zIndex = 10000;
        previewDiv.style.background = "rgba(0, 0, 0, 0.7)";
        previewDiv.style.color = "#fff";
        previewDiv.style.padding = "10px";
        previewDiv.style.borderRadius = "8px";
        previewDiv.style.fontFamily = "monospace";
        previewDiv.style.whiteSpace = "pre-line";
        previewDiv.style.maxWidth = "400px";
        previewDiv.style.pointerEvents = "none";

        const lines = text.split(/\r?\n/).slice(0, 3);
        previewDiv.textContent = lines.join("\n");
        document.body.appendChild(previewDiv);

        // 3 秒后自动移除预览
        setTimeout(() => previewDiv.remove(), 3000);

        // 稍微延迟让预览先显示，再让用户输入文件名
        setTimeout(() => {
          let fileName = prompt(
            "请输入文件名及后缀（例如 myfile.txt）\n回车使用默认 clipboard.txt",
            "clipboard.txt"
          );
          if (fileName === null) {
            console.log("用户取消操作");
            return; // 取消，不生成文件
          }
          if (fileName === "") fileName = "clipboard.txt"; // 默认文件名

          // 创建下载文件
          const blob = new Blob([text], { type: "text/plain" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
        }, 300);
      } catch (err) {
        console.error("⚠️ 无法读取剪贴板：", err.message);
      }
    };

    // 点击或任意键盘操作触发
    document.addEventListener("click", triggerHandler);
    document.addEventListener("keydown", triggerHandler);
  })();
}
