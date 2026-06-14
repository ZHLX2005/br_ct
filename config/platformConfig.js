/**
 * 统一平台配置文件
 *
 * 所有平台相关的配置都在此定义，包括：
 * - 平台基本信息（名称、图标、颜色）
 * - 平台 URL
 * - 默认可见性
 *
 * 后续添加新平台时，只需在此文件中添加即可
 */

// 平台配置数据
export const PLATFORM_CONFIG = {
  yuanbao: {
    name: '元宝',
    icon: '元',
    shortIcon: '元',
    color: '#ff6b35',
    url: 'https://yuanbao.tencent.com/chat/',
    defaultVisible: true
  },
  gemini: {
    name: 'Gemini',
    icon: 'G',
    shortIcon: 'G',
    color: '#4285f4',
    url: 'https://gemini.google.com/app',
    defaultVisible: true
  },
  chatgpt: {
    name: 'ChatGPT',
    icon: 'C',
    shortIcon: 'C',
    color: '#10a37f',
    url: 'https://chatgpt.com',
    defaultVisible: true
  },
  claude: {
    name: 'Claude',
    icon: 'A',
    shortIcon: 'A',
    color: '#cc785c',
    url: 'https://claude.ai',
    defaultVisible: true
  },
  doubao: {
    name: '豆包',
    icon: '豆',
    shortIcon: '豆',
    color: '#ff6900',
    url: 'https://www.doubao.com/chat/',
    defaultVisible: true
  },
  glm: {
    name: '智谱',
    icon: '智',
    shortIcon: 'ZH',
    color: '#62a3d8',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    defaultVisible: true
  },
  googlestudio: {
    name: 'GAS',
    icon: 'GAS',
    shortIcon: 'GAS',
    color: '#5f6368',
    url: 'https://aistudio.google.com/',
    defaultVisible: true
  },
  tongyi: {
    name: '通义',
    icon: '通',
    shortIcon: 'TO',
    color: '#ff6600',
    url: 'https://www.qianwen.com',
    defaultVisible: true
  },
  grok: {
    name: 'Grok',
    icon: 'GR',
    shortIcon: 'GR',
    color: '#000000',
    url: 'https://grok.com',
    defaultVisible: true
  },
  notionai: {
    name: 'NotionAI',
    icon: 'N',
    shortIcon: 'N',
    color: '#000000',
    url: 'https://www.notion.so/chat',
    defaultVisible: true
  },
  zai: {
    name: 'Zai',
    icon: 'Z',
    shortIcon: 'Z',
    color: '#8b5cf6',
    url: 'https://chat.z.ai/',
    defaultVisible: true
  },
  deepseek: {
    name: 'DeepSeek',
    icon: 'DS',
    shortIcon: 'DS',
    color: '#0066cc',
    url: 'https://chat.deepseek.com/',
    defaultVisible: true
  },
  kimi: {
    name: 'Kimi',
    icon: 'K',
    shortIcon: 'K',
    color: '#6c5ce7',
    url: 'https://www.kimi.com/',
    defaultVisible: true
  },
  coderqwen: {
    name: 'CoderQwen',
    icon: 'CQ',
    shortIcon: 'CQ',
    color: '#00b4d8',
    url: 'https://coder.qwen.ai/',
    defaultVisible: true
  },
  coze: {
    name: 'Coze',
    icon: 'CZ',
    shortIcon: 'CZ',
    color: '#ff6b6b',
    url: 'https://www.coze.cn/',
    defaultVisible: true
  },
  xiaomi: {
    name: '小米',
    icon: '米',
    shortIcon: '米',
    color: '#ff6700',
    url: 'https://aistudio.xiaomimimo.com/#/c',
    defaultVisible: true
  }
};

/**
 * 获取平台 URL 映射（用于 ai_platform_processor.js）
 */
export function getPlatformUrls() {
  const urls = {};
  Object.entries(PLATFORM_CONFIG).forEach(([platformId, config]) => {
    urls[platformId] = config.url;
  });
  return urls;
}

/**
 * 获取平台 ID 列表
 */
export function getPlatformIds() {
  return Object.keys(PLATFORM_CONFIG);
}

/**
 * 获取平台配置
 */
export function getPlatformConfig(platformId) {
  return PLATFORM_CONFIG[platformId];
}
