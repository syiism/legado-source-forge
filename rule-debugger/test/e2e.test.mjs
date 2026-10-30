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

test('--help 退出码 0 且列出退出码约定', () => {
  const { code, stdout } = runCli(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /退出码：0 成功/);
});
