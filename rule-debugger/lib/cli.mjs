import { UsageError } from './rule.mjs';

const VALUE_FLAGS = new Set([
  '--source', '--project', '--rule', '--js', '--js-file', '--result', '--base-url',
  '--book', '--chapter', '--key', '--page', '--var', '--login', '--timeout', '--ua',
  '--charset', '--cassette', '--record', '--cookie', '--cookie-jar', '--state', '--max-chars',
]);

const BOOLEAN_FLAGS = new Set(['--offline', '--no-save', '--json', '--full', '--quiet', '--show-secrets', '--help', '-h']);

function newStep(kind, value) {
  return {
    kind,
    value,
    result: null,
    baseUrl: null,
    book: null,
    chapter: null,
    key: null,
    page: null,
    vars: {},
    logins: {},
  };
}

function parsePair(text, flag) {
  const idx = String(text).indexOf('=');
  if (idx <= 0) throw new UsageError(`${flag} 需要 k=v 形式，收到 ${text}`);
  return [text.slice(0, idx), text.slice(idx + 1)];
}

export function parseArgs(argv) {
  const config = {
    source: null,
    project: null,
    steps: [],
    defaults: { result: null, baseUrl: null, book: null, chapter: null, key: null, page: null, vars: {}, logins: {} },
    net: { timeout: 15000, ua: null, charset: null, offline: false, cassette: null, record: null, cookie: null, cookieJar: null },
    state: { file: null, save: true },
    output: { json: false, full: false, maxChars: 2000, quiet: false, showSecrets: false },
    help: false,
  };
  let current = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) throw new UsageError(`无法识别的参数：${arg}`);

    if (!VALUE_FLAGS.has(arg) && !BOOLEAN_FLAGS.has(arg)) throw new UsageError(`未知选项：${arg}`);
    const value = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${arg} 需要参数`);
      return argv[++i];
    };
    const target = (prop, val) => {
      if (current) current[prop] = val;
      else config.defaults[prop] = val;
    };

    switch (arg) {
      case '--source': config.source = value(); break;
      case '--project': config.project = value(); break;
      case '--help': case '-h': config.help = true; break;
      case '--rule': current = newStep('rule', value()); config.steps.push(current); break;
      case '--js': current = newStep('js', value()); config.steps.push(current); break;
      case '--js-file': current = newStep('js-file', value()); config.steps.push(current); break;
      case '--result': target('result', value()); break;
      case '--base-url': target('baseUrl', value()); break;
      case '--book': target('book', value()); break;
      case '--chapter': target('chapter', value()); break;
      case '--key': target('key', value()); break;
      case '--page': {
        const n = Number(value());
        if (!Number.isFinite(n)) throw new UsageError('--page 需要数字');
        target('page', n);
        break;
      }
      case '--var': {
        const [k, v] = parsePair(value(), '--var');
        const bucket = current ? current.vars : config.defaults.vars;
        bucket[k] = v;
        break;
      }
      case '--login': {
        const [k, v] = parsePair(value(), '--login');
        const bucket = current ? current.logins : config.defaults.logins;
        bucket[k] = v;
        break;
      }
      case '--timeout': {
        const n = Number(value());
        if (!Number.isFinite(n) || n <= 0) throw new UsageError('--timeout 需要正数毫秒');
        config.net.timeout = n;
        break;
      }
      case '--ua': config.net.ua = value(); break;
      case '--charset': config.net.charset = value(); break;
      case '--offline': config.net.offline = true; break;
      case '--cassette': config.net.cassette = value(); break;
      case '--record': config.net.record = value(); break;
      case '--cookie': config.net.cookie = value(); break;
      case '--cookie-jar': config.net.cookieJar = value(); break;
      case '--state': config.state.file = value(); break;
      case '--no-save': config.state.save = false; break;
      case '--json': config.output.json = true; break;
      case '--full': config.output.full = true; break;
      case '--quiet': config.output.quiet = true; break;
      case '--show-secrets': config.output.showSecrets = true; break;
      case '--max-chars': {
        const n = Number(value());
        if (!Number.isFinite(n) || n < 0) throw new UsageError('--max-chars 需要非负整数');
        config.output.maxChars = Math.floor(n);
        break;
      }
      default: throw new UsageError(`未知选项：${arg}`);
    }
  }

  if (config.help) return config;
  if (!config.source && !config.project) throw new UsageError('缺少 --source <书源.json> 或 --project <工程目录>');
  if (config.steps.length === 0) throw new UsageError('至少需要一个 --rule / --js / --js-file');
  return config;
}

export function usage() {
  return [
    'Legado 书源 JS 规则调试器（离线/联网）',
    '',
    '用法：',
    '  node rule-debugger/bin/legado-debug.mjs (--source <dist.json> | --project <dir>) \\',
    '       (--rule <字段> ... | --js <代码> | --js-file <文件>) [选项]',
    '',
    '字段：',
    '  searchUrl / exploreUrl / jsLib ...        顶层字段',
    '  search.bookList / bookinfo.init ...       规则字段（也可写 ruleSearch.bookList）',
    '  bookList                                  简写，默认 ruleSearch.bookList',
    '',
    '输入（写在 --rule 之后即该步专属，否则为全局默认）：',
    '  --result <text|@file>   当前步 result 绑定（默认取上一步输出）',
    '  --base-url <url>  --book <json|@file>  --chapter <json|@file>',
    '  --key <文本>  --page <n>  --var k=v  --login k=v',
    '',
    '网络：',
    '  --offline                禁止真实请求（配合 --cassette 回放）',
    '  --cassette <file>        只回放录制文件',
    '  --record <file>          优先回放，未命中则真实请求并追加录制',
    '  --timeout <ms>  --ua <UA>  --charset <编码>',
    '  --cookie "k=v; ..."  --cookie-jar <file>',
    '',
    '状态与输出：',
    '  --state <file>  --no-save   变量/缓存持久化',
    '  --json  --full  --max-chars <n>  --quiet  --show-secrets',
    '',
    '示例：',
    '  node rule-debugger/bin/legado-debug.mjs --project ../legado-work/work/光遇聚合 \\',
    '       --rule searchUrl --key 斗破苍穹',
    '  node rule-debugger/bin/legado-debug.mjs --source ../legado-work/work/stv/dist/STV.json \\',
    '       --rule ruleExplore.bookList --result @input.html --offline',
    '',
    '退出码：0 成功 / 1 运行错误 / 2 用法错误 / 3 cassette 未命中 / 4 构建失败',
  ].join('\n');
}
