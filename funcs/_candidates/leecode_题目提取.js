/**
 * @fileoverview LeetCode题目标题提取
 *
 * @scenario    LeetCode题库列表页使用
 * @feature     双层XPath遍历抓取所有题目标题
 * @effect      输出Markdown并自动复制到剪贴板
 * @category    平台专属
 * @platform    leecode
 * @entry       main()
 */
// funcs/example_func2.js

function main() {
 
// 定义结果数组
const allTitles = [];

// 外层循环：遍历方框 (1到17)
for (let boxIndex = 1; boxIndex <= 17; boxIndex++) {
    // 内层循环：遍历每个方框下的内容div (从2开始)
    for (let contentIndex = 2; ; contentIndex++) {
        try {
            // 构建XPath
            const xpath = `/html/body/div[1]/div[1]/div[6]/div/div/div/div[2]/div/div[1]/div/div[2]/div[${boxIndex}]/div[${contentIndex}]`;
            
            // 获取元素
            const result = document.evaluate(
                xpath, 
                document, 
                null, 
                XPathResult.FIRST_ORDERED_NODE_TYPE, 
                null
            );
            
            const element = result.singleNodeValue;
            
            // 如果找不到元素，跳出内层循环
            if (!element) break;
            
            // 查找标题元素
            const titleElement = element.querySelector('.truncate');
            
            if (titleElement) {
                // 直接记录标题文本
                allTitles.push(titleElement.textContent.trim());
            }
            
        } catch (e) {
            console.error(`在div[${boxIndex}]/div[${contentIndex}]处出错:`, e);
            break;
        }
    }
}

// 创建简洁输出
console.log(`发现 ${allTitles.length} 个LeetCode题目:\n`);
let markdownOutput = "";
let clipboardOutput = "";

// 直接输出有序列表
allTitles.forEach((title, index) => {
    const line = `${index + 1}. ${title}`;
    console.log(line);
    markdownOutput += line + "\n";
    clipboardOutput += line + "\n";
});

// 添加完整复制内容
console.log("\n--- 可一次性复制的完整内容 ---\n" + clipboardOutput);

// 尝试自动复制
const textArea = document.createElement("textarea");
textArea.value = clipboardOutput;
textArea.style.position = "fixed";
textArea.style.left = "-9999px";
document.body.appendChild(textArea);
textArea.select();

try {
    document.execCommand("copy");
    console.log("内容已自动复制到剪贴板");
} catch (err) {
    console.log("自动复制失败，请手动复制控制台输出");
}

setTimeout(() => {
    if (document.body.contains(textArea)) {
        document.body.removeChild(textArea);
    }
}, 2000);
}


