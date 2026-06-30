/**
 * @fileoverview 多行文本转 \n 转义字符串
 *
 * @scenario    在控制台调试时，需要把一段多行 JSON/代码贴进单行字符串里
 * @feature     prompt 弹窗接收多行文本 → 把换行替换成 \n → 输出到 console 并复制到剪贴板
 * @effect      console 输出转义后的单行字符串，剪贴板里也是这份转义结果
 * @category    文本处理
 * @platform    通用
 * @entry       main()
 */


function main() {
  // 提示用户输入多行文本
  const input = prompt("请输入要转换的多行文本：\n(支持粘贴多行内容)");

  // 如果用户取消或为空则不执行
  if (input) {
    // 将换行符替换成 \n，并去除首尾空格
    const result = input.trim().replace(/\r?\n/g, "\\n");

    // 输出结果到控制台
    console.log("✅ 转换结果：");
    console.log(result);

    // --- 使用 textarea 复制 ---
    const textarea = document.createElement("textarea");
    textarea.value = result;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);

    console.log("📋 已复制到剪贴板！");
  }
}

