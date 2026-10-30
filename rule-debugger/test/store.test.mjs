import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';

test('putVariable 同步回 raw，getVariable() 能看到按 key 写入的值', () => {
  const store = new Store();
  store.putVariable('mode', '漫画');
  assert.equal(store.getVariable(), '{"mode":"漫画"}');
  assert.equal(JSON.parse(store.getVariable()).mode, '漫画');
  assert.equal(store.getVariable('mode'), '漫画');
});

test('删除变量后 raw 不再包含该键', () => {
  const store = new Store();
  store.putVariable('a', '1');
  store.putVariable('b', '2');
  store.putVariable('a', null);
  assert.deepEqual(JSON.parse(store.getVariable()), { b: '2' });
});

test('setVariableRaw 解析 JSON 回填 vars；空串清空 vars', () => {
  const store = new Store();
  store.setVariableRaw('{"x":"1"}');
  assert.equal(store.vars.get('x'), '1');
  store.setVariableRaw('');
  assert.equal(store.vars.size, 0);
  assert.equal(store.getVariable(), '');
});

test('构造时 vars 非空而 raw 为空时补出 raw', () => {
  const store = new Store({ vars: { tab_type: '10' } });
  assert.equal(JSON.parse(store.getVariable()).tab_type, '10');
});
