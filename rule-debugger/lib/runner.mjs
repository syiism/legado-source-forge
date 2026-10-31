import fs from 'node:fs';
import { loadSource } from './load.mjs';
import { Store } from './store.mjs';
import { Sandbox, rhinoHint } from './sandbox.mjs';
import {
  resolveRule, extractAtom, classifySuffix, evaluateRule, evaluateRuleString,
  isJsonText, looksLikeJsonPath, renderTemplate, splitResultOptions,
} from './rule.mjs';
import { HttpClient } from './net/http.mjs';
import { Cassette } from './net/cassette.mjs';
import { CookieJar } from './net/cookies.mjs';
import { createPackages } from './packages.mjs';
import { makeSourceBindings, makeMapLike } from './bindings/source.mjs';
import { makeJavaBindings } from './bindings/java.mjs';
import { UsageError } from './rule.mjs';

function readText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.startsWith('@')) return fs.readFileSync(text.slice(1), 'utf8');
  return text;
}

// 与 Legado AnalyzeUrl 对齐：data:…;base64 的 result 是解码后的正文；
// 带 type 的 URL 选项返回原始字节的 hex（AnalyzeUrl.getStrResponseAwait）。
function decodeDataUriResult(text) {
  const raw = String(text ?? '').trim();
  const options = splitResultOptions(raw);
  const uri = options ? options.url : raw;
  const match = /^data:[^,]*;base64,([\s\S]*)$/i.exec(uri.trim());
  if (!match) return raw;
  const bytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  return options?.json?.type != null ? bytes.toString('hex') : bytes.toString('utf8');
}

function resolveFollowUrl(value, baseUrl, sourceUrl) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const options = splitResultOptions(text);
  const url = (options ? options.url : text).trim();
  if (!/^(?:https?:\/\/|data:|\/)/i.test(url)) return null;
  if (/^(?:https?:\/\/|data:)/i.test(url)) return { url, options: options?.json ?? {} };
  const base = baseUrl || sourceUrl || '';
  if (!base) throw new UsageError(`无法解析相对 URL ${url}：请提供 --base-url 或书源 bookSourceUrl`);
  try {
    return { url: new URL(url, base).toString(), options: options?.json ?? {} };
  } catch (err) {
    throw new UsageError(`URL 解析失败：${url}（${err.message}）`);
  }
}

// fetch 步骤面对的是规则明确产出的 URL，允许不带前导 / 的相对路径。
function resolveFetchTarget(value, baseUrl, sourceUrl) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const options = splitResultOptions(text);
  const url = (options ? options.url : text).trim();
  if (/^(?:https?:\/\/|data:)/i.test(url)) return { url, options: options?.json ?? {} };
  const base = baseUrl || sourceUrl || '';
  if (!base) return null;
  try {
    return { url: new URL(url, base).toString(), options: options?.json ?? {} };
  } catch {
    return null;
  }
}

function applyRuleSuffix(value, suffix) {
  const info = classifySuffix(suffix);
  if (info.kind === 'none' || info.kind === 'options') return { applied: false, info };
  if (info.kind === 'regex' || info.kind === 'jsonpath') {
    const out = evaluateRule(value, suffix);
    return { applied: true, info, value: out, missing: out === undefined };
  }
  if (info.kind === 'selector' && isJsonText(value) && looksLikeJsonPath(suffix)) {
    const out = evaluateRule(value, suffix);
    return { applied: true, info, value: out, missing: out === undefined };
  }
  return { applied: false, info };
}

function evaluatePlainRule(value, rule, store) {
  const text = String(rule ?? '').trim();
  if (text.startsWith('@get:')) return { value: store.get(text.slice(5).trim()), matched: true };
  const base = text.split('##')[0].trim();
  if (text.startsWith('$') || (isJsonText(value) && looksLikeJsonPath(base))) {
    return { value: evaluateRule(value, text), matched: true };
  }
  return { value: rule, matched: false };
}

function parseJsonArg(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const text = readText(value);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${label} 不是合法 JSON：${err.message}`);
  }
}

function sourceHeader(source) {
  const raw = source?.header;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function describeValue(value) {
  if (value === undefined) return { type: 'undefined', size: 0, text: '' };
  if (value === null) return { type: 'null', size: 4, text: 'null' };
  if (typeof value === 'string') return { type: 'string', size: Buffer.byteLength(value), text: value };
  if (Array.isArray(value)) {
    const text = JSON.stringify(value);
    return { type: `array[${value.length}]`, size: Buffer.byteLength(text), text };
  }
  if (typeof value === 'object') {
    const text = JSON.stringify(value, null, 2);
    return { type: 'object', size: Buffer.byteLength(JSON.stringify(value)), text };
  }
  return { type: typeof value, size: Buffer.byteLength(String(value)), text: String(value) };
}

function toChain(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function describeError(err) {
  return {
    message: String(err?.message ?? err),
    code: err?.code,
    stack: err?.stack,
    hints: rhinoHint(err),
  };
}

// Legado 在 getLoginInfoMap() 里把 loginUrl 的脚本拼在 loginUi 前面执行（BaseSource.getLoginJs），
// loginUi 因此可以调用 loginUrl 里定义的函数；单独 eval loginUi 会报 xxx is not defined。
function loginScript(loginUrl) {
  const text = String(loginUrl ?? '');
  if (!text) return '';
  if (text.startsWith('@js:')) return text.slice(4);
  if (text.startsWith('<js>')) return text.slice(4, text.lastIndexOf('<'));
  return text;
}

export function run(config) {
  const startedAt = Date.now();
  const { source, project, warnings: buildWarnings = [] } = loadSource(config);

  const stateFile = config.state?.file ?? null;
  const loadState = stateFile && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  const store = loadState ? Store.fromState(loadState) : new Store();

  const jarFile = config.net?.cookieJar ?? null;
  const jar = jarFile && fs.existsSync(jarFile)
    ? CookieJar.fromJSON(JSON.parse(fs.readFileSync(jarFile, 'utf8')))
    : new CookieJar();
  if (config.net?.cookie) jar.seed(config.net.cookie);

  const cassetteFile = config.net?.record || config.net?.cassette || null;
  const cassette = cassetteFile ? new Cassette(cassetteFile, { record: Boolean(config.net?.record) }) : null;
  cassette?.load();
  const offline = Boolean(config.net?.offline) || (Boolean(config.net?.cassette) && !config.net?.record);

  const events = [];
  let currentStep = 0;
  const hooks = {
    log(kind, text) {
      events.push({ step: currentStep, type: 'log', kind, text: String(text) });
    },
    warn(text) {
      events.push({ step: currentStep, type: 'log', kind: 'warn', text: String(text) });
    },
    noop(api) {
      events.push({ step: currentStep, type: 'log', kind: 'noop', text: String(api) });
    },
  };

  const client = new HttpClient({
    jar,
    cassette,
    offline,
    timeout: config.net?.timeout ?? 15000,
    ua: config.net?.ua,
    defaultHeaders: sourceHeader(source),
    charset: config.net?.charset,
    onCall(call) {
      events.push({ step: currentStep, type: 'net', ...call });
    },
  });

  const { source: sourceApi, cache, cookie, makeBook, makeChapter } = makeSourceBindings({ source, store, jar, hooks });
  let activeResult = '';
  const java = makeJavaBindings({ client, store, hooks, sourceApi, currentResult: () => activeResult });
  const Packages = createPackages({
    transport: (method, url, params) => client.request(method, url, params),
  });

  for (const [k, v] of Object.entries(config.defaults?.vars ?? {})) store.putVariable(k, v);
  for (const [k, v] of Object.entries(config.defaults?.logins ?? {})) store.setLogin(k, v);

  const book = makeBook(parseJsonArg(config.defaults?.book, '--book') ?? {});
  const chapter = makeChapter(parseJsonArg(config.defaults?.chapter, '--chapter') ?? {});
  const infoMap = makeMapLike(store.loginInfo);

  const globals = {
    java,
    source: sourceApi,
    cache,
    cookie,
    book,
    chapter,
    result: '',
    baseUrl: '',
    key: '',
    page: 1,
    title: '',
    src: '',
    sourceUrl: source?.bookSourceUrl ?? '',
    nextChapterUrl: '',
    fromBookInfo: false,
    rssArticle: null,
    infoMap,
    Packages,
    console: {
      log: (...args) => hooks.log('console', args.map(String).join(' ')),
      info: (...args) => hooks.log('console', args.map(String).join(' ')),
      warn: (...args) => hooks.log('console', args.map(String).join(' ')),
      error: (...args) => hooks.log('console', args.map(String).join(' ')),
    },
    print: (...args) => hooks.log('print', args.map(String).join(' ')),
  };

  const sandbox = new Sandbox({ jsLib: source?.jsLib || '', globals, timeout: 300000 });

  const steps = [];
  let stepSeq = 0;
  let chain = config.defaults?.result !== null && config.defaults?.result !== undefined
    ? readText(config.defaults.result)
    : '';
  let exitCode = 0;
  let flowReport = null;

  const executeStep = (step, inputChain) => {
    currentStep = stepSeq;
    store.step = stepSeq;
    const mark = events.length;
    const before = store.snapshot();

    for (const [k, v] of Object.entries(step.vars ?? {})) store.putVariable(k, v);
    for (const [k, v] of Object.entries(step.logins ?? {})) store.setLogin(k, v);

    const bookData = parseJsonArg(step.book, '--book');
    if (bookData) Object.assign(book, bookData);
    const chapterData = parseJsonArg(step.chapter, '--chapter');
    if (chapterData) Object.assign(chapter, chapterData);

    const key = step.key ?? config.defaults?.key ?? '';
    const page = step.page ?? config.defaults?.page ?? 1;
    const baseUrl = step.baseUrl ?? config.defaults?.baseUrl ?? '';
    const resultText = step.result !== null && step.result !== undefined
      ? (step.rawResult ? String(step.result) : readText(step.result))
      : inputChain;
    const resultInput = decodeDataUriResult(resultText);
    activeResult = resultInput;
    const follow = step.follow ?? config.defaults?.follow ?? false;

    sandbox.set('result', resultInput);
    sandbox.set('baseUrl', baseUrl);
    sandbox.set('key', key);
    sandbox.set('page', page);
    sandbox.set('book', book);
    sandbox.set('chapter', chapter);
    sandbox.set('title', step.title ?? chapter?.title ?? '');
    sandbox.set('src', resultInput);
    sandbox.set('infoMap', infoMap);

    const record = {
      index: stepSeq,
      label: step.label ?? '',
      mode: '',
      sourceBytes: 0,
      suffix: { kind: 'none' },
      bindings: { key, page, baseUrl },
      ms: 0,
      logs: [],
      net: [],
      vars: null,
      result: null,
      suffixApplied: null,
      requestOptions: null,
      error: null,
    };

    const stepStart = Date.now();
    let rawValue;
    let chainValue = resultInput;

    let skipTemplate = false;
    try {
      if (step.kind === 'fetch') {
        record.mode = 'fetch';
        record.label = step.label ?? 'fetch';
        const rawUrl = String(step.value ?? '').trim();
        record.sourceBytes = Buffer.byteLength(rawUrl);
        const target = resolveFetchTarget(rawUrl, baseUrl, source?.bookSourceUrl);
        if (!target) throw new UsageError(`fetch 需要 http(s)/data/相对 URL：${rawUrl}`);
        const options = target.options ?? {};
        const method = String(options.method || 'GET').toUpperCase();
        const response = client.request(method, target.url, {
          headers: options.headers,
          body: method === 'POST' && options.body !== undefined && options.body !== null
            ? (typeof options.body === 'object' ? JSON.stringify(options.body) : String(options.body))
            : '',
          charset: options.charset,
          type: options.type,
        });
        rawValue = response.body;
        chainValue = response.body;
        record.requestOptions = splitResultOptions(rawUrl);
        record.followed = { url: response.url, status: response.code, mode: response.mode };
        record.result = describeValue(rawValue);
      } else {
        let atom;
        if (step.kind === 'rule') {
          const field = resolveRule(source, step.value);
          if (field.value === null || field.value === undefined) {
            throw new Error(`字段 ${field.label} 不存在或为空`);
          }
          atom = extractAtom(field.value);
          record.label = field.label;
          // 登录/JS 库在 Legado 里直接 eval，不经过 SourceRule 的 {{}} 替换。
          skipTemplate = ['jsLib', 'loginUrl', 'loginUi'].includes(field.label);
          // loginUrl / jsLib 本身就是 JavaScript（Legado getLoginJs 直接 eval），没有 @js: 包装也要执行
          if ((field.label === 'loginUrl' || field.label === 'jsLib') && atom.mode === 'plain') {
            atom = { mode: 'js', lead: '', body: atom.raw, suffix: '', wrapped: false };
          }
          if (field.label === 'loginUi' && atom.mode === 'js') {
            const prelude = loginScript(source?.loginUrl);
            if (prelude) atom = { ...atom, body: `${prelude}\n${atom.body}` };
          }
        } else if (step.kind === 'js-file') {
          atom = { mode: 'js', body: fs.readFileSync(step.value, 'utf8'), suffix: '' };
          record.label = `js:${step.value}`;
        } else {
          atom = { mode: 'js', body: String(step.value), suffix: '' };
          record.label = 'js';
        }

        record.mode = atom.mode;
        record.sourceBytes = Buffer.byteLength(atom.body ?? atom.raw ?? '');

        if (atom.mode === 'missing' || atom.mode === 'empty') {
          throw new Error(`字段 ${record.label} 为空`);
        }
        if (atom.mode === 'broken') throw new Error(`字段 ${record.label} 的 <js> 包装未闭合`);
        if (atom.mode === 'nonstring') throw new Error(`字段 ${record.label} 不是字符串`);

        // @put 在规则求值前执行，参数按当前 result 求值（bookinfo.name 的 bid 依赖于此）。
        for (const [keyName, putRule] of Object.entries(atom.putMap ?? {})) {
          store.put(keyName, evaluateRuleString(resultInput, putRule));
        }

        const resolveInner = (expr) => {
          const text = String(expr).trim();
          if (text.startsWith('@get:')) return store.get(text.slice(5).trim());
          if (text.startsWith('@js:')) return sandbox.runExpression(text.slice(4));
          if (text.startsWith('@Json:')) return evaluateRuleString(resultInput, text.slice(6));
          if (text.startsWith('@CSS:') || text.startsWith('@XPath:') || text.startsWith('//')) {
            throw new UsageError(`内嵌规则暂不支持选择器求值：${text}`);
          }
          if (text.startsWith('$') || text.startsWith('@')) {
            return evaluateRuleString(resultInput, text);
          }
          return sandbox.runExpression(text);
        };

        if (atom.mode === 'js') {
          record.suffix = classifySuffix(atom.suffix);
          rawValue = sandbox.runAtom(skipTemplate ? atom.body : renderTemplate(atom.body, resolveInner));
          const applied = applyRuleSuffix(rawValue, atom.suffix);
          if (applied.applied) {
            if (applied.missing) hooks.warn(`suffix ${atom.suffix.trim()} 未命中`);
            rawValue = applied.value === undefined ? '' : applied.value;
            record.suffixApplied = describeValue(rawValue);
          }
          chainValue = toChain(rawValue);
        } else if (atom.mode === 'template') {
          rawValue = skipTemplate ? atom.raw : renderTemplate(atom.raw, resolveInner);
          chainValue = toChain(rawValue);
        } else if (atom.mode === 'plain') {
          const plain = evaluatePlainRule(resultInput, atom.raw, store);
          if (plain.matched && plain.value === undefined) {
            hooks.warn(`规则 ${String(atom.raw).trim()} 未命中当前 result`);
            rawValue = '';
          } else {
            rawValue = plain.value;
            if (plain.matched) record.suffixApplied = describeValue(rawValue);
          }
          chainValue = toChain(rawValue);
        } else {
          rawValue = atom.raw;
          chainValue = toChain(rawValue);
        }

        record.requestOptions = splitResultOptions(typeof rawValue === 'string' ? rawValue : null);
        if (follow && typeof rawValue === 'string') {
          const target = resolveFollowUrl(rawValue, baseUrl, source?.bookSourceUrl);
          if (target) {
            const options = target.options ?? {};
            const method = String(options.method || 'GET').toUpperCase();
            const response = client.request(method, target.url, {
              headers: options.headers,
              body: method === 'POST' && options.body !== undefined && options.body !== null
                ? (typeof options.body === 'object' ? JSON.stringify(options.body) : String(options.body))
                : '',
              charset: options.charset,
              type: options.type,
            });
            rawValue = response.body;
            chainValue = response.body;
            record.followed = { url: response.url, status: response.code, mode: response.mode };
          }
        }
        record.result = describeValue(rawValue);
      }
    } catch (err) {
      if (err?.code === 'CASSETTE_MISS') throw err;
      record.error = describeError(err);
    }

    record.ms = Date.now() - stepStart;
    const stepEvents = events.slice(mark);
    record.logs = stepEvents
      .filter((e) => e.type === 'log')
      .map((e) => ({ kind: e.kind, text: e.text }));
    record.net = stepEvents
      .filter((e) => e.type === 'net')
      .map(({ method, url, status, bytes, ms, mode, charset, error }) => ({ method, url, status, bytes, ms, mode, charset, error }));
    record.vars = store.diff(before);
    record.vars.vars = record.vars.vars.map((change) => ({
      ...change,
      from: change.from === undefined ? undefined : String(change.from),
      to: change.to === undefined ? undefined : String(change.to),
    }));
    return { record, chain: chainValue };
  };

  const commit = ({ record, chain: nextChain }) => {
    steps.push(record);
    stepSeq += 1;
    if (record.error) exitCode = 1;
    return nextChain;
  };

  const flowErrorRecord = (label, err, bindings) => ({
    index: stepSeq,
    label: label || 'flow',
    mode: 'flow',
    sourceBytes: 0,
    suffix: { kind: 'none' },
    bindings,
    ms: 0,
    logs: [],
    net: [],
    vars: store.diff(store.snapshot()),
    result: null,
    suffixApplied: null,
    requestOptions: null,
    error: describeError(err),
  });

  const hasRule = (group, field) => {
    const value = source?.[group]?.[field];
    return value !== null && value !== undefined && String(value).trim() !== '';
  };

  const toList = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return [];
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [text];
      }
    }
    if (value && typeof value === 'object') return [value];
    return [];
  };

  const itemText = (item) => (item && typeof item === 'object' ? JSON.stringify(item) : String(item ?? ''));
  const isUrlLike = (text) => /^(?:https?:\/\/|data:|\/)/i.test(String(text ?? '').trim());
  // Legado 的 kind 走 getStringList().joinToString(",")，数组结果要拼成逗号串。
  const flowFieldValue = (field, value) => {
    if (field !== 'kind') return value;
    const text = String(value ?? '').trim();
    if (!text.startsWith('[')) return value;
    try {
      const list = JSON.parse(text);
      return Array.isArray(list) ? list.map(String).join(',') : value;
    } catch {
      return value;
    }
  };

  const runFlow = (flowStep, inputChain) => {
    const key = flowStep.key ?? config.defaults?.key ?? '';
    const page = flowStep.page ?? config.defaults?.page ?? 1;
    const bookIndex = Number(flowStep.bookIndex ?? config.defaults?.bookIndex ?? 0);
    const chapterIndex = Number(flowStep.chapterIndex ?? config.defaults?.chapterIndex ?? 0);
    const initialBase = flowStep.baseUrl ?? config.defaults?.baseUrl ?? source?.bookSourceUrl ?? '';
    const summary = {
      search: { total: 0, index: bookIndex },
      book: { index: bookIndex },
      toc: { total: 0, index: chapterIndex },
      chapter: { index: chapterIndex },
      content: null,
    };
    let flowChain = inputChain;
    let stage = 'flow';
    const FLOW_STOP = Symbol('flow-stop');
    const bindings = { key, page, baseUrl: initialBase };

    for (const [k, v] of Object.entries(flowStep.vars ?? {})) store.putVariable(k, v);
    for (const [k, v] of Object.entries(flowStep.logins ?? {})) store.setLogin(k, v);
    for (const k of Object.keys(book)) delete book[k];
    for (const k of Object.keys(chapter)) delete chapter[k];

    const runOne = (step) => {
      const out = executeStep(step, flowChain);
      flowChain = commit(out);
      if (out.record.error) throw FLOW_STOP;
      return out.record;
    };
    const ruleStep = (value, result, baseUrl, follow = false) => ({
      kind: 'rule', value, result: result === undefined ? null : String(result),
      rawResult: true, baseUrl: baseUrl ?? '', key, page, follow,
    });
    const fetchStep = (url, baseUrl, label) => ({
      kind: 'fetch', value: String(url), baseUrl: baseUrl ?? '', label, key, page,
    });

    try {
      if (!Number.isInteger(bookIndex) || bookIndex < 0) throw new UsageError('--book-index 需要非负整数');
      if (!Number.isInteger(chapterIndex) || chapterIndex < 0) throw new UsageError('--chapter-index 需要非负整数');

      // 1. 搜索
      let searchBody;
      let searchBase = initialBase;
      let seed = '';
      if (flowStep.result !== null && flowStep.result !== undefined) {
        seed = decodeDataUriResult(flowStep.rawResult ? String(flowStep.result) : readText(flowStep.result));
      } else if (inputChain !== '') {
        seed = decodeDataUriResult(inputChain);
      }
      if (seed !== '') {
        searchBody = seed;
        flowChain = seed;
      } else {
        stage = 'searchUrl';
        runOne(ruleStep('searchUrl', null, initialBase, false));
        const searchUrlRaw = flowChain;
        stage = 'flow.search';
        const searchFetch = runOne(fetchStep(searchUrlRaw, initialBase, 'flow.search'));
        searchBody = flowChain;
        searchBase = searchFetch.followed?.url
          || String(resolveFetchTarget(searchUrlRaw, initialBase, source?.bookSourceUrl)?.url ?? initialBase);
      }
      summary.search.url = searchBase;

      stage = 'search.bookList';
      if (!hasRule('ruleSearch', 'bookList')) throw new UsageError('书源缺少 ruleSearch.bookList');
      runOne(ruleStep('search.bookList', searchBody, searchBase));
      const books = toList(flowChain);
      summary.search.total = books.length;
      if (books.length === 0) throw new UsageError('搜索结果为空');
      if (bookIndex >= books.length) throw new UsageError(`--book-index ${bookIndex} 超出搜索结果范围（共 ${books.length} 条）`);
      const pickedBook = books[bookIndex];
      const bookText = itemText(pickedBook);
      if (pickedBook && typeof pickedBook === 'object') Object.assign(book, pickedBook);
      summary.search.index = bookIndex;
      summary.book.index = bookIndex;

      // 字段顺序对齐 BookList.kt：name → author → kind → wordCount → lastChapter → intro → coverUrl → bookUrl
      const searchFields = [
        'name', 'author', 'kind', 'wordCount', 'lastChapter', 'intro', 'coverUrl', 'updateTime', 'bookUrl',
      ];
      for (const field of searchFields) {
        if (!hasRule('ruleSearch', field)) continue;
        stage = `search.${field}`;
        runOne(ruleStep(`search.${field}`, bookText, searchBase));
        const value = flowFieldValue(field, flowChain);
        if (value !== '') book[field] = value;
      }
      if (!book.bookUrl) {
        if (pickedBook && typeof pickedBook === 'object' && pickedBook.bookUrl) book.bookUrl = String(pickedBook.bookUrl);
        else if (isUrlLike(bookText)) book.bookUrl = bookText.trim();
        else if (searchBase) book.bookUrl = searchBase;
      }
      if (!book.bookUrl) throw new UsageError('搜索结果没有 bookUrl');
      summary.book.name = book.name ?? '';
      summary.book.bookUrl = String(book.bookUrl);

      // 2. 详情
      stage = 'flow.detail';
      const bookUrlRaw = String(book.bookUrl);
      const detailRecord = runOne(fetchStep(bookUrlRaw, searchBase, 'flow.detail'));
      const detailBody = flowChain;
      const detailBase = detailRecord.followed?.url || String(resolveFollowUrl(bookUrlRaw, searchBase, source?.bookSourceUrl)?.url ?? bookUrlRaw);

      stage = 'bookinfo.init';
      let infoContent = detailBody;
      if (hasRule('ruleBookInfo', 'init')) {
        runOne(ruleStep('bookinfo.init', detailBody, detailBase));
        if (flowChain !== '') infoContent = flowChain;
      }
      const infoFields = [
        'name', 'author', 'kind', 'wordCount', 'lastChapter', 'intro', 'coverUrl', 'tocUrl', 'updateTime',
      ];
      for (const field of infoFields) {
        if (!hasRule('ruleBookInfo', field)) continue;
        stage = `bookinfo.${field}`;
        runOne(ruleStep(`bookinfo.${field}`, infoContent, detailBase));
        const value = flowFieldValue(field, flowChain);
        if (value !== '') book[field] = value;
      }
      if (!book.tocUrl) book.tocUrl = detailBase;
      summary.book.name = book.name ?? '';
      summary.book.tocUrl = String(book.tocUrl);

      // 3. 目录
      stage = 'flow.toc';
      const tocUrlRaw = String(book.tocUrl);
      const tocTarget = resolveFetchTarget(tocUrlRaw, detailBase || source?.bookSourceUrl, source?.bookSourceUrl);
      let tocBody;
      let tocBase;
      if (tocTarget && tocTarget.url === detailBase) {
        tocBody = detailBody;
        tocBase = detailBase;
        summary.toc.reusedDetail = true;
      } else {
        const tocRecord = runOne(fetchStep(tocUrlRaw, detailBase || source?.bookSourceUrl, 'flow.toc'));
        tocBody = flowChain;
        tocBase = tocRecord.followed?.url || tocTarget?.url || tocUrlRaw;
      }
      if (!hasRule('ruleToc', 'chapterList')) throw new UsageError('书源缺少 ruleToc.chapterList');
      stage = 'toc.chapterList';
      runOne(ruleStep('toc.chapterList', tocBody, tocBase));
      const chapters = toList(flowChain);
      summary.toc.total = chapters.length;
      if (chapters.length === 0) throw new UsageError('目录为空');
      if (chapterIndex >= chapters.length) throw new UsageError(`--chapter-index ${chapterIndex} 超出目录范围（共 ${chapters.length} 章）`);
      const pickedChapter = chapters[chapterIndex];
      const chapterText = itemText(pickedChapter);
      if (pickedChapter && typeof pickedChapter === 'object') Object.assign(chapter, pickedChapter);
      summary.toc.index = chapterIndex;
      summary.chapter.index = chapterIndex;

      const chapterFields = [
        ['chapterName', 'title'], ['chapterUrl', 'url'], ['updateTime', 'updateTime'],
        ['isVolume', 'isVolume'], ['isVip', 'isVip'], ['isPay', 'isPay'], ['nextTocUrl', 'nextTocUrl'],
      ];
      for (const [field, prop] of chapterFields) {
        if (!hasRule('ruleToc', field)) continue;
        stage = `toc.${field}`;
        runOne(ruleStep(`toc.${field}`, chapterText, tocBase));
        if (flowChain !== '') chapter[prop] = flowChain;
      }
      if (!chapter.url) {
        if (pickedChapter && typeof pickedChapter === 'object' && pickedChapter.url) chapter.url = String(pickedChapter.url);
        else if (isUrlLike(chapterText)) chapter.url = chapterText.trim();
      }
      if (!chapter.url) throw new UsageError('目录项没有 chapterUrl');
      chapter.index = chapterIndex;
      chapter.baseUrl = tocBase;
      chapter.bookUrl = book.bookUrl;
      summary.chapter.title = chapter.title ?? '';
      summary.chapter.url = String(chapter.url);

      // 4. 正文
      stage = 'flow.content';
      const chapterUrlRaw = String(chapter.url);
      const contentRecord = runOne(fetchStep(chapterUrlRaw, tocBase || detailBase, 'flow.content'));
      const contentBody = flowChain;
      const chapterBase = contentRecord.followed?.url
        || String(resolveFollowUrl(chapterUrlRaw, tocBase || detailBase, source?.bookSourceUrl)?.url ?? chapterUrlRaw);
      chapter.baseUrl = chapterBase;
      let finalContent = contentBody;
      if (hasRule('ruleContent', 'content')) {
        stage = 'content.content';
        const contentStep = ruleStep('content.content', contentBody, chapterBase);
        contentStep.title = chapter.title ?? '';
        runOne(contentStep);
        finalContent = flowChain;
      }
      summary.content = { title: chapter.title ?? '', chars: finalContent.length, bytes: Buffer.byteLength(finalContent) };
      summary.book.name = book.name ?? '';
      summary.book.bookUrl = String(book.bookUrl ?? '');
      summary.book.tocUrl = String(book.tocUrl ?? '');
      summary.chapter.title = chapter.title ?? '';
      summary.chapter.url = String(chapter.url ?? '');
      return { chain: finalContent, error: false, summary };
    } catch (err) {
      if (err === FLOW_STOP) return { chain: flowChain, error: true, summary };
      if (err?.code === 'CASSETTE_MISS') throw err;
      steps.push(flowErrorRecord(stage, err, bindings));
      stepSeq += 1;
      exitCode = 1;
      return { chain: flowChain, error: true, summary };
    }
  };

  for (const step of config.steps) {
    if (step.kind === 'flow') {
      const out = runFlow(step, chain);
      if (out.summary) flowReport = out.summary;
      chain = out.chain;
      if (out.error) break;
      continue;
    }
    const out = executeStep(step, chain);
    chain = commit(out);
    if (out.record.error) break;
  }

  if (config.state?.file && config.state.save !== false) {
    fs.writeFileSync(config.state.file, JSON.stringify(store.exportState(), null, 2) + '\n');
  }
  if (jarFile) fs.writeFileSync(jarFile, JSON.stringify(jar.toJSON(), null, 2) + '\n');
  cassette?.save();

  const report = {
    ok: steps.every((s) => !s.error),
    source: {
      name: source?.bookSourceName ?? '',
      url: source?.bookSourceUrl ?? '',
      file: config.source ?? null,
      project: project ?? null,
    },
    build: { warnings: buildWarnings },
    flow: flowReport,
    bindings: {
      key: config.defaults?.key ?? '',
      page: config.defaults?.page ?? 1,
      baseUrl: config.defaults?.baseUrl ?? '',
      vars: Object.fromEntries(store.vars),
      login: Object.fromEntries(store.loginInfo),
    },
    steps,
    summary: {
      stepCount: steps.length,
      netCalls: steps.reduce((n, s) => n + s.net.length, 0),
      failed: steps.filter((s) => s.error).length,
      elapsedMs: Date.now() - startedAt,
    },
  };

  return { report, exitCode };
}
