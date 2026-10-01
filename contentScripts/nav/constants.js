/**
 * @fileoverview Nav 行为常量。CSS class/id 仍在 view.js 中（表现层职责）。
 */

// ---- 点击锁 ----
/** 用户点击 nav row 后锁定 active 不跟随视口，单位 ms */
export const CLICK_LOCK_MS = 800;

// ---- 节流 ----
/** evaluateActiveByViewport 节流间隔，单位 ms */
export const SET_ACTIVE_THROTTLE_MS = 120;

// ---- 可见度阈值 ----
/** 一条 row 的 visible ratio 超过此值才参与 active 竞争 */
export const ACTIVE_MIN_RATIO = 0.3;
/** 当前 active row 的 ratio 低于此值才让出新 active */
export const ACTIVE_STABILITY_RATIO = 0.15;
/** 新候选 ratio 必须超出当前 active 至少此差值才会切换 */
export const ACTIVE_STABILITY_DELTA = 0.1;

// ---- 文本截断 ----
/** 每个 nav label 的最大字符数 */
export const LABEL_TRUNCATE = 60;

// ---- 复制过滤 ----
/** 「复制全部」时，超过此字符数的条目被排除（太长复制出来没有意义） */
export const COPY_MAX_LEN = 400;

// ---- 重建防抖 ----
export const REBUILD_DEBOUNCE_MS = 60;

// ---- 启动兜底 ----
export const RETRY_INTERVAL_MS = 300;
export const RETRY_MAX = 30;

// ---- IntersectionObserver ----
export const IDLE_ROOT_MARGIN = '-30% 0px -30% 0px';
export const IO_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

// ---- 发送类按钮（总结/问法） ----
/**
 * 「总结」按钮拼装消息时使用的模板。%s 用与"复制"按钮相同的多消息原文
 * （以 ========== 分隔）填充。支持重复总结：上一轮发出的总结消息会被
 * isNavSentMessage 过滤，不会嵌套进下一轮。
 */
export const SUMMARY_TEMPLATE =
  '%s,这是我向你提出的这些问题 现在重新对每个问题进行总结,讲解整个知识体系,让整个所有提问和体系更加自然';

/**
 * 「问法」按钮（复盘提问序列）使用的模板，%s 填充方式与 SUMMARY_TEMPLATE 相同。
 * 用途：把提问按知识点聚类成迭代链（不满意→换角度追问），对每个提问版本
 * 按多维度百分制打分并比较，沉淀高分配方的提问模板。
 * 例：「flink解决了什么需求」→「给出一个场景告诉我必须使用flink解决的原理」，
 * 后者在具体度/可验证性维度显著更高。
 */
export const INSIGHT_TEMPLATE = [
  '%s',
  '',
  '---',
  '这是我向你提出的这些问题。请复盘这个提问序列,严格按以下四部分输出:',
  '',
  '## 一、迭代链识别',
  '把提问按知识点聚类,找出同一知识点的多个提问版本(迭代链:对回答不满意→换角度追问),标明链条如 Q1→Q3→Q5。',
  '',
  '## 二、版本打分(百分制)',
  '对每个提问版本,从以下 4 个维度各打 0~100 分:',
  '- 具体度:是否锚定具体场景/对象,而非抽象泛问',
  '- 约束力:是否限定回答边界,防止回答泛泛而谈',
  '- 可验证性:答案优劣能否被明确判断',
  '- 信息增量:相比迭代链前一版能多挖出多少新知识',
  '总分 = 4 个维度的平均值。输出表格:| 版本 | 具体度 | 约束力 | 可验证性 | 信息增量 | 总分 | 一句话点评 |',
  '',
  '## 三、迭代比较',
  '对每条迭代链,指出得分最高与最低的版本:低分版输在哪个维度、高分版赢在哪个维度,说明高分问法为什么能引出更好的回答。',
  '参照例:先问「flink解决了什么需求」,不满意后追问「给出一个场景告诉我必须使用flink解决的原理」—— 后者具体度与可验证性显著更高,更值得沉淀。',
  '',
  '## 四、沉淀',
  '1) 提炼高分版本的共性,整理成可复用的提问模板',
  '2) 给出后续提问的迭代启发:第一版该怎么问,不满意后往哪个维度升级',
].join('\n');

/**
 * 内部发起消息的识别标记：「总结」「问法」按钮发出的消息都包含该子串
 * （两个模板共用同一句开头）。模板里 %s 替换后是用户第一条问题（位置
 * 不固定），所以不能用 startsWith 检测，只能用"全文包含"匹配。
 */
export const NAV_SENT_MARKER = '这是我向你提出的这些问题';

/**
 * 工具函数：给定 nav 记录（或任意文本），判断是否由 nav 按钮内部发起。
 * 任何含 NAV_SENT_MARKER 的文本一律视为内部消息，复制/导出/再次发送时
 * 都要过滤掉 —— 这是"按钮可重复使用而不产生嵌套重复"的过滤机制。
 */
export function isNavSentMessage(text) {
  if (!text) return false;
  return text.includes(NAV_SENT_MARKER);
}
