/**
 * @fileoverview Video操作工具模块
 *
 * @scenario    控制台脚本中需要统一管理页面video元素
 * @feature     提供video查找/选择/控制/监听的纯逻辑操作
 * @effect      不直接操作DOM，作为类被其他模块引用以管理视频元素
 * @category    视频处理
 * @platform    通用
 * @entry       VideoOperator
 */

/**
 * Video 操作工具模块
 * 提供视频元素的查找、控制、监听等核心功能
 * 从 videoPlane.js 中提取的纯 video 操作逻辑
 */

export class VideoOperator {
    constructor() {
        this.videos = [];
        this.currentVideo = null;
        this.eventListeners = [];
        this.observers = [];

        // 初始化时查找视频
        this.findVideos();
        this.setupVideoObserver();
    }

    // ==================== 视频查找与选择 ====================

    /**
     * 查找页面中的所有视频元素
     */
    findVideos() {
        const newVideos = Array.from(document.querySelectorAll('video'));

        if (newVideos.length !== this.videos.length) {
            this.videos = newVideos;
            console.log(`[VideoOperator] 找到 ${this.videos.length} 个视频元素`);

            // 如果当前视频不在新的视频列表中，或者没有当前视频，则选择第一个
            if (!this.currentVideo || !this.videos.includes(this.currentVideo)) {
                if (this.videos.length > 0) {
                    this.setVideo(0);
                }
            }

            return true;
        }

        return false;
    }

    /**
     * 获取视频源信息
     * @param {HTMLVideoElement} video - 视频元素
     * @returns {string} 视频源信息
     */
    getVideoSource(video) {
        if (!video) return '无视频';

        if (video.src) {
            const src = video.src.substring(0, 100);
            return src + (video.src.length > 100 ? '...' : '');
        }

        if (video.querySelector('source')) {
            return '多个<source>标签';
        }

        if (video.currentSrc) {
            const src = video.currentSrc.substring(0, 100);
            return src + (video.currentSrc.length > 100 ? '...' : '');
        }

        return '未知';
    }

    /**
     * 获取视频的详细信息
     * @param {HTMLVideoElement} video - 视频元素
     * @returns {Object} 视频信息对象
     */
    getVideoInfo(video) {
        if (!video) {
            return {
                exists: false,
                src: '无视频',
                duration: 0,
                currentTime: 0,
                width: 0,
                height: 0,
                paused: true,
                ended: false,
                readyState: 0
            };
        }

        return {
            exists: true,
            src: this.getVideoSource(video),
            duration: video.duration || 0,
            currentTime: video.currentTime || 0,
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
            paused: video.paused,
            ended: video.ended,
            readyState: video.readyState,
            playbackRate: video.playbackRate || 1
        };
    }

    /**
     * 选择并设置当前视频
     * @param {number} index - 视频索引
     * @returns {boolean} 是否成功设置
     */
    setVideo(index) {
        if (index < 0 || index >= this.videos.length) {
            console.error(`[VideoOperator] 无效的视频索引: ${index}，有效范围: 0-${this.videos.length - 1}`);
            return false;
        }

        // 清理旧视频的事件监听器
        this.cleanupVideoListeners();

        this.currentVideo = this.videos[index];
        console.log(`[VideoOperator] 已切换到视频 ${index}`);

        // 触发视频切换事件
        this._triggerEvent('videoChanged', {
            index,
            video: this.currentVideo,
            info: this.getVideoInfo(this.currentVideo)
        });

        return true;
    }

    /**
     * 根据条件查找视频
     * @param {Function} predicate - 查找条件函数
     * @returns {HTMLVideoElement|null} 找到的视频元素
     */
    findVideo(predicate) {
        for (let i = 0; i < this.videos.length; i++) {
            if (predicate(this.videos[i], i)) {
                this.setVideo(i);
                return this.currentVideo;
            }
        }
        return null;
    }

    /**
     * 根据视频源URL查找视频
     * @param {string} urlPattern - URL匹配模式
     * @returns {HTMLVideoElement|null} 找到的视频元素
     */
    findVideoByUrl(urlPattern) {
        return this.findVideo((video) => {
            const src = video.src || video.currentSrc || '';
            return src.includes(urlPattern);
        });
    }

    // ==================== 视频播放控制 ====================

    /**
     * 播放视频
     * @param {number} time - 可选，跳转到指定时间后播放
     * @returns {Promise<boolean>} 播放是否成功
     */
    async play(time) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        try {
            if (typeof time === 'number') {
                this.currentVideo.currentTime = time;
            }

            await this.currentVideo.play();
            this._triggerEvent('play', { video: this.currentVideo });
            return true;
        } catch (error) {
            console.error('[VideoOperator] 播放失败:', error);
            return false;
        }
    }

    /**
     * 暂停视频
     * @returns {boolean} 暂停是否成功
     */
    pause() {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        this.currentVideo.pause();
        this._triggerEvent('pause', { video: this.currentVideo });
        return true;
    }

    /**
     * 停止视频（暂停并重置到开头）
     * @returns {boolean} 停止是否成功
     */
    stop() {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        this.currentVideo.pause();
        this.currentVideo.currentTime = 0;
        this._triggerEvent('stop', { video: this.currentVideo });
        return true;
    }

    /**
     * 跳转到指定时间
     * @param {number} time - 目标时间（秒）
     * @returns {boolean} 跳转是否成功
     */
    seekTo(time) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        if (typeof time !== 'number' || time < 0) {
            console.error('[VideoOperator] 无效的时间值');
            return false;
        }

        const oldTime = this.currentVideo.currentTime;
        this.currentVideo.currentTime = time;

        this._triggerEvent('seek', {
            video: this.currentVideo,
            from: oldTime,
            to: time
        });

        return true;
    }

    /**
     * 相对跳转（快进/快退）
     * @param {number} offset - 偏移量（秒），正数为快进，负数为快退
     * @returns {boolean} 跳转是否成功
     */
    seekRelative(offset) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        const newTime = this.currentVideo.currentTime + offset;
        return this.seekTo(Math.max(0, Math.min(newTime, this.currentVideo.duration || 0)));
    }

    /**
     * 设置播放速度
     * @param {number} rate - 播放速度（0.5 = 半速，1 = 正常，2 = 两倍速）
     * @returns {boolean} 设置是否成功
     */
    setPlaybackRate(rate) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        if (typeof rate !== 'number' || rate <= 0) {
            console.error('[VideoOperator] 无效的播放速度');
            return false;
        }

        this.currentVideo.playbackRate = rate;
        this._triggerEvent('rateChange', { video: this.currentVideo, rate });
        return true;
    }

    /**
     * 设置音量
     * @param {number} volume - 音量值（0-1）
     * @returns {boolean} 设置是否成功
     */
    setVolume(volume) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        const clampedVolume = Math.max(0, Math.min(1, volume));
        this.currentVideo.volume = clampedVolume;
        this._triggerEvent('volumeChange', { video: this.currentVideo, volume: clampedVolume });
        return true;
    }

    /**
     * 静音/取消静音
     * @param {boolean} muted - 是否静音
     * @returns {boolean} 设置是否成功
     */
    setMuted(muted) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        this.currentVideo.muted = muted;
        this._triggerEvent('muteChange', { video: this.currentVideo, muted });
        return true;
    }

    /**
     * 切换全屏
     * @returns {boolean} 切换是否成功
     */
    toggleFullscreen() {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            this.currentVideo.requestFullscreen().catch(err => {
                console.error('[VideoOperator] 全屏切换失败:', err);
            });
        }

        return true;
    }

    // ==================== 视频状态查询 ====================

    /**
     * 获取当前播放时间
     * @returns {number} 当前时间（秒）
     */
    getCurrentTime() {
        return this.currentVideo ? this.currentVideo.currentTime : 0;
    }

    /**
     * 获取视频总时长
     * @returns {number} 总时长（秒）
     */
    getDuration() {
        return this.currentVideo ? this.currentVideo.duration : 0;
    }

    /**
     * 获取播放进度百分比
     * @returns {number} 进度百分比（0-100）
     */
    getProgress() {
        if (!this.currentVideo || !this.currentVideo.duration) {
            return 0;
        }
        return (this.currentVideo.currentTime / this.currentVideo.duration) * 100;
    }

    /**
     * 检查视频是否正在播放
     * @returns {boolean} 是否正在播放
     */
    isPlaying() {
        return this.currentVideo ? !this.currentVideo.paused && !this.currentVideo.ended : false;
    }

    /**
     * 检查视频是否已加载完成
     * @returns {boolean} 是否已加载完成
     */
    isLoaded() {
        return this.currentVideo ? this.currentVideo.readyState >= 2 : false;
    }

    /**
     * 检查视频是否已结束
     * @returns {boolean} 是否已结束
     */
    isEnded() {
        return this.currentVideo ? this.currentVideo.ended : false;
    }

    // ==================== 视频事件监听 ====================

    /**
     * 监听视频时间更新
     * @param {Function} callback - 回调函数，接收当前时间作为参数
     * @returns {boolean} 是否成功添加监听
     */
    onTimeUpdate(callback) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        const handler = () => {
            callback(this.currentVideo.currentTime);
        };

        this.currentVideo.addEventListener('timeupdate', handler);

        this.eventListeners.push({
            type: 'timeupdate',
            target: this.currentVideo,
            handler,
            callback
        });

        return true;
    }

    /**
     * 监听视频播放状态
     * @param {Function} callback - 回调函数，接收状态对象作为参数
     * @returns {boolean} 是否成功添加监听
     */
    onPlayStateChange(callback) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        const playHandler = () => {
            callback({ state: 'playing', video: this.currentVideo });
        };

        const pauseHandler = () => {
            callback({ state: 'paused', video: this.currentVideo });
        };

        const endedHandler = () => {
            callback({ state: 'ended', video: this.currentVideo });
        };

        this.currentVideo.addEventListener('play', playHandler);
        this.currentVideo.addEventListener('pause', pauseHandler);
        this.currentVideo.addEventListener('ended', endedHandler);

        this.eventListeners.push(
            { type: 'play', target: this.currentVideo, handler: playHandler, callback },
            { type: 'pause', target: this.currentVideo, handler: pauseHandler, callback },
            { type: 'ended', target: this.currentVideo, handler: endedHandler, callback }
        );

        return true;
    }

    /**
     * 监听视频加载完成
     * @param {Function} callback - 回调函数
     * @returns {boolean} 是否成功添加监听
     */
    onLoaded(callback) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        const handler = () => {
            callback(this.currentVideo);
        };

        this.currentVideo.addEventListener('loadeddata', handler);
        this.currentVideo.addEventListener('loadedmetadata', handler);

        this.eventListeners.push(
            { type: 'loadeddata', target: this.currentVideo, handler, callback },
            { type: 'loadedmetadata', target: this.currentVideo, handler, callback }
        );

        return true;
    }

    /**
     * 监听视频错误
     * @param {Function} callback - 回调函数，接收错误对象
     * @returns {boolean} 是否成功添加监听
     */
    onError(callback) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        const handler = (e) => {
            callback({
                error: this.currentVideo.error,
                video: this.currentVideo,
                event: e
            });
        };

        this.currentVideo.addEventListener('error', handler);

        this.eventListeners.push({
            type: 'error',
            target: this.currentVideo,
            handler,
            callback
        });

        return true;
    }

    /**
     * 监听视频进度
     * @param {Function} callback - 回调函数，接收进度对象 {loaded, total, percentage}
     * @returns {boolean} 是否成功添加监听
     */
    onProgress(callback) {
        if (!this.currentVideo) {
            console.error('[VideoOperator] 没有可用的视频元素');
            return false;
        }

        const handler = () => {
            if (this.currentVideo.buffered.length > 0) {
                const bufferedEnd = this.currentVideo.buffered.end(this.currentVideo.buffered.length - 1);
                const duration = this.currentVideo.duration;

                callback({
                    loaded: bufferedEnd,
                    total: duration,
                    percentage: (bufferedEnd / duration) * 100
                });
            }
        };

        this.currentVideo.addEventListener('progress', handler);

        this.eventListeners.push({
            type: 'progress',
            target: this.currentVideo,
            handler,
            callback
        });

        return true;
    }

    /**
     * 移除特定事件监听
     * @param {string} eventType - 事件类型
     * @param {Function} callback - 回调函数
     * @returns {boolean} 是否成功移除
     */
    off(eventType, callback) {
        const removed = this.eventListeners.filter(listener => {
            if (listener.type === eventType && listener.callback === callback) {
                listener.target.removeEventListener(eventType, listener.handler);
                return false;
            }
            return true;
        });

        this.eventListeners = removed;
        return true;
    }

    /**
     * 清理视频相关的事件监听器
     */
    cleanupVideoListeners() {
        this.eventListeners.forEach(listener => {
            if (listener.target && listener.handler) {
                listener.target.removeEventListener(listener.type, listener.handler);
            }
        });

        this.eventListeners = [];
        console.log('[VideoOperator] 已清理视频事件监听器');
    }

    // ==================== 视频监观察器 ====================

    /**
     * 设置视频元素监观察器
     * 当页面中新增或移除视频时自动更新
     */
    setupVideoObserver() {
        const observer = new MutationObserver((mutations) => {
            let hasVideoChanges = false;

            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeName === 'VIDEO' || (node.querySelectorAll && node.querySelectorAll('video').length > 0)) {
                        hasVideoChanges = true;
                    }
                });

                mutation.removedNodes.forEach(node => {
                    if (node.nodeName === 'VIDEO' || (node === this.currentVideo)) {
                        hasVideoChanges = true;
                    }
                });
            });

            if (hasVideoChanges) {
                const changed = this.findVideos();
                if (changed) {
                    this._triggerEvent('videosChanged', {
                        videos: this.videos,
                        currentVideo: this.currentVideo
                    });
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        this.observers.push(observer);

        console.log('[VideoOperator] 视频监观察器已启动');
    }

    /**
     * 清理观察器
     */
    cleanupObservers() {
        this.observers.forEach(observer => {
            observer.disconnect();
        });

        this.observers = [];
        console.log('[VideoOperator] 已清理观察器');
    }

    // ==================== 时间格式化工具 ====================

    /**
     * 将时间字符串转换为秒
     * @param {string} timeStr - 时间字符串 (格式: "00:01:30.5" 或 "01:30" 或 "90.5")
     * @returns {number} 秒数
     */
    static parseTimeStr(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return NaN;

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

    /**
     * 将秒转换为时间字符串
     * @param {number} seconds - 秒数
     * @param {boolean} includeHours - 是否包含小时
     * @returns {string} 格式化的时间字符串
     */
    static formatTime(seconds, includeHours = false) {
        if (isNaN(seconds)) return "00:00";

        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0 || includeHours) {
            return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    }

    /**
     * 解析时间段字符串
     * @param {string} rangeStr - 时间段字符串 (格式: "00:01-00:05" 或 "00:01:10-00:01:20")
     * @returns {Object|null} {start, end} 或 null
     */
    static parseTimeRange(rangeStr) {
        const match = rangeStr.match(/([\d:.]+)-([\d:.]+)/);
        if (!match) {
            console.error('[VideoOperator] 时间格式错误，应为: "00:01-00:05"');
            return null;
        }

        const start = this.parseTimeStr(match[1]);
        const end = this.parseTimeStr(match[2]);

        if (isNaN(start) || isNaN(end)) {
            console.error('[VideoOperator] 时间格式错误');
            return null;
        }

        if (start >= end) {
            console.error('[VideoOperator] 开始时间必须小于结束时间');
            return null;
        }

        return { start, end };
    }

    // ==================== 内部方法 ====================

    /**
     * 触发自定义事件
     * @private
     */
    _triggerEvent(eventName, data) {
        const event = new CustomEvent(`video:${eventName}`, {
            detail: data
        });
        document.dispatchEvent(event);
    }

    // ==================== 清理 ====================

    /**
     * 清理所有资源
     */
    cleanup() {
        this.cleanupVideoListeners();
        this.cleanupObservers();

        this.videos = [];
        this.currentVideo = null;

        console.log('[VideoOperator] 已清理所有资源');
    }
}

// ==================== 导出 ====================

/**
 * 创建单例实例
 */
export function createVideoOperator() {
    return new VideoOperator();
}

/**
 * 获取全局单例实例
 */
export function getVideoOperator() {
    if (!window.__globalVideoOperator) {
        window.__globalVideoOperator = new VideoOperator();
    }
    return window.__globalVideoOperator;
}
