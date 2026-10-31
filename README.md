# Legado 书源工坊（legado-source-forge）

写源、修源用的两个独立工具，零 npm 依赖，只要求 Node.js：

| 目录 | 作用 | 入口 |
|------|------|------|
| [`template/`](template/README.md) | 书源工程骨架：一个字段一个文件，`build` / `unbuild` 双向逐字节回环 | `node build.mjs` |
| [`rule-debugger/`](rule-debugger/README.md) | 规则调试器：Legado 同名绑定 + 沙箱 + 真网/离线 cassette，支持单条规则与五环节自动流转 | `node rule-debugger/bin/legado-debug.mjs` |

典型工作流：

```
成品书源 ──unbuild──▶ template 工程 ──build──▶ 成品书源
                          │
                          └── rule-debugger 调单条规则 / 单步 URL ──▶ 真机全链路（原 legado-work 仓库的 scripts/legado-debug.py）
```

`rule-debugger` 的 `--project` 直接消费 template 骨架：它调用工程的 `build.mjs --out <tmp>`，不污染工程目录。含 `{{}}` 占位符的 `@js` 规则若被语法门禁拦截，会自动改用 `--no-gate` 重试，并在报告 `build.warnings` 里注明。

近期已补齐（详见 [`rule-debugger/README.md`](rule-debugger/README.md)）：

- `@js` 代码内的 `{{$.id}}`、模板内的规则/JS 双分支求值，`@put` / `@get:` 动作；
- JSON result 下的裸字段 JSONPath（`data.books`、`title`、`book.author`）与 `##正则##替换`；
- `java.get(key)` / `java.get(url, headers)` 重载，新增 `java.getString/getStringList`；
- `--follow`：把规则返回的 `url,{options}` 按 `bookSourceUrl/baseUrl` 解析并发请求，响应体进入下一步；
- `--flow`：自动串联搜索 → 详情 → 目录 → 正文，默认第 1 本搜索结果、第 1 章，可用 `--book-index` / `--chapter-index` 选择；
- data URI 本地解析、`{"type":...}` 返回 hex、重定向链内 `Set-Cookie` 立即生效。

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

# 4. URL 规则跟进（相对 URL 用 bookSourceUrl 解析）
node rule-debugger/bin/legado-debug.mjs \
     --project ../legado-work/work/光遇聚合 \
     --rule searchUrl --follow --key 斗破苍穹 --rule bookList

# 5. 五环节自动流转（默认第 1 本、第 1 章）
node rule-debugger/bin/legado-debug.mjs \
     --project ../legado-work/work/光遇聚合 \
     --key 斗破苍穹 --flow --book-index 0 --chapter-index 0
```

## 环境

- Node.js 20.11+（测试用到 `import.meta.dirname`；Node 24 已实测）。
- 调试器联网依赖系统 `curl`；`--offline` / `--cassette` 不需要。
- 测试：`node --test rule-debugger/test/*.test.mjs`（Node 24 的 `node --test <dir>` 会把目录当文件执行，需用通配）。

## 边界

- 覆盖「单条规则 + 单步 URL 跟进 + 搜索→详情→目录→正文自动流转」；HTML/CSS/XPath 选择器引擎、发现页/登录/翻页流水线、WebView、Web UI 尚未提供。
- 选择器规则会原样展示并提示跳过；JSON result 的裸字段按 JSONPath 求值，`##正则##替换` 对 JSON/JS 结果生效。
- `url,{...}` 请求选项在加 `--follow` 时按 `method/body/headers/charset/type` 应用；`retry/timeout` 仍不进入网络层。
- `template` 不内置任何站点签名或凭据。

## 未完成的工作（规则解析与调试）

当前覆盖单条规则、单步 URL 跟进、五环节自动流转与常用运行时绑定；以下按「解析 → 流程 → 机制 → 体验」列出缺口，越靠前的越适合先做：

### 规则解析

| 能力 | 现状 | 待做 |
|------|------|------|
| CSS / Jsoup | 原样展示 + 警告 | `选择器@提取类型`、AND/OR 组合、`!` 排除、`@text/@href/@html/@ownText` |
| XPath | 原样展示 + 警告 | `@XPath:` 规则与 `//`/`/` 表达式 |
| 正则 | JSON/JS 结果执行 `##正则##替换` | HTML 选择器上的正则、`@` 正则后缀 |
| JSONPath | `$.a.b` / 裸 `a.b` / `[n]` / `[*]` | 递归 `..`、切片 `[a:b]`、过滤 `[?()]`、`$..*` |
| 内嵌规则 | `{{}}` 规则/JS 双分支求值；`@put`、`@get:` 生效 | 嵌套复杂表达式、`@get:` 之外的规则参数 |
| 脚本 API | `java.getString/getStringList`（JSONPath + `##`） | `java.getStrRule`、CSS/XPath 求值 |

### 流程调试

| 能力 | 现状 | 待做 |
|------|------|------|
| 五环节串联 | `--flow` 自动跑 `searchUrl → bookList → bookinfo → toc → content`，`book/chapter` 上下文贯通 | 发现页、登录、翻页、`reverseToc` 排序 |
| 字段规则喂参 | `--flow` 自动把选中书/章喂给字段规则；单步模式仍可手动 `--result` | 搜索结果全部字段的完整 SearchBook 语义（`checkKeyWord` 过滤等） |
| 发现页 | 只跑 `exploreUrl` 单步 | 解析分类行 → 跑对应 `bookList`，处理分页与多行聚合 |
| `bookUrl/tocUrl` 链路 | `--flow` 自动解引用；`--follow` 可单步跟进 | `nextTocUrl` 多页目录、`nextContentUrl` 正文翻页 |
| 登录链路 | 只执行 `loginUrl` / `loginUi` 单段 | `loginCheckJs` 触发、`getVerificationCode`、登录态在后续请求中回放 |

### 未完成的机制

| 机制 | 现状 | 缺口 |
|------|------|------|
| 规则级请求选项 | `--follow` 应用 `method/body/headers/charset/type` | `retry/timeout` 仍未进入网络层 |
| 选择器求值 | `java.getString/getStringList` 支持 JSONPath + `##` 正则 | CSS/XPath/HTML 抽取与 `java.getStrRule` 仍缺失 |
| 五环节上下文 | `--flow` 自动选书/章并贯通 `book/chapter`；`--follow` 跟进单条 URL | 一次只跑选中的一本/一章，不批量迭代列表；不做 `reverseToc` 排序 |
| 登录检查 | 只执行 `loginUrl` / `loginUi` | `loginCheckJs` 不触发，验证码与 WebView cookie 无回传 |
| WebView / 浏览器 | `startBrowser` 记录型 no-op，`startBrowserAwait` 抛错 | 页面等待、JS 注入、cookie 回传、返回值缺失 |
| 网络栈 | 同步 `curl`；data URI 本地解析，`type` → hex | 无 Cronet/TLS 指纹与代理；`retry/timeout` 不生效 |
| Cookie | 内存 jar + 显式文件；重定向链内 `Set-Cookie` 已回填 | 无 public suffix / 域名策略细化，跨运行依赖 `--cookie-jar` |
| 缓存 / 变量 | 内存 TTL；raw 与 key 已同步 | 无磁盘缓存；默认不写 `--state`，跨进程与 python 驱动共享需显式指定 |
| Rhino 保真 | 已知差异见调试器 README | Java String 方法语义、`int` 溢出、`==` 隐式转换、跨线程 jsLib 竞态 |
| cassette | 完整 URL 精确匹配 | 无易变参数归一化（`_rticket`、时间戳），签名 URL 易未命中 |
| WebJs / 定时回调 | 不执行 | WebView 内的 `webJs` 轮询、`setTimeout` / Promise 链无法复现 |
| 字体 / 压缩 / 下载 | 抛错或透传 | 字体反爬、`unzipFile`、`downloadFile`、`cacheFile` |

### 调试体验

- `--flow` 已支持「选中一条搜索结果 → 直接跑详情/目录/正文」；选择器引擎就绪后可支持 HTML 站点的列表/字段抽取。
- `--watch` 规则热重载、断点/单步、变量快照对比。
- 与 `scripts/legado-debug.py` 共用状态的显式开关（当前默认不写，避免互相污染）。
- 编辑器集成（VSCode 任务/诊断）暂不在计划内。

## 安全

- 调试器的 `vm` 不是安全边界，且 `java.getFile` 能读本地文件：**只运行可信书源**。
- cassette、`--state`、cookie jar 可能含明文凭据；提交或分享前自行清理。
- 报告默认对 `password/token/cookie/session/sid/secret/csrf` 打码，`--show-secrets` 才会显示原值。

## 来源

`template/` 与 `rule-debugger/` 从 `legado-work` 仓库拆分而来，现为独立仓库；知识库与真实书源工程仍留在该独立仓库，本仓库只收录可复用工具与少量示例工程。按行切块的实现约定见 `template/README.md` 文首。

## 许可

[MIT](LICENSE) © 2026 syiism
