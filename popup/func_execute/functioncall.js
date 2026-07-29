// 预定义脚本列表
const scriptFiles = [
  { name: "拾取元素,直接复制内容", file: "元素dom/div_copy_wrapper.js" },
  {
    name: "通过传入dom的全部元素,间接复制内容",
    file: "元素dom/div_copy_input_dom.js",
  },
  { name: "拾取资源路径", file: "元素dom/div_Img_wrapper.js" },
  { name: "DOM可见性控制器", file: "元素dom/dom_visibility_controller.js" },
  { name: "boss直聘加载+打招呼（合并脚本）", file: "平台专属/boss直聘/boss_job_all.js" },
  { name: "获得当前输入框的内容保存为文件", file: "元素dom/input.js" },
  { name: "转换成一行数据", file: "元素dom/oneRaw.js" },
  { name: "颜色色卡", file: "元素dom/color_show.js" },
  { name: "剪切板抓取文字", file: "元素dom/copy2file.js" },
  { name: "视频播放面板", file: "元素dom/videoControllerPlane/videoPlane.js" },
  { name: "B站收藏夹导出所有视频链接", file: "平台专属/bili/收藏夹导出所有视频链接/extract_bilibili_favlist.js" },
  { name: "B站播放页分P链接提取（pod+合集）", file: "平台专属/bili/extract_bilibili_pod.js" },
];

document.addEventListener("DOMContentLoaded", () => {
  const scriptList = document.getElementById("script-list");
  const statsCount = document.getElementById("stats-count");

  // 更新统计数量
  if (statsCount) {
    statsCount.textContent = scriptFiles.length;
  }

  // 动态生成脚本项
  if (scriptFiles.length === 0) {
    // 空状态
    scriptList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">暂无可用的脚本</div>
      </div>
    `;
  } else {
    scriptFiles.forEach((script) => {
      const scriptItem = document.createElement("div");
      scriptItem.className = "script-item";
      scriptItem.innerHTML = `
        <div class="script-content">
          <div class="script-name">${script.name}</div>
          <div class="script-path">${script.file}</div>
        </div>
        <button class="execute-button" data-file="${script.file}">执行</button>
      `;
      scriptList.appendChild(scriptItem);
    });
  }

  // 按钮事件监听
  scriptList.addEventListener("click", (event) => {
    if (event.target.classList.contains("execute-button")) {
      const scriptFile = event.target.dataset.file;
      const button = event.target;
      const originalText = button.textContent;

      button.textContent = "执行中...";
      button.disabled = true;

      chrome.runtime.sendMessage(
        { action: "executeFunctionScript", file: scriptFile },
        (response) => {
          if (response && response.status === "success") {
            console.log(`脚本 ${scriptFile} 执行成功`);
          } else {
            alert(
              `脚本 ${scriptFile} 执行失败: ${response?.message || "未知错误"}`
            );
          }

          button.textContent = originalText;
          button.disabled = false;

          // 成功后关闭 popup
          window.close();
        }
      );
    }
  });

  // 设置链接点击事件
  const settingsLink = document.querySelector(".settings-link");
  if (settingsLink) {
    settingsLink.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }
});
