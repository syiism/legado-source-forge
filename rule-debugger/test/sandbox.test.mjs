import test from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox, rhinoHint } from '../lib/sandbox.mjs';

test('jsLib 顶层 let/function 跨步可见', () => {
  const sb = new Sandbox({ jsLib: "let PREFIX = 'p:'; function wrap(v){ return PREFIX + String(v); }" });
  assert.equal(sb.runAtom("wrap('a')"), 'p:a');
  sb.set('key', 'k');
  assert.equal(sb.runAtom('PREFIX + key'), 'p:k');
});

test('completion value：最后一条表达式即返回值', () => {
  const sb = new Sandbox();
  assert.equal(sb.runAtom('let a = 1; a + 2'), 3);
  assert.equal(sb.runAtom('let xs = [1, 2].map((v) => v * 2); xs.length'), 2);
  assert.equal(sb.runAtom('var obj = { x: 1 }; obj.x'), 1);
});

test('每步原子内的 let 隔离，多步同名不冲突', () => {
  const sb = new Sandbox({ jsLib: 'let shared = 10;' });
  assert.equal(sb.runAtom('let n = 1; n + shared'), 11);
  assert.equal(sb.runAtom('let n = 2; n + shared'), 12);
  assert.equal(sb.runAtom('typeof n'), 'undefined');
  assert.equal(sb.runAtom('shared'), 10);
});

test('每步前重设绑定不污染 jsLib 全局', () => {
  const sb = new Sandbox();
  sb.set('result', 'first');
  assert.equal(sb.runAtom('result'), 'first');
  sb.set('result', 'second');
  assert.equal(sb.runAtom('result'), 'second');
});

test('日志经注入的 java.log 捕获', () => {
  const logs = [];
  const sb = new Sandbox({
    globals: {
      java: {
        log: (...args) => logs.push(args.map(String).join(' ')),
        toast: (text) => logs.push(`toast:${text}`),
      },
    },
  });
  sb.runAtom("java.log('hello', 1); java.toast('ok'); 'done'");
  assert.deepEqual(logs, ['hello 1', 'toast:ok']);
});

test('异常栈保留，rhinoHint 给出 Java String 提示', () => {
  const sb = new Sandbox();
  let error;
  try {
    sb.runAtom('var s = {}; s.length()');
  } catch (err) {
    error = err;
  }
  assert.ok(error, '应当抛出异常');
  assert.match(String(error.message), /is not a function/);
  const hints = rhinoHint(error);
  assert.ok(hints.some((h) => h.includes('.length')), hints.join('\n'));
});

test('rhinoHint 覆盖 Packages 缺失与未实现 API', () => {
  assert.ok(rhinoHint(new Error('Packages is not defined')).some((h) => h.includes('Packages')));
  assert.ok(rhinoHint(new Error('java.webView is not a function')).some((h) => h.includes('未在调试器中实现')));
});

test('沙箱不暴露 require / process / Buffer', () => {
  const sb = new Sandbox();
  assert.equal(sb.runAtom('typeof require'), 'undefined');
  assert.equal(sb.runAtom('typeof process'), 'undefined');
  assert.equal(sb.runAtom('typeof Buffer'), 'undefined');
});
