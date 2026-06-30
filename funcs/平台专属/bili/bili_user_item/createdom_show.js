/**
 * @fileoverview B站项目数据生成DOM列表
 *
 * @scenario    在已有 items 数组的场景下调用
 * @feature     将传入的 items 数组渲染为有序列表DOM
 * @effect      在页面顶部插入带链接的有序列表
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