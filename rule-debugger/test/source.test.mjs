// 回归测试: flow 模式切换书本时 runner 会 delete book 的所有可枚举属性,
// 变量方法必须挂为非枚举属性, 否则 book.getVariable 会变 undefined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSourceBindings } from '../lib/bindings/source.mjs';

const stub = { source: {}, store: {}, jar: {}, hooks: { noop(){}, warn(){}, log(){} } };

test('book.getVariable survives flow reset (Object.keys + delete)', () => {
  const { makeBook } = makeSourceBindings(stub);
  const book = makeBook({ name: 'x', bookUrl: 'u' });
  assert.equal(typeof book.getVariable, 'function');
  for (const k of Object.keys(book)) delete book[k];
  assert.equal(typeof book.getVariable, 'function', 'getVariable 不应被 delete 清除');
  assert.equal(typeof book.putVariable, 'function');
  assert.equal(book.getVariable('custom'), '');
  assert.equal(book.putVariable('custom', '3'), true);
  assert.equal(book.getVariable('custom'), '3');
});

test('chapter.getVariable survives reset', () => {
  const { makeChapter } = makeSourceBindings(stub);
  const chapter = makeChapter({ title: 't' });
  for (const k of Object.keys(chapter)) delete chapter[k];
  assert.equal(typeof chapter.getVariable, 'function');
});
