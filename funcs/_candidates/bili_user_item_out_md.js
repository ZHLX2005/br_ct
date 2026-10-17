/**
 * @fileoverview B站项目列表转Markdown输出
 *
 * @scenario    在 B站用户主页项目列表页使用
 * @feature     遍历XPath抓取项目并生成Markdown
 * @effect      输出到控制台并自动复制到剪贴板
 * @category    平台专属
 * @platform    bilibili
 * @entry       自动执行
 */
// 获取所有匹配的节点
const items = [];
for (let i = 1; ; i++) {
  const path = `/html/body/div[1]/main/div[1]/div[2]/div/div[2]/div/div[${i}]/div/div/div/div/div[2]/div[1]/a`;
  const node = document.evaluate(
    path,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;
  
  if (!node) break;  // 当找不到元素时终止循环
  
  items.push({
    title: node.textContent,
    link: node.href.startsWith('//') ? `https:${node.href}` : node.href
  });
}

// 创建包含所有结果的单一字符串
let markdownOutput = `发现 ${items.length} 个项目：\n\n`;
let clipboardOutput = "";

items.forEach((item, index) => {
  const line = `${index + 1}. [${item.title}](${item.link})`;
  markdownOutput += line + "\n";
  clipboardOutput += line + "\n";
});

// 添加可复制的完整Markdown代码块
markdownOutput += "\n--- 可一次性复制的完整Markdown代码 ---\n" + clipboardOutput;

// 在控制台输出完整结果
console.log(markdownOutput);

// 额外创建一个隐藏文本区域便于复制
const textArea = document.createElement("textarea");
textArea.value = clipboardOutput;
textArea.style.position = "fixed";
textArea.style.left = "-9999px";
document.body.appendChild(textArea);
textArea.select();

console.log("已自动选中所有内容，按Ctrl+C复制");
try {
  document.execCommand("copy");
  console.log("内容已自动复制到剪贴板");
} catch (err) {
  console.log("自动复制失败，请手动复制控制台输出");
}

setTimeout(() => document.body.removeChild(textArea), 2000);