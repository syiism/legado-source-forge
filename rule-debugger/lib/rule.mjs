export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.code = 'USAGE';
  }
}

export const GROUPS = {
  search: 'ruleSearch',
  explore: 'ruleExplore',
  bookinfo: 'ruleBookInfo',
  toc: 'ruleToc',
  content: 'ruleContent',
  review: 'ruleReview',
};

const TOP_FIELDS = new Set([
  'searchUrl', 'exploreUrl', 'loginUrl', 'loginUi', 'jsLib',
  'coverDecodeJs', 'loginCheckJs', 'header', 'bookSourceComment',
]);

const RULE_FIELDS = new Set([
  'bookList', 'name', 'author', 'intro', 'kind', 'lastChapter', 'updateTime',
  'bookUrl', 'coverUrl', 'wordCount', 'checkKeyWord', 'init', 'tocUrl',
  'downloadUrls', 'canReName', 'chapterList', 'chapterName', 'chapterUrl',
  'nextTocUrl', 'isVolume', 'isVip', 'isPay', 'preUpdateJs', 'formatJs',
  'content', 'title', 'subContent', 'nextContentUrl', 'webJs', 'sourceRegex',
  'replaceRegex', 'imageStyle', 'imageDecode', 'payAction', 'callBackJs',
  'reviewUrl', 'avatarRule', 'contentRule', 'postTimeRule', 'reviewQuoteUrl',
  'voteUpUrl', 'voteDownUrl', 'postReviewUrl', 'postQuoteUrl', 'deleteUrl',
]);

export function resolveRule(source, name) {
  if (!source || typeof source !== 'object') throw new UsageError('书源对象为空');
  const label = String(name ?? '').trim();
  if (!label) throw new UsageError('--rule 需要字段名');

  if (TOP_FIELDS.has(label)) return { label, value: source[label], group: null, field: label };

  if (label.includes('.')) {
    const idx = label.indexOf('.');
    const groupText = label.slice(0, idx);
    const field = label.slice(idx + 1);
    const group = GROUPS[groupText] ?? (groupText.startsWith('rule') ? groupText : null);
    if (!group) throw new UsageError(`未知规则组：${groupText}（可用：search/explore/bookinfo/toc/content/review）`);
    const rule = source[group];
    return { label: `${group}.${field}`, value: rule?.[field], group, field };
  }

  if (RULE_FIELDS.has(label)) {
    const value = source.ruleSearch?.[label];
    return { label: `ruleSearch.${label}`, value, group: 'ruleSearch', field: label };
  }

  throw new UsageError(`未知字段：${label}（顶层或 <组>.<字段>，如 search.bookList）`);
}

// Legado 用 GSON（lenient）解析请求选项，规则里常见 {method:"POST"} 这种未加引号的键；
// JSON.parse 严格模式下会整段放弃，按「未加引号的键补引号」再试一次即可对齐。
export function parseOptionsJson(text) {
  const raw = String(text ?? '');
  try {
    return JSON.parse(raw);
  } catch {
    // fallthrough
  }
  try {
    return JSON.parse(raw.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3'));
  } catch {
    return null;
  }
}

// URL/规则尾部 `, {...}` 请求选项：允许逗号后有空白，JSON 用 GSON 宽松规则解析。
export function splitTrailingJson(text) {
  const raw = String(text ?? '');
  const match = /,\s*(\{[\s\S]*\})\s*$/.exec(raw);
  if (!match) return null;
  const json = parseOptionsJson(match[1]);
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  return { prefix: raw.slice(0, match.index), json, raw: match[0] };
}

function splitRequestOptions(body) {
  const split = splitTrailingJson(body);
  if (!split) return { body, suffix: '' };
  return { body: split.prefix, suffix: split.raw };
}

// Legado 在求值前剥离 @put:{...}，把规则按当前 result 求值后写入变量表。
const PUT_RULE = /@put:\{[^}]*\}/gi;

export function splitPutRule(value) {
  const rule = String(value ?? '');
  const putMap = {};
  let found = false;
  const stripped = rule.replace(PUT_RULE, (match) => {
    const parsed = parseOptionsJson(match.slice('@put:'.length));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.assign(putMap, parsed);
      found = true;
    }
    return '';
  });
  return found ? { rule: stripped, putMap } : { rule, putMap: {} };
}

export function extractAtom(value) {
  if (value === null || value === undefined) return { mode: 'missing' };
  if (typeof value !== 'string') return { mode: 'nonstring', raw: value };
  if (value.trim() === '') return { mode: 'empty' };

  const { rule, putMap } = splitPutRule(value);
  if (rule.trim() === '') return { mode: 'empty', putMap };

  if (rule.startsWith('@js:')) {
    const { body, suffix } = splitRequestOptions(rule.slice(4));
    return { mode: 'js', lead: '@js:', body, suffix, wrapped: false, putMap };
  }

  if (rule.startsWith('<js>')) {
    const end = rule.lastIndexOf('</js>');
    if (end < 0) return { mode: 'broken', raw: rule, putMap };
    const body = rule.slice(4, end);
    let suffix = rule.slice(end + 5);
    if (suffix.startsWith('\r\n')) suffix = suffix.slice(2);
    else if (suffix.startsWith('\n')) suffix = suffix.slice(1);
    return { mode: 'js', lead: '<js>', body, suffix, wrapped: true, putMap };
  }

  if (/\{\{[\s\S]*?\}\}/.test(rule)) return { mode: 'template', raw: rule, putMap };
  return { mode: 'plain', raw: rule, putMap };
}

export function classifySuffix(suffix) {
  const text = String(suffix ?? '').trim();
  if (!text) return { kind: 'none' };
  if (text.startsWith(',')) {
    const json = parseOptionsJson(text.slice(text.indexOf('{')));
    return { kind: 'options', text, json };
  }
  if (text.includes('##')) return { kind: 'regex', text };
  if (text.startsWith('$')) return { kind: 'jsonpath', text };
  if (text.startsWith('@')) return { kind: 'regex', text };
  return { kind: 'selector', text };
}

function pathTokens(expr) {
  const text = String(expr).trim().replace(/^\$/, '');
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.') {
      i += 1;
      let name = '';
      while (i < text.length && text[i] !== '.' && text[i] !== '[') name += text[i++];
      if (!name) throw new UsageError(`不支持的 JSONPath：${expr}`);
      tokens.push({ type: 'key', name });
    } else if (ch === '[') {
      const end = text.indexOf(']', i);
      if (end < 0) throw new UsageError(`JSONPath 括号未闭合：${expr}`);
      const inner = text.slice(i + 1, end).trim();
      if (inner === '*') tokens.push({ type: 'wildcard' });
      else if (/^-?\d+$/.test(inner)) tokens.push({ type: 'index', index: Number(inner) });
      else if (/^["'][^"']*["']$/.test(inner)) tokens.push({ type: 'key', name: inner.slice(1, -1) });
      else throw new UsageError(`不支持的 JSONPath 片段：[${inner}]`);
      i = end + 1;
    } else {
      throw new UsageError(`不支持的 JSONPath：${expr}`);
    }
  }
  return tokens;
}

function walk(value, tokens, depth) {
  if (depth >= tokens.length) return value;
  const token = tokens[depth];
  if (token.type === 'key') {
    if (value === null || typeof value !== 'object') return undefined;
    return walk(value[token.name], tokens, depth + 1);
  }
  if (token.type === 'index') {
    if (!Array.isArray(value)) return undefined;
    const idx = token.index < 0 ? value.length + token.index : token.index;
    return walk(value[idx], tokens, depth + 1);
  }
  if (!Array.isArray(value)) return undefined;
  const out = [];
  for (const item of value) {
    const v = walk(item, tokens, depth + 1);
    if (v !== undefined) out.push(v);
  }
  return out;
}

export function applyJsonPath(value, expr) {
  return walk(value, pathTokens(expr), 0);
}

export function applySuffix(value, suffix) {
  const info = classifySuffix(suffix);
  if (info.kind !== 'jsonpath') return { value, info, error: null };
  let target = value;
  if (typeof target === 'string') {
    try {
      target = JSON.parse(target);
    } catch {
      return { value, info, error: `结果不是 JSON，无法应用 ${info.text}` };
    }
  }
  try {
    return { value: applyJsonPath(target, info.text), info, error: null };
  } catch (err) {
    return { value, info, error: err.message };
  }
}

function splitRegexRule(rule) {
  const text = String(rule ?? '');
  if (!text.includes('##')) return { base: text.trim(), hasRegex: false };
  const parts = text.split('##');
  return {
    base: parts[0].trim(),
    hasRegex: true,
    pattern: parts[1] ?? '',
    replacement: parts[2] ?? '',
    first: parts.length > 3,
  };
}

// JSON result 下的裸字段（data.books / title / book.author）等价于 $. 开头的 JSONPath
export function looksLikeJsonPath(rule) {
  const text = String(rule ?? '').trim();
  if (!text) return false;
  if (text.startsWith('$')) return true;
  if (/^(?:https?:|data:|\/)/i.test(text)) return false;
  return /^[A-Za-z_$][\w$-]*(?:(?:\.[A-Za-z_$][\w$-]*)|(?:\[(?:\d+|\*|"[^"]*"|'[^']*')\]))*$/.test(text);
}

export function isJsonText(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') return true;
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function asJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function applyRegexReplace(text, { pattern, replacement, first }) {
  if (!pattern) return text;
  try {
    if (first) {
      const regex = new RegExp(pattern);
      const match = regex.exec(text);
      return match ? match[0].replace(regex, replacement) : '';
    }
    return text.replace(new RegExp(pattern, 'g'), replacement);
  } catch {
    return text;
  }
}

export function stringifyRuleValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map((item) => stringifyRuleValue(item)).join('\n');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// 求值单条规则：JSONPath（含裸字段）+ 尾部 ##regex##replacement 替换。
// JS/选择器仍由调用方处理；这里只覆盖 JSON 结果和规则内嵌取值。
export function evaluateRule(value, rule) {
  const { base, hasRegex, pattern, replacement, first } = splitRegexRule(rule);
  let out;
  if (!base) {
    out = value;
  } else if (base.startsWith('$') || (isJsonText(value) && looksLikeJsonPath(base))) {
    const expr = base.startsWith('$') ? base : `$.${base}`;
    out = applyJsonPath(asJson(value), expr);
  } else {
    out = base;
  }
  if (hasRegex) out = applyRegexReplace(stringifyRuleValue(out), { pattern, replacement, first });
  return out;
}

export function evaluateRuleString(value, rule) {
  return stringifyRuleValue(evaluateRule(value, rule));
}

export function evaluateRuleList(value, rule) {
  const out = evaluateRule(value, rule);
  if (out === undefined || out === null) return [];
  if (Array.isArray(out)) return out.map((item) => stringifyRuleValue(item));
  return [stringifyRuleValue(out)];
}

export function hasTemplate(text) {
  return typeof text === 'string' && /\{\{[\s\S]*?\}\}/.test(text);
}

const URL_LIKE = /^(https?:\/\/|data:|\/)/i;

// 规则经常把 Legado 请求选项直接拼进返回值：`<url>,{"type":"gysearch"}`
export function splitResultOptions(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const split = splitTrailingJson(text);
  if (!split) return null;
  const url = split.prefix.trim();
  if (!URL_LIKE.test(url)) return null;
  return { url, json: split.json };
}

// Legado 的 makeUpRule 对 {{}} 求值失败会直接抛错；这里同样不吞异常。
export function renderTemplate(text, evaluate) {
  return String(text).replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
    const value = evaluate(expr.trim());
    return value === null || value === undefined ? '' : String(value);
  });
}
