/**
 * @fileoverview 提取页面表单数据
 *
 * @scenario    需要快速导出页面上所有表单的有效数据
 * @feature     扫描input/select/textarea，提取非空值输出到控制台
 * @effect      在控制台输出所有非空表单数据
 * @category    数据提取
 * @platform    通用
 * @entry       main()
 */

// 获得表单数据 
function main(){
(function() {
    'use strict';

    /**
     * 检查一个值是否为“空”。
     * 空的定义包括：null, undefined, 空字符串, 空数组。
     * 注意：数字 0 和布尔值 false 不被视为空。
     * @param {*} val 
     * @returns {boolean}
     */
    function isEmpty(val) {
        if (val === null || val === undefined) return true;
        if (typeof val === 'string' && val.trim() === '') return true;
        if (Array.isArray(val) && val.length === 0) return true;
        return false;
    }

    console.log('开始扫描页面表单数据...');

    // 获取所有相关的表单元素
    const allFormElements = document.querySelectorAll('input, select, textarea');
    
    // 存储有效（非空）的表单数据
    const validFormElements = [];

    allFormElements.forEach((element) => {
        // 忽略某些特定类型的输入框
        if (element.type === 'password' || element.type === 'hidden') {
            return;
        }

        let value;
        // 根据元素类型获取值
        if (element.type === 'checkbox' || element.type === 'radio') {
            value = element.checked;
        } else if (element.type === 'file') {
            // file类型的input，其value是文件名，为空时表示未选择文件
            value = element.files.length > 0 ? Array.from(element.files).map(f => f.name).join(', ') : '';
        } else if (element.tagName.toLowerCase() === 'select' && element.multiple) {
            const selectedOptions = Array.from(element.selectedOptions);
            value = selectedOptions.map(option => option.value || option.text);
        } else {
            value = element.value;
        }

        // **核心逻辑：如果值为空，则直接跳过此元素，不进行任何处理**
        if (isEmpty(value)) {
            return;
        }

        // 只有值不为空的元素才会被处理
        const label = element.labels ? Array.from(element.labels).map(l => l.innerText).join(' ') : '(无标签)';
        const type = element.type || element.tagName.toLowerCase();
        // 生成一个相对稳定的选择器用于定位
        const selector = element.id ? `#${element.id}` : 
                         (element.className ? `${element.tagName.toLowerCase()}.${element.className.split(' ').join('.')}` : 
                         `${element.tagName.toLowerCase()}:nth-of-type(${Array.from(element.parentNode.children).indexOf(element) + 1})`);

        validFormElements.push({
            label: label,
            type: type,
            selector: selector,
            value: value
        });
    });

    // 生成输出文本
    let output = '';
    const now = new Date();
    const timestamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    output += `页面表单数据快照\n`;
    output += `============================\n`;
    output += `生成时间: ${timestamp}\n`;
    output += `页面URL: ${window.location.href}\n`;
    output += `============================\n\n`;

    if (validFormElements.length === 0) {
        output += '当前页面没有找到任何包含有效数据的表单元素。';
    } else {
        validFormElements.forEach((item, index) => {
            output += `#${index + 1}\n`;
            output += `  标签: ${item.label}\n`;
            output += `  类型: ${item.type}\n`;
            output += `  定位: ${item.selector}\n`;
            output += `  值: ${JSON.stringify(item.value)}\n`;
            output += '-----------------------------\n';
        });
    }

    // 创建并下载文件
    try {
        const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `form_data_snapshot_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`成功导出 ${validFormElements.length} 条有效表单数据。`);
    } catch (e) {
        console.error('导出文件时出错:', e);
        console.log('数据如下，可手动复制：\n\n', output);
    }

})();


}
