# _candidates 候选脚本区

未被注册的脚本统一扁平存放在此（不在 popup 列表、无快捷键、不被后台注入）。

- **启用某个脚本**：移回对应分类目录 → 文件内加 `main()` 包装（若无）→ 注册到 `popup/func_execute/functioncall.js`
- **规范**：见 `.claude/skills/code-standards-guide/references/add-func-script.md`
- 文件名前缀即原目录上下文（如 `bili_`、`boss_job_`、`腾讯文档_`），文件头部 `@fileoverview` 有详细说明

| 前缀/名称 | 说明 |
|---|---|
| `bili_*` | B站：用户项目抓取/DOM/MD、专栏提取 |
| `boss_job*` | boss直聘：旧版职位脚本、列表点击/沟通按钮测试（已被 boss_job_all.js 合并取代） |
| `chatgpt_cdp_copy.js` | chatgpt CDP 复制 |
| `leecode_*` | LeetCode：题目标题提取、题目基础信息 |
| `腾讯文档_*` | 腾讯文档表格：单元格输入读取、批量爬取 |
| `video_*` | 视频：抽帧打包下载、VideoOperator 操作模块 |
| `div_*` / `dom_*` / `xpath_*` | 元素 DOM 开发调试面板类（dev-panel 参考实现） |
| `copy_prevent_hook.js` | 复制操作 hook |
| `typingMonitor.js` | 打字监听 |
| `test_yuanbao_paste.js` | 元宝粘贴测试 |
| `海浪效果*.js` | 页面底部 Canvas 海浪动画 |
| `debug_*` | 调试草稿/笔记 |
