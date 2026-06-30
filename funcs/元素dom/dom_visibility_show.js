/**
 * @fileoverview 保留#messages-container全屏展示
 *
 * @scenario    需要让聊天容器独占全屏、移除其它干扰元素
 * @feature     清空body并保留#messages-container占满100vh
 * @effect      移除body所有子节点后重新挂载#messages-container并全屏展示
 * @category    视觉展示
 * @platform    通用
 * @entry       自动执行
 */

(function() {
    var keep = document.querySelector('#messages-container');                                                                                                             
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.height = '100vh';
    document.body.style.overflow = 'hidden';
    if (keep) {
      keep.style.width = '100%';
      keep.style.height = '100vh';
      keep.style.overflow = 'auto';
      document.body.appendChild(keep);
    }
  })();


