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
    defaultVisible: true,
    hasNav: true
  },
  gemini: {
    name: 'Gemini',
    icon: 'G',
    shortIcon: 'G',
    color: '#4285f4',
    url: 'https://gemini.google.com/app',
    defaultVisible: true,
    hasNav: true
  },
  chatgpt: {
    name: 'ChatGPT',
    icon: 'C',
    shortIcon: 'C',
    color: '#10a37f',
    url: 'https://chatgpt.com',
    defaultVisible: true,
    hasNav: true
  },
  claude: {
    name: 'Claude',
    icon: 'A',
    shortIcon: 'A',
    color: '#cc785c',
    url: 'https://claude.ai',
    defaultVisible: true,
    hasNav: true
  },
  doubao: {
    name: '豆包',
    icon: '豆',
    shortIcon: '豆',
    color: '#ff6900',
    url: 'https://www.doubao.com/chat/',
    defaultVisible: true,
    hasNav: true
  },
  glm: {
    name: '智谱',
    icon: '智',
    shortIcon: 'ZH',
    color: '#62a3d8',
    url: 'https://chatglm.cn/main/alltoolsdetail',
    defaultVisible: true,
    hasNav: true
  },
  googlestudio: {
    name: 'GAS',
    icon: 'GAS',
    shortIcon: 'GAS',
    color: '#5f6368',
    url: 'https://aistudio.google.com/',
    defaultVisible: true,
    hasNav: true
  },
  tongyi: {
    name: '通义',
    icon: '通',
    shortIcon: 'TO',
    color: '#ff6600',
    url: 'https://www.qianwen.com',
    defaultVisible: true,
    hasNav: true
  },
  grok: {
    name: 'Grok',
    icon: 'GR',
    shortIcon: 'GR',
    color: '#000000',
    url: 'https://grok.com',
    defaultVisible: true,
    hasNav: true
  },
  notionai: {
    name: 'NotionAI',
    icon: 'N',
    shortIcon: 'N',
    color: '#000000',
    url: 'https://app.notion.com/chat',
    defaultVisible: true,
    hasNav: true
  },
  zai: {
    name: 'Zai',
    icon: 'Z',
    shortIcon: 'Z',
    color: '#8b5cf6',
    url: 'https://chat.z.ai/',
    defaultVisible: true,
    hasNav: true
  },
  deepseek: {
    name: 'DeepSeek',
    icon: 'DS',
    shortIcon: 'DS',
    color: '#0066cc',
    url: 'https://chat.deepseek.com/',
    defaultVisible: true,
    hasNav: true
  },
  kimi: {
    name: 'Kimi',
    icon: 'K',
    shortIcon: 'K',
    color: '#6c5ce7',
    url: 'https://www.kimi.com/',
    defaultVisible: true,
    hasNav: true
  },
  coderqwen: {
    name: 'CoderQwen',
    icon: 'CQ',
    shortIcon: 'CQ',
    color: '#00b4d8',
    url: 'https://coder.qwen.ai/',
    defaultVisible: true,
    hasNav: true
  },
  coze: {
    name: 'Coze',
    icon: 'CZ',
    shortIcon: 'CZ',
    color: '#ff6b6b',
    url: 'https://www.coze.cn/',
    defaultVisible: true,
    hasNav: true
  },
  xiaomi: {
    name: '小米',
    icon: '米',
    shortIcon: '米',
    color: '#ff6700',
    url: 'https://aistudio.xiaomimimo.com/#/c',
    defaultVisible: true,
    hasNav: true
  },
    copilot: {
        name: 'Copilot',
        icon: 'CO',
        shortIcon: 'CO',
        color: '#0078d4',
        url: 'https://copilot.microsoft.com/',
        defaultVisible: true,
        hasNav: true
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
 * URL → platformId 反查（entry.js 用）
 * - 严格匹配 origin
 * - pathname 必须等于配置路径，或位于该路径的子目录
 * - 忽略 query/hash（支持 hash-router 平台，例如 Xiaomi）
 * - 找不到或 URL 非法时返回 null
 */
export function getPlatformIdByUrl(url) {
  if (!url) return null;

  let currentUrl;
  try {
    currentUrl = new URL(url);
  } catch (error) {
    return null;
  }

  for (const [platformId, config] of Object.entries(PLATFORM_CONFIG)) {
    let platformUrl;
    try {
      platformUrl = new URL(config.url);
    } catch (error) {
      continue;
    }

    if (currentUrl.origin !== platformUrl.origin) continue;

    const basePath = platformUrl.pathname.replace(/\/$/, '') || '/';
    const currentPath = currentUrl.pathname.replace(/\/$/, '') || '/';
    if (
      basePath === '/' ||
      currentPath === basePath ||
      currentPath.startsWith(`${basePath}/`)
    ) {
      return platformId;
    }
  }
  return null;
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
