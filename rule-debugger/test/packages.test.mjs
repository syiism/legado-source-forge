import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createPackages } from '../lib/packages.mjs';

function readAll(stream, Packages) {
  const baos = new Packages.java.io.ByteArrayOutputStream();
  const buf = new Packages.java.lang.String('x'.repeat(8192)).getBytes('UTF-8');
  let n;
  while ((n = stream.read(buf)) > 0) baos.write(buf, 0, n);
  return Buffer.from(Array.from(baos.toByteArray(), (x) => x & 255)).toString('utf8');
}

test('URL.openConnection GET returns body and header fields', () => {
  const calls = [];
  const Packages = createPackages({
    transport(method, url, params) {
      calls.push({ method, url, headers: params.headers });
      return { code: 200, headers: { 'content-type': ['application/json'] }, body: '{"ok":1}' };
    },
  });
  const conn = new Packages.java.net.URL('https://example.com/api').openConnection();
  conn.setRequestMethod('GET');
  conn.setRequestProperty('x-test', '1');
  assert.equal(conn.getResponseCode(), 200);
  assert.equal(readAll(conn.getInputStream(), Packages), '{"ok":1}');
  const it = conn.getHeaderFields().entrySet().iterator();
  const first = it.next();
  assert.equal(first.getKey(), 'content-type');
  assert.equal(first.getValue().iterator().next(), 'application/json');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers['x-test'], '1');
});

test('URLConnection POST writes body bytes', () => {
  const calls = [];
  const Packages = createPackages({
    transport(method, url, params) {
      calls.push({ method, body: params.body });
      return { code: 201, headers: {}, body: 'ok' };
    },
  });
  const conn = new Packages.java.net.URL('https://example.com/post').openConnection();
  conn.setRequestMethod('POST');
  conn.setDoOutput(true);
  const out = conn.getOutputStream();
  const bytes = new Packages.java.lang.String('{"a":1}').getBytes('UTF-8');
  out.write(bytes);
  out.close();
  assert.equal(conn.getResponseCode(), 201);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, '{"a":1}');
});

test('GZIPInputStream decodes gzipped payload', () => {
  const Packages = createPackages({ transport: () => ({ code: 200, headers: {}, body: '' }) });
  const gz = zlib.gzipSync(Buffer.from('hello 世界', 'utf8'));
  const stream = new Packages.java.util.zip.GZIPInputStream(
    new Packages.java.io.ByteArrayInputStream(Array.from(gz, (b) => (b > 127 ? b - 256 : b)))
  );
  assert.equal(readAll(stream, Packages), 'hello 世界');
});

test('offline transport errors surface to JS', () => {
  const Packages = createPackages({
    transport() {
      const err = new Error('离线模式禁止网络请求');
      err.code = 'OFFLINE';
      throw err;
    },
  });
  const conn = new Packages.java.net.URL('https://example.com/x').openConnection();
  assert.throws(() => conn.getResponseCode(), /离线模式禁止网络请求/);
});
