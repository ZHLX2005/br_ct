(() => {
  const texts = [
    '低头是题海，抬头是未来',
    '今天不吃学习的苦，明天就吃生活的苦',
    '只要学不死，就往死里学',
  ];

  // 每次动画的唯一 keyframes 名，避免多次注入同名动画互相覆盖
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const keyframesName = `banner-slide-${runId}`;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ${keyframesName} {
      0%   { transform: translate(100vw, -50%); }
      100% { transform: translate(-100%, -50%); }
    }
  `;
  document.head.appendChild(style);

  // 串行执行：上一句跑完再跑下一句，循环 texts 数组注入 3 次
  let i = 0;
  const runOnce = () => {
    const text = texts[i % texts.length];
    const banner = document.createElement('div');
    banner.textContent = text;
    Object.assign(banner.style, {
      position: 'fixed',
      top: '50%',
      left: '0',
      transform: 'translateY(-50%)',
      whiteSpace: 'nowrap',
      color: '#ff1a1a',
      fontSize: '20vw',
      fontWeight: '900',
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      textShadow: '0 0 30px rgba(255, 0, 0, 0.6), 2px 2px 0 #800000',
      letterSpacing: '0.05em',
      zIndex: '2147483647',
      pointerEvents: 'none',
      willChange: 'transform',
      animation: `${keyframesName} 8s linear forwards`,
    });
    document.body.appendChild(banner);
    banner.addEventListener('animationend', () => {
      banner.remove();
      i += 1;
      if (i < texts.length) {
        // 轻微停顿后跑下一句
        setTimeout(runOnce, 800);
      } else {
        style.remove();
      }
    }, { once: true });
  };

  runOnce();
})();