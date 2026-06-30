

/**
 * @fileoverview 腾讯文档单元格输入与读取
 *
 * @scenario    腾讯文档在线表格页面使用
 * @feature     通过公式栏输入单元格地址并读取内容
 * @effect      调用input写入单元格getRe读取值
 * @category    平台专属
 * @platform    腾讯文档
 * @entry       自动执行
 */


function input(value){
const inputElement = document.querySelector("#mainContainer > div.formula-bar > input");

// 确保找到了元素
if (inputElement) {
  // 1. 设置输入框的值为 "D1"
  inputElement.value = value;

  // 2. 创建并分派一个键盘事件，模拟 Enter 键按下
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true, // 事件能冒泡到父元素
    cancelable: true // 事件可被取消
  });

  inputElement.dispatchEvent(enterEvent);
}

}

input("D3");

function getRe(){

  return   document.querySelector("#alloy-simple-text-editor > p").textContent;
}


getRe()