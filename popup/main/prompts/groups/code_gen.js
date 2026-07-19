export default [
  {
    "label": "不修饰",
    "alias": "raw",
    "template": "%s"
  },
  {
    "label": "docx-copy",
    "alias": "docx",
    "template": "主题:  %s\n规范: 核心回答全部输出到txt代码块当中,因为我需要复制到docx当中,不支持公式语法和md语法,所以答案输出到txt的代码块里面,不要使用 -的列表符号"
  },
  {
    "label": "docx-copy-st",
    "alias": "docx-copy-st",
    "template": "参考: %s\n上面参考内容,我希望你进行弱化或者强化或者润色或者重构,降低去重,完成模仿的第一步\n不要使用表格,如有需要,使用列表表达表格"
  }
];
