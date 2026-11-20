
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectIn, selectChain, evaluateSelector } from '../lib/analyze/html.mjs';
import { evaluateRuleString, evaluateRuleList } from '../lib/rule.mjs';

const HTML = [
  '<div id=\"wrap\">',
  '  <ul class=\"toc\" style=\"color:red\">',
  '    <li class=\"item\"><a href=\"/c/1\">第一章</a></li>',
  '    <li class=\"item\"><a href=\"/c/2\">第二章</a></li>',
  '  </ul>',
  '  <meta property=\"og:title\" content=\"My Book\" />',
  '  <p class=\"note\">hello <b>world</b></p>',
  '</div>'
].join('\n');

test('selectIn finds nested anchors', () => {
  const els = selectIn(HTML, '#wrap li a');
  assert.equal(els.size(), 2);
  assert.equal(els.first().text(), '第一章');
  assert.equal(els.first().attr('href'), '/c/1');
});

test('selectChain follows legado at-segments and index', () => {
  const els = selectChain(HTML, '#wrap@ul.0@li@a');
  assert.equal(els.size(), 2);
  assert.equal(els.last().text(), '第二章');
});

test('evaluateSelector reads meta content attr', () => {
  assert.equal(evaluateSelector(HTML, 'meta[property=og:title]@content'), 'My Book');
});

test('evaluateSelector default returns text', () => {
  assert.equal(evaluateSelector(HTML, 'p.note'), 'hello world');
});

test('evaluateRuleString applies selector on HTML content', () => {
  assert.equal(evaluateRuleString(HTML, 'p.note'), 'hello world');
});

test('evaluateRuleList returns all matches from HTML', () => {
  const list = evaluateRuleList(HTML, 'li.item>a@text');
  assert.deepEqual(list, ['第一章', '第二章']);
});

test('selectIn 支持 Legado 的 .N 索引后缀', () => {
  const els = selectIn(HTML, 'li.item.1');
  assert.equal(els.size(), 1);
  assert.equal(els.first().text(), '第二章');
  assert.equal(evaluateSelector(HTML, 'li.item.1@text'), '第二章');
});

test('selectIn 中剩余的 @ 作为链式选择器分隔符', () => {
  assert.equal(evaluateSelector(HTML, '#wrap@ul.toc@li.0@a@text'), '第一章');
});
