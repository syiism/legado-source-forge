# Legado 书源 JS 规则调试器

零依赖、纯 Node CLI 的离线/联网调试器：从成品书源或 template 工程里取出**单个 JS 规则原子**（`@js:` / `<js>…</js>`），在带 Legado 同名绑定的沙箱里执行，输出日志、网络调用、变量变更与返回值。

- 不做选择器引擎（CSS/XPath/JSONPath 之外的 HTML 解析），不做五环节流水线。
- 默认真实联网；`--offline` / `--cassette` 可切到确定性回放。
- 与真机调试脚本互补：`scripts/legado-debug.py`（在原 `legado-work` 仓库）验证真机全链路，本工具验证单条 JS 规则。

## 快速开始

```bash
# 1. 取 searchUrl 的 JS 原子，产出带请求选项的 data: URI
node rule-debugger/bin/legado-debug.mjs --project ../legado-work/work/光遇聚合 \
     --rule searchUrl --key 斗破苍穹

# 2. 大 jsLib 工程（24 万字符）加载 + exploreUrl 求值
node rule-debugger/bin/legado-debug.mjs --project ../legado-work/work/stv \
     --rule exploreUrl --json --max-chars 500

# 3. 不联网：给 bookList 喂 hex 编码的 result，用 cassette 回放上游响应
node rule-debugger/bin/legado-debug.mjs --project ../legado-work/work/光遇聚合 \
     --rule search.bookList \
     --result @rule-debugger/test/fixtures/gy-search.hex \
     --cassette rule-debugger/test/fixtures/gy-search.cassette.json

# 4. 直接跑一段 JS，读上一步输出
node rule-debugger/bin/legado-debug.mjs --source ../legado-work/work/stv/dist/STV.json \
     --js "java.md5Encode('abc')" --json
```

> 上面用到的 `../legado-work` 是相邻的书源仓库（可选）。只想在本仓库内试跑时：

```bash
node rule-debugger/bin/legado-debug.mjs \
     --source rule-debugger/test/fixtures/mini-source.json \
     --rule searchUrl --key abc --offline --json
```

## CLI 契约

```
node rule-debugger/bin/legado-debug.mjs [--source <dist.json> | --project <dir>] \
     (--rule <field> ... | --js <code> | --js-file <f>) [options]
```

### 来源

| 参数 | 说明 |
|------|------|
| `--source <json>` | 成品书源；JSON 数组取首条 |
| `--project <dir>` | 调 `<dir>/build.mjs --out <tmp>` 构建后加载；构建失败原样透传（退出码 4） |

### 步骤与字段

`--rule` 可重复，按顺序串联，共享 jsLib / 变量 / 缓存 / cookie。第 N 步的 `result` 默认取第 N-1 步输出，可用 `--result` 覆盖。`--js` / `--js-file` 直接注入代码，同样参与串联。

字段写法：

| 写法 | 解析为 |
|------|--------|
| `searchUrl` / `exploreUrl` / `jsLib` … | 顶层字段 |
| `search.bookList` / `bookinfo.init` / `toc.chapterList` / `content.content` | `ruleSearch.bookList` 等 |
| `ruleSearch.bookList` | 全称 |
| `bookList` / `name` … | 默认 `ruleSearch.*` |

### 每步输入

写在某个 `--rule` / `--js` **之后**即为该步专属；写在第一个步骤之前则是全局默认。

| 参数 | 绑定 |
|------|------|
| `--result <text\|@file>` | `result`（上一步输出的文本；`data:…;base64,` 与 Legado 一致先解码，尾部 `,{...}` 选项忽略） |
| `--base-url <url>` | `baseUrl` |
| `--book <json\|@file>` | `book` 对象（普通 JS 对象 + `getVariable/putVariable`） |
| `--chapter <json\|@file>` | `chapter` |
| `--key <文本>` | `key` |
| `--page <n>` | `page` |
| `--var k=v` | 源变量（可重复） |
| `--login k=v` | 注入 `getLoginInfoMap()` / `infoMap` |

### 网络

| 参数 | 说明 |
|------|------|
| `--timeout <ms>` | curl `--max-time`，默认 15000 |
| `--ua <UA>` | 覆盖 User-Agent |
| `--charset <enc>` | 强制响应编码（`gbk`/`big5`/…） |
| `--offline` | 禁止真实请求；无 cassette 时抛 `OFFLINE` |
| `--cassette <f>` | 只回放（隐含 offline），未命中退出码 3 |
| `--record <f>` | 先回放已有条目，未命中则真实请求并写回 |
| `--cookie "k=v; …"` | 预置 cookie |
| `--cookie-jar <f>` | 读写 JSON cookie jar（运行时按域/路径回送） |

头合并优先级：`--ua` → 书源 `header`（JSON 字符串容错）→ 单次请求 headers；请求未显式带 `Cookie` 时自动叠加 cookie jar。

### 状态与输出

| 参数 | 说明 |
|------|------|
| `--state <f>` | 读入/写回源变量、登录信息、`put/get` map、磁盘缓存、内存缓存（普通 JSON）；默认不写，避免与 python 驱动共用文件互污 |
| `--no-save` | 不写 `--state`（cookie jar 文件仍会写回） |
| `--json` | 机器可读报告 |
| `--full` | 不截断（默认 2000 字符） |
| `--max-chars <n>` | 自定义截断长度 |
| `--quiet` | 隐藏 toast/longToast/noop 噪音 |
| `--show-secrets` | 关闭默认打码（`password/token/cookie/session/sid/secret/csrf`） |

退出码：`0` 成功，`1` 运行/JS 异常，`2` 用法错误，`3` cassette 未命中，`4` 构建失败。

## 运行时模型

- **两级作用域（对齐 Legado `SharedJsScope`）**：
  - 共享作用域 = vm 全局，只放 `Packages/console/print` 与 Rhino 风格的 `java`（`JavaPackage`，未知成员是包对象，调用即报错）。jsLib 加载在这里，加载期看不到 `java/source/result/...`。
  - 规则作用域 = 每步新建 `Object.create(globalThis)`，持有 `java/source/cache/cookie/book/chapter/key/page/baseUrl/result/src/title/infoMap/...`；原子代码在该作用域内用 `with` 执行，`this` 也指向它。
  - 因此 jsLib 函数里的自由 `java` 是 `JavaPackage`（真机同样如此），规则原子里的 `java` 才是 `JsExtensions`；jsLib 顶层函数被原子直接调用时会被包一层，令 `this` = 规则作用域（对齐 Rhino 的调用点作用域），jsLib 内部互相调用则 `this` = 共享作用域。
  - 无 `require/process/Buffer`。
- **jsLib 只加载一次**：顶层 `let/const/function` 跨步骤可见（`let/const` 是全局词法绑定，不是全局对象属性）。
- **每一步用 `eval` 包一层**：`(function(){ return eval(<code>) })()`，利用 completion value 模拟 Rhino「最后一条表达式即返回值」，同时把原子内的 `let/const` 限制在该步，避免多步重复声明冲突。
- 每步前重置 `result/baseUrl/key/page/book/chapter`；步骤之间共享 `source/cache/cookie`。
- 结果归一化：`null/undefined → ""`，数组 `join("")`，对象保留原值并在报告中给 JSON；字符串结果若形如 `<url>,{...}` 会额外识别出内嵌的 Legado 请求选项。
- `java.log/toast/longToast` 与 `console.*` 进入日志流（带步骤号与类型），`cache`/变量写入进 journal，报告里给前后 diff。
- 非 JS 规则：含 `{{expr}}` 则在沙箱内求值（可用 `key/page/book/chapter/baseUrl`）；纯 `$.a.b` 字段规则直接对 `result` 求值；其余原样展示。规则文本尾部的 `$.a[0]` 就地求值；`,{...}` 请求选项仅展示；CSS/正则后缀给警告并跳过。
- `loginUrl` / `jsLib` 即使没有 `@js:` 包装也按 JS 执行；`loginUi` 执行前会拼接 `loginUrl` 脚本（对齐 `BaseSource.getLoginJs`），因此 `loginUi` 可以调用 `loginUrl` 里定义的函数。

## 保真矩阵

与 Legado（Rhino 1.8 + Android）一致的部分：

- 规则原子语义：`@js:`、`<js>…</js>`、尾部 JSONPath / 请求选项、`{{}}` 模板；
- `java.ajax` 的同步语义、`url,{options}` 解析、GET/HEAD 丢弃 body、状态码 ≥400 仍返回；
- `source.getVariable()` 无参返回原始变量串、带参缺失返回 `""`；`putVariable(null)` 删除；
- `java.*` 加密/编码、`Packages.java.net.URLEncoder`、`android.util.Base64`；
- **Java Socket 桥**：`new Packages.java.net.URL(u).openConnection()` 走调试器自己的 HTTP 客户端（cassette/offline/cookie/超时全部生效），配套 `java.io.ByteArrayInputStream/ByteArrayOutputStream`、`java.util.zip.GZIPInputStream`、`getHeaderFields()` 迭代器。直接使用 `HttpURLConnection` 取流的书源因此可以离线或联网调试。

刻意不模拟（写规则时不要依赖）：

| 差异 | 说明 |
|------|------|
| Java String 包装 | 返回的 `result` 是 JS 字符串：`.length` 是数字而非方法引用，`.slice` 可用；Rhino 下常见的 `result.length()` 会报错，这里在错误里追加提示 |
| jsLib 里用宿主 `java` | 共享作用域的 `java` 是 `JavaPackage`（与设备一致）。想在 jsLib 里用 `java.*` 扩展，必须在规则原子入口注入并在 jsLib 内保存引用（例如 `sqUseHost(java, source)`），否则调用会报 `Cannot call property … in object [JavaPackage java]` |
| `this` 的近似 | jsLib 顶层函数被原子**直接调用**时 `this` = 规则作用域；jsLib 函数之间互相调用时 `this` = 共享作用域。用 `const/let` 定义的函数无法被包装，原子直接调用时 `this` 落在共享作用域（函数声明与 `var f = function` 不受影响） |
| `console` / `print` | 调试器额外提供（设备 Rhino 的 SharedJsScope 里没有），方便打印 |
| 隐式全局 | jsLib 里未声明就赋值的新全局在设备上会因 `preventExtensions()` 失败，调试器不会拦截 |
| 数值/相等 | 不模拟 Java `int` 溢出与 Rhino `==` 隐式转换 |
| 并发 | 不模拟多线程共享 jsLib 全局的竞态 |
| WebView / 字体 / 压缩包 / 下载 | `webView*`、`startBrowserAwait`、字体、`unzipFile`、`downloadFile` 抛 `UnsupportedApiError`；`startBrowser`/`startBrowserDp`/`openVideoPlayer` 记录型 no-op（警告一次，规则可继续返回正文 URL）；`getVerificationCode` 返空串并警告一次 |
| `htmlFormat` / `t2s` / `s2t` | 透传原值 + 警告一次 |
| 选择器 | CSS/XPath、HTML 抽取不实现；正则后缀不应用 |
| 请求选项 `retry` / `timeout` | 只解析不执行：网络层固定用 `--timeout`，不做自动重试 |

### java.* 支持

- 真实实现：`md5Encode/md5Encode16`、`base64Encode/base64Decode/base64DecodeToByteArray`、`hexEncodeToString/hexDecodeToString/hexDecodeToByteArray`、`digestHex/digestBase64Str`、`HMacHex/HMacBase64`、`createSymmetricCrypto`、`createAsymmetricCrypto`、`encodeURI`、`strToBytes/bytesToStr`（UTF-8）、`timeFormat/timeFormatUTC`、`randomUUID`、`androidId`（固定假值）、`toURL`。
- 记录型 no-op：`toast/longToast/log/refreshExplore/reLoginView/upLoginData/refreshJSLib/refreshContent/showBrowser/showReadingBrowser/open/openUrl/setContent`。
- `ajax/get/head/post/connect` 返回 `{body(), code(), headers(), url(), toString()}`；`ajax` 失败时返回错误文本（与 Legado 返回堆栈字符串一致），但 `OFFLINE` / `CASSETTE_MISS` 会抛出以中断调试。
- `Packages.*`：`java.lang`（String/StringBuilder/Integer/Long/Thread/System）、`java.net`（URLEncoder + URL.openConnection → 调试器 HTTP 客户端）、`java.io`（ByteArray 流）、`java.util`（Base64/UUID/Arrays/HashMap/zip.GZIPInputStream）、`java.security`（MessageDigest/SecureRandom）、`java.nio.charset.StandardCharsets`、`android.util.Base64`、`javax.crypto.Cipher` + `SecretKeySpec/IvParameterSpec/GCMParameterSpec`。

### 加密对照（`help/JsEncodeUtils.kt` 语义）

| API | 行为 |
|-----|------|
| `md5Encode` | 小写 32 位 hex |
| `md5Encode16` | 32 位 hex 的 `[8, 24)` |
| `base64Encode/Decode` | 标准 Base64；解码返回字符串，`…ToByteArray` 返回有符号字节 |
| `hexEncodeToString/hexDecodeToString` | UTF-8 ↔ hex |
| `digestHex(data, alg='md5')` | md5/sha1/sha256/sha384/sha512/sha3-256/sha3-512；`md5_16` 走截断 |
| `digestBase64Str` | 同上，Base64 输出 |
| `HMacHex/HMacBase64(alg, key, data)` | 默认 `HmacSHA256` |
| `createSymmetricCrypto(t, key, iv)` | AES/DES/3DES × ECB/CBC/CFB/OFB/CTR/GCM；`NoPadding` → `setAutoPadding(false)`；DES 在 OpenSSL 3 下用「三组相同密钥的 3DES」等价实现 |
| `createAsymmetricCrypto(t, pub, priv)` | RSA 加密/解密，支持 `…/NoPadding` |
| `createSign` | 未实现，调用即抛错 |

已知细节：`decryptStr` 按 Base64 输入处理（Hutool 会自动识别 Hex/Base64，这里只覆盖常见用法）；`createSymmetricCrypto` 不支持 `key=null`（随机密钥）。

## 网络与 cassette

- 请求由 `spawnSync('curl', …)` 同步执行：`-L --max-redirs 5 --compressed -D <headers> -w <code|url>`；非 ASCII URL 先 `encodeURI`（OkHttp 行为）。找不到 curl 时提示改用 `--offline`。
- 编码优先级：`--charset` > `Content-Type charset` > `<meta charset>` 嗅探 > `utf-8`；用 `TextDecoder`（Node 全 ICU，支持 gbk/big5），去 BOM。
- cookie jar 在内存中按 host/path 匹配；`Set-Cookie` 的 `Max-Age=0`/过期时间会删除；重定向各跳的 `Set-Cookie` 都接收。
- Cassette v1：

```json
{ "v": 1, "entries": [
  { "key": "<sha256>", "method": "GET", "url": "…", "status": 200,
    "headers": { "content-type": "…" }, "finalUrl": "…",
    "setCookie": ["…"], "body": "…" }
] }
```

`key = sha256(method + "\n" + url + "\n" + sha256(body))`。响应体超过 256 KB 的外置到 `<cassette>.d/<key>.txt`（条目改记 `bodyFile`）。未命中时会列出 3 条 URL 前缀最近的键；两次回放除耗时外逐字节一致。

## 调试注意事项

- **`Cannot call property … in object [JavaPackage java]`**：jsLib 里的 `java` 是 Rhino `JavaPackage`，不是规则层的 `java.*` 扩展。在规则原子入口把宿主注入 jsLib（如 `sqUseHost(java, source)` 保存引用），再由 jsLib 内部使用；直接在 jsLib 里写 `java.ajax/md5Encode/...` 在真机同样会失败。
- **字段规则要各自喂同一份 book JSON**：`bookinfo.name` 这类规则用 `$.name` 求值，`result` 应是详情数据。多步串联时第 N 步拿到的是第 N-1 步的**字符串输出**，所以 `init → name → author` 不会按预期工作；要么每一步都写 `--result @detail.json`，要么只跑一个 `<js>` 原子一次性取全字段。
- **HTTP 200 + 空体是上游风控，不是调试器吞了响应**：部分接口在特定出口 IP 上无论签名与否都返回 0 字节（`curl` 直连同样如此）。报告里的 `net[].bytes=0` 即此情形，和真机可能不一致，需换网络或上真机复核。
- **cassette 按完整 URL 精确匹配**：URL 里带 `_rticket` / 毫秒时间戳等易变参数时，回放会未命中。先用 `--record` 在同一时刻录制并回放，或改用 `--result @fixture` 直接喂已保存的响应体。
- **`--var` / `--state` 与 `source.getVariable()` 已打通**：按 key 写入的值会同步回整串源变量 JSON，规则里 `JSON.parse(source.getVariable())` 能立即看到。
- 请求选项允许未加引号的键（`{method:"POST"}`），对齐 Legado 的 GSON 宽松解析。

## 测试

```bash
node --test rule-debugger/test/*.test.mjs
```

Node 24 的 `node --test <dir>` 会把目录当 glob 命中再当文件执行，需用上面的通配写法。覆盖：规则提取/后缀矩阵、jsLib 跨步可见与 completion value、日志与 Rhino 提示、cassette 回放确定性、offline/未命中、cookie jar、GBK 解码、md5/base64/HMAC/NIST AES 向量、RSA 往返、Packages Java 桥（URL/流/gzip/头迭代器）、源变量 raw 同步、CLI 退出码 0/1/2/3/4。

## 安全提示

- `vm` 不是安全边界，且 `java.getFile/readFile` 能读本地文件：**只运行可信书源**，不要拿它跑来路不明的规则。
- `--show-secrets` 关闭后，报告里的 `password/token/cookie/session/sid/secret/csrf` 值会被打码；但 cassette、`--state`、cookie jar 文件本身仍可能含明文凭据，提交前自行清理。
- 默认不写 `--state`；需要与真机驱动（原 `scripts/legado-debug.py`）共用状态时再显式指定。

## 本次不做

HTML/CSS/XPath 选择器引擎、五环节流水线、WebView/浏览器登录、`--watch`、Web UI。后续可在本 runtime 上叠加选择器引擎，实现「选中一条搜索结果直接跑详情/目录/正文」。
