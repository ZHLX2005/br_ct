/**
 * @fileoverview 视频片段播放器（全功能DOM版）
 *
 * @scenario    需要在控制台运行一个可操作的视频片段播放器
 * @feature     扫描页面视频元素，提供片段播放/控制/调试的悬浮UI
 * @effect      注入视频片段播放器悬浮面板DOM，提供完整的视频操作UI
 * @category    视频处理
 * @platform    通用
 * @entry       自动执行
 */

// ==================== 控制台视频片段播放器（全功能DOM版） ====================
// 用法: 复制整个代码到控制台执行，然后使用界面操作

(function() {
  'use strict';
  
  // 防止重复注入
  if (window._videoSegmentPlayer) {
    console.log('视频片段播放器已存在，重新加载...');
    window._videoSegmentPlayer.cleanup();
  }
  
  // 视频片段播放器类
  class VideoSegmentPlayer {
    constructor() {
      this.videos = [];
      this.currentVideo = null;
      this.segments = [];
      this.currentSegment = 0;
      this.isPlaying = false;
      this.intervalId = null;
      this.eventListeners = [];
      this.uiElement = null;
      this.debugMode = false;
      this.uiInitialized = false;
      
      this.init();
    }
    
    // 初始化
    init() {
      console.log('🔍 正在扫描页面中的视频元素...');
      this.findVideos();
      this.createUI();
      this.bindGlobalEvents();

      // 向 background 请求预设配置
      this.requestStoredConfig();

      window._videoSegmentPlayer = this;
      console.log('✅ 视频片段播放器已加载成功!');
    }

    // 向 background 请求存储的配置
    requestStoredConfig() {
      const currentUrl = window.location.href;

      // 检查是否在扩展环境中运行
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            action: 'getVideoConfig',
            url: currentUrl
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.log('📡 无法连接到 background (可能是直接在页面运行)');
              return;
            }

            if (response && response.status === 'success' && response.yaml) {
              console.log('📥 找到预设配置:', response.matchedPrefix);
              console.log('📄 YAML 内容:', response.yaml);

              // 自动加载配置
              this.loadConfigFromYaml(response.yaml);
              this.showMessage(`已加载预设配置: ${response.matchedPrefix}`, 'success');
            } else {
              console.log('📭 未找到预设配置');
            }
          }
        );
      } else {
        console.log('📡 非扩展环境，跳过配置请求');
      }
    }

    // 从 YAML 字符串加载配置
    loadConfigFromYaml(yamlText) {
      try {
        console.log('📥 开始解析 YAML 配置');
        console.log('原始 YAML 内容:', yamlText);

        const yamlData = this.parseSimpleYAML(yamlText);
        console.log('解析后的 YAML 数据:', yamlData);

        this.segments = [];

        Object.entries(yamlData).forEach(([sectionName, items]) => {
          console.log(`处理分组 "${sectionName}":`, items);
          items.forEach((item, index) => {
            console.log(`  - 项 ${index}:`, item);
            const segment = this.parseTimeRange(item.timeRange);
            if (segment) {
              const label = item.label ? `${sectionName} - ${item.label}` : sectionName;
              segment.label = label;
              this.segments.push(segment);
              console.log(`    ✓ 成功解析片段:`, segment);
            } else {
              console.error(`    ✗ 解析失败: ${item.timeRange}`);
            }
          });
        });

        this.currentSegment = 0;
        this.renderUI();
        console.log(`✅ 已加载 ${this.segments.length} 个片段`);
        return true;
      } catch (err) {
        console.error('❌ YAML 解析失败:', err);
        console.error('错误堆栈:', err.stack);
        this.showMessage('配置加载失败', 'error');
        return false;
      }
    }

    // 保存当前配置到 background
    saveCurrentConfig() {
      const currentUrl = window.location.href;
      const urlPrefix = this.extractUrlPrefix(currentUrl);

      // 生成 YAML
      let yaml = `# 视频片段配置 - ${currentUrl}\n`;
      yaml += `# 当前片段: ${this.currentSegment}\n`;
      yaml += `# 自动播放: ${this.uiElement?.querySelector('#autoPlayNext')?.checked ? true : false}\n`;
      yaml += `# 调试模式: ${this.uiElement?.querySelector('#debugMode')?.checked ? true : false}\n\n`;

      if (this.segments.length > 0) {
        const groups = {};

        this.segments.forEach((segment) => {
          let groupName = '默认分组';

          if (segment.label) {
            const parts = segment.label.split(' - ');
            if (parts.length > 1) {
              groupName = parts[0];
            }
          }

          if (!groups[groupName]) {
            groups[groupName] = [];
          }

          const timeRange = `${this.formatTime(segment.start)}-${this.formatTime(segment.end)}`;
          const itemLabel = segment.label.includes(' - ') ?
            segment.label.split(' - ').slice(1).join(' - ') :
            (segment.label || '');

          groups[groupName].push({
            timeRange,
            label: itemLabel
          });
        });

        Object.entries(groups).forEach(([groupName, items]) => {
          yaml += `${groupName}:\n`;
          items.forEach(item => {
            if (item.label) {
              yaml += `  - ${item.timeRange} ${item.label}\n`;
            } else {
              yaml += `  - ${item.timeRange}\n`;
            }
          });
          yaml += '\n';
        });
      } else {
        yaml += "默认分组:\n  # 暂无片段\n";
      }

      // 发送到 background 保存
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            action: 'setVideoConfig',
            urlPrefix: urlPrefix,
            yaml: yaml
          },
          (response) => {
            if (chrome.runtime.lastError) {
              this.showMessage('保存失败: 无法连接到 background', 'error');
              return;
            }

            if (response && response.status === 'success') {
              this.showMessage(`配置已保存: ${urlPrefix}`, 'success');
            } else {
              this.showMessage(response?.message || '保存失败', 'error');
            }
          }
        );
      } else {
        // 非扩展环境，只复制到剪贴板
        this.copyToClipboard(yaml);
        this.showMessage('非扩展环境，内容已复制到剪贴板', 'info');
      }
    }

    // 提取 URL 前缀
    extractUrlPrefix(url) {
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length > 0) {
          return `${urlObj.protocol}//${urlObj.hostname}/${pathParts[0]}`;
        }
        return `${urlObj.protocol}//${urlObj.hostname}`;
      } catch (e) {
        console.error('URL 解析失败:', e);
        return url;
      }
    }

    // 查找页面中的所有视频
    findVideos() {
      this.videos = Array.from(document.querySelectorAll('video'));

      if (this.videos.length > 0) {
        // 如果当前视频不在新的视频列表中，或者没有当前视频，则选择第一个
        if (!this.currentVideo || !this.videos.includes(this.currentVideo)) {
          this.currentVideo = this.videos[0];
          this.setupTimeUpdateListener();
        }
        this.updateUI();
      } else {
        console.log('❌ 未找到视频元素');
      }
    }
    
    // 获取视频源
    getVideoSource(video) {
      if (video.src) {
        return video.src.substring(0, 100) + (video.src.length > 100 ? '...' : '');
      } else if (video.querySelector('source')) {
        return '多个<source>标签';
      } else if (video.currentSrc) {
        return video.currentSrc.substring(0, 100) + (video.currentSrc.length > 100 ? '...' : '');
      }
      return '未知';
    }
    
    // 创建控制台UI
    createUI() {
      // 移除旧的UI
      if (this.uiElement) {
        this.uiElement.remove();
      }
      
      // 创建浮动控制面板
      this.uiElement = document.createElement('div');
      this.uiElement.id = 'videoSegmentPlayerUI';
      this.uiElement.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.95);
        color: white;
        padding: 15px;
        border-radius: 8px;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 12px;
        z-index: 999999;
        width: 400px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        border: 2px solid #4CAF50;
        resize: both;
        overflow: auto;
        min-width: 350px;
        min-height: 200px;
      `;
      
      this.renderUI();
      document.body.appendChild(this.uiElement);
      this.uiInitialized = true;
    }
    
    // 渲染UI
    renderUI() {
      if (!this.uiElement) return;
      
      const videoOptions = this.videos.map((video, i) => 
        `<option value="${i}" ${video === this.currentVideo ? 'selected' : ''}>
          视频${i}: ${this.getVideoSource(video).split('/').pop().substring(0, 30) || '未知'}
        </option>`
      ).join('');
      
      const segmentsList = this.segments.map((seg, i) =>
        `<div class="segment-item ${i === this.currentSegment ? 'active' : ''}" data-index="${i}">
          <div class="segment-info">
            <span class="segment-index">${i+1}.</span>
            <input type="text" class="segment-start" value="${this.formatTime(seg.start)}"
                   placeholder="开始时间" data-index="${i}">
            <span> - </span>
            <input type="text" class="segment-end" value="${this.formatTime(seg.end)}"
                   placeholder="结束时间" data-index="${i}">
            <input type="text" class="segment-label" value="${seg.label || ''}"
                   placeholder="标签(可选)" data-index="${i}">
          </div>
          <div class="segment-actions">
            <button class="btn btn-play-segment" data-index="${i}" title="播放此片段">▶</button>
            <button class="btn btn-remove-segment" data-index="${i}" title="删除">×</button>
          </div>
        </div>`
      ).join('');
      
      this.uiElement.innerHTML = `
        <div class="header">
          <div style="display: flex; align-items: center; gap: 10px;">
            <strong style="color: #4CAF50; font-size: 14px;">🎬 视频片段播放器</strong>
            <button class="btn btn-small" id="minimizeBtn" title="缩小">📐</button>
          </div>
          <button class="btn btn-close" id="closeUI" title="关闭面板">×</button>
        </div>

        <div class="main-content" id="mainContent">
          <div class="section">
            <div class="section-title">📹 视频选择</div>
            <select id="videoSelect" class="select-input" style="width: 100%; padding: 5px; margin-bottom: 10px;">
              ${videoOptions}
            </select>
            <div style="font-size: 11px; color: #bbb; margin-bottom: 10px;">
              ${this.currentVideo ?
                `时长: ${this.currentVideo.duration ? this.currentVideo.duration.toFixed(1) + 's' : '加载中...'} |
                尺寸: ${this.currentVideo.videoWidth || 0}x${this.currentVideo.videoHeight || 0}` :
                '无视频'}
            </div>
            ${this.currentVideo ? `
              <div style="font-size: 12px; color: #4CAF50; margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
                <span>当前时间: <strong id="currentTimeDisplay">${this.formatTime(this.currentVideo.currentTime || 0)}</strong></span>
                <button class="btn btn-small" id="copyTimeBtn" title="复制当前时间">📋 复制</button>
              </div>
            ` : ''}
          </div>

          <div class="section">
            <div class="section-title" style="display: flex; justify-content: space-between; align-items: center;">
              <span>📊 片段列表 (${this.segments.length})</span>
              <div>
                <button class="btn btn-small" id="quickAddBtn">快速添加</button>
                <button class="btn btn-small" id="clearSegmentsBtn">清空</button>
              </div>
            </div>
            <div id="segmentsList" class="segments-list" style="max-height: 200px; overflow-y: auto; margin: 10px 0;">
              ${segmentsList || '<div style="text-align: center; padding: 20px; color: #888;">暂无片段</div>'}
            </div>
          </div>

          <div class="section">
            <div class="section-title">🎮 播放控制</div>
            <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px;">
              <button class="btn btn-success" id="autoFitBtn" style="flex: 1;">📍 自动适配</button>
            </div>
            <div style="display: flex; gap: 5px;">
              <button class="btn" id="prevSegmentBtn" style="flex: 1;">⬅️ 上一段</button>
              <button class="btn" id="nextSegmentBtn" style="flex: 1;">➡️ 下一段</button>
            </div>
            <div style="font-size: 10px; color: #888; margin-top: 5px; text-align: center;">
              当前片段: <span id="currentSegmentLabel">${this.currentSegment + 1}/${this.segments.length || 0}</span>
            </div>
          </div>

          <div class="section">
            <div class="section-title">⚙️ 设置</div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
              <label style="display: flex; align-items: center; gap: 5px; font-size: 11px;">
                <input type="checkbox" id="autoPlayNext" checked> 自动播放下一个
              </label>
              <label style="display: flex; align-items: center; gap: 5px; font-size: 11px;">
                <input type="checkbox" id="debugMode"> 调试模式
              </label>
              <button class="btn btn-small" id="exportBtn">导出YAML</button>
              <button class="btn btn-small" id="importBtn">导入YAML</button>
            </div>
            <div style="display: flex; gap: 5px; margin-top: 5px;">
              <button class="btn btn-small" id="saveToPluginBtn" style="flex: 1; background: #4CAF50;">💾 保存到插件</button>
            </div>
          </div>

          <div class="section">
            <div class="section-title">🔧 批量操作</div>
            <textarea id="batchInput" placeholder="YAML格式 (支持分组):
Part 1:
  - 01:16-01:21 打开
  - 08:37-08:42 没语季节

或简单格式 (每行一个):
01:16-01:21 打开
08:37-08:42 没语季节"
                      style="width: 100%; height: 80px; padding: 8px; font-family: monospace; font-size: 11px; background: rgba(255,255,255,0.1); color: white; border: 1px solid #444; border-radius: 4px; resize: vertical; margin-bottom: 8px;"></textarea>
            <div style="display: flex; gap: 5px;">
              <button class="btn" id="batchAddBtn" style="flex: 1;">批量添加</button>
              <button class="btn" id="replaceAllBtn" style="flex: 1;">全部替换</button>
              <button class="btn" id="clearBatchBtn" style="flex: 1;">清空</button>
            </div>
          </div>

          <div class="section">
            <div class="section-title">⏱️ 添加片段</div>
            <div style="display: flex; gap: 5px; margin-bottom: 10px;">
              <input type="text" id="segmentStart" class="time-input" placeholder="00:00"
                     style="flex: 1; padding: 5px;">
              <input type="text" id="segmentEnd" class="time-input" placeholder="00:05"
                     style="flex: 1; padding: 5px;">
              <input type="text" id="segmentLabel" class="label-input" placeholder="标签(可选)"
                     style="flex: 1.5; padding: 5px;">
              <button class="btn btn-primary" id="addSegmentBtn">添加</button>
            </div>
            <div style="font-size: 11px; color: #bbb; margin-bottom: 10px;">
              格式: 00:01-00:05 或 00:01:10-00:01:20
            </div>
          </div>
        </div>

        <div class="minimized-content" id="minimizedContent" style="display: none;">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 5px 10px;">
            <span style="font-size: 11px; color: #4CAF50;">${this.segments.length} 片段</span>
            <div style="display: flex; gap: 5px;">
              <button class="btn btn-small" id="playAllMiniBtn" style="padding: 2px 6px;">▶</button>
              <button class="btn btn-small" id="stopMiniBtn" style="padding: 2px 6px;">⏸</button>
            </div>
          </div>
        </div>

        <div class="status-bar">
          当前片段: ${this.currentSegment + 1}/${this.segments.length} | 状态: ${this.isPlaying ? '播放中' : '已停止'}
        </div>

        <style>
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            border-bottom: 1px solid #444;
            padding-bottom: 8px;
          }

          .section {
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }

          .section:last-child {
            border-bottom: none;
          }

          .section-title {
            font-weight: bold;
            margin-bottom: 6px;
            color: #4CAF50;
            font-size: 11px;
          }

          .btn {
            padding: 4px 10px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
            transition: all 0.2s;
            background: rgba(255,255,255,0.1);
            color: white !important;
          }

          .btn:hover {
            background: rgba(255,255,255,0.2);
            transform: translateY(-1px);
          }

          .btn:active {
            transform: translateY(0);
          }

          .btn-primary {
            background: #4CAF50;
            color: white;
          }

          .btn-success {
            background: #2196F3;
            color: white;
          }

          .btn-info {
            background: #00bcd4;
            color: white;
          }

          .btn-warning {
            background: #ff9800;
            color: white;
          }

          .btn-small {
            padding: 2px 6px;
            font-size: 10px;
          }

          .btn-close {
            background: #f44336;
            color: white;
            padding: 2px 6px;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
          }

          .segment-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px;
            margin: 2px 0;
            background: rgba(255,255,255,0.05);
            border-radius: 3px;
            border-left: 3px solid #666;
            color: white !important;
          }

          .segment-item.active {
            border-left-color: #4CAF50;
            background: rgba(76, 175, 80, 0.1);
          }

          .segment-item.active .segment-index {
            color: #4CAF50 !important;
          }

          .segment-item.active .segment-start,
          .segment-item.active .segment-end,
          .segment-item.active .segment-label {
            color: white !important;
            background: rgba(255,255,255,0.15) !important;
          }

          .segment-item:hover {
            background: rgba(255,255,255,0.1);
          }

          .segment-info {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: 1;
          }

          .segment-index {
            min-width: 16px;
            text-align: center;
            font-weight: bold;
            color: #aaa !important;
            font-size: 10px;
          }

          .time-input, .label-input {
            background: rgba(255,255,255,0.1) !important;
            border: 1px solid #444;
            border-radius: 2px;
            color: white !important;
            padding: 3px 5px;
            font-family: monospace;
            font-size: 10px;
          }

          .segment-start,
          .segment-end,
          .segment-label {
            background: rgba(255,255,255,0.1) !important;
            border: 1px solid #444;
            border-radius: 2px;
            color: white !important;
            padding: 3px 5px;
            font-family: monospace;
            font-size: 10px;
          }

          .time-input {
            width: 55px;
          }

          .label-input {
            width: 75px;
          }

          .segment-actions {
            display: flex;
            gap: 2px;
          }

          .segments-list::-webkit-scrollbar {
            width: 4px;
          }

          .segments-list::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.1);
            border-radius: 2px;
          }

          .segments-list::-webkit-scrollbar-thumb {
            background: #4CAF50;
            border-radius: 2px;
          }

          .select-input {
            background: rgba(255,255,255,0.1);
            border: 1px solid #444;
            border-radius: 3px;
            color: white;
            padding: 5px;
            font-size: 11px;
          }

          .select-input option {
            background: #222;
            color: white;
          }

          .status-bar {
            margin-top: 10px;
            padding-top: 6px;
            border-top: 1px solid #444;
            font-size: 9px;
            color: #aaa;
            text-align: center;
          }

          /* 最小化状态 */
          .minimized-ui {
            width: auto !important;
            height: auto !important;
            min-width: 120px !important;
            min-height: 30px !important;
          }

          .minimized-ui .main-content {
            display: none;
          }

          .minimized-ui .minimized-content {
            display: block !important;
          }

          .minimized-ui .status-bar {
            display: none;
          }
        </style>
      `;
      
      this.bindUIEvents();
    }
    
    // 绑定UI事件
    bindUIEvents() {
      if (!this.uiElement) return;
      
      // 视频选择
      const videoSelect = this.uiElement.querySelector('#videoSelect');
      if (videoSelect) {
        videoSelect.addEventListener('change', (e) => {
          const index = parseInt(e.target.value);
          this.setVideo(index);
        });
      }
      
      // 添加片段按钮
      const addSegmentBtn = this.uiElement.querySelector('#addSegmentBtn');
      if (addSegmentBtn) {
        addSegmentBtn.addEventListener('click', () => {
          this.addSegmentFromInputs();
        });
      }
      
      // 快速添加按钮
      const quickAddBtn = this.uiElement.querySelector('#quickAddBtn');
      if (quickAddBtn) {
        quickAddBtn.addEventListener('click', () => {
          this.showQuickAddMenu();
        });
      }
      
      // 清空片段按钮
      const clearSegmentsBtn = this.uiElement.querySelector('#clearSegmentsBtn');
      if (clearSegmentsBtn) {
        clearSegmentsBtn.addEventListener('click', () => {
          this.clearSegments();
        });
      }

      // 自动适配按钮
      const autoFitBtn = this.uiElement.querySelector('#autoFitBtn');
      if (autoFitBtn) {
        autoFitBtn.addEventListener('click', () => {
          this.autoFitToCurrentTime();
        });
      }

      // 上一段按钮
      const prevSegmentBtn = this.uiElement.querySelector('#prevSegmentBtn');
      if (prevSegmentBtn) {
        prevSegmentBtn.addEventListener('click', () => {
          this.activatePreviousSegment();
        });
      }

      // 下一段按钮
      const nextSegmentBtn = this.uiElement.querySelector('#nextSegmentBtn');
      if (nextSegmentBtn) {
        nextSegmentBtn.addEventListener('click', () => {
          this.activateNextSegment();
        });
      }

      // 批量操作按钮
      const batchAddBtn = this.uiElement.querySelector('#batchAddBtn');
      if (batchAddBtn) {
        batchAddBtn.addEventListener('click', () => {
          this.addSegmentsFromBatch();
        });
      }
      
      const replaceAllBtn = this.uiElement.querySelector('#replaceAllBtn');
      if (replaceAllBtn) {
        replaceAllBtn.addEventListener('click', () => {
          this.replaceSegmentsFromBatch();
        });
      }
      
      const clearBatchBtn = this.uiElement.querySelector('#clearBatchBtn');
      if (clearBatchBtn) {
        clearBatchBtn.addEventListener('click', () => {
          const batchInput = this.uiElement.querySelector('#batchInput');
          if (batchInput) batchInput.value = '';
        });
      }
      
      // 导入/导出按钮
      const exportBtn = this.uiElement.querySelector('#exportBtn');
      if (exportBtn) {
        // 移除可能存在的旧监听器避免重复绑定
        exportBtn.replaceWith(exportBtn.cloneNode(true));
        const newExportBtn = this.uiElement.querySelector('#exportBtn');
        newExportBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('导出按钮被点击');
          this.exportConfig();
        });
        console.log('导出按钮事件已绑定');
      } else {
        console.warn('未找到导出按钮 #exportBtn');
      }
      
      const importBtn = this.uiElement.querySelector('#importBtn');
      if (importBtn) {
        importBtn.addEventListener('click', () => {
          this.importConfig();
        });
      }

      // 保存到插件按钮
      const saveToPluginBtn = this.uiElement.querySelector('#saveToPluginBtn');
      if (saveToPluginBtn) {
        saveToPluginBtn.addEventListener('click', () => {
          this.saveCurrentConfig();
        });
      }

      // 关闭按钮
      const closeBtn = this.uiElement.querySelector('#closeUI');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.removeUI();
        });
      }
      
      // 自动播放下一个复选框
      const autoPlayNext = this.uiElement.querySelector('#autoPlayNext');
      if (autoPlayNext) {
        autoPlayNext.addEventListener('change', (e) => {
          this.autoPlayNext = e.target.checked;
        });
      }
      
      // 调试模式复选框
      const debugMode = this.uiElement.querySelector('#debugMode');
      if (debugMode) {
        debugMode.addEventListener('change', (e) => {
          this.debugMode = e.target.checked;
        });
      }
      
      // 输入框回车键支持
      const segmentStart = this.uiElement.querySelector('#segmentStart');
      const segmentEnd = this.uiElement.querySelector('#segmentEnd');
      
      const handleEnterKey = (e) => {
        if (e.key === 'Enter') {
          this.addSegmentFromInputs();
        }
      };
      
      if (segmentStart) segmentStart.addEventListener('keypress', handleEnterKey);
      if (segmentEnd) segmentEnd.addEventListener('keypress', handleEnterKey);
      
      // 绑定片段列表事件
      this.bindSegmentListEvents();

      // 绑定复制时间按钮
      const copyTimeBtn = this.uiElement.querySelector('#copyTimeBtn');
      if (copyTimeBtn) {
        copyTimeBtn.addEventListener('click', () => {
          this.copyCurrentTime();
        });
      }

      // 绑定最小化按钮
      const minimizeBtn = this.uiElement.querySelector('#minimizeBtn');
      if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
          this.toggleMinimize();
        });
      }

      // 绑定最小化状态下的按钮
      const playAllMiniBtn = this.uiElement.querySelector('#playAllMiniBtn');
      if (playAllMiniBtn) {
        playAllMiniBtn.addEventListener('click', () => {
          this.playSegments();
        });
      }

      const stopMiniBtn = this.uiElement.querySelector('#stopMiniBtn');
      if (stopMiniBtn) {
        stopMiniBtn.addEventListener('click', () => {
          this.stop();
        });
      }
    }
    
    // 绑定片段列表事件
    bindSegmentListEvents() {
      if (!this.uiElement) return;
      
      // 播放片段按钮
      this.uiElement.querySelectorAll('.btn-play-segment').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = parseInt(e.target.dataset.index);
          this.playSingleSegment(index);
        });
      });
      
      // 删除片段按钮
      this.uiElement.querySelectorAll('.btn-remove-segment').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const index = parseInt(e.target.dataset.index);
          this.removeSegment(index);
        });
      });
      
      // 片段输入框变化
      this.uiElement.querySelectorAll('.segment-start, .segment-end, .segment-label').forEach(input => {
        input.addEventListener('change', (e) => {
          const index = parseInt(e.target.dataset.index);
          this.updateSegmentFromInput(index, e.target.className, e.target.value);
        });
        
        input.addEventListener('blur', (e) => {
          const index = parseInt(e.target.dataset.index);
          this.updateSegmentFromInput(index, e.target.className, e.target.value);
        });
      });
    }
    
    // 从输入框添加片段
    addSegmentFromInputs() {
      if (!this.uiElement) return;
      
      const startInput = this.uiElement.querySelector('#segmentStart');
      const endInput = this.uiElement.querySelector('#segmentEnd');
      const labelInput = this.uiElement.querySelector('#segmentLabel');
      
      if (!startInput || !endInput) return;
      
      const start = startInput.value.trim();
      const end = endInput.value.trim();
      const label = labelInput ? labelInput.value.trim() : '';
      
      if (!start || !end) {
        this.showMessage('请输入开始和结束时间', 'error');
        return;
      }
      
      const segment = this.parseTimeRange(`${start}-${end}`);
      if (!segment) {
        this.showMessage('时间格式错误，请使用 00:01-00:05 格式', 'error');
        return;
      }
      
      if (label) {
        segment.label = label;
      }
      
      this.segments.push(segment);
      this.renderUI();
      this.showMessage(`已添加片段: ${start}-${end} ${label ? '(' + label + ')' : ''}`, 'success');
      
      // 清空输入框
      startInput.value = '';
      endInput.value = '';
      if (labelInput) labelInput.value = '';
      startInput.focus();
    }
    
    // 从批量输入添加片段
    addSegmentsFromBatch() {
      if (!this.uiElement) return;

      const batchInput = this.uiElement.querySelector('#batchInput');
      if (!batchInput) return;

      const text = batchInput.value.trim();
      if (!text) {
        this.showMessage('请输入时间片段', 'error');
        return;
      }

      let added = 0;
      let errors = [];

      // 检查是否是YAML格式（包含冒号和短横线的缩进结构）
      const isYAML = text.includes(':') && text.includes('-');

      if (isYAML) {
        // 解析YAML格式
        try {
          const yamlData = this.parseSimpleYAML(text);

          Object.entries(yamlData).forEach(([sectionName, items]) => {
            items.forEach((item, index) => {
              const segment = this.parseTimeRange(item.timeRange);
              if (segment) {
                const label = item.label ? `${sectionName} - ${item.label}` : sectionName;
                segment.label = label;
                this.segments.push(segment);
                added++;
              } else {
                errors.push(`${sectionName} - ${item.timeRange}: 时间格式错误`);
              }
            });
          });

          this.showMessage(`YAML格式解析成功，已添加 ${added} 个片段`, 'success');
        } catch (err) {
          console.error('YAML解析错误:', err);
          this.showMessage('YAML格式解析失败', 'error');
        }
      } else {
        // 解析简单文本格式：每行一个 01:16-01:21 标签
        const lines = text.split('\n');

        lines.forEach((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          const timeRangeMatch = trimmed.match(/(\d{1,2}:\d{2}(?::\d{2})?-\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)?/);
          if (timeRangeMatch) {
            const timeRange = timeRangeMatch[1];
            const label = timeRangeMatch[2] ? timeRangeMatch[2].trim() : '';

            const segment = this.parseTimeRange(timeRange);
            if (segment) {
              if (label) segment.label = label;
              this.segments.push(segment);
              added++;
            } else {
              errors.push(`第${i+1}行时间格式错误: ${line}`);
            }
          } else {
            errors.push(`第${i+1}行格式错误: ${line}`);
          }
        });

        this.showMessage(`简单格式解析成功，已添加 ${added} 个片段`, 'success');
      }

      this.renderUI();

      if (errors.length > 0) {
        console.error('解析错误:', errors);
        this.showMessage(`${errors.length} 个格式错误，已跳过无效行`, 'warning');
      }
    }
    
    // 从批量输入替换所有片段
    replaceSegmentsFromBatch() {
      if (!this.uiElement) return;
      
      const batchInput = this.uiElement.querySelector('#batchInput');
      if (!batchInput) return;
      
      const text = batchInput.value.trim();
      if (!text) {
        this.showMessage('请输入时间片段', 'error');
        return;
      }
      
      this.segments = [];
      this.addSegmentsFromBatch();
    }
    
    // 更新片段
    updateSegmentFromInput(index, className, value) {
      if (index < 0 || index >= this.segments.length) return;
      
      if (className.includes('segment-start')) {
        const start = this.parseTimeStr(value);
        if (!isNaN(start)) {
          this.segments[index].start = start;
        }
      } else if (className.includes('segment-end')) {
        const end = this.parseTimeStr(value);
        if (!isNaN(end)) {
          this.segments[index].end = end;
        }
      } else if (className.includes('segment-label')) {
        this.segments[index].label = value;
      }
      
      this.updateUI();
    }
    
    // 删除片段
    removeSegment(index) {
      if (index >= 0 && index < this.segments.length) {
        this.segments.splice(index, 1);
        if (this.currentSegment >= this.segments.length) {
          this.currentSegment = Math.max(0, this.segments.length - 1);
        }
        this.renderUI();
        this.showMessage('片段已删除', 'info');
      }
    }
    
    // 显示快速添加菜单
    showQuickAddMenu() {
      if (!this.currentVideo || !this.currentVideo.duration) {
        this.showMessage('视频未加载完成', 'error');
        return;
      }
      
      const duration = this.currentVideo.duration;
      const menu = document.createElement('div');
      menu.style.cssText = `
        position: absolute;
        background: rgba(0,0,0,0.95);
        border: 1px solid #4CAF50;
        border-radius: 4px;
        padding: 10px;
        z-index: 1000000;
        min-width: 200px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      `;
      
      menu.innerHTML = `
        <div style="margin-bottom: 8px; color: #4CAF50; font-weight: bold;">快速添加</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 10px;">
          <button class="btn btn-small quick-add-btn" data-interval="5">每5秒</button>
          <button class="btn btn-small quick-add-btn" data-interval="10">每10秒</button>
          <button class="btn btn-small quick-add-btn" data-interval="30">每30秒</button>
          <button class="btn btn-small quick-add-btn" data-interval="60">每60秒</button>
        </div>
        <div style="display: flex; gap: 5px;">
          <input type="number" id="quickInterval" placeholder="间隔(秒)" 
                 style="flex: 1; padding: 5px; background: rgba(255,255,255,0.1); color: white; border: 1px solid #444; border-radius: 3px;">
          <button class="btn btn-small" id="quickAddCustomBtn">自定义</button>
        </div>
        <div style="font-size: 10px; color: #aaa; margin-top: 8px;">
          视频时长: ${duration.toFixed(1)}秒
        </div>
      `;
      
      const quickAddBtn = this.uiElement.querySelector('#quickAddBtn');
      const rect = quickAddBtn.getBoundingClientRect();
      menu.style.left = (rect.left - 200) + 'px';
      menu.style.top = (rect.top - 150) + 'px';
      
      menu.querySelectorAll('.quick-add-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const interval = parseInt(e.target.dataset.interval);
          this.addSegmentsByInterval(interval);
          menu.remove();
        });
      });
      
      menu.querySelector('#quickAddCustomBtn').addEventListener('click', () => {
        const input = menu.querySelector('#quickInterval');
        const interval = parseInt(input.value);
        if (interval > 0) {
          this.addSegmentsByInterval(interval);
          menu.remove();
        }
      });
      
      // 点击外部关闭
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target) && e.target !== quickAddBtn) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
      
      document.body.appendChild(menu);
    }
    
    // 按间隔添加片段
    addSegmentsByInterval(interval) {
      if (!this.currentVideo || !this.currentVideo.duration) return;
      
      const duration = this.currentVideo.duration;
      const segmentLength = 5; // 每个片段5秒
      
      this.segments = [];
      for (let time = 0; time < duration - segmentLength; time += interval) {
        const start = time;
        const end = Math.min(time + segmentLength, duration);
        this.segments.push({
          start,
          end,
          label: `片段${Math.floor(time/interval)+1}`
        });
      }
      
      this.renderUI();
      this.showMessage(`已添加 ${this.segments.length} 个片段，间隔${interval}秒`, 'success');
    }
    
    // 显示消息
    showMessage(message, type = 'info') {
      const colors = {
        success: '#4CAF50',
        error: '#f44336',
        info: '#2196F3',
        warning: '#ff9800'
      };
      
      const messageEl = document.createElement('div');
      messageEl.textContent = message;
      messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 10px 15px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 999999;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      `;
      
      document.body.appendChild(messageEl);
      
      setTimeout(() => {
        messageEl.style.animation = 'slideOut 0.3s ease-out forwards';
        setTimeout(() => messageEl.remove(), 300);
      }, 3000);
      
      // 添加动画样式
      if (!document.querySelector('#message-animations')) {
        const style = document.createElement('style');
        style.id = 'message-animations';
        style.textContent = `
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
          }
        `;
        document.head.appendChild(style);
      }
    }
    
    // 切换最小化状态
    toggleMinimize() {
      if (!this.uiElement) return;

      const mainContent = this.uiElement.querySelector('#mainContent');
      const minimizedContent = this.uiElement.querySelector('#minimizedContent');
      const minimizeBtn = this.uiElement.querySelector('#minimizeBtn');

      if (this.uiElement.classList.contains('minimized-ui')) {
        // 展开UI
        this.uiElement.classList.remove('minimized-ui');
        mainContent.style.display = 'block';
        minimizedContent.style.display = 'none';
        minimizeBtn.textContent = '📐';
        minimizeBtn.title = '缩小';
      } else {
        // 最小化UI
        this.uiElement.classList.add('minimized-ui');
        mainContent.style.display = 'none';
        minimizedContent.style.display = 'block';
        minimizeBtn.textContent = '📖';
        minimizeBtn.title = '展开';
      }
    }

    // 更新UI
    updateUI() {
      this.renderUI();
    }

    // 更新时间显示
    updateTimeDisplay() {
      if (!this.uiElement || !this.currentVideo) return;

      const timeDisplay = this.uiElement.querySelector('#currentTimeDisplay');
      if (timeDisplay) {
        timeDisplay.textContent = this.formatTime(this.currentVideo.currentTime || 0);
      }
    }

    // 复制当前时间
    copyCurrentTime() {
      if (!this.currentVideo) {
        this.showMessage('没有可用的视频元素', 'error');
        return;
      }

      const currentTime = this.formatTime(this.currentVideo.currentTime || 0);
      navigator.clipboard.writeText(currentTime).then(() => {
        this.showMessage(`已复制时间: ${currentTime}`, 'success');
      }).catch(() => {
        // 降级方案
        const textArea = document.createElement('textarea');
        textArea.value = currentTime;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        this.showMessage(`已复制时间: ${currentTime}`, 'success');
      });
    }
    
    // 移除UI
    removeUI() {
      if (this.uiElement) {
        this.uiElement.remove();
        this.uiElement = null;
        this.uiInitialized = false;
        console.log('🔴 播放器UI已关闭，可在控制台使用 window._videoSegmentPlayer 访问');
      }
    }
    
    // 简单的YAML解析器
    parseSimpleYAML(yamlText) {
      console.log('📄 parseSimpleYAML 开始解析');
      const lines = yamlText.split('\n');
      const result = {};
      let currentSection = null;
      let currentList = [];

      lines.forEach((line, lineIndex) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        // 检查是否是节标题（不以空格开头，以冒号结尾）
        if (!line.startsWith(' ') && trimmed.endsWith(':')) {
          // 保存上一个节
          if (currentSection && currentList.length > 0) {
            result[currentSection] = currentList;
            console.log(`  保存分组 "${currentSection}":`, currentList);
          }
          currentSection = trimmed.slice(0, -1); // 移除冒号
          currentList = [];
          console.log(`  第${lineIndex}行: 新分组 "${currentSection}"`);
          return;
        }

        // 检查是否是列表项（以空格和-开头）
        if (line.match(/^\s*-\s*/)) {
          const item = trimmed.replace(/^\s*-\s*/, '');
          console.log(`  第${lineIndex}行: 列表项 "${item}"`);

          // 解析时间范围和标签
          const timeRangeMatch = item.match(/(\d{1,2}:\d{2}(?::\d{2})?-\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)?/);
          if (timeRangeMatch) {
            const timeRange = timeRangeMatch[1];
            const label = timeRangeMatch[2] ? timeRangeMatch[2].trim() : '';
            console.log(`    ✓ 正则匹配成功: timeRange="${timeRange}", label="${label}"`);
            currentList.push({
              timeRange,
              label
            });
          } else {
            console.error(`    ✗ 正则匹配失败: "${item}"`);
          }
        }
      });

      // 保存最后一个节
      if (currentSection && currentList.length > 0) {
        result[currentSection] = currentList;
        console.log(`  保存最后一个分组 "${currentSection}":`, currentList);
      }

      console.log('📄 parseSimpleYAML 解析完成，结果:', result);
      return result;
    }

    // 绑定全局事件
    bindGlobalEvents() {
      // 监听页面变化，检测新视频
      const observer = new MutationObserver((mutations) => {
        const newVideos = document.querySelectorAll('video');
        if (newVideos.length > this.videos.length) {
          this.findVideos();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      this.eventListeners.push({ type: 'observer', value: observer });

      // 添加全局点击处理作为导出按钮的备选方案
      const globalClickHandler = (e) => {
        if (e.target && e.target.id === 'exportBtn') {
          e.preventDefault();
          e.stopPropagation();
          console.log('全局点击处理器捕获到导出按钮点击');
          this.exportConfig();
        }
      };

      document.addEventListener('click', globalClickHandler, true);
      this.eventListeners.push({
        type: 'documentClick',
        target: document,
        handler: globalClickHandler
      });

      // 添加视频时间更新监听器
      if (this.currentVideo) {
        this.setupTimeUpdateListener();
      }
    }

    // 设置时间更新监听器
    setupTimeUpdateListener() {
      if (!this.currentVideo) return;

      const handleTimeUpdate = () => {
        this.updateTimeDisplay();
      };

      this.currentVideo.addEventListener('timeupdate', handleTimeUpdate);

      // 保存监听器以便清理
      this.eventListeners.push({
        type: 'videoTimeUpdate',
        target: this.currentVideo,
        handler: handleTimeUpdate
      });
    }
    
    // 将时间字符串转换为秒
    parseTimeStr(timeStr) {
      if (!timeStr || typeof timeStr !== 'string') return NaN;
      
      // 支持格式: "00:01:30.5" 或 "01:30" 或 "90.5"
      const parts = timeStr.split(':').map(part => parseFloat(part));
      
      if (parts.length === 3) {
        // 时:分:秒
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else if (parts.length === 2) {
        // 分:秒
        return parts[0] * 60 + parts[1];
      } else if (parts.length === 1) {
        // 秒
        return parts[0];
      }
      
      return NaN;
    }
    
    // 将秒转换为时间字符串
    formatTime(seconds) {
      if (isNaN(seconds)) return "00:00";
      
      const hrs = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      
      if (hrs > 0) {
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      } else {
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }
    }
    
    // 解析时间段字符串
    parseTimeRange(rangeStr) {
      // 格式: "00:01-00:05" 或 "00:01:10-00:01:20"
      const match = rangeStr.match(/([\d:.]+)-([\d:.]+)/);
      if (!match) {
        console.error('❌ 时间格式错误，应为: "00:01-00:05"');
        return null;
      }
      
      const start = this.parseTimeStr(match[1]);
      const end = this.parseTimeStr(match[2]);
      
      if (isNaN(start) || isNaN(end)) {
        console.error('❌ 时间格式错误');
        return null;
      }
      
      if (start >= end) {
        console.error('❌ 开始时间必须小于结束时间');
        return null;
      }
      
      return { start, end };
    }
    
    // 添加播放片段
    addSegment(rangeStr, label = '') {
      const segment = this.parseTimeRange(rangeStr);
      if (!segment) return false;
      
      if (label) {
        segment.label = label;
      }
      
      this.segments.push(segment);
      this.updateUI();
      return true;
    }
    
    // 清除所有片段
    clearSegments() {
      this.segments = [];
      this.currentSegment = 0;
      this.stop();
      this.updateUI();
      this.showMessage('已清除所有片段', 'info');
    }

    // 根据时间查找对应的片段
    findSegmentForTime(time) {
      for (let i = 0; i < this.segments.length; i++) {
        const seg = this.segments[i];
        if (time >= seg.start && time <= seg.end) {
          return { index: i, segment: seg, within: true };
        }
      }

      // 如果不在任何片段内，找到最近的下一个片段
      for (let i = 0; i < this.segments.length; i++) {
        if (time < this.segments[i].start) {
          return { index: i, segment: this.segments[i], within: false };
        }
      }

      // 如果时间超过所有片段，返回 null
      return null;
    }

    // 播放片段（智能定位）
    playSegments(rangeStrings = null, smartStart = true) {
      if (!this.currentVideo) {
        this.showMessage('没有可用的视频元素', 'error');
        return;
      }

      // 如果提供了新的片段列表，替换当前片段
      if (rangeStrings && Array.isArray(rangeStrings)) {
        this.segments = [];
        let allValid = true;

        rangeStrings.forEach(rangeStr => {
          if (!this.addSegment(rangeStr)) {
            allValid = false;
          }
        });

        if (!allValid) {
          this.showMessage('部分片段格式错误，播放取消', 'error');
          return;
        }
      }

      if (this.segments.length === 0) {
        this.showMessage('没有设置播放片段', 'error');
        return;
      }

      // 智能定位：根据当前视频时间找到对应的片段
      if (smartStart && this.currentVideo.currentTime > 0) {
        const currentTime = this.currentVideo.currentTime;
        const result = this.findSegmentForTime(currentTime);

        if (result) {
          if (result.within) {
            // 当前时间在某个片段内，从当前时间继续播放
            this.currentSegment = result.index;
            this.playCurrentSegment(true); // true 表示从当前时间继续
            this.showMessage(`从当前进度继续: ${this.formatTime(currentTime)}`, 'info');
          } else {
            // 当前时间不在任何片段内，跳转到最近的下一个片段
            this.currentSegment = result.index;
            this.playCurrentSegment(false);
            this.showMessage(`跳转到下一个片段: ${this.formatTime(result.segment.start)}`, 'info');
          }
        } else {
          // 当前时间超过所有片段，从第一个片段开始
          this.currentSegment = 0;
          this.playCurrentSegment(false);
          this.showMessage('当前进度已超过所有片段，从头开始', 'info');
        }
      } else {
        // 不使用智能定位，从头开始
        this.currentSegment = 0;
        this.playCurrentSegment(false);
      }
    }
    
    // 播放单个片段
    playSingleSegment(index) {
      if (index < 0 || index >= this.segments.length) {
        this.showMessage('无效的片段索引', 'error');
        return;
      }

      this.currentSegment = index;
      this.playCurrentSegment(false);
    }

    // 播放当前片段
    // resumeFromCurrent: true 表示从当前视频时间继续播放，false 表示从头开始
    playCurrentSegment(resumeFromCurrent = false) {
      if (this.currentSegment >= this.segments.length) {
        this.showMessage('所有片段播放完毕', 'success');
        this.isPlaying = false;
        this.updateUI();
        return;
      }

      const segment = this.segments[this.currentSegment];

      if (!this.currentVideo) {
        this.showMessage('视频元素不存在', 'error');
        return;
      }

      // 确保视频已加载
      if (this.currentVideo.readyState < 2) {
        this.showMessage('视频加载中...', 'info');
        this.currentVideo.load();

        const onLoaded = () => {
          this.currentVideo.removeEventListener('loadeddata', onLoaded);
          this.startSegmentPlayback(segment, resumeFromCurrent);
        };

        this.currentVideo.addEventListener('loadeddata', onLoaded);
      } else {
        this.startSegmentPlayback(segment, resumeFromCurrent);
      }
    }

    // 开始播放片段
    // resumeFromCurrent: true 表示从当前时间继续，false 表示跳转到片段开始
    startSegmentPlayback(segment, resumeFromCurrent = false) {
      this.isPlaying = true;

      if (resumeFromCurrent) {
        // 从当前时间继续播放
        const currentTime = this.currentVideo.currentTime;
        this.showMessage(`继续播放片段 ${this.currentSegment + 1}/${this.segments.length}: ${this.formatTime(currentTime)}`, 'info');
      } else {
        // 跳转到片段开始
        this.currentVideo.currentTime = segment.start;
        this.showMessage(`播放片段 ${this.currentSegment + 1}/${this.segments.length}: ${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}`, 'info');
      }
      
      // 开始播放
      const playPromise = this.currentVideo.play();
      
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error('❌ 播放失败:', error);
          this.showMessage('播放失败: 需要用户交互', 'error');
        });
      }
      
      // 设置结束检查
      this.setupEndCheck(segment);
      this.updateUI();
    }

    // 设置结束检查
    setupEndCheck(segment) {
      // 清除之前的检查
      if (this.intervalId) {
        clearInterval(this.intervalId);
      }

      // 设置定时检查
      this.intervalId = setInterval(() => {
        if (!this.currentVideo || !this.isPlaying) {
          clearInterval(this.intervalId);
          return;
        }

        const currentTime = this.currentVideo.currentTime;

        if (this.debugMode) {
          console.log(`⏱️ 当前时间: ${this.formatTime(currentTime)} | 片段: ${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}`);
        }

        // 如果当前时间在片段范围之外，显示状态但不强制跳转（用户可能手动拖动了进度条）
        if (currentTime < segment.start) {
          // 用户手动拖动到片段之前，工具不生效
          this.updateStatusDisplay(`⏸️ 工具暂停（时间 ${this.formatTime(currentTime)} 在片段 ${this.formatTime(segment.start)} 之前）`);
          return;
        }

        if (currentTime >= segment.end) {
          // 时间已超出片段范围
          this.updateStatusDisplay(`⏸️ 工具暂停（时间 ${this.formatTime(currentTime)} 超出片段 ${this.formatTime(segment.end)}）`);
        }

        // 检查是否到达片段结束，自动切换到下一个片段
        if (currentTime >= segment.end - 0.1) { // 提前0.1秒切换到下一个片段
          clearInterval(this.intervalId);

          const autoPlayNext = this.uiElement && this.uiElement.querySelector('#autoPlayNext') ?
            this.uiElement.querySelector('#autoPlayNext').checked : true;

          if (autoPlayNext && this.currentSegment < this.segments.length - 1) {
            this.currentSegment++;
            const nextSegment = this.segments[this.currentSegment];
            // 检查当前时间是否在下一个片段范围内
            if (currentTime >= nextSegment.start && currentTime < nextSegment.end) {
              // 当前时间在下一个片段范围内，直接激活
              this.activateSegment(nextSegment);
              this.updateUI();
            } else if (currentTime < nextSegment.start) {
              // 有时间间隙，跳转到下一个片段开始
              this.currentVideo.currentTime = nextSegment.start;
              this.activateSegment(nextSegment);
              this.updateUI();
            } else {
              // 当前时间已超出下一个片段，继续查找合适的片段
              this.findAndActivateAppropriateSegment(currentTime);
            }
          } else {
            this.showMessage('片段播放完成', 'success');
            this.isPlaying = false;
            this.updateStatusDisplay('✅ 全部片段播放完成');
          }
        }
      }, 100); // 每100ms检查一次
    }

    // 更新状态栏显示
    updateStatusDisplay(message) {
      const statusBar = this.uiElement?.querySelector('.status-bar');
      if (statusBar) {
        statusBar.textContent = message;
      }
    }

    // 查找并激活适合当前时间的片段
    findAndActivateAppropriateSegment(currentTime) {
      const result = this.findSegmentForTime(currentTime);
      if (result && result.within) {
        this.currentSegment = result.index;
        this.activateSegment(result.segment);
        this.updateUI();
        this.showMessage(`自动激活片段 ${this.currentSegment + 1}`, 'info');
      } else {
        // 没有找到合适的片段，停止监听
        this.isPlaying = false;
        this.updateStatusDisplay(`⏸️ 当前时间 ${this.formatTime(currentTime)} 不在任何片段范围内`);
      }
    }

    // 播放下一个片段
    playNextSegment() {
      if (this.currentSegment < this.segments.length - 1) {
        this.currentSegment++;
        this.playCurrentSegment(false);
      } else {
        this.showMessage('已经是最后一个片段', 'info');
      }
    }

    // 播放上一个片段
    playPreviousSegment() {
      if (this.currentSegment > 0) {
        this.currentSegment--;
        this.playCurrentSegment(false);
      } else {
        this.showMessage('已经是第一个片段', 'info');
      }
    }

    // 自动适配当前时间（不修改进度，只激活对应片段）
    autoFitToCurrentTime() {
      if (!this.currentVideo) {
        this.showMessage('没有可用的视频元素', 'error');
        return;
      }

      if (this.segments.length === 0) {
        this.showMessage('没有设置播放片段', 'error');
        return;
      }

      const currentTime = this.currentVideo.currentTime;
      const result = this.findSegmentForTime(currentTime);

      if (result) {
        this.currentSegment = result.index;
        const segment = result.segment;

        if (result.within) {
          // 当前时间在片段内，激活该片段并开始监听
          this.activateSegment(segment);
          this.showMessage(`已激活片段 ${this.currentSegment + 1}: ${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}`, 'success');
        } else {
          // 当前时间不在片段内，跳转到该片段开始
          this.currentVideo.currentTime = segment.start;
          this.activateSegment(segment);
          this.showMessage(`已跳转到片段 ${this.currentSegment + 1}: ${this.formatTime(segment.start)}`, 'info');
        }
      } else {
        this.showMessage('当前时间已超过所有片段', 'warning');
      }

      this.updateUI();
    }

    // 激活上一个片段（跳转到片段开始）
    activatePreviousSegment() {
      if (this.segments.length === 0) {
        this.showMessage('没有设置播放片段', 'error');
        return;
      }

      if (this.currentSegment > 0) {
        this.currentSegment--;
        const segment = this.segments[this.currentSegment];
        // 跳转到片段开始
        this.currentVideo.currentTime = segment.start;
        this.activateSegment(segment);
        this.showMessage(`已跳转到片段 ${this.currentSegment + 1}: ${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}`, 'success');
        this.updateUI();
      } else {
        this.showMessage('已经是第一个片段', 'info');
      }
    }

    // 激活下一个片段（跳转到片段开始）
    activateNextSegment() {
      if (this.segments.length === 0) {
        this.showMessage('没有设置播放片段', 'error');
        return;
      }

      if (this.currentSegment < this.segments.length - 1) {
        this.currentSegment++;
        const segment = this.segments[this.currentSegment];
        // 跳转到片段开始
        this.currentVideo.currentTime = segment.start;
        this.activateSegment(segment);
        this.showMessage(`已跳转到片段 ${this.currentSegment + 1}: ${this.formatTime(segment.start)} - ${this.formatTime(segment.end)}`, 'success');
        this.updateUI();
      } else {
        this.showMessage('已经是最后一个片段', 'info');
      }
    }

    // 激活片段并开始监听（不修改视频位置）
    activateSegment(segment) {
      // 清除之前的监听
      if (this.intervalId) {
        clearInterval(this.intervalId);
      }

      this.isPlaying = true;

      // 如果视频未播放，则开始播放
      if (this.currentVideo && this.currentVideo.paused) {
        this.currentVideo.play().catch(error => {
          console.error('播放失败:', error);
        });
      }

      this.setupEndCheck(segment);
    }

    // 停止播放
    stop() {
      this.isPlaying = false;

      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }

      if (this.currentVideo) {
        this.currentVideo.pause();
      }

      this.updateUI();
      this.showMessage('播放已停止', 'info');
    }

    // 选择视频
    setVideo(index) {
      if (index >= 0 && index < this.videos.length) {
        // 清理旧视频的事件监听器
        this.cleanupVideoListeners();

        this.currentVideo = this.videos[index];
        this.setupTimeUpdateListener();
        this.updateUI();
        this.showMessage(`已切换到视频 ${index}`, 'success');
      } else {
        this.showMessage(`无效的视频索引，有效范围: 0-${this.videos.length-1}`, 'error');
      }
    }

    // 清理视频相关的事件监听器
    cleanupVideoListeners() {
      this.eventListeners = this.eventListeners.filter(listener => {
        if (listener.type === 'videoTimeUpdate' && listener.target) {
          listener.target.removeEventListener('timeupdate', listener.handler);
          return false;
        }
        return true;
      });
    }
    
    // 导出YAML配置
    exportConfig() {
      try {
        console.log('开始导出YAML配置');

        let yaml = "# 视频片段配置\n";
        yaml += `# 当前片段: ${this.currentSegment}\n`;
        yaml += `# 自动播放: ${this.uiElement?.querySelector('#autoPlayNext')?.checked ? true : false}\n`;
        yaml += `# 调试模式: ${this.uiElement?.querySelector('#debugMode')?.checked ? true : false}\n\n`;

        if (this.segments.length > 0) {
          // 按分组整理片段
          const groups = {};

          this.segments.forEach((segment, index) => {
            let groupName = '默认分组';

            if (segment.label) {
              // 如果标签包含 " - "，提取分组名
              const parts = segment.label.split(' - ');
              if (parts.length > 1) {
                groupName = parts[0];
              }
            }

            if (!groups[groupName]) {
              groups[groupName] = [];
            }

            const timeRange = `${this.formatTime(segment.start)}-${this.formatTime(segment.end)}`;
            const itemLabel = segment.label.includes(' - ') ?
              segment.label.split(' - ').slice(1).join(' - ') :
              (segment.label || '');

            groups[groupName].push({
              timeRange,
              label: itemLabel
            });
          });

          // 生成YAML
          Object.entries(groups).forEach(([groupName, items]) => {
            yaml += `${groupName}:\n`;
            items.forEach(item => {
              if (item.label) {
                yaml += `  - ${item.timeRange} ${item.label}\n`;
              } else {
                yaml += `  - ${item.timeRange}\n`;
              }
            });
            yaml += '\n';
          });
        } else {
          yaml += "默认分组:\n  # 暂无片段\n";
        }

        console.log('YAML内容生成完成，开始下载');

        // 先复制到剪切板作为兜底
        this.copyToClipboard(yaml);

        // 尝试下载文件
        let downloadSuccess = false;
        try {
          const blob = new Blob([yaml], { type: 'text/yaml' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'video-segments.yaml';
          a.style.display = 'none';

          // 使用更兼容的点击方式
          document.body.appendChild(a);

          // 尝试多种触发下载的方法
          if (a.click) {
            a.click();
          } else {
            // 备选方法：创建鼠标事件
            const event = new MouseEvent('click', {
              view: window,
              bubbles: true,
              cancelable: true
            });
            a.dispatchEvent(event);
          }

          // 延迟清理，确保下载触发
          setTimeout(() => {
            try {
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch (e) {
              console.warn('清理下载元素时出错:', e);
            }
          }, 100);

          downloadSuccess = true;
          console.log('YAML文件下载触发成功');

        } catch (downloadError) {
          console.error('文件下载失败:', downloadError);
        }

        // 根据结果显示不同的消息
        if (downloadSuccess) {
          this.showMessage('YAML配置已导出（文件下载+剪切板备份）', 'success');
        } else {
          this.showMessage('下载失败，但内容已复制到剪切板', 'warning');
        }

      } catch (error) {
        console.error('导出YAML配置时发生错误:', error);
        this.showMessage('导出失败: ' + error.message, 'error');
      }
    }

    // 复制到剪切板的通用方法
    copyToClipboard(text) {
      // 优先使用现代 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          console.log('内容已复制到剪切板（现代API）');
        }).catch((err) => {
          console.warn('现代剪切板API失败，尝试降级方案:', err);
          this.fallbackCopyToClipboard(text);
        });
      } else {
        // 降级方案
        this.fallbackCopyToClipboard(text);
      }
    }

    // 降级的剪切板复制方法
    fallbackCopyToClipboard(text) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        textArea.style.opacity = '0';
        textArea.style.pointerEvents = 'none';
        textArea.setAttribute('readonly', '');

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, textArea.length); // 对于移动设备

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
          console.log('内容已复制到剪切板（降级方案）');
        } else {
          console.error('降级剪切板复制失败');
        }
      } catch (err) {
        console.error('降级剪切板复制出错:', err);
        // 最后的兜底：在控制台输出
        console.log('=== YAML配置内容 ===');
        console.log(text);
        console.log('=== 内容结束 ===');
      }
    }

    // 导入YAML配置
    importConfig() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.yaml,.yml';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const yamlText = e.target.result;
            const yamlData = this.parseSimpleYAML(yamlText);

            this.segments = [];

            Object.entries(yamlData).forEach(([sectionName, items]) => {
              items.forEach((item, index) => {
                const segment = this.parseTimeRange(item.timeRange);
                if (segment) {
                  const label = item.label ? `${sectionName} - ${item.label}` : sectionName;
                  segment.label = label;
                  this.segments.push(segment);
                }
              });
            });

            this.currentSegment = 0;
            this.updateUI();
            this.showMessage(`YAML配置导入成功，共导入 ${this.segments.length} 个片段`, 'success');
          } catch (err) {
            this.showMessage('YAML文件格式错误', 'error');
            console.error('导入YAML配置错误:', err);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }
    
    // 清理
    cleanup() {
      this.stop();

      if (this.uiElement) {
        this.uiElement.remove();
      }

      // 清理所有事件监听器
      this.cleanupVideoListeners();

      this.eventListeners.forEach(listener => {
        if (listener.type === 'observer' && listener.value) {
          listener.value.disconnect();
        } else if (listener.type === 'documentClick' && listener.target && listener.handler) {
          listener.target.removeEventListener('click', listener.handler, true);
        }
      });

      this.eventListeners = [];
      console.log('🧹 视频片段播放器已清理');
    }
  }
  
  // 创建全局函数（保持向后兼容）
  window.playSegments = function(rangeStrings) {
    if (!window._videoSegmentPlayer) {
      console.error('❌ 视频片段播放器未初始化');
      return;
    }
    
    window._videoSegmentPlayer.playSegments(rangeStrings);
  };
  
  window.setVideo = function(index) {
    if (!window._videoSegmentPlayer) {
      console.error('❌ 视频片段播放器未初始化');
      return;
    }
    
    window._videoSegmentPlayer.setVideo(index);
  };
  
  window.showVideos = function() {
    if (!window._videoSegmentPlayer) {
      console.error('❌ 视频片段播放器未初始化');
      return;
    }
    
    window._videoSegmentPlayer.showVideos();
  };
  
  window.addSegment = function(rangeStr) {
    if (!window._videoSegmentPlayer) {
      console.error('❌ 视频片段播放器未初始化');
      return;
    }
    
    window._videoSegmentPlayer.addSegment(rangeStr);
  };
  
  window.clearSegments = function() {
    if (!window._videoSegmentPlayer) {
      console.error('❌ 视频片段播放器未初始化');
      return;
    }
    
    window._videoSegmentPlayer.clearSegments();
  };
  
  window.playNext = function() {
    if (!window._videoSegmentPlayer) {
      console.error('❌ 视频片段播放器未初始化');
      return;
    }
    
    window._videoSegmentPlayer.playNextSegment();
  };
  
  window.stop = function() {
    if (!window._videoSegmentPlayer) {
      console.error('❌ 视频片段播放器未初始化');
      return;
    }
    
    window._videoSegmentPlayer.stop();
  };
  
  window.help = function() {
    console.log(`
🎬 视频片段播放器 - 帮助指南
=============================
控制台命令 (向后兼容):
  playSegments(["00:01-00:05", "00:10-00:15"])
  addSegment("00:20-00:30")
  clearSegments()
  playNext()
  stop()
  setVideo(0)
  showVideos()

或直接在界面中操作!
    `);
  };
  
  // 初始化播放器
  new VideoSegmentPlayer();
  
  console.log(`
🎬 视频片段播放器已就绪!
========================
浮动控制面板已添加到页面右下角。

功能特性:
1. 可视化界面操作，无需记忆命令
2. 支持时间格式: 00:01-00:05 或 00:01:10-00:01:20
3. 片段可编辑，支持标签
4. 批量添加和快速添加功能
5. 配置导入/导出
6. 自动播放下一个片段
7. 调试模式

使用说明:
1. 在"添加片段"区域输入开始和结束时间
2. 点击"添加"按钮或按回车键
3. 在片段列表中可编辑、删除或单独播放
4. 使用"批量操作"区域批量添加
5. 点击"播放全部"开始播放
  `);
  
})();