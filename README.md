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

- 不提供 HTML/CSS/XPath 选择器引擎、五环节流水线、WebView 登录、Web UI。
- `rule-debugger` 只负责 JS 原子；选择器规则会原样展示并提示跳过。
- `template` 不内置任何站点签名或凭据。

## 安全

- 调试器的 `vm` 不是安全边界，且 `java.getFile` 能读本地文件：**只运行可信书源**。
- cassette、`--state`、cookie jar 可能含明文凭据；提交或分享前自行清理。
- 报告默认对 `password/token/cookie/session/sid/secret/csrf` 打码，`--show-secrets` 才会显示原值。

## 来源

`template/` 与 `rule-debugger/` 从 `legado-work` 仓库拆分而来；知识库与真实书源工程仍留在原仓库，本仓库只收录这两个可复用工具。

## 许可

[MIT](LICENSE) © 2026 syiism
