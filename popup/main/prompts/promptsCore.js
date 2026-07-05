/**
 * promptsCore.js — 提示词模板核心工具
 *
 * template 文本格式：
 *   <正文（可含 %s 占位符）>
 *   good_eg:
 *   [以下是推荐的示例 / 期望你采用 — good_eg = good example]
 *   <用户填的好例内容>
 *   bad_eg:
 *   [以下是不推荐的、应避免的反例 — bad_eg = bad example]
 *   <用户填的反例内容>
 *
 * 标记名含义：
 *   - eg = example
 *   - good_eg  = "好的例子 / 推荐的示例" — 期望 AI 采用的输出风格
 *   - bad_eg   = "坏例子 / 应避免的反例" — 提示 AI 不要这么写
 *
 * 系统行为：
 * - 保存到磁盘时，composeTemplate 会在每个段首主动注入一行"含义注解"（不依赖编辑器）
 * - 加载到编辑器时，parseTemplate 会自动剥离这两行系统注释（用户只看到自己写的内容）
 * - 拼请求时，applyPromptTemplate 不再重复加尾标题（系统注释已在段内），保留原文
 *   末尾追加简短的"推荐/不推荐"小标题作为 AI 的视觉锚点
 *
 * 老模板（无标记）向前兼容。
 * 老标记（good_ed / bad_ed）视为正文文本，不会被特殊处理。
 */

// ---------- 系统注释常量 ----------

const GOOD_EG_NOTE = '[以下是推荐的示例 / 期望你采用 — good_eg = good example]';
const BAD_EG_NOTE = '[以下是不推荐的、应避免的反例 — bad_eg = bad example]';
const IMAGE_INFO_NOTE = '[以下是图片识别结果 — image_info = OCR 自动填充]';

// 用于在解析时检测"这是系统注释还是用户自写的方括号行"。
// 仅匹配关键字 "good_eg = good example" / "bad_eg = bad example" / "image_info = OCR 自动填充"。
const GOOD_EG_NOTE_DETECT = /\[(?:[^\]\n]*\s)?good_eg\s*=\s*good\s*example[^\]\n]*\]\n?/;
const BAD_EG_NOTE_DETECT = /\[(?:[^\]\n]*\s)?bad_eg\s*=\s*bad\s*example[^\]\n]*\]\n?/;
const IMAGE_INFO_NOTE_DETECT = /\[(?:[^\]\n]*\s)?image_info[^\]\n]*\]\n?/;

// ---------- 解析 ----------

const GOOD_EG_RE = /(?:^|\n)good_eg:\n([\s\S]*?)(?=\n\s*(?:bad_eg|image_info):|$)/;
const BAD_EG_RE = /(?:^|\n)bad_eg:\n([\s\S]*?)(?=\n\s*image_info:|$)/;
// 解析时检测 image_info: 段（必须在 good_eg: / bad_eg: 之前匹配，所以放最后）
const IMAGE_INFO_RE = /(?:^|\n)image_info:\n([\s\S]*?)(?=\n\s*(?:good_eg|bad_eg|image_info):|$)/;

/**
 * 把 template 字符串拆成 { body, good_eg, bad_eg, image_info }
 * - body 不含 good_eg: / bad_eg: / image_info: 段
 * - 自动剥离上述段首的系统注释行，让编辑器只看到用户内容
 * - 用户自写的 `[...]` 行不被剥离（仅命中关键字格式才剥）
 */
export function parseTemplate(template) {
  if (!template) return { body: '', good_eg: '', bad_eg: '', image_info: '' };

  let body = template;
  let good_eg = '';
  let bad_eg = '';
  let image_info = '';

  // 注意：先抽 bad_eg 再抽 image_info 再抽 good_eg
  // image_info 可能在 body 任意位置（开头/中间/末尾），需要切除命中段后保留前后
  const badMatch = body.match(BAD_EG_RE);
  if (badMatch) {
    bad_eg = badMatch[1].replace(/\n+$/, '');
    body = body.slice(0, badMatch.index);
  }
  const imageInfoMatch = body.match(IMAGE_INFO_RE);
  if (imageInfoMatch) {
    image_info = imageInfoMatch[1].replace(/\n+$/, '');
    // image_info 段可能出现在 body 的任意位置（开头/中间/末尾）：
    // 切除命中段（不含前缀 \n, 含段后 \n）并替换为单个 \n，让前后段衔接干净
    const matchStart = imageInfoMatch.index;
    const matchedText = imageInfoMatch[0]; // 含前缀 \n（若有）+ 'image_info:\n' + 内容
    const leadingNewline = matchedText.startsWith('\n') ? 1 : 0;
    const segStart = matchStart + leadingNewline;
    const segEnd = matchStart + matchedText.length; // 末尾不含 \n（被 lookahead 消耗）
    const before = body.slice(0, segStart);
    const afterRaw = body.slice(segEnd);
    const after = afterRaw.startsWith('\n') ? afterRaw.slice(1) : afterRaw;
    body = before + (before && after ? '\n' : '') + after;
  }
  const goodMatch = body.match(GOOD_EG_RE);
  if (goodMatch) {
    good_eg = goodMatch[1].replace(/\n+$/, '');
    body = body.slice(0, goodMatch.index);
  }

  // 剥离段首系统注释（仅识别含关键字的那一行）
  good_eg = good_eg.replace(GOOD_EG_NOTE_DETECT, '');
  bad_eg = bad_eg.replace(BAD_EG_NOTE_DETECT, '');
  image_info = image_info.replace(IMAGE_INFO_NOTE_DETECT, '');

  body = body.replace(/\n+$/, '');
  good_eg = good_eg.replace(/^\n+/, '').replace(/\n+$/, '');
  bad_eg = bad_eg.replace(/^\n+/, '').replace(/\n+$/, '');
  image_info = image_info.replace(/^\n+/, '').replace(/\n+$/, '');

  return { body, good_eg, bad_eg, image_info };
}

// ---------- 拼回（保存到磁盘） ----------

/**
 * 把 { body, good_eg, bad_eg, image_info } 拼回 template 字符串
 * - 在每个段首主动注入一行系统注释（让 AI 看到磁盘模板也知道这俩单词是啥意思）
 * - 段为空则不追加该段
 * - 始终保持 image_info → good_eg → bad_eg 的顺序
 */
export function composeTemplate({ body, good_eg, bad_eg, image_info }) {
  let out = body || '';
  if (image_info && image_info.trim()) {
    out += (out ? '\n' : '') + 'image_info:\n' + IMAGE_INFO_NOTE + '\n' + image_info.replace(/\n+$/, '');
  }
  if (good_eg && good_eg.trim()) {
    out += (out ? '\n' : '') + 'good_eg:\n' + GOOD_EG_NOTE + '\n' + good_eg.replace(/\n+$/, '');
  }
  if (bad_eg && bad_eg.trim()) {
    out += (out ? '\n' : '') + 'bad_eg:\n' + BAD_EG_NOTE + '\n' + bad_eg.replace(/\n+$/, '');
  }
  return out;
}

// 暴露给测试/特殊场景使用
export const _SYSTEM_NOTES = { good: GOOD_EG_NOTE, bad: BAD_EG_NOTE, image: IMAGE_INFO_NOTE };

// ---------- 运行时拼装（送进 LLM 的最终文本） ----------

const GOOD_EG_HEADER = '\n\n[Good Examples — 期望你采用以下示例]';
const BAD_EG_HEADER = '\n\n[Bad Examples — 应避免以下反例]';

/**
 * 把 template 拼成最终发给大模型的字符串 —— 整个扩展唯一的"提示词映射"决策树。
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ 决策树（按顺序）                                                   │
 * │                                                                  │
 * │  ① 模板为 null/空                                                 │
 * │     → 直接返回 userMessage（或空字符串）                            │
 * │                                                                  │
 * │  ② parseTemplate(template) → { body, good_eg, bad_eg, image_info }│
 * │     - body 是剥离 good_eg: / bad_eg: / image_info: 段（含系统注释）后的主文本│
 * │                                                                  │
 * │  ②.5 %i（图片 OCR 信息）                                          │
 * │     a. body 含 %i → 全部替换为 imageInfo（空也替换）              │
 * │     b. body 不含 %i 且 imageInfo 非空 → 兜底前置                 │
 * │     c. body 不含 %i 且 imageInfo 为空 → 啥也不做                 │
 * │                                                                  │
 * │  ③ %v（提取文本 / 网页上下文）                                     │
 * │     a. body 含 %v → 全部替换为 extractedText（空也替换）           │
 * │     b. body 不含 %v 且 extractedText 非空 → 兜底前置             │
 * │     c. body 不含 %v 且 extractedText 为空 → 啥也不做             │
 * │                                                                  │
 * │  ④ %s（用户消息）                                                  │
 * │     a. body 含 %s → 替换（userMessage 可空）                       │
 * │     b. body 不含 %s 且 userMessage 非空 → 兜底前置               │
 * │     c. body 不含 %s 且 userMessage 为空 → 啥也不做               │
 * │                                                                  │
 * │  ④.5 image_info 段                                                │
 * │     a. image_info 非空 → 拼 [相关图片信息 — 自动填充] 标题           │
 * │                                                                  │
 * │  ⑤ good_eg / bad_eg 段                                            │
 * │     a. good_eg 非空 → 拼 [Header]\n[系统注释]\n<good_eg>          │
 * │     b. bad_eg  非空 → 拼 [Header]\n[系统注释]\n<bad_eg>           │
 * │                                                                  │
 * │  ⑥ 返回完整 prompt                                                 │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * 边界规则：
 * - 完全无占位符、无 good_eg/bad_eg：沿用 aichatUtils 行为 `<user> <body>`
 *   （调用方若想"无 %s 时忽略 userMessage"是各自的 UX 策略，不在决策树里）
 * - 无占位符但有 extractedText：`<ctx>\n\n<user> <body>`
 * - 占位符与提取文本同时存在：以模板显式定义为准
 *
 * @param {string} template 提示词模板（可含 %s / %v / %i / good_eg: / bad_eg: / image_info: 段）
 * @param {Object} [opts]
 * @param {string} [opts.userMessage=""] 用户输入；空字符串视为"无用户消息"
 * @param {string} [opts.extractedText=""] 提取的网页上下文（仅 sidebar 传入）
 * @param {string} [opts.imageInfo=""] 图片 OCR 识别结果（仅 popup 传入）
 * @returns {string} 拼好的最终 prompt
 */
export function applyPromptTemplate(template, { userMessage = '', extractedText = '', imageInfo = '' } = {}) {
  // ① 模板为 null/空
  if (!template) return userMessage || '';

  // ② 解析：拆 body / good_eg / bad_eg / image_info，剥离系统注释
  const { body, good_eg, bad_eg, image_info } = parseTemplate(template);
  const user = userMessage || '';
  const ctx = extractedText || '';
  const img = imageInfo || '';
  let processed = body;

  // ②.5 %i 占位符处理
  const hasImagePlaceholder = processed.includes('%i');
  if (hasImagePlaceholder) {
    // a. 显式 %i：原位替换
    processed = processed.replace(/%i/g, img);
  }

  // ③ %v 占位符处理
  const hasCtxPlaceholder = processed.includes('%v');
  if (hasCtxPlaceholder) {
    // a. 显式 %v：原位替换
    processed = processed.replace(/%v/g, ctx);
  }

  // ④ %s 占位符处理
  const hasUserPlaceholder = processed.includes('%s');
  if (hasUserPlaceholder) {
    // a. 显式 %s：原位替换
    processed = processed.replace(/%s/g, user);
  }

  // 兜底前置：只在三个占位符都没用上的情况下触发
  // 顺序：img 在前 → ctx 在中 → user 在末 → body 兜底
  if (!hasCtxPlaceholder && !hasUserPlaceholder && !hasImagePlaceholder) {
    let prefix = '';
    if (img) prefix += '[相关图片信息]\n' + img + '\n\n';
    if (ctx) prefix += ctx + '\n\n';
    if (user.trim()) prefix += user + ' ';
    processed = prefix + processed;
  } else if (!hasImagePlaceholder && img) {
    // 模板没显式 %i 但有 imageInfo：兜底前置
    processed = '[相关图片信息]\n' + img + '\n\n' + processed;
  } else if (!hasCtxPlaceholder && ctx) {
    // 模板显式含 %s 但没 %v，且有 ctx：保留旧 aichatUtils 行为，ctx 兜底前置
    processed = ctx + '\n\n' + processed;
  }

  // ④.5 image_info 段（已剥离系统注释，发送时再补回）
  if (image_info && image_info.trim()) {
    processed += '\n\n[相关图片信息 — 自动填充]';
  }

  // ⑤ good_eg / bad_eg 段（已剥离系统注释，发送时再补回）
  if (good_eg && good_eg.trim()) {
    processed += GOOD_EG_HEADER + '\n' + GOOD_EG_NOTE + '\n' + good_eg.replace(/\n+$/, '');
  }
  if (bad_eg && bad_eg.trim()) {
    processed += BAD_EG_HEADER + '\n' + BAD_EG_NOTE + '\n' + bad_eg.replace(/\n+$/, '');
  }

  // ⑥ 返回
  return processed;
}
