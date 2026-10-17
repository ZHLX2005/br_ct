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



// 输出结果
console.log('发现项目:', items.length);


/**
 * @fileoverview B站个人空间项目DOM展示
 *
 * @scenario    在 B站个人空间项目页面使用
 * @feature     遍历XPath收集项目链接并渲染DOM列表
 * @effect      在页面顶部插入有序列表DOM元素
 * @category    DOM创建
 * @platform    bilibili
 * @entry       自动执行
 */
// 构建有序列表  使用js在浏览器创建dom
const ol = document.createElement('ol');
ol.style.fontFamily = 'system-ui, sans-serif';
ol.style.lineHeight = '1.6';

items.forEach(item => {
  const li = document.createElement('li');
  const link = document.createElement('a');
  
  link.href = item.link;
  link.textContent = item.title;
  link.target = '_blank';
  link.style.textDecoration = 'none';
  link.style.color = '#00a1d6';
  link.style.fontWeight = '500';
  
  li.style.marginBottom = '12px';
  li.appendChild(link);
  ol.appendChild(li);
});
document.body.prepend(ol);