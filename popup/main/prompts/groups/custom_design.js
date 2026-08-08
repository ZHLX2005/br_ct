export default [
  {
    "label": "vue模板",
    "alias": "vue",
    "template": "%s 按照指定格式生成vue代码 <script setup lang = 'js'></script><template></template><style scoped></style>"
  },
  {
    "label": "生成bat文件",
    "alias": "bat",
    "template": "内容: %s\n要求: 只需要考虑windows系统  参考上面的概念或者从现成的案例当中获得上面文本当中的指令序列分组, 如果有文件的依赖 定义单独的bat来创建文件，把内容放到markdown的代码段当中,以及成功运行他们的前提条件和可能的报错 ,你只需要生成不同阶段的bat文件的内容即可, 把注意事项和相关的全部都放到bat文件的注释当中"
  },
  {
    "label": "swagger接口文档",
    "alias": "swagger",
    "template": "内容: %s 要求: 生成swagger yml接口文档 ,可以适当进行合理推测 进行描述"
  },
  {
    "label": "大python文件",
    "alias": "py",
    "template": "内容: %s 要求: 只需要考虑windows系统   编写唯一一份python脚本  一键生成上面的所有需要的目录文件和执行文件(bat文件 chcp 65001 >nul 保持对中文的支持)  只需要创建对应的文件 和目录结构, 以及必要的注释, 不要执行被生成的命令,如果有冗余的信息或者提醒 以及指令的含义 写入到readme.md当中  "
  },
  {
    "label": "整理格式",
    "alias": "fmt",
    "template": "内容: %s 要求: 帮我整理上面的内容 进行合理的分段 和格式优化  让内容更清晰 易读 ，比如表格或者代码标准的格式 "
  },
  {
    "label": "指令序列(windows)",
    "alias": "cmd",
    "template": "我的环境是windows 我现在需要 %s , 帮我生成尽可能完整的指令序列  并且提醒其中的可能出现的错误 , 如果没有指出 默认安装了相关的命令工具"
  },
  {
    "label": "docker运行",
    "alias": "docker",
    "template": "主题: %s  要求:基础:  1. 生成一个最小运行的docker run 一行指令,生成一行指令,不要使用命令换行,方便兼容不同shell直接复制,优先保证运行,数据卷都使用数据卷名进行映射,不要指定路径,其他的用户密码优先使用默认配置,如果需要指定 都使用容器作为用户名 223456作为密码 保证快速启动  2. 生成完整的docker-compose.yml文件 可以包含一些高级的参数 比如各种卷的挂载(使用./xxxx进行相对路径的挂载),环境变量的设置,具有良好的配置管理,并且使用扩展一个预留数据卷的挂载./shared:/shared进行预留的映射,其他:把相关的端口全部映射 完成上面两个主题的配置 "
  },
  {
    "label": "识别器设计模式",
    "alias": "recognizer",
    "template": "现在有一个方法go签名 ,我将使用设计模式进行优化 参考下面的案例设计模式 添加识别器 然后对入参创建一个map string [string] 进行冗余 \\n案例: func ParseConfigFromFile(filePath string) (*Config, error) {}  \\n处理之后生成: type Recognizer interface {\\n\\tRecognizeHandler(filePath string) (Handler, error)\\n}\\n\\ntype Handler func(filePath string, msg AdapterMessage) (*Config, error)\\ntype AdapterMessage map[string]string\\n\\n// UniversalRecognizer 通用识别器\\ntype UniversalRecognizer struct{}\\n\\n// NewUniversalRecognizer 创建新的通用识别器\\nfunc NewUniversalRecognizer() *UniversalRecognizer {\\n\\treturn &UniversalRecognizer{}\\n}\\n\\n// RecognizeHandler 识别处理器\\nfunc (r *UniversalRecognizer) RecognizeHandler(filePath string) (Handler, error) {\\n\\t\\n\\tdefault:\\n\\t\\treturn nil, fmt.Errorf(\\\"unsupported file format: %\\\", ext)\\n\\t}\\n}\\n\\n请对: %s 进行类似设计模式的优化"
  },
  {
    "label": "channel设计模式_基于任务机制的消费",
    "alias": "channel",
    "template": " package executor\\n\\nimport (\\n\\t\\\"context\\\"\\n\\t\\\"errors\\\"\\n)\\n// NewPoolExecutor 创建新的协程池执行器\\nfunc NewPoolExecutor(workerCount, queueSize int) *PoolExecutor {\\n\\treturn &PoolExecutor{\\n\\t\\tworkerCount: workerCount,\\n\\t\\ttaskQueue:   make(chan Task, queueSize),\\n\\t\\trunning:     false,\\n\\t}\\n}\\n\\n// SetHandler 设置任务处理函数\\nfunc (e *PoolExecutor) SetHandler(handler TaskHandler) {\\n\\te.mu.Lock()\\n\\tdefer e.mu.Unlock()\\n\\te.handler = handler\\n}\\n\\nfunc (e *PoolExecutor) Submit(ctx context.Context, task Task) error {\\n\\tselect {\\n\\tcase e.taskQueue <- task:\\n\\t\\treturn nil\\n\\tcase <-ctx.Done():\\n\\t\\treturn ctx.Err()\\n\\t}\\n}\\n\\nfunc (e *PoolExecutor) Start(ctx context.Context) error {\\n\\te.mu.Lock()\\n\\tdefer e.mu.Unlock()\\n\\n\\tif e.running {\\n\\t\\treturn nil // 已经运行中\\n\\t}\\n\\n\\tif e.handler == nil {\\n\\t\\treturn ErrNoHandler // 没有设置处理函数\\n\\t}\\n\\n\\te.running = true\\n\\n\\t// 启动工作协程\\n\\tfor i := 0; i < e.workerCount; i++ {\\n\\t\\te.wg.Add(1)\\n\\t\\tgo e.worker(ctx, i)\\n\\t}\\n\\n\\treturn nil\\n}\\n\\nfunc (e *PoolExecutor) Stop(ctx context.Context) error {\\n\\te.mu.Lock()\\n\\tdefer e.mu.Unlock()\\n\\n\\tif !e.running {\\n\\t\\treturn nil\\n\\t}\\n\\n\\te.running = false\\n\\tclose(e.taskQueue)\\n\\te.wg.Wait()\\n\\n\\treturn nil\\n}\\n\\nfunc (e *PoolExecutor) IsRunning() bool {\\n\\te.mu.Lock()\\n\\tdefer e.mu.Unlock()\\n\\treturn e.running\\n}\\n\\nfunc (e *PoolExecutor) worker(ctx context.Context, id int) {\\n\\tdefer e.wg.Done()\\n\\n\\tfor task := range e.taskQueue {\\n\\t\\t// 使用处理函数处理任务\\n\\t\\tif e.handler != nil {\\n\\t\\t\\tif err := e.handler(ctx, task); err != nil {\\n\\t\\t\\t\\t// todo 异常的兜底策略\\n\\n\\t\\t\\t}\\n\\t\\t}\\n\\t}\\n}\\n\\n// 错误定义\\nvar (\\n\\tErrNoHandler = errors.New(\\\"未设置任务处理函数\\\")\\n)package executor\\n\\nimport (\\n\\t\\\"sync\\\"\\n)\\n\\nvar (\\n\\tdefaultExecutor Executor\\n\\tonce            sync.Once\\n)\\n\\n// GetDefaultExecutor 获取默认执行器（单例）\\nfunc GetDefaultExecutor() Executor {\\n\\tonce.Do(func() {\\n\\t\\texecutor := NewPoolExecutor(10, 100) // 10个工作协程，队列大小100\\n\\n\\t\\tdefaultExecutor = executor\\n\\t})\\n\\treturn defaultExecutor\\n}\\n\\npackage executor\\n\\nimport (\\n\\t\\\"context\\\"\\n\\t\\\"sync\\\"\\n)\\n// Task 表示要执行的任务\\ntype Task struct {\\n\\tID      string\\n\\tPayload interface{}\\n}\\n\\n// TaskHandler 任务处理函数类型\\ntype TaskHandler func(ctx context.Context, task Task) error\\n\\n// Executor 执行器接口\\ntype Executor interface {\\n\\t// Submit 提交任务\\n\\tSubmit(ctx context.Context, task Task) error\\n\\n\\t// Start 启动执行器\\n\\tStart(ctx context.Context) error\\n\\n\\t// Stop 停止执行器\\n\\tStop(ctx context.Context) error\\n\\n\\t// IsRunning 检查是否在运行\\n\\tIsRunning() bool\\n\\n\\t// SetHandler 设置任务处理函数\\n\\tSetHandler(handler TaskHandler)\\n}\\n\\n// PoolExecutor 协程池执行器\\ntype PoolExecutor struct {\\n\\tworkerCount int\\n\\ttaskQueue   chan Task\\n\\trunning     bool\\n\\twg          sync.WaitGroup\\n\\tmu          sync.Mutex\\n\\thandler     TaskHandler // 任务处理函数\\n}\\n参考这个包的单例+协程池+channel任务设计 对下面的函数进行包的封装 调用下面这个方法是通过submit具体任务进行异步处理,可以设计一个结果channel,需要重新封装的函数: %s"
  },
  {
    "label": "结构体的Option设计模式",
    "alias": "option",
    "template": "你是一个Go语言代码生成专家。\\n请根据我提供的结构体定义，生成一个完整的Go示例，使用【Functional Options Pattern】构建该结构体。\\n\\n要求：\\n1. 使用可变参数options（Option func(*Struct) error）实现；\\n2. 提供默认配置函数（defaultStruct）；\\n3. 提供构造函数 NewXxx(opts ...Option)；\\n4. 提供必要的 WithXxx() option 函数；\\n5. 提供 Validate() 方法；\\n6. 在 main() 中生成两个示例；\\n7. 输出完整Go文件。\\n\\n输入结构体： %s"
  },
  {
    "label": "go变量脚本",
    "alias": "flag",
    "template": "需求： %s 要求: 使用flag包，把相关var参数支持flag绑定，并且提供默认值，支持直接运行，提高兼容性"
  },
  {
    "label": "mermaid图表",
    "alias": "mermaid",
    "template": "帮我生成mermaid图表代码,使用flowchart语法生成清晰的结构图, 你的任务是参考下面的文本 生成相关的mermaid图表文本 :  %s"
  },
  {
    "label": "dot格式",
    "alias": "dot",
    "template": "内容： %s ,要求 ： 编写代码根据代码输出，把相关设计数据结构之后，通过依赖相关的分析，转换成dot格式，支持Graphviz的文本输出"
  },
  {
    "label": "SQL抽取变量",
    "alias": "sql",
    "template": "内容:   %s 要求: 生成SQL语句 ,  每个SQL段使用====进行分割 对于查询条件 都是用@xxxxx变量来进行占位使用,减少硬编码,生成规范的sql语句文件"
  },
  {
    "label": "Mysql数据库设计",
    "alias": "mysql",
    "template": "内容: %s\\n  要求: 按照用户需要设计数据库，其中在用户的表当中有以下基本规范：\\n  建表语句自带drop if exists,如果有抽象类型 优先使用status字段,前期验证原型阶段,减少使用not null的约束字段\\n  为你便捷开发,你可以对业务数据使用json数据格式存储,整体的json来进行保存\\n  id              bigint auto_increment comment '主键ID',\\n  status         varchar(20), -- 时间维度上的状态\\n  type          varchar(20), -- 静态维度上的状态\\n  create_time     datetime default CURRENT_TIMESTAMP not null comment '创建时间',\\n  update_time     datetime default CURRENT_TIMESTAMP not null on update CURRENT_TIMESTAMP comment '更新时间'"
  },
  {
    "label": "运维bug的配置归档",
    "alias": "ops",
    "template": "我执行的关键步骤:  %s 要求:  按照我的步骤, 我已经修改了这个bug, 请结合python和相关python库,生成高可用的python脚本来进行下次遇到这种问题的恢复, 把相关的提示全部都放到python脚本的注释当中,使用python的文档注释指出这种bug的原理"
  },
  {
    "label": "maven多模块化",
    "alias": "maven",
    "template": "相关信息:  %s 要求: 按照Spring-maven多模块高可用进行分层,如果存在spring-bean相关的逻辑 并且对spring使用@ConditionalOnProperty进行配置,支持配置bean的开关,默认是注入开启状态,并且提供spring.factories相关的配置,让Spring容器能够扫描"
  },
  {
    "label": "spring",
    "alias": "spring",
    "template": "相关信息:  %s 要求: 我现在正在进行dao层单独的Iservice和service的分层,请在xxxService注入IxxxService，把当前Service和数据库查询语句构建的逻辑全部放到Iservice当中,使用private final IxxxService xxxService进行注入,保证逻辑的一致性,xxxService就不需要再使用接口,IxxxService使用mp标准的接口,输出完整的三个文件 IxxxService.java xxxServiceImpl.java 以及xxxService.java"
  },
  {
    "label": "go语言的显示单例模式",
    "alias": "singleton",
    "template": "用户输入:  %s 要求:指令：对上面的业务和逻辑进行代码的重构和分层模块化处理，采用以下设计模式：\\n\\n使用 单例模式（sync.Once） 实现全局唯一服务实例（如 GetInstance()）。\\n\\n使用 函数式可选参数（Option Pattern） 初始化配置（如 WithXxx()）。\\n\\n提供默认配置函数（defaultConfig()）。\\n\\n支持运行时 Reload() 方法以重新应用配置。\\n\\n保持结构清晰，注释完整，可扩展性强。\\n\\n输出要求：\\n\\n必须包含：Service 结构体、Config 结构体、Option 类型定义、GetInstance()、Reload()、defaultConfig()。\\n\\n逻辑完整可直接运行。补充: 1. getInstance使用log.Fatalf()进行错误处理,不需要返回error 2. 使用sync.Once进行单例模式调用 ,.3,提供一个service，把用户原始的结构体也进行封装,符合显式单例的设计模式"
  },
  {
    "label": "keyshort",
    "alias": "keyshort",
    "template": "你是一个快捷键数据生成助手。根据用户需求,产出符合以下规范的 TOML,用于导入到 ShortcutLibrary 组件(一个本地快捷键管理工具)。\n\n# === 格式规范 ===\n# - 每个 `[[groups]]` 表示一个应用分组(如 VSCode、Chrome)\n# - 每个 `[[groups.shortcuts]]` 是该分组下的一条快捷键\n# - 同一分组的快捷键条目必须紧跟在该 `[[groups]]` 之后,不能跨组穿插\n# - UTF-8 编码,使用中文说明时无需转义\n# - 文件大小不超过 1 MB\n\n# === 字段表 ===\n# [[groups]]        类型:表数组        必填:是  说明:每个分组一个 [[groups]]\n# name              类型:字符串        必填:是  说明:分组名称,如 \"VSCode\"、\"Chrome\"\n# [[groups.shortcuts]]  类型:嵌套表数组  必填:否  说明:分组下的快捷键条目\n# combo             类型:字符串        必填:是  说明:组合键,用 + 连接,如 \"Ctrl+R\"\n# desc              类型:字符串        必填:否  说明:这条快捷键做什么(中文/英文均可)\n# condition         类型:字符串        必填:否  说明:激活条件,纯备注,运行时不做检查。例:\"选中数字时\"、\"仅 macOS\"、\"编辑器内\"\n\n# === 修饰键写法(不区分左右) ===\n# Ctrl  Shift  Alt  ⌘(Meta/Command)\n\n# === 主键写法(大小写不敏感) ===\n# 字母: A-Z     数字: 0-9     功能键: F1-F12\n# 方向: ↑ ↓ ← →  符号: - = [ ] \\ ; ' , . / `\n# 特殊: Enter Esc Tab Space Backspace Delete\n\n# === 示例 1:基础分组 ===\n[[groups]]\nname = \"VSCode\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+R\"\ndesc = \"打开目录\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+Shift+P\"\ndesc = \"命令面板\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+P\"\ndesc = \"文件搜索\"\n\n# === 示例 2:多个分组 ===\n[[groups]]\nname = \"Chrome\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+T\"\ndesc = \"新建标签页\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+Shift+T\"\ndesc = \"恢复关闭标签页\"\n\n[[groups]]\nname = \"Slack\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+K\"\ndesc = \"快速切换频道\"\n\n# === 示例 3:带激活条件的快捷键(条件为备注,不参与运行时判断) ===\n[[groups]]\nname = \"Word\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+Shift+Digit1\"\ndesc = \"上标\"\ncondition = \"选中文本时\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+Shift+Digit2\"\ndesc = \"下标\"\ncondition = \"选中文本时\"\n\n[[groups.shortcuts]]\ncombo = \"Ctrl+Shift+L\"\ndesc = \"切换侧边栏\"\ncondition = \"仅 Windows/Linux\"\n\n# === 易错点(必须避免) ===\n# 1. combo 只写修饰键 → \"Ctrl+Shift\" 是非法,必须含主键\n# 2. 主键用全名 → 错:\"Control+R\";对:\"Ctrl+R\";符号主键错:\"Minus\";对:\"-\"\n# 3. 顺序不规范 → 修饰键在前,主键在末尾,例:\"Ctrl+Shift+P\" 而不是 \"P+Ctrl+Shift\"\n# 4. 出现未知字段 → 每个 [[groups.shortcuts]] 只允许 combo / desc / condition\n# 5. 缩进/引号混乱 → name 与 desc 一律用双引号包裹\n\n# === 输出要求 ===\n# - 只输出 TOML 文本,不要包裹在 markdown 代码块里(用户复制时不需要三个反引号 toml)\n# - 不要写解释、不要写前言,直接第一行就是 [[groups]]\n# - 不要使用 [[groups.shortcut]] 单数,必须是复数 shortcuts\n\n我需要的场景: \n%s"
  }
];
