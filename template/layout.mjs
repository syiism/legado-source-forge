// layout.mjs · 书源工程模板布局（build / unbuild / scaffold 共用）
//
// 规则字段三类落盘：
//   kind='code' → 独立 .js 裸代码（纯 JS 字段），可直接 node --check
//   kind='text' → 同组 index.mjs 双引号字符串，保存**完整规则文本**（选择器 / JSONPath /
//                 带 `@js:` 或 `<js>` 前缀的整串），build 原样透传
//   kind='both' → 双形态：有 .js 原子就按 @js 裸代码装配，否则取 index.mjs 完整规则文本
// 未启用：text 字段为 null；code 字段文件内容等于 ABSENT_CODE；build 跳过，不写空串。
//
// 字段表为官方实体全集（SearchRule / ExploreRule / BookInfoRule / TocRule / ContentRule /
// ReviewRule），顺序即 Legado 导出的字母序。见知识库 wiki/01-book-source-schema.md。

export const ABSENT_CODE = '// 未启用：替换本行后参与构建';

export const WRAPPERS_FILE = 'src/wrappers.json';

// 输出配置（unbuild 自动探测缩进/尾换行/顶层键序，build 按此还原；缺省 = Legado 导出规范）
//   file    输出路径（相对工程根）；缺省 dist/<bookSourceName>.json
//   indent  JSON 缩进空格数，缺省 2
//   newline 末尾是否补换行，缺省 true
//   topOrder 非字母序工程的顶层键序；缺省 layout.TOP_KEYS
export const BUILD_FILE = 'src/build.json';

export const TOP_KEYS = [
  'bookSourceComment', 'bookSourceGroup', 'bookSourceName', 'bookSourceType', 'bookSourceUrl',
  'bookUrlPattern', 'concurrentRate', 'coverDecodeJs', 'customButton', 'customOrder',
  'enabled', 'enabledCookieJar', 'enabledExplore', 'eventListener', 'exploreScreen', 'exploreUrl',
  'header', 'jsLib', 'lastUpdateTime', 'loginCheckJs', 'loginUi', 'loginUrl', 'respondTime',
  'ruleBookInfo', 'ruleContent', 'ruleExplore', 'ruleReview', 'ruleSearch', 'ruleToc',
  'searchUrl', 'variableComment', 'weight',
];

// meta.json 承载的普通元字段（null = 不写进产物）
export const META_KEYS = [
  'bookSourceComment', 'bookSourceGroup', 'bookSourceName', 'bookSourceType', 'bookSourceUrl',
  'bookUrlPattern', 'concurrentRate', 'customButton', 'customOrder', 'enabled', 'enabledCookieJar',
  'enabledExplore', 'eventListener', 'exploreScreen', 'header', 'lastUpdateTime', 'respondTime',
  'variableComment', 'weight',
];

// 顶层长文本/JS 字段：落独立文件，避免在 meta.json 里变成难读的单行转义串。
// 文件保存**完整字段值**（header 常带 `@js:` 前缀，原样保留）；文件缺失时回退 meta.json 同名字段。
export const TOP_FILES = [
  { key: 'bookSourceComment', file: 'src/shell/comment.txt' },
  { key: 'header',            file: 'src/shell/header.js' },
];

// 顶层纯 JS 字段（裸代码，无 @js: 包装）
export const OPTIONAL_TOP_CODE = [
  { key: 'coverDecodeJs', file: 'src/optional/coverDecodeJs.js' },
  { key: 'loginCheckJs',  file: 'src/optional/loginCheckJs.js' },
];

// 顶层 URL / 登录壳：
//   searchUrl / exploreUrl / loginUrl 文件保存**完整字段值**（@js: 前缀 / 裸 URL / JS 库都原样写）。
//   loginUi 只有一个文件：loginUi.js 写 @js: 体（末尾 JSON.stringify(res)，syiism 范式）；
//   JSON 数据也在 JS 里返回。unbuild 遇到原始 JSON 时记 wrappers.mode='raw'，仍可单文件无损回环。
export const SHELL = [
  { key: 'exploreUrl', file: 'src/shell/exploreUrl.js' },
  { key: 'loginUi',    file: 'src/shell/loginUi.js', wrap: '@js' },
  { key: 'loginUrl',   file: 'src/shell/loginUrl.js', pureJs: true },
  { key: 'searchUrl',  file: 'src/shell/searchUrl.js' },
];

// 规则对象：字段顺序 = 官方导出字母序。code 字段的 defaultMode 只用于从零编写；
// unbuild 会把手头书源的实际包装（@js / <js> + 尾部选择器 / raw）写进 wrappers.json。
export const RULES = [
  {
    key: 'ruleBookInfo', dir: 'src/rules/bookinfo', fields: [
      { name: 'author',       kind: 'text' },
      { name: 'canReName',    kind: 'text' },
      { name: 'coverUrl',     kind: 'text' },
      { name: 'downloadUrls', kind: 'text' },
      { name: 'init',         kind: 'both', defaultMode: '@js' },
      { name: 'intro',        kind: 'both', defaultMode: '@js' },
      { name: 'kind',         kind: 'text' },
      { name: 'lastChapter',  kind: 'text' },
      { name: 'name',         kind: 'text' },
      { name: 'tocUrl',       kind: 'text' },
      { name: 'updateTime',   kind: 'text' },
      { name: 'wordCount',    kind: 'text' },
    ],
  },
  {
    key: 'ruleContent', dir: 'src/rules/content', always: true, fields: [
      { name: 'callBackJs',    kind: 'code', defaultMode: 'raw', pureJs: true },
      { name: 'content',       kind: 'both', defaultMode: '@js' },
      { name: 'imageDecode',   kind: 'code', defaultMode: 'raw', pureJs: true },
      { name: 'imageStyle',    kind: 'text' },
      { name: 'nextContentUrl', kind: 'text' },
      { name: 'payAction',     kind: 'text' },
      { name: 'replaceRegex',  kind: 'text' },
      { name: 'sourceRegex',   kind: 'text' },
      { name: 'subContent',    kind: 'text' },
      { name: 'title',         kind: 'text' },
      { name: 'webJs',         kind: 'code', defaultMode: 'raw', pureJs: true },
    ],
  },
  {
    key: 'ruleExplore', dir: 'src/rules/explore', fields: [
      { name: 'author',      kind: 'text' },
      { name: 'bookList',    kind: 'both', defaultMode: '@js' },
      { name: 'bookUrl',     kind: 'text' },
      { name: 'coverUrl',    kind: 'text' },
      { name: 'intro',       kind: 'text' },
      { name: 'kind',        kind: 'text' },
      { name: 'lastChapter', kind: 'text' },
      { name: 'name',        kind: 'text' },
      { name: 'updateTime',  kind: 'text' },
      { name: 'wordCount',   kind: 'text' },
    ],
  },
  {
    key: 'ruleReview', dir: 'src/rules/review', fields: [
      { name: 'avatarRule',    kind: 'text' },
      { name: 'contentRule',   kind: 'text' },
      { name: 'deleteUrl',     kind: 'text' },
      { name: 'postQuoteUrl',  kind: 'text' },
      { name: 'postReviewUrl', kind: 'text' },
      { name: 'postTimeRule',  kind: 'text' },
      { name: 'reviewQuoteUrl', kind: 'text' },
      { name: 'reviewUrl',     kind: 'text' },
      { name: 'voteDownUrl',   kind: 'text' },
      { name: 'voteUpUrl',     kind: 'text' },
    ],
  },
  {
    key: 'ruleSearch', dir: 'src/rules/search', always: true, fields: [
      { name: 'author',      kind: 'text' },
      { name: 'bookList',    kind: 'both', defaultMode: '@js' },
      { name: 'bookUrl',     kind: 'text' },
      { name: 'checkKeyWord', kind: 'text' },
      { name: 'coverUrl',    kind: 'text' },
      { name: 'intro',       kind: 'text' },
      { name: 'kind',        kind: 'text' },
      { name: 'lastChapter', kind: 'text' },
      { name: 'name',        kind: 'text' },
      { name: 'updateTime',  kind: 'text' },
      { name: 'wordCount',   kind: 'text' },
    ],
  },
  {
    key: 'ruleToc', dir: 'src/rules/toc', always: true, fields: [
      { name: 'chapterList', kind: 'both', defaultMode: '@js' },
      { name: 'chapterName', kind: 'text' },
      { name: 'chapterUrl',  kind: 'text' },
      { name: 'formatJs',    kind: 'code', defaultMode: 'raw', pureJs: true },
      { name: 'isPay',       kind: 'text' },
      { name: 'isVolume',    kind: 'text' },
      { name: 'isVip',       kind: 'text' },
      { name: 'nextTocUrl',  kind: 'text' },
      { name: 'preUpdateJs', kind: 'code', defaultMode: 'raw', pureJs: true },
      { name: 'updateTime',  kind: 'text' },
    ],
  },
];

// 初始 meta.json（scaffold.mjs 仅在文件缺失时写入）
export const DEFAULT_META = {
  bookSourceComment: null,
  bookSourceGroup: null,
  bookSourceName: '新书源模板',
  bookSourceType: 0,
  bookSourceUrl: 'https://example.com',
  bookUrlPattern: null,
  concurrentRate: null,
  customButton: false,
  customOrder: 0,
  enabled: true,
  enabledCookieJar: true,
  enabledExplore: true,
  eventListener: false,
  exploreScreen: null,
  header: null,
  lastUpdateTime: 0,
  respondTime: 180000,
  variableComment: null,
  weight: 0,
};
