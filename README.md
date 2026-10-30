# Legado 书源工坊（legado-source-forge）

写源、修源用的两个独立工具，零 npm 依赖，只要求 Node.js：

| 目录 | 作用 | 入口 |
|------|------|------|
| [`template/`](template/README.md) | 书源工程骨架：一个字段一个文件，`build` / `unbuild` 双向逐字节回环 | `node build.mjs` |
| [`rule-debugger/`](rule-debugger/README.md) | JS 规则原子调试器：Legado 同名绑定 + 沙箱 + 真网/离线 cassette | `node rule-debugger/bin/legado-debug.mjs` |

典型工作流：

```
成品书源 ──unbuild──▶ template 工程 ──build──▶ 成品书源
                          │
                          └── rule-debugger 调单条 JS 规则 ──▶ 真机全链路（原 legado-work 仓库的 scripts/legado-debug.py）
```

`rule-debugger` 的 `--project` 直接消费 template 骨架：它调用工程的 `build.mjs --out <tmp>`，不污染工程目录。

## 快速开始

```bash
# 1. 从模板起一个新工程
cp -r template ../我的书源
cd ../我的书源
node build.mjs                       # → dist/<bookSourceName>.json

# 2. 用自带 fixture 离线试跑调试器
cd ../legado-source-forge
node rule-debugger/bin/legado-debug.mjs \
     --source rule-debugger/test/fixtures/mini-source.json \
     --rule searchUrl --key abc --offline --json

# 3. 调已有工程（示例假设相邻目录有 legado-work）
node rule-debugger/bin/legado-debug.mjs \
     --project ../legado-work/work/stv --rule exploreUrl
```

## 环境

- Node.js 20.11+（测试用到 `import.meta.dirname`；Node 24 已实测）。
- 调试器联网依赖系统 `curl`；`--offline` / `--cassette` 不需要。
- 测试：`node --test rule-debugger/test/*.test.mjs`（Node 24 的 `node --test <dir>` 会把目录当文件执行，需用通配）。

## 边界

- 当前只覆盖「单条 JS 规则原子」：HTML/CSS/XPath 选择器引擎、五环节流水线、WebView 登录、Web UI 尚未提供。
- 选择器规则会原样展示并提示跳过；`,{...}` 请求选项只识别不应用。
- `template` 不内置任何站点签名或凭据。

## 未完成的工作（规则解析与调试）

当前只覆盖单条 JS 原子；以下按「解析 → 流程 → 机制 → 体验」列出缺口，越靠前的越适合先做：

### 规则解析

| 能力 | 现状 | 待做 |
|------|------|------|
| CSS / Jsoup | 原样展示 + 警告 | `选择器@提取类型`、AND/OR 组合、`!` 排除、`@text/@href/@html/@ownText` |
| XPath | 原样展示 + 警告 | `@XPath:` 规则与 `//`/`/` 表达式 |
| 正则 | 警告并跳过 | `##正则##替换`、`@` 正则后缀 |
| JSONPath | 仅 `$.a.b` / `[n]` / `[*]` | 递归 `..`、切片 `[a:b]`、过滤 `[?()]`、`$..*` |

### 流程调试

| 能力 | 现状 | 待做 |
|------|------|------|
| 五环节串联 | 只能手动 `--rule` 逐步跑 | `searchUrl → bookList → bookinfo → toc → content` 自动流转，`book/chapter` 上下文贯通 |
| 字段规则喂参 | 每步手动 `--result` | 选中一条搜索结果后自动作为下一步的 book 输入 |
| 发现页 | 只跑 `exploreUrl` 单步 | 解析分类行 → 跑对应 `bookList`，处理分页与多行聚合 |
| `bookUrl/tocUrl` 链路 | 不解引用 | 搜索结果自动进入详情/目录，支持 `nextContentUrl` 等翻页规则 |
| 登录链路 | 只执行 `loginUrl` / `loginUi` 单段 | `loginCheckJs` 触发、`getVerificationCode`、登录态在后续请求中回放 |

### 未完成的机制

| 机制 | 现状 | 缺口 |
|------|------|------|
| 规则级请求选项 | 只识别不应用 | 请求构造仍是 URL + 全局参数；`method/body/headers/charset/retry` 尚未进入规则流水线 |
| 选择器求值 | 无 HTML 解析器 | CSS/XPath/正则无法求值，`java.getString/getStringList/getStrRule` 只能占位 |
| 五环节上下文 | 每步手动 `--rule` | `book/chapter/result` 不自动流转，字段规则需手动 `--result`；`bookUrl/tocUrl` 不解引用 |
| 登录检查 | 只执行 `loginUrl` / `loginUi` | `loginCheckJs` 不触发，验证码与 WebView cookie 无回传 |
| WebView / 浏览器 | `startBrowser` 记录型 no-op，`startBrowserAwait` 抛错 | 页面等待、JS 注入、cookie 回传、返回值缺失 |
| 网络栈 | 同步 `curl` | 无 Cronet/TLS 指纹与代理；请求选项 `retry/timeout` 不生效 |
| Cookie | 内存 jar + 显式文件 | 无 public suffix / 域名策略细化，跨运行依赖 `--cookie-jar` |
| 缓存 / 变量 | 内存 TTL；raw 与 key 已同步 | 无磁盘缓存；默认不写 `--state`，跨进程与 python 驱动共享需显式指定 |
| Rhino 保真 | 已知差异见调试器 README | Java String 方法语义、`int` 溢出、`==` 隐式转换、跨线程 jsLib 竞态 |
| cassette | 完整 URL 精确匹配 | 无易变参数归一化（`_rticket`、时间戳），签名 URL 易未命中 |
| WebJs / 定时回调 | 不执行 | WebView 内的 `webJs` 轮询、`setTimeout` / Promise 链无法复现 |
| 字体 / 压缩 / 下载 | 抛错或透传 | 字体反爬、`unzipFile`、`downloadFile`、`cacheFile` |

### 调试体验

- 选择器引擎就绪后，可「选中一条搜索结果 → 直接跑详情/目录/正文」。
- `--watch` 规则热重载、断点/单步、变量快照对比。
- 与 `scripts/legado-debug.py` 共用状态的显式开关（当前默认不写，避免互相污染）。
- 编辑器集成（VSCode 任务/诊断）暂不在计划内。

## 安全

- 调试器的 `vm` 不是安全边界，且 `java.getFile` 能读本地文件：**只运行可信书源**。
- cassette、`--state`、cookie jar 可能含明文凭据；提交或分享前自行清理。
- 报告默认对 `password/token/cookie/session/sid/secret/csrf` 打码，`--show-secrets` 才会显示原值。

## 来源

`template/` 与 `rule-debugger/` 从 `legado-work` 仓库拆分而来；知识库与真实书源工程仍留在原仓库，本仓库只收录这两个可复用工具。

## 许可

[MIT](LICENSE) © 2026 syiism
