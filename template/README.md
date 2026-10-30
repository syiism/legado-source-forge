# 书源工程模板（template）

通用的 Legado 书源工程骨架：`src/` 按「一个字段一个文件」组织，`build.mjs` 装配成可导入的书源 JSON，`unbuild.mjs` 可把成品书源反向拆回骨架。

- 从零写源：先改 `src/meta.json` 与各规则字段，再 `node build.mjs`。
- 已有书源：`node unbuild.mjs <书源.json> --verify`，拆完立即回环比对。
- 字段表对齐官方实体全集：`SearchRule` / `ExploreRule` / `BookInfoRule` / `TocRule` / `ContentRule` / `ReviewRule`（依据官方实体源码 `raw/legado-E/entities/rule/*.kt` 与「阅读书源规则查询知识库」的字段表）。

本目录不做行号级拆分（不绑定某一份原件）；需要「逐字节还原某成品 + 大段 body 按行切块」的工程，参见原 `legado-work` 仓库的「红果短剧漫剧」工程。

## 一、快速开始

```bash
cp -r template ../我的书源
cd ../我的书源

# 1. 改元数据
$EDITOR src/meta.json

# 2. 写规则（示例）
#    src/rules/search/index.mjs          → export const bookList = "$.data[*]";
#    src/rules/search/bookList.js        → 需要长 JS 时再建，写 @js 裸代码
#    src/rules/toc/chapterList.js        → 或继续用 index.mjs 里的选择器
#    src/shell/searchUrl.js              → 完整字段值：裸 URL 或 "@js:\n…"
#    src/shell/loginUi.js                → 登录界面 JS：末尾 JSON.stringify(res)

# 3. 装配 + 语法门禁
node build.mjs
# → dist/我的书源.json（文件名为 bookSourceName）

# 4. 可选：从成品书源反向拆解
node unbuild.mjs path/to/bookSource.json --verify
```

`node scaffold.mjs` 可随时补齐缺失的骨架文件（只创建、不覆盖已有内容）。

## 二、目录结构

```
template/
├── layout.mjs        # 单一真源：规范键序 / 六组完整字段 / 缺省约定 / 顶层代码文件表
├── build.mjs         # src → dist（跳过未启用字段 + 语法门禁 + --verify / --out / --no-gate）
├── unbuild.mjs       # 成品 → src（包装形态记 wrappers.json，输出格式记 build.json）
├── scaffold.mjs      # 补齐缺失骨架，不覆盖
├── src/
│   ├── meta.json     # 普通元字段（null = 不输出）
│   ├── build.json    # 输出格式：file / indent / newline / topOrder / ruleOrder
│   ├── jslib.js      # jsLib 裸代码（整体一个文件）
│   ├── wrappers.json # 包装模式清单（unbuild 生成；从零写源可保持 {}）
│   ├── optional/     # coverDecodeJs.js / loginCheckJs.js（顶层纯 JS）
│   ├── shell/        # searchUrl.js / exploreUrl.js / loginUrl.js / loginUi.js
│   │                 # + comment.txt（bookSourceComment）/ header.js（header）
│   └── rules/
│       ├── search/   #   index.mjs（需要长 JS 时再建 bookList.js）
│       ├── explore/  #   index.mjs（需要长 JS 时再建 bookList.js）
│       ├── bookinfo/ #   index.mjs（需要长 JS 时再建 init.js）
│       ├── toc/      #   index.mjs + formatJs.js preUpdateJs.js（chapterList 可按需建 .js）
│       ├── content/  #   index.mjs + callBackJs.js webJs.js imageDecode.js（content 可按需建 .js）
│       └── review/   #   仅 index.mjs
└── dist/             # 产物
```

## 二·补、输出格式（src/build.json）

Legado 导出通常是「字母序 + 2 空格缩进 + 末尾换行」，模板以此为默认；真实成品常不守规范，`unbuild` 会把差异写进 `src/build.json`：

| 键 | 含义 | 缺省 |
|---|---|---|
| `file` | 输出路径（相对工程根） | `dist/<bookSourceName>.json` |
| `indent` | JSON 缩进空格数 | `2` |
| `newline` | 末尾是否补换行 | `true` |
| `topOrder` | 顶层键序（非字母序时记录完整数组） | `layout.TOP_KEYS` |
| `ruleOrder` | 单个规则对象的字段序（非字母序时按键记录） | 各组规范字段序 |

例：fq-hg-mini 的 `{"indent":1,"newline":false,"topOrder":[…],"ruleOrder":{"ruleBookInfo":[…]},…}`；fanq-max 只记 `{"newline":false,"file":"dist/番茄maxv1.8.json"}`。`unbuild` 只在值偏离缺省时写键，`build` 校验顶层键序与 `topOrder` 完全一致。

`bookSourceComment` / `header` 是长文本，落 `src/shell/comment.txt` / `src/shell/header.js`（保存**完整字段值**，`@js:` 前缀原样保留）；文件缺失时回退 `meta.json` 同名字段。

## 三、字段落盘约定

| 类型 | 位置 | 内容 |
|---|---|---|
| 纯代码字段（`callBackJs` / `webJs` / `imageDecode` / `formatJs` / `preUpdateJs`） | `<组>/<字段>.js` | **裸代码**，无包装、无模板字符串，可直接 `node --check` |
| 双形态字段（`bookList` / `chapterList` / `init` / `content`） | `<字段>.js` **或** `index.mjs` | 写了 `.js` 就按 `@js` 裸代码装配；否则取 `index.mjs` 里的完整规则文本（选择器 / JSONPath / 手写 `@js:`、`<js>` 串） |
| 字符串字段（选择器 / JSONPath / URL） | `<组>/index.mjs` | `export const x = "…";`，保存**完整规则文本**（也可直接写 `"@js:\n…"`） |
| 顶层 URL / 登录壳 | `src/shell/*` | **完整字段值**：裸 URL、`@js:` 体、`loginUrl` 函数库都原样写 |
| `bookSourceComment` / `header` | `src/shell/comment.txt` / `src/shell/header.js` | **完整字段值**（header 常带 `@js:` 前缀，原样保留） |
| `loginUi` | `src/shell/loginUi.js` | **`@js:` 体**，末尾返回 `JSON.stringify(res)`（syiism 范式）；固定 JSON 也在这里返回 |
| 顶层纯 JS | `src/optional/*.js` | 裸代码 |

未启用：

- 字符串字段：`null`。
- 代码字段：文件内容为 `// 未启用：替换本行后参与构建`。
- 空文件同样视为未启用。
- build **不写空串、不写 null 键**；规则对象整组全空时省略（`ruleSearch` / `ruleToc` / `ruleContent` 例外，会输出 `{}` 占位）。

`src/wrappers.json` 只记录**规则代码原子**的实际包装（`@js:` / `<js>…</js>` + 尾部选择器），例如：

```json
{
  "ruleSearch.bookList": { "mode": "js", "lead": "<js>\n", "suffix": "ul li" },
  "ruleContent.content": { "mode": "@js", "lead": "@js:\n" }
}
```

从零写源时保持 `{}` 即可：`.js` 原子默认按 `@js` 装配；纯 JS 字段按其本性输出裸代码。URL / 登录壳直接写完整值，不经过 wrappers（`loginUi` 的 `@js:` / `<js>` 形态由 wrappers 记录）。

`loginUi` 只写一个 `src/shell/loginUi.js`（build 自动加 `@js:` 前缀）：

```js
// src/shell/loginUi.js
let res = [];
res.push({ name: '账号', type: 'text', action: '' });
res.push({ name: '密码', type: 'text', action: '' });
res.push({ name: '登录', type: 'button', action: 'login()' });
JSON.stringify(res);
```

固定 JSON 不需要额外文件，直接在 JS 里返回：`JSON.stringify([{ name: '账号', type: 'text', action: '' }]);`。`action` 填 `loginUrl` 中已定义的函数名；文件为空或只有注释时视为未启用。

## 四、完整规则字段表

| 规则对象 | 字段（`·js` = 纯代码原子；`·js?` = 双形态，.js 优先否则取 index.mjs） |
|---|---|
| `ruleSearch` | `bookList·js?` `name` `author` `intro` `kind` `lastChapter` `updateTime` `bookUrl` `coverUrl` `wordCount` `checkKeyWord` |
| `ruleExplore` | `bookList·js?` `name` `author` `intro` `kind` `lastChapter` `updateTime` `bookUrl` `coverUrl` `wordCount` |
| `ruleBookInfo` | `init·js?` `name` `author` `intro·js?` `kind` `lastChapter` `updateTime` `coverUrl` `tocUrl` `wordCount` `canReName` `downloadUrls` |
| `ruleToc` | `chapterList·js?` `chapterName` `chapterUrl` `nextTocUrl` `isVolume` `isVip` `isPay` `updateTime` `preUpdateJs·js` `formatJs·js` |
| `ruleContent` | `content·js?` `title` `subContent` `nextContentUrl` `webJs·js` `sourceRegex` `replaceRegex` `imageStyle` `imageDecode·js` `payAction` `callBackJs·js` |
| `ruleReview` | `reviewUrl` `avatarRule` `contentRule` `postTimeRule` `reviewQuoteUrl` `voteUpUrl` `voteDownUrl` `postReviewUrl` `postQuoteUrl` `deleteUrl` |

顶层另有 `coverDecodeJs` / `loginCheckJs` 两个纯 JS 字段（`src/optional/`）。

## 五、构建与校验

```bash
node scaffold.mjs                  # 补齐缺失骨架
node build.mjs                     # 装配 dist/<bookSourceName>.json（或 build.json.file）
node build.mjs --out out.json      # 指定输出
node build.mjs --verify ref.json   # 与目标逐字节比对
node build.mjs --no-gate           # 跳过语法门禁（仅用于复现带语法错误的原始成品）
node unbuild.mjs src.json          # 反向拆解
node unbuild.mjs src.json --verify # 拆完立即回环
```

门禁：

1. **语法**：jsLib、顶层纯 JS、登录壳代码、全部已启用规则代码体逐个 `new Function` 编译（不执行）；`loginUi.js` 同样编译；`loginUrl` 为裸 URL 时跳过。裸选择器字段不编译。
2. **包装**：`@js:` / `<js>…</js>` / 裸值三种形态由 `wrappers.json` + layout 默认值复原。
3. **键序**：顶层与规则字段按 `build.json` 的 `topOrder` / `ruleOrder` 输出；未记录时用 Legado 字母序。`build` 会断言实际键序与预期完全一致。
4. **回环**：`unbuild` 接受任意顶层键序、2~N 空格缩进、有/无尾换行，并把差异记入 `build.json`；`--verify` 只比较产物字节，不再要求输入是规范导出格式。

## 六、模板自检

> 以下为模板在原 `legado-work` 仓库中对真实书源的验证记录；相关书源工程不在本仓库。

- 红果短剧漫剧（540,049 字符）：`@js:`、`<js>…ul li`、`<js>…$[*]`、裸 `callBackJs` 混合形态 → 逐字节回环。
- syiism 聚合（303,554 字符，`loginUi` 为真实 `@js:` 长脚本）→ 逐字节回环；该源后续也用本模板维护。
- 六个真实工程迁移（2026-10-30，全部 `unbuild --verify` 后两次构建同 sha256）：

| 工程 | 成品字符 | build.json 非默认项 | 备注 |
|---|---|---|---|
| `fq-hg-mini` | 167,082 | `indent:1` / `newline:false` / 非字母序 `topOrder` / 3 组 `ruleOrder` | 构建期设备注入改用原仓库的 `scripts/inject-sessions.mjs` |
| `fq-hg` | 174,754 | 无（全默认） | 10 段 core 合并为单 jsLib |
| `fanq-max` | 218,583 | `newline:false` + `file` | `nextContentUrl` 尾随空格由 wrapper 复原 |
| `qq-read` | 500,592 | `newline:false` + `file` | `header`→shell、`loginCheckJs`→optional |
| `rrssk` | 22,548 | `file` | `<js>` exploreUrl/init/chapterList |
| `stv` | 341,021 | `indent:1` / `newline:false` / `file` | 测试改读新 src 路径 |

- 从零填写冒烟：`searchUrl` 写裸 URL、`exploreUrl` 写 `@js:`、`bookList`/`chapterList` 分别用字符串选择器与 `.js` 原子——产物均按预期形态输出。
- `loginUi` 单文件冒烟：`loginUi.js` 写 JS → 产物为 `@js:` 体并逐字节回环；遇到原始 JSON 的成品 → unbuild 记为 `wrappers.mode='raw'`，仍在同一文件内逐字节回环。
- 空骨架 `build` 可产出含 `ruleSearch` / `ruleToc` / `ruleContent` 空对象的最小 JSON。
- 所有代码原子 `node --check` 通过。

## 七、注意事项

1. 模板不内置任何站点签名/凭据；真实源请把设备常量、Cookie 放进 `src/jslib.js` 或 `src/meta.json` 的 `header`，并注意分发前脱敏。
2. `jsLib` 为整体文件；若需要按行分段维护，复制原仓库「红果短剧漫剧」工程的 `layout.mjs` + `CORE/CONTENT` 方案。
3. `unbuild` 会清空 `src/{shell,optional,rules}` 并按输入重建；不要把手工改动留在这三个目录外又期望它保留。
4. 发布前改 `lastUpdateTime`（`src/meta.json`），`bookSourceName` 决定产物文件名。
