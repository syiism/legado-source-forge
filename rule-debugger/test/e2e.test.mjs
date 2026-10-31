import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Cassette } from '../lib/net/cassette.mjs';

const HERE = import.meta.dirname;
const BIN = path.join(HERE, '..', 'bin', 'legado-debug.mjs');
const FIXTURE = path.join(HERE, 'fixtures', 'mini-source.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-debugger-e2e-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function runCli(args) {
  const res = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

function json(out) {
  return JSON.parse(out);
}

function writeCassette(name, entries) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ v: 1, entries }, null, 2));
  return file;
}

function cassetteEntry(url, body) {
  return {
    key: Cassette.key('GET', url, ''),
    method: 'GET',
    url,
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    finalUrl: url,
    body,
  };
}

function writeFlowSource(name) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify([{
    bookSourceName: 'flow-fixture',
    bookSourceUrl: 'https://flow.test',
    searchUrl: '<js>\n"/search?q=" + key + "&page=" + page\n</js>',
    ruleSearch: {
      bookList: 'data.books',
      name: 'title',
      author: 'author',
      bookUrl: '@js:\n"/book/" + {{$.id}};',
    },
    ruleBookInfo: {
      name: 'book.title',
      author: 'book.author',
      tocUrl: '@js:\n"/toc/" + {{$.book.id}};',
    },
    ruleToc: {
      chapterList: 'data.chapters',
      chapterName: 'title',
      chapterUrl: '@js:\n"/chapter/" + {{$.id}};',
    },
    ruleContent: { content: 'data.content' },
  }]));
  return file;
}

test('searchUrl 输出可读 JSON，退出码 0', () => {
  const { code, stdout, stderr } = runCli([
    '--source', FIXTURE, '--rule', 'searchUrl', '--key', '斗破苍穹', '--json',
  ]);
  assert.equal(code, 0, stderr);
  const report = json(stdout);
  assert.equal(report.ok, true);
  assert.equal(report.steps[0].label, 'searchUrl');
  assert.equal(report.steps[0].mode, 'js');
  assert.equal(
    report.steps[0].result.text,
    '/search?q=%E6%96%97%E7%A0%B4%E8%8B%8D%E7%A9%B9&page=1',
  );
});

test('多步串联：上一步输出作为下一步 result，jsLib 共享', () => {
  const { code, stdout } = runCli([
    '--source', FIXTURE, '--key', 'abc', '--rule', 'searchUrl', '--rule', 'bookList', '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.steps.length, 2);
  assert.equal(report.steps[1].label, 'ruleSearch.bookList');
  assert.equal(report.steps[1].suffix.kind, 'jsonpath');
  assert.equal(report.steps[1].suffixApplied.type, 'array[2]');
  assert.deepEqual(JSON.parse(report.steps[1].suffixApplied.text), [
    { name: 'p:abc#1' },
    { name: 'p:abc#2' },
  ]);
});

test('--result @file 与 --offline 不触网', () => {
  const input = path.join(dir, 'result.txt');
  fs.writeFileSync(input, 'ignored-by-fixture');
  const { code, stdout } = runCli([
    '--source', FIXTURE, '--rule', 'bookList', '--result', `@${input}`, '--key', 'k', '--offline', '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.summary.netCalls, 0);
  assert.equal(JSON.parse(report.steps[0].suffixApplied.text)[0].name, 'p:k#1');
});

test('变量 put/get 跨步共享，--var 注入默认值', () => {
  const { code, stdout } = runCli([
    '--source', FIXTURE, '--var', 'seed=1',
    '--js', "source.putVariable('x', String(source.getVariable('seed') + 'a')); 'ok'",
    '--js', "source.getVariable('x')",
    '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.steps[1].result.text, '1a');
});

test('loginUi 执行前拼接 loginUrl（Legado getLoginJs 语义）', () => {
  const file = path.join(dir, 'login-source.json');
  fs.writeFileSync(file, JSON.stringify([{
    bookSourceName: 'login',
    bookSourceUrl: 'login-probe',
    searchUrl: '@js:""',
    loginUrl: "@js:function who(){ return 'lv'; } source.putVariable('fromLogin', '1');",
    loginUi: '@js:JSON.stringify([{ title: who(), value: source.getVariable("fromLogin") }])',
  }]));
  const { code, stdout, stderr } = runCli(['--source', file, '--rule', 'loginUi', '--json']);
  assert.equal(code, 0, stderr);
  const text = json(stdout).steps[0].result.text;
  assert.deepEqual(JSON.parse(text), [{ title: 'lv', value: '1' }]);
});

test('纯 JSONPath 字段规则就地求值', () => {
  const { code, stdout, stderr } = runCli([
    '--source', FIXTURE, '--rule', 'search.name', '--result', '{"name":"斗破苍穹"}', '--json',
  ]);
  assert.equal(code, 0, stderr);
  const report = json(stdout);
  assert.equal(report.steps[0].mode, 'plain');
  assert.equal(report.steps[0].result.text, '斗破苍穹');
  assert.equal(report.steps[0].suffixApplied.type, 'string');
});

test('java.startBrowser 记录警告但不中断步骤', () => {
  const { code, stdout } = runCli([
    '--source', FIXTURE, '--js', "java.startBrowser('https://m.test/x'); 'after'", '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.steps[0].result.text, 'after');
  assert.ok(report.steps[0].logs.some((l) => l.kind === 'warn' && /startBrowser/.test(l.text)));
});

test('--state 写回并在下一次运行读入', () => {  const state = path.join(dir, 'state.json');
  const first = runCli(['--source', FIXTURE, '--state', state, '--js', "source.putVariable('token', 't1')", '--json']);
  assert.equal(first.code, 0);
  const saved = json(fs.readFileSync(state, 'utf8'));
  assert.equal(saved.vars.token, 't1');
  const second = runCli(['--source', FIXTURE, '--state', state, '--js', "source.getVariable('token')", '--json']);
  assert.equal(second.code, 0);
  assert.equal(json(second.stdout).steps[0].result.text, 't1');
});

test('--js + cassette 回放：网络调用走录制，结果稳定', () => {
  const url = 'https://fixture.test/api';
  const cassette = writeCassette('ok.json', [{
    key: Cassette.key('GET', url, ''),
    method: 'GET',
    url,
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    finalUrl: url,
    body: '{"ok":true}',
  }]);
  const args = ['--source', FIXTURE, '--js', `java.ajax('${url}')`, '--cassette', cassette, '--json'];
  const first = runCli(args);
  const second = runCli(args);
  assert.equal(first.code, 0, first.stderr);
  const a = json(first.stdout);
  const b = json(second.stdout);
  assert.equal(a.steps[0].result.text, '{"ok":true}');
  assert.equal(a.steps[0].net[0].mode, 'replay');
  const strip = ({ ms, ...rest }) => rest;
  assert.deepEqual(strip(a.steps[0].net[0]), strip(b.steps[0].net[0]));
  assert.deepEqual(a.steps[0].result, b.steps[0].result);
});

test('--offline 下的网络调用以退出码 1 报错', () => {
  const { code, stdout } = runCli([
    '--source', FIXTURE, '--js', "java.ajax('https://blocked.test/x')", '--offline', '--json',
  ]);
  assert.equal(code, 1);
  const report = json(stdout);
  assert.equal(report.ok, false);
  assert.match(report.steps[0].error.message, /离线|OFFLINE/);
  assert.equal(report.steps[0].net[0].mode, 'error');
  assert.equal(report.steps[0].net[0].error, 'OFFLINE');
});

test('cassette 未命中退出码 3', () => {
  const cassette = writeCassette('empty.json', []);
  const { code, stdout, stderr } = runCli([
    '--source', FIXTURE, '--js', "java.ajax('https://missing.test/x')", '--cassette', cassette,
  ]);
  assert.equal(code, 3);
  assert.equal(stdout, '');
  assert.match(stderr, /cassette 未命中/);
});

test('字段不存在：退出码 1 并给出错误', () => {
  const { code, stdout } = runCli(['--source', FIXTURE, '--rule', 'ruleSearch.nope', '--json']);
  assert.equal(code, 1);
  const report = json(stdout);
  assert.match(report.steps[0].error.message, /不存在或为空/);
});

test('用法错误退出码 2', () => {
  const missingStep = runCli(['--source', FIXTURE]);
  assert.equal(missingStep.code, 2);
  assert.match(missingStep.stderr, /参数错误/);

  const missingSource = runCli(['--rule', 'searchUrl']);
  assert.equal(missingSource.code, 2);
});

test('--project 构建失败退出码 4', () => {
  const project = fs.mkdtempSync(path.join(dir, 'broken-'));
  fs.writeFileSync(path.join(project, 'build.mjs'), "console.error('gate failed'); process.exit(1);\n");
  const { code, stderr } = runCli(['--project', project, '--rule', 'searchUrl']);
  assert.equal(code, 4);
  assert.match(stderr, /构建失败/);
  assert.match(stderr, /gate failed/);
});

test('--project 门禁失败后自动用 --no-gate 重试', () => {
  const project = fs.mkdtempSync(path.join(dir, 'nogate-'));
  fs.writeFileSync(path.join(project, 'build.mjs'), [
    "import fs from 'node:fs';",
    "const out = process.argv[process.argv.indexOf('--out') + 1];",
    "if (!process.argv.includes('--no-gate')) { console.error('✘ 语法门禁失败 demo'); process.exit(1); }",
    "fs.writeFileSync(out, JSON.stringify([{ bookSourceName: 'nogate', bookSourceUrl: 'https://n.test', searchUrl: '@js:1' }]));",
  ].join('\n'));
  const { code, stdout } = runCli(['--project', project, '--rule', 'searchUrl', '--json']);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.match(report.build.warnings[0], /--no-gate/);
  assert.equal(report.steps[0].result.text, '1');
});

test('--result 的 data:;base64 URI 按 Legado 语义解码后注入 result', () => {
  const b64 = Buffer.from('sqtoc:3380555', 'utf8').toString('base64');
  const plain = runCli([
    '--source', FIXTURE, '--js', 'String(result)', '--result', `data:;base64,${b64}`, '--json',
  ]);
  assert.equal(plain.code, 0);
  assert.equal(json(plain.stdout).steps[0].result.text, 'sqtoc:3380555');

  const typed = runCli([
    '--source', FIXTURE, '--js', 'String(result)', '--result', `data:;base64,${b64}, {"type":"sq"}`, '--json',
  ]);
  assert.equal(typed.code, 0);
  assert.equal(json(typed.stdout).steps[0].result.text, Buffer.from('sqtoc:3380555').toString('hex'));
});

test('java.get(key) 读变量，get(url, headers) 发请求', () => {
  const { code, stdout } = runCli([
    '--source', FIXTURE, '--offline', '--js', "java.put('x','y'); String(java.get('x'))", '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.steps[0].result.text, 'y');
  assert.equal(report.steps[0].net.length, 0);
  assert.deepEqual(report.steps[0].vars.ruleMap, [{ key: 'x', to: 'y' }]);

  const url = 'https://fixture.test/get';
  const cassette = writeCassette('java-get.json', [{
    key: Cassette.key('GET', url, ''),
    method: 'GET',
    url,
    status: 200,
    headers: { 'content-type': 'text/plain' },
    finalUrl: url,
    body: 'ok',
  }]);
  const http = runCli([
    '--source', FIXTURE, '--js', `String(java.get('${url}', {}).body())`, '--cassette', cassette, '--json',
  ]);
  assert.equal(http.code, 0);
  assert.equal(json(http.stdout).steps[0].result.text, 'ok');
});

test('java.getString / getStringList 按当前 result 求值', () => {
  const one = runCli([
    '--source', FIXTURE, '--js', "java.getString('$.a.b')", '--result', '{"a":{"b":"v"}}', '--offline', '--json',
  ]);
  assert.equal(one.code, 0);
  assert.equal(json(one.stdout).steps[0].result.text, 'v');

  const list = runCli([
    '--source', FIXTURE, '--js', "JSON.stringify(java.getStringList('$.a[*].b'))",
    '--result', '{"a":[{"b":1},{"b":2}]}', '--offline', '--json',
  ]);
  assert.equal(list.code, 0);
  assert.deepEqual(JSON.parse(json(list.stdout).steps[0].result.text), ['1', '2']);
});

test('@js 内的 {{}} 与 @put 生效', () => {
  const file = path.join(dir, 'semantics-source.json');
  fs.writeFileSync(file, JSON.stringify([{
    bookSourceName: 'semantics',
    bookSourceUrl: 'https://sem.test',
    ruleSearch: {
      bookList: 'data.books',
      name: 'title@put:{"bid":"$.id"}',
      bookUrl: '@js:\nvar p = { id: {{$.id}} };\n"/detail?id=" + p.id;',
    },
  }]));
  const bookUrl = runCli([
    '--source', file, '--rule', 'search.bookUrl', '--result', '{"id":7}', '--offline', '--json',
  ]);
  assert.equal(bookUrl.code, 0);
  assert.equal(json(bookUrl.stdout).steps[0].result.text, '/detail?id=7');

  const name = runCli([
    '--source', file, '--rule', 'search.name', '--result', '{"id":7,"title":"A"}', '--offline', '--json',
  ]);
  assert.equal(name.code, 0);
  const report = json(name.stdout);
  assert.equal(report.steps[0].result.text, 'A');
  assert.deepEqual(report.steps[0].vars.ruleMap, [{ key: 'bid', to: '7' }]);

  const list = runCli([
    '--source', file, '--rule', 'search.bookList', '--result', '{"data":{"books":[{"id":1}]}}',
    '--offline', '--json',
  ]);
  assert.equal(list.code, 0);
  assert.deepEqual(JSON.parse(json(list.stdout).steps[0].result.text), [{ id: 1 }]);

  const inlineJs = runCli([
    '--source', file, '--js', 'var x = {{@js:1 + 1}}; String(x)', '--offline', '--json',
  ]);
  assert.equal(inlineJs.code, 0);
  assert.equal(json(inlineJs.stdout).steps[0].result.text, '2');

  const broken = runCli([
    '--source', file, '--js', "var x = '{{nope()}}'; 'ok'", '--offline', '--json',
  ]);
  assert.equal(broken.code, 1);
  assert.match(json(broken.stdout).steps[0].error.message, /nope is not defined/);
});

test('--follow 用 bookSourceUrl 解析相对 URL 并把响应作为结果', () => {
  const url = 'https://fixture.test/search?q=abc&page=1';
  const cassette = writeCassette('follow.json', [{
    key: Cassette.key('GET', url, ''),
    method: 'GET',
    url,
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    finalUrl: url,
    body: '{"data":[{"name":"x"}]}',
  }]);
  const file = path.join(dir, 'follow-source.json');
  fs.writeFileSync(file, JSON.stringify([{
    bookSourceName: 'follow',
    bookSourceUrl: 'https://fixture.test',
    searchUrl: '<js>\n"/search?q=" + key + "&page=" + page\n</js>',
    ruleSearch: { bookList: 'data' },
  }]));
  const { code, stdout } = runCli([
    '--source', file, '--key', 'abc', '--rule', 'searchUrl', '--follow', '--rule', 'bookList',
    '--cassette', cassette, '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.steps[0].followed.url, url);
  assert.equal(report.steps[0].result.text, '{"data":[{"name":"x"}]}');
  assert.deepEqual(JSON.parse(report.steps[1].result.text), [{ name: 'x' }]);
});

const FLOW_CASSETTE = [
  cassetteEntry('https://flow.test/search?q=abc&page=1', JSON.stringify({
    data: { books: [{ id: 1, title: '书一', author: '作者一' }, { id: 2, title: '书二', author: '作者二' }] },
  })),
  cassetteEntry('https://flow.test/book/1', JSON.stringify({ book: { id: 1, title: '书一详情', author: '作者一详情' } })),
  cassetteEntry('https://flow.test/book/2', JSON.stringify({ book: { id: 2, title: '书二详情', author: '作者二详情' } })),
  cassetteEntry('https://flow.test/toc/1', JSON.stringify({
    data: { chapters: [{ id: 10, title: '第1章' }, { id: 11, title: '第2章' }] },
  })),
  cassetteEntry('https://flow.test/toc/2', JSON.stringify({
    data: { chapters: [{ id: 20, title: '第1章' }, { id: 21, title: '第2章' }] },
  })),
  cassetteEntry('https://flow.test/chapter/10', JSON.stringify({ data: { content: '正文一' } })),
  cassetteEntry('https://flow.test/chapter/11', JSON.stringify({ data: { content: '正文一第二' } })),
  cassetteEntry('https://flow.test/chapter/20', JSON.stringify({ data: { content: '正文二' } })),
  cassetteEntry('https://flow.test/chapter/21', JSON.stringify({ data: { content: '正文二第二' } })),
];

test('--flow 默认选中搜索结果第一条与目录第一章', () => {
  const file = writeFlowSource('flow-source.json');
  const cassette = writeCassette('flow.cassette.json', FLOW_CASSETTE);
  const { code, stdout } = runCli([
    '--source', file, '--key', 'abc', '--flow', '--cassette', cassette, '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.ok, true);
  assert.equal(report.flow.search.total, 2);
  assert.equal(report.flow.search.index, 0);
  assert.equal(report.flow.book.name, '书一详情');
  assert.equal(report.flow.toc.total, 2);
  assert.equal(report.flow.toc.index, 0);
  assert.equal(report.flow.chapter.title, '第1章');
  assert.equal(report.flow.content.chars, '正文一'.length);
  assert.equal(report.steps.at(-1).result.text, '正文一');
  for (const label of ['flow.search', 'flow.detail', 'flow.toc', 'flow.content']) {
    assert.ok(report.steps.some((s) => s.label === label), `缺少步骤 ${label}`);
  }
});

test('--flow 支持选择第 N 本书与第 N 章', () => {
  const file = writeFlowSource('flow-source-index.json');
  const cassette = writeCassette('flow-index.cassette.json', FLOW_CASSETTE);
  const { code, stdout } = runCli([
    '--source', file, '--key', 'abc',
    '--flow', '--book-index', '1', '--chapter-index', '1', '--cassette', cassette, '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.flow.book.name, '书二详情');
  assert.equal(report.flow.toc.index, 1);
  assert.equal(report.flow.chapter.title, '第2章');
  assert.equal(report.steps.at(-1).result.text, '正文二第二');
});

test('--flow 搜索为空时在 bookList 阶段报错', () => {
  const file = writeFlowSource('flow-source-empty.json');
  const cassette = writeCassette('flow-empty.cassette.json', [
    cassetteEntry('https://flow.test/search?q=abc&page=1', '{"data":{"books":[]}}'),
  ]);
  const { code, stdout } = runCli([
    '--source', file, '--key', 'abc', '--flow', '--cassette', cassette, '--json',
  ]);
  assert.equal(code, 1);
  const report = json(stdout);
  assert.equal(report.ok, false);
  assert.equal(report.flow.search.total, 0);
  assert.match(report.steps.at(-1).error.message, /搜索结果为空/);
});

test('--flow 的章节 data URI + type 在 fetch 阶段本地转 hex', () => {
  const file = path.join(dir, 'flow-source-datauri.json');
  fs.writeFileSync(file, JSON.stringify([{
    bookSourceName: 'flow-datauri',
    bookSourceUrl: 'https://flow.test',
    searchUrl: '<js>\n"/search?q=" + key + "&page=" + page\n</js>',
    ruleSearch: { bookList: 'data.books', bookUrl: '@js:\n"/book/" + {{$.id}};' },
    ruleBookInfo: { tocUrl: '@js:\n"/toc/" + {{$.book.id}};' },
    ruleToc: {
      chapterList: 'data.chapters',
      chapterUrl: '@js:\n"data:;base64," + java.base64Encode(String({{$.id}}) + "/abc/0") + ",{\\"type\\":\\"qm\\"}";',
    },
    ruleContent: { content: '@js:\njava.hexDecodeToString(result);' },
  }]));
  const cassette = writeCassette('flow-datauri.cassette.json', [
    cassetteEntry('https://flow.test/search?q=abc&page=1', JSON.stringify({ data: { books: [{ id: 1, title: '书一' }] } })),
    cassetteEntry('https://flow.test/book/1', JSON.stringify({ book: { id: 1, title: '书一' } })),
    cassetteEntry('https://flow.test/toc/1', JSON.stringify({ data: { chapters: [{ id: 10 }] } })),
  ]);
  const { code, stdout } = runCli([
    '--source', file, '--key', 'abc', '--flow', '--cassette', cassette, '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.steps.at(-1).label, 'ruleContent.content');
  assert.equal(report.steps.at(-1).result.text, '10/abc/0');
  assert.equal(report.steps.find((s) => s.label === 'flow.content').net[0].mode, 'data');
});

test('--flow 可用 --result 喂搜索响应，跳过 searchUrl 请求', () => {
  const file = writeFlowSource('flow-source-seed.json');
  const seed = path.join(dir, 'flow-search.json');
  fs.writeFileSync(seed, JSON.stringify({
    data: { books: [{ id: 1, title: '书一', author: '作者一' }] },
  }));
  const cassette = writeCassette('flow-seed.cassette.json', FLOW_CASSETTE.filter((entry) => !entry.url.includes('/search')));
  const { code, stdout } = runCli([
    '--source', file, '--flow', '--result', `@${seed}`, '--cassette', cassette, '--json',
  ]);
  assert.equal(code, 0);
  const report = json(stdout);
  assert.equal(report.steps[0].label, 'ruleSearch.bookList');
  assert.equal(report.flow.book.name, '书一详情');
  assert.equal(report.steps.at(-1).result.text, '正文一');
});

test('--help 退出码 0 且列出退出码约定', () => {
  const { code, stdout } = runCli(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /退出码：0 成功/);
});
