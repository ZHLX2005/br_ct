/**
 * @fileoverview 腾讯文档批量爬取单元格内容
 *
 * @scenario    腾讯文档在线表格批量读取使用
 * @feature     输入左上角+右下角坐标批量抓取单元格
 * @effect      按区域循环读取单元格值并返回结果数组
 * @category    平台专属
 * @platform    腾讯文档
 * @entry       batchFetch()
 */
function input(value) {
    const inputElement = document.querySelector("#mainContainer > div.formula-bar > input");
    if (inputElement) {
        inputElement.value = value;
        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        inputElement.dispatchEvent(enterEvent);
    }
}

function getRe() {
    const el = document.querySelector("#alloy-simple-text-editor > p");
    return el ? el.textContent : "";
}

// 工具函数：字母列 <-> 数字列 转换
function numToCol(n) {
    let s = "";
    while (n >= 0) {
        s = String.fromCharCode(n % 26 + 65) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
}
function colToNum(col) {
    let num = 0;
    for (let i = 0; i < col.length; i++) {
        num = num * 26 + (col.charCodeAt(i) - 64);
    }
    return num - 1;
}

// 批量爬取 A0 → Z99
async function batchFetch(topLeft, bottomRight) {
    const results = [];

    const startCol = topLeft.match(/[A-Z]+/i)[0].toUpperCase();
    const startRow = parseInt(topLeft.match(/\d+/)[0], 10);
    const endCol = bottomRight.match(/[A-Z]+/i)[0].toUpperCase();
    const endRow = parseInt(bottomRight.match(/\d+/)[0], 10);

    const startColNum = colToNum(startCol);
    const endColNum = colToNum(endCol);

    for (let row = startRow; row <= endRow; row++) {
        const rowData = [];
        for (let col = startColNum; col <= endColNum; col++) {
            const cell = numToCol(col) + row;
            input(cell);

            // 等待页面渲染
            await new Promise(r => setTimeout(r, 120));

            rowData.push(getRe());
        }
        results.push(rowData);
    }
    return results;
}

function exportCSV(data, filename = "excel_data.csv") {
    const csvContent = data.map(row =>
        row.map(cell => {
            if (cell == null) return "";
            let v = String(cell).replace(/"/g, '""');
            if (v.includes(",") || v.includes("\n")) {
                v = `"${v}"`;
                //1
            }
            return v;
        }).join(",")
    ).join("\n");

    // 在开头加 BOM 解决 Excel 乱码
    const BOM = "\uFEFF";  
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

// 示例：爬取 A0 → Z99 并导出
batchFetch("A1", "H34").then(res => {
    console.log("爬取完成，正在导出 CSV...");
    exportCSV(res, "excel_result.csv");
});
