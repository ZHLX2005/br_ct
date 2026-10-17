/**
 * @fileoverview LeetCode页面XPath调试脚本
 *
 * @scenario    LeetCode页面调试XPath定位
 * @feature     解析固定XPath获取元素并打印
 * @effect      控制台输出目标DOM供调试
 * @category    工具辅助
 * @platform    leecode
 * @entry       自动执行
 */
var xpath = "/html/body/div[1]/div[1]/div[6]/div/div/div/div[2]/div/div[1]/div/div[2]/div[17]/div[2]";
var result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
var element = result.singleNodeValue;
console.log(element);

<div class="flex flex-col border-b-[1.5px] duration-300 last:border-b-0 border-lc-fill-02 dark:border-dark-lc-fill-02 hov
er:bg-lc-fill-02 dark:hover:bg-dark-lc-fill-02 cursor-pointer" id=""><div class="flex h-[52px] w-full items-center space-x-3
 px-4"><div><div class="flex items-center" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1
 em" height="1em" fill="currentColor" class="h-4.5 w-4.5 text-lc-green-60 dark:text-dark-lc-green-60 inline-block shrin
 k-0 fill-none stroke-current"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21.6 12a9.6 9.6 0 01-9.6
  9.6 9.6 9.6 0 110-19.2c1.507 0 2.932.347 4.2.965M19.8 6l-8.4 8.4L9 12"></path></svg></div></div><div class="relative flex
   h-full w-full items-center"><div class=" flex w-0 flex-1 items-center space-x-2"><div class="text-body max-w-[75%] font-m
   edium text-lc-text-primary dark:text-dark-lc-text-primary"><div class="truncate">只出现一次的数字</div></div></div>
<p class="text-[14px] text-lc-green-60 dark:text-dark-lc-green-60">简单</p></div></div></div>




