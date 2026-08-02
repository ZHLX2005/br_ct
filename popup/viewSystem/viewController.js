// popup/viewSystem/viewController.js
// 视图挂载控制器（中间件）：在单一 mount 点 attach/detach 各视图的 DOM 实例，
// 切换时切页级 <link> 隔离 CSS。detach 不销毁实例 → 状态/监听保留。

let mountPoint = null;
let views = Object.create(null);
let current = null;
const CSS_ATTR = 'data-view-css';

export function setMountPoint(el) { mountPoint = el; }

export function register(viewDefs) {
  views = Object.create(null);
  for (const def of viewDefs) {
    // 存「同一引用」并就地补默认值：init 内 this===def，测试方可读 def.initCalls。
    // 不做 {...def} 拷贝，否则 this 指向内部副本、外部引用失效。
    def.init = def.init || (() => {});
    def.teardown = def.teardown || (() => {});
    def.cssHrefs = def.cssHrefs || [];
    def.dom = null;
    def.ready = false;
    views[def.id] = def;
  }
}

export function getCurrent() { return current; }

async function loadBody(view) {
  const html = await view.getBody();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body.querySelector('[data-view-content]') || doc.body;
  const wrapper = document.createElement('div');
  wrapper.className = `view view-${view.id}`;
  while (root.firstChild) wrapper.appendChild(root.firstChild);
  return wrapper;
}

function addLinks(viewId) {
  for (const href of views[viewId].cssHrefs) {
    if (document.head.querySelector(`link[${CSS_ATTR}="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href; link.setAttribute(CSS_ATTR, href);
    document.head.appendChild(link); // theme.css 静态在最前，页级 link 追加其后
  }
}
function removeLinks(viewId) {
  for (const href of views[viewId].cssHrefs) {
    const el = document.head.querySelector(`link[${CSS_ATTR}="${href}"]`);
    if (el) el.remove();
  }
}

export async function mount(viewId) {
  if (current === viewId) return;
  const view = views[viewId];
  if (!view) { console.error('[viewController] unknown view', viewId); return; }

  // 首次取 body（异步，期间旧视图仍可见，无闪烁）
  if (view.dom === null) {
    try { view.dom = await loadBody(view); }
    catch (e) { console.error('[viewController] loadBody failed', viewId, e); return; }
  }

  const prev = current;
  // 同步块：teardown prev → add 新 css → attach 新 → remove 旧 css → detach 旧（一次绘制）
  if (prev !== null && views[prev].teardown) {
    try { views[prev].teardown(views[prev].dom); } catch (e) { console.error(e); }
  }
  addLinks(viewId);
  mountPoint.appendChild(view.dom);
  if (prev !== null) {
    removeLinks(prev);
    mountPoint.removeChild(views[prev].dom);
  }
  current = viewId;

  // 首次 init（视图已可见）
  if (!view.ready) {
    try { await view.init(view.dom); view.ready = true; }
    catch (e) { console.error('[viewController] init failed', viewId, e); }
  }
}
