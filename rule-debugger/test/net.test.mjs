import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpClient, NetworkError, parseHeaderDump } from '../lib/net/http.mjs';
import { Cassette, CassetteMiss } from '../lib/net/cassette.mjs';
import { CookieJar } from '../lib/net/cookies.mjs';
import { decodeBody, detectCharset, charsetFromContentType } from '../lib/net/charset.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-debugger-net-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeCassette(name, entries) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ v: 1, entries }, null, 2));
  return file;
}

function entry(method, url, body, extra = {}, requestBody = '') {
  return {
    key: Cassette.key(method, url, requestBody),
    method,
    url,
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    finalUrl: url,
    body,
    ...extra,
  };
}

test('cassette 键由 method/url/body 决定', () => {
  assert.equal(Cassette.key('get', 'https://a.test/x', ''), Cassette.key('GET', 'https://a.test/x', ''));
  assert.notEqual(Cassette.key('GET', 'https://a.test/x', 'a'), Cassette.key('GET', 'https://a.test/x', 'b'));
  assert.notEqual(Cassette.key('GET', 'https://a.test/x', ''), Cassette.key('POST', 'https://a.test/x', ''));
});

test('两次回放结果逐字节一致', () => {
  const url = 'https://replay.test/api?q=1';
  const file = writeCassette('replay.json', [entry('GET', url, '{"ok":true}')]);
  const client = new HttpClient({ cassette: new Cassette(file).load(), offline: true });
  const first = client.request('GET', url);
  const second = client.request('GET', url);
  assert.equal(first.mode, 'replay');
  assert.equal(first.code, 200);
  assert.equal(first.body, '{"ok":true}');
  assert.deepEqual(first, second);
});

test('cassette 未命中抛出 CASSETTE_MISS 并列出最近条目', () => {
  const known = 'https://miss.test/api/known';
  const file = writeCassette('miss.json', [entry('GET', known, 'x')]);
  const client = new HttpClient({ cassette: new Cassette(file).load(), offline: true });
  let error;
  try {
    client.request('GET', 'https://miss.test/api/other');
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof CassetteMiss);
  assert.equal(error.code, 'CASSETTE_MISS');
  assert.match(error.message, /cassette 未命中/);
  assert.match(error.message, /miss\.test\/api\/known/);
});

test('--offline 无 cassette 时抛 OFFLINE', () => {
  const client = new HttpClient({ offline: true });
  assert.throws(
    () => client.request('GET', 'https://offline.test/'),
    (err) => err instanceof NetworkError && err.code === 'OFFLINE',
  );
});

test('失败的请求也进入 onCall（status 0 / mode error）', () => {
  const calls = [];
  const client = new HttpClient({ offline: true, onCall: (call) => calls.push(call) });
  assert.throws(() => client.request('GET', 'https://offline.test/'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'error');
  assert.equal(calls[0].status, 0);
  assert.equal(calls[0].error, 'OFFLINE');
});

test('回放时用录制的 Set-Cookie 更新 jar', () => {
  const url = 'https://cookie.test/login';
  const file = writeCassette('cookie.json', [
    entry('POST', url, 'ok', { setCookie: ['sid=recorded; Path=/', 'expired=1; Max-Age=0'] }),
  ]);
  const jar = new CookieJar();
  const client = new HttpClient({ cassette: new Cassette(file).load(), offline: true, jar });
  client.request('POST', url);
  assert.match(jar.headerFor(url), /sid=recorded/);
  assert.doesNotMatch(jar.headerFor(url), /expired/);
});

test('cookie jar 按域 / 路径 / hostOnly 回送', () => {
  const jar = new CookieJar();
  jar.fromSetCookie('https://a.test/x', ['sid=abc; Path=/', 'uid=1; Domain=.a.test; Path=/']);
  assert.equal(jar.headerFor('https://a.test/other'), 'sid=abc; uid=1');
  assert.equal(jar.headerFor('https://sub.a.test/'), 'uid=1');
  assert.equal(jar.headerFor('https://b.test/'), '');
  assert.equal(jar.getCookie('https://a.test/'), 'sid=abc; uid=1');
  assert.equal(jar.getKey('https://a.test/x'), 'a.test');

  jar.setCookie('https://a.test/', 'sid=new');
  assert.equal(jar.headerFor('https://a.test/'), 'sid=new; uid=1');
  jar.replaceCookie('https://a.test/', 'sid=fresh');
  assert.equal(jar.headerFor('https://a.test/'), 'sid=fresh');
  assert.equal(jar.removeCookie('https://a.test/'), true);
  assert.equal(jar.headerFor('https://a.test/'), '');

  const seeded = new CookieJar();
  seeded.seed('p=1; q=2');
  assert.equal(seeded.headerFor('https://any.test/'), 'p=1; q=2');
  assert.deepEqual(CookieJar.fromJSON(seeded.toJSON()).headerFor('https://any.test/'), 'p=1; q=2');
});

test('请求头合并：UA > 书源 header > 单次请求，显式 Cookie 时不叠加 jar', () => {
  const jar = new CookieJar();
  jar.seed('from=jar');
  const client = new HttpClient({ ua: 'UA/1', defaultHeaders: { 'X-Src': '1' }, jar });
  const merged = client.mergedHeaders({ 'x-src': '2', Accept: '*/*' }, 'https://h.test/');
  assert.equal(merged['User-Agent'], 'UA/1');
  assert.equal(merged['x-src'], '2');
  assert.equal(merged.Accept, '*/*');
  assert.equal(merged.Cookie, 'from=jar');

  const explicit = client.mergedHeaders({ Cookie: 'manual=1' }, 'https://h.test/');
  assert.equal(explicit.Cookie, 'manual=1');
});

test('header dump：跳转响应与最终响应的 Set-Cookie 都收集', () => {
  const dump = [
    'HTTP/1.1 302 Found',
    'Location: https://x.test/final',
    'Set-Cookie: hop=1; Path=/',
    '',
    'HTTP/1.1 200 OK',
    'Content-Type: text/html; charset=gbk',
    'Set-Cookie: sid=2; Path=/',
    '',
  ].join('\r\n');
  const { headers, setCookie } = parseHeaderDump(dump);
  assert.equal(headers['content-type'], 'text/html; charset=gbk');
  assert.deepEqual(setCookie, ['hop=1; Path=/', 'sid=2; Path=/']);
});

test('GBK 解码与字符集探测优先级', () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  assert.equal(decodeBody(gbk, 'gbk'), '你好');
  assert.equal(decodeBody(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69]), 'utf-8'), 'hi');
  assert.equal(charsetFromContentType('text/html; charset=GB2312'), 'gbk');
  assert.equal(detectCharset({ bytes: Buffer.from('<meta charset="big5">', 'latin1') }), 'big5');
  assert.equal(
    detectCharset({ headers: { 'Content-Type': 'text/html; charset=utf-8' }, prefer: 'gbk', bytes: gbk }),
    'gbk',
  );
  assert.equal(detectCharset({ bytes: Buffer.from('plain') }), 'utf-8');
});
