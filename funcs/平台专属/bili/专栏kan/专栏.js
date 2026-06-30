/**
 * @fileoverview B站专栏区域XPath调试
 *
 * @scenario    在 B站专栏页面调试XPath定位
 * @feature     解析固定XPath获取元素并打印到控制台
 * @effect      输出目标元素到控制台供调试
 * @category    工具辅助
 * @platform    bilibili
 * @entry       自动执行
 */
// /html/body/div[2]/div[2]/div[2]/div/div[5]/div[1]/div[2]/div/div[797]/div/div/div[1]/div[2]

var xpath = "/html/body/div[2]/div[2]/div[2]/div/div[5]/div[1]/div[2]/div/div[796]";
var result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
var element = result.singleNodeValue;
console.log(element);



