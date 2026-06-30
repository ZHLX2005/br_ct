/**
 * @fileoverview 视频定间隔抽帧打包下载
 *
 * @scenario    需要把长视频按固定间隔抽帧保存为图片集
 * @feature     定时跳转视频currentTime，截取canvas帧，打包为ZIP下载
 * @effect      触发浏览器下载，生成包含视频帧图片的ZIP压缩包
 * @category    视频处理
 * @platform    通用
 * @entry       自动执行
 */

// 按照间隔获得视频帧  然后进行下载 

(async () => {
    console.log("🚀 正在启动抽帧脚本...");

    // 1. 动态引入 JSZip 库 (用于打包图片)
    const loadScript = (src) => new Promise(res => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        document.head.appendChild(s);
    });
    if (typeof JSZip === 'undefined') {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    }

    // 2. 自动定位页面第一个视频
    const video = document.querySelector('video');
    if (!video) {
        console.error("❌ 页面上没找到视频元素！");
        return;
    }

    // 3. 配置参数
    const step = 5; // 步长：5秒
    const zip = new JSZip();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // 设置画布尺寸
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const duration = video.duration;
    console.log(`🎬 视频总时长: ${duration.toFixed(2)}s，预计提取 ${Math.ceil(duration / step)} 帧`);

    // 4. 抽帧逻辑
    // 注意：由于跨域安全策略，如果视频服务器没配CORS，导出图片可能会失败
    video.pause();
    const originalTime = video.currentTime;

    for (let time = 0; time < duration; time += step) {
        console.log(`📸 正在抓取第 ${time} 秒...`);
        
        // 跳转时间
        video.currentTime = time;
        
        // 等待浏览器渲染该帧 (seeked)
        await new Promise(resolve => {
            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                resolve();
            };
            video.addEventListener('seeked', onSeeked);
        });

        // 绘制到画布
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // 转换为 Blob 格式并加入 ZIP
        try {
            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
            zip.file(`frame_${time.toFixed(0)}s.jpg`, blob);
        } catch (e) {
            console.error("🔒 跨域错误：无法导出该帧图片。视频服务器可能限制了CORS。");
            break;
        }
    }

    // 5. 导出并下载压缩包
    console.log("📦 正在生成压缩包，请稍候...");
    video.currentTime = originalTime; // 恢复视频进度
    const content = await zip.generateAsync({type: "blob"});
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `video_frames_${Date.now()}.zip`;
    link.click();
    
    console.log("✅ 下载已启动！");
})();