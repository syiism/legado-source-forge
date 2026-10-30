import fs from 'node:fs';
import { loadSource } from './load.mjs';
import { Store } from './store.mjs';
import { Sandbox, rhinoHint } from './sandbox.mjs';
import { resolveRule, extractAtom, classifySuffix, applySuffix, renderTemplate, splitResultOptions } from './rule.mjs';
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
  const { source, project } = loadSource(config);

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
  const java = makeJavaBindings({ client, store, hooks, sourceApi });
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
  let chain = config.defaults?.result !== null && config.defaults?.result !== undefined
    ? readText(config.defaults.result)
    : '';
  let exitCode = 0;

  for (let i = 0; i < config.steps.length; i++) {
    currentStep = i;
    store.step = i;
    const step = config.steps[i];
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
    const resultInput = step.result !== null && step.result !== undefined ? readText(step.result) : chain;

    sandbox.set('result', resultInput);
    sandbox.set('baseUrl', baseUrl);
    sandbox.set('key', key);
    sandbox.set('page', page);
    sandbox.set('book', book);
    sandbox.set('chapter', chapter);
    sandbox.set('infoMap', infoMap);

    const record = {
      index: i,
      label: '',
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

    try {
      let atom;
      if (step.kind === 'rule') {
        const field = resolveRule(source, step.value);
        if (field.value === null || field.value === undefined) {
          throw new Error(`字段 ${field.label} 不存在或为空`);
        }
        atom = extractAtom(field.value);
        record.label = field.label;
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

      if (atom.mode === 'js') {
        record.suffix = classifySuffix(atom.suffix);
        rawValue = sandbox.runAtom(atom.body);
        if (record.suffix.kind === 'jsonpath') {
          const applied = applySuffix(rawValue, atom.suffix);
          if (applied.error) hooks.warn(applied.error);
          else {
            rawValue = applied.value;
            record.suffixApplied = describeValue(applied.value);
            chainValue = toChain(applied.value);
          }
        } else {
          chainValue = toChain(rawValue);
        }
      } else if (atom.mode === 'template') {
        rawValue = renderTemplate(atom.raw, (expr) => sandbox.runExpression(expr));
        chainValue = toChain(rawValue);
      } else if (atom.mode === 'plain' && String(atom.raw).trim().startsWith('$')) {
        // 纯 JSONPath 字段规则：以当前 result 为输入就地求值
        const applied = applySuffix(resultInput, String(atom.raw).trim());
        if (applied.error) {
          hooks.warn(applied.error);
          rawValue = atom.raw;
        } else if (applied.value === undefined) {
          hooks.warn(`JSONPath ${String(atom.raw).trim()} 未命中当前 result`);
          rawValue = '';
        } else {
          rawValue = applied.value;
          record.suffixApplied = describeValue(applied.value);
        }
        chainValue = toChain(rawValue);
      } else {
        rawValue = atom.raw;
        chainValue = toChain(rawValue);
      }

      record.result = describeValue(rawValue);
      record.requestOptions = splitResultOptions(typeof rawValue === 'string' ? rawValue : null);
    } catch (err) {
      if (err?.code === 'CASSETTE_MISS') throw err;
      record.error = describeError(err);
      exitCode = 1;
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
    steps.push(record);
    chain = chainValue;

    if (record.error) break;
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
