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

const REQUEST_OPTIONS = /,\s*(\{[\s\S]*\})\s*$/;

function splitRequestOptions(body) {
  const match = REQUEST_OPTIONS.exec(body);
  if (!match) return { body, suffix: '' };
  try {
    JSON.parse(match[1]);
  } catch {
    return { body, suffix: '' };
  }
  return { body: body.slice(0, match.index), suffix: body.slice(match.index) };
}

export function extractAtom(value) {
  if (value === null || value === undefined) return { mode: 'missing' };
  if (typeof value !== 'string') return { mode: 'nonstring', raw: value };
  if (value.trim() === '') return { mode: 'empty' };

  if (value.startsWith('@js:')) {
    const { body, suffix } = splitRequestOptions(value.slice(4));
    return { mode: 'js', lead: '@js:', body, suffix, wrapped: false };
  }

  if (value.startsWith('<js>')) {
    const end = value.lastIndexOf('</js>');
    if (end < 0) return { mode: 'broken', raw: value };
    const body = value.slice(4, end);
    let suffix = value.slice(end + 5);
    if (suffix.startsWith('\r\n')) suffix = suffix.slice(2);
    else if (suffix.startsWith('\n')) suffix = suffix.slice(1);
    return { mode: 'js', lead: '<js>', body, suffix, wrapped: true };
  }

  if (/\{\{[\s\S]*?\}\}/.test(value)) return { mode: 'template', raw: value };
  return { mode: 'plain', raw: value };
}

export function classifySuffix(suffix) {
  const text = String(suffix ?? '').trim();
  if (!text) return { kind: 'none' };
  if (text.startsWith(',')) {
    let json = null;
    try {
      json = JSON.parse(text.slice(text.indexOf('{')));
    } catch {
      json = null;
    }
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

export function hasTemplate(text) {
  return typeof text === 'string' && /\{\{[\s\S]*?\}\}/.test(text);
}

const URL_LIKE = /^(https?:\/\/|data:|\/)/i;

// 规则经常把 Legado 请求选项直接拼进返回值：`<url>,{"type":"gysearch"}`
export function splitResultOptions(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const idx = text.lastIndexOf(',{');
  if (idx <= 0) return null;
  const url = text.slice(0, idx).trim();
  if (!URL_LIKE.test(url)) return null;
  let json;
  try {
    json = JSON.parse(text.slice(idx + 1));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  return { url, json };
}

export function renderTemplate(text, evaluate) {
  return String(text).replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => {
    try {
      const value = evaluate(expr.trim());
      return value === null || value === undefined ? '' : String(value);
    } catch {
      return '';
    }
  });
}
