import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractAtom,
  classifySuffix,
  applyJsonPath,
  applySuffix,
  resolveRule,
  renderTemplate,
  hasTemplate,
  splitResultOptions,
  UsageError,
} from '../lib/rule.mjs';

const source = JSON.parse(fs.readFileSync(new URL('./fixtures/mini-source.json', import.meta.url), 'utf8'))[0];

test('提取 @js: 原子', () => {
  const atom = extractAtom('@js:\nvar a = 1;\na');
  assert.equal(atom.mode, 'js');
  assert.equal(atom.lead, '@js:');
  assert.equal(atom.body, '\nvar a = 1;\na');
  assert.equal(atom.suffix, '');
});

test('提取 <js> 原子并保留 JSONPath 后缀', () => {
  const atom = extractAtom('<js>\nJSON.stringify({data: [1]})\n</js>\n$.data');
  assert.equal(atom.mode, 'js');
  assert.equal(atom.body, '\nJSON.stringify({data: [1]})\n');
  assert.equal(atom.suffix, '$.data');
});

test('<js> 无换行与 CSS 后缀', () => {
  const atom = extractAtom('<js>1+1</js>ul li');
  assert.equal(atom.body, '1+1');
  assert.equal(classifySuffix(atom.suffix).kind, 'selector');
});

test('@js: 尾部的请求选项被识别为 suffix', () => {
  const atom = extractAtom('@js:fetch(),{"method":"POST"}');
  assert.equal(atom.body, 'fetch()');
  const info = classifySuffix(atom.suffix);
  assert.equal(info.kind, 'options');
  assert.equal(info.json.method, 'POST');
});

test('模板与普通值', () => {
  assert.equal(extractAtom('https://x.test/{{page}}').mode, 'template');
  assert.equal(extractAtom('https://x.test/list').mode, 'plain');
  assert.equal(hasTemplate('a{{key}}b'), true);
  assert.equal(renderTemplate('a{{ 1 + 2 }}b{{nope()}}c', (expr) => {
    if (expr.startsWith('nope')) throw new Error('boom');
    return eval(expr);
  }), 'a3bc');
});

test('JSONPath 子集', () => {
  const data = { data: [{ name: 'a' }, { name: 'b' }], nested: { list: [10, 20] } };
  assert.deepEqual(applyJsonPath(data, '$.data[*].name'), ['a', 'b']);
  assert.equal(applyJsonPath(data, '$.data[0].name'), 'a');
  assert.equal(applyJsonPath(data, '$.data[-1].name'), 'b');
  assert.equal(applyJsonPath(data, '$.nested.list[1]'), 20);
  assert.equal(applyJsonPath(data, '$'), data);
  assert.throws(() => applyJsonPath(data, '$..name'), UsageError);
});

test('applySuffix 处理字符串化 JSON 与失败分支', () => {
  const ok = applySuffix('{"data":[{"a":1}]}', '$.data[0].a');
  assert.equal(ok.error, null);
  assert.equal(ok.value, 1);
  const bad = applySuffix('not json', '$.data');
  assert.match(bad.error, /不是 JSON/);
  const selector = applySuffix('{"data":1}', 'ul li');
  assert.equal(selector.info.kind, 'selector');
});

test('字段定位：简写 / 组.字段 / 顶层', () => {
  const a = resolveRule(source, 'bookList');
  assert.equal(a.label, 'ruleSearch.bookList');
  assert.match(a.value, /wrap\(key\)/);
  assert.equal(resolveRule(source, 'search.bookList').label, 'ruleSearch.bookList');
  assert.equal(resolveRule(source, 'ruleSearch.bookList').label, 'ruleSearch.bookList');
  assert.equal(resolveRule(source, 'searchUrl').label, 'searchUrl');
  assert.throws(() => resolveRule(source, 'nope'), UsageError);
  assert.throws(() => resolveRule(source, 'badgroup.x'), UsageError);
});

test('请求选项容忍未加引号的键（Legado GSON 宽松解析）', () => {
  const parsed = classifySuffix(',{method:"POST", body:"{}",headers:{"content-type":"application/json"}}');
  assert.equal(parsed.kind, 'options');
  assert.equal(parsed.json.method, 'POST');
  assert.equal(parsed.json.headers['content-type'], 'application/json');
  const split = splitResultOptions('https://x.test/api,{method:"POST", body:"{\\"a\\":1}"}');
  assert.equal(split.url, 'https://x.test/api');
  assert.equal(split.json.method, 'POST');
});

test('splitResultOptions 识别返回值里内嵌的请求选项', () => {
  const gy = splitResultOptions('data:;base64,eyJrZXkiOiLmlpfnoLToi43nqbkiLCJ0YWIiOiLlsI/or7QiLCJzb3VyY2VzS2V5Ijoi5YWo6YOoIiwicGFnZSI6MSwiZGlzYWJsZWRfc291cmNlcyI6IjAifQ==,{"type":"gysearch"}');
  assert.equal(gy.json.type, 'gysearch');
  assert.ok(gy.url.startsWith('data:;base64,'));
  const http = splitResultOptions('https://x.test/api?a=1,{"method":"POST","body":"{}"}');
  assert.equal(http.url, 'https://x.test/api?a=1');
  assert.equal(http.json.method, 'POST');
  assert.equal(splitResultOptions('https://x.test/api'), null);
  assert.equal(splitResultOptions('just,{"a":1}'), null);
  assert.equal(splitResultOptions('https://x.test/api,{broken'), null);
  assert.equal(splitResultOptions('https://x.test/api,["a"]'), null);
  assert.equal(splitResultOptions(null), null);
});
