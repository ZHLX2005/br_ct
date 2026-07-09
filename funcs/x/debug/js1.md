
# 1

(function () {
    // 保存原生 open 方法
    var open = window.XMLHttpRequest.prototype.open;

    // 重写 open
    window.XMLHttpRequest.prototype.open = function (method, url, async) {
        // 如果 url 中不包含字母 "t"
        if (url.indexOf("t") === -1) {
            debugger; // 触发调试断点
            return open.apply(this, arguments);
        }

    // 否则正常执行（你也可以在这里加逻辑）
        return open.apply(this, arguments);
    };
})();

xhr请求类型断点


# 2

(function () {
    var cookieTemp = ''; // 1. 定义一个局部变量，用于临时存储 Cookie 的值
    Object.defineProperty(document, 'cookie', { // 2. 重写 document.cookie 属性
        set: function (Val) { // 3. 当外部代码试图给 document.cookie 赋值时（如设置 Cookie）
            if (Val.indexOf('v') != -1) { // 4.
                debugger; // 5. 【阻断执行】如果包含，则触发断点，暂停执行
            }
            console.log('Hook捕获到cookie设置->', Val); // 6. 在控制台打印出完整的 Cookie 设置信息
            cookieTemp = Val; // 7. 将新值保存到局部变量中
            return Val; // 8. 返回这个值，保证原有逻辑正常运行
        },
        get: function () { // 9. 当外部读取 document.cookie 时
            return cookieTemp; // 10. 返回我们刚才保存的局部变量值
        }
    });
})();

# 3

过debugger : 强行赋值

# 4

websocket hook

# 5 



篡改猴

基于规则的进行注入js脚本 



# 6 

浏览器的最高执行权限



# 7 

(function() {
    var parse_ = JSON.parse;          // ① 保存原始 JSON.parse 方法
    JSON.parse = function(jp) {       // ② 重写 JSON.parse
        console.log("您猜怎么着？断住了！-->", jp);  // ③ 打印被解析的内容
        debugger;                      // ④ 触发浏览器断点（暂停执行）
        return parse_(jp);             // ⑤ 调用原始方法，不改变原有逻辑
    }
})();

# 8 

(function() {
    var open = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function(method, url, async) {
        if (url.indexOf("NECapTchaValidate") !== -1) {
            console.log('[拦截] NECapTchaValidate 请求:', method, url);
            debugger;
        }
        return open.apply(this, arguments);
    };
})();



# 9



(function () {
    // 1. 备份原始的函数构造器（防止彻底破坏 JS 引擎）
    var _constructor = constructor;

    // 2. 重写 Function 的构造器
    Function.prototype.constructor = function(s) {
        // 3. 核心逻辑：如果传入的代码字符串是 "debugger"
        if (s === "debugger") {
            // console.log(s); // 原本可以在这里打印日志，作者注释掉了
            return null; // 直接返回 null，不执行 debugger
        }

    // 4. 如果不是 debugger，就调用原始构造器，保持正常逻辑
        return _constructor(s);
    }
})();

Function是一个内置的函数构造器（Constructor）。
当你写 new Function("code")时，实际上就是在调用 Function.prototype.constructor("code")。
所以，“构造器启动” 指的是：通过修改 Function.prototype.constructor这个原型链上的方法，来在代码执行的最源头（底层）拦截特定的操作。


# 10 

工作区

# 11 

全局搜索 xx: 

有可能查看到赋值

# 12

.call调用


  fn.apply(this, arguments)   // 原样透传，逆向时说明是「包装/代理函数」

# 13 

spidertools.cn
