hook

JS 逆向里最常用的就是各种  **Hook（钩子）脚本** ，在浏览器 Console / 油猴 / 代理注入阶段运行，用来拦截原生 API、定位加密参数生成位置。下面给你整理了实战中最常用的几类 **可直接复制执行的代码片段** 。

---

## 一、XHR（XMLHttpRequest）Hook

### Hook `open`—— 按 URL 关键字断点

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">(function () {
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, async) {
        if (url.indexOf('sign') !== -1 || url.indexOf('login') !== -1) {
            console.log('[XHR open]', method, url);
            debugger; // 命中关键词自动断点
        }
        return _open.apply(this, arguments);
    };
})();</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

### Hook `setRequestHeader`—— 抓自定义签名 Header

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">(function () {
    var _set = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
        if (key === 'X-Sign' || key === 'Authorization') {
            console.log('[XHR Header]', key + ':', value);
            debugger;
        }
        return _set.apply(this, arguments);
    };
})();</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

### Hook `send`—— 看请求体（含加密参数）

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">(function () {
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
        console.log('[XHR send]', body);
        return _send.apply(this, arguments);
    };
})();</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

---

## 二、Fetch Hook（现代站点常用）

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">(function () {
    var _fetch = window.fetch;
    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : input.url;
        if (url.indexOf('sign') !== -1) {
            console.log('[Fetch]', url, init);
            debugger;
        }
        return _fetch.apply(this, arguments);
    };
})();</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

---

## 三、Cookie Hook（定位关键 Cookie 生成）

把 `'__ac_signature'`换成你要追的 Cookie 关键字：

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">(function () {
    'use strict';
    var cache = document.cookie;
    Object.defineProperty(document, 'cookie', {
        set: function (val) {
            if (val.indexOf('__ac_signature') !== -1) {
                console.log('[Cookie Set]', val);
                debugger;
            }
            cache = val;
            return val;
        },
        get: function () {
            return cache;
        }
    });
})();</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

---

## 四、JSON.stringify / JSON.parse Hook（追加解密入口）

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">// Hook JSON.stringify
(function () {
    var _s = JSON.stringify;
    JSON.stringify = function (p) {
        console.log('[stringify]', p);
        debugger;
        return _s.apply(this, arguments);
    };
})();

// Hook JSON.parse
(function () {
    var _p = JSON.parse;
    JSON.parse = function (s) {
        console.log('[parse]', s);
        debugger;
        return _p.apply(this, arguments);
    };
})();</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

---

## 五、反无限 debugger（绕过 Function("debugger")）

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">(function () {
    var _ctor = Function.prototype.constructor;
    Function.prototype.constructor = function (str) {
        if (str === 'debugger') {
            console.log('[Anti-debugger] 已绕过');
            return function () {};
        }
        return _ctor.apply(this, arguments);
    };
})();</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

---

## 六、setTimeout / setInterval Hook（找加密定时器）

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">(function () {
    var _st = window.setTimeout;
    window.setTimeout = function (fn, delay) {
        console.log('[setTimeout] delay:', delay, '\nstack:', new Error().stack);
        return _st.apply(this, arguments);
    };
})();</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

---

## 七、全局对象属性 Hook（追 window._sign / token）

已知目标字段名时：

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">Object.defineProperty(window, '_sign', {
    set: function (v) {
        console.log('[_sign 被赋值]', v);
        debugger;
        this._sign_val = v;
    },
    get: function () {
        return this._sign_val;
    }
});</code></pre></div><div class="hyc-code-scrollbar__track"><div class="hyc-code-scrollbar__thumb"></div></div><div><div></div></div></div></pre></div></pre>

---

## 八、WebSocket Hook（IM/行情类站点）

<pre class="ybc-pre-component ybc-pre-component_not-math"><div class="hyc-common-markdown__code"><div class="hyc-common-markdown__code__hd"></div><pre class="hyc-common-markdown__code-lan"><div class="hyc-code-scrollbar"><div class="hyc-code-scrollbar__view"><pre><code class="language-js">(function () {
    var _send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        console.log('[WS send]', data);
        return _send.apply(this, arguments);
    };
    var _WS = WebSocket;
    window.WebSocket = function (url) {
        console.log('[WS connect]', url);
        return new _WS(url);
    };
    window.WebSocket.prototype = _WS.prototype;
})();</code></pre></div></div></pre></div></pre>
