import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { decodeBody, detectCharset } from './charset.mjs';

export class NetworkError extends Error {
  constructor(code, message, url) {
    super(message);
    this.name = 'NetworkError';
    this.code = code;
    this.url = url;
  }
}

function normalizeHeaders(headers) {
  if (!headers) return {};
  if (typeof headers === 'string') {
    try {
      return JSON.parse(headers);
    } catch {
      return {};
    }
  }
  return { ...headers };
}

function lowerKeys(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[k.toLowerCase()] = v;
  return out;
}

export class HttpClient {
  constructor({
    jar,
    cassette,
    offline = false,
    timeout = 15000,
    ua,
    defaultHeaders = {},
    charset,
    onCall,
  } = {}) {
    this.jar = jar;
    this.cassette = cassette;
    this.offline = offline;
    this.timeout = timeout;
    this.ua = ua;
    this.defaultHeaders = normalizeHeaders(defaultHeaders);
    this.charset = charset;
    this.onCall = onCall;
    this.tmpDir = null;
    this.headerFile = null;
  }

  headerFileOnce() {
    if (!this.tmpDir) {
      this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legado-debug-'));
      this.headerFile = path.join(this.tmpDir, 'headers.txt');
    }
    return this.headerFile;
  }

  mergedHeaders(headers, url) {
    const merged = { ...this.defaultHeaders, ...normalizeHeaders(headers) };
    if (this.ua) merged['User-Agent'] = this.ua;
    const hasCookie = Object.keys(merged).some((k) => k.toLowerCase() === 'cookie');
    if (!hasCookie) {
      const cookie = this.jar?.headerFor(url);
      if (cookie) merged.Cookie = cookie;
    }
    return merged;
  }

  request(method, url, { headers, body = '', charset } = {}) {
    const m = String(method || 'GET').toUpperCase();
    const merged = this.mergedHeaders(headers, url);
    const started = Date.now();
    const prefer = charset ?? this.charset;

    const hit = this.cassette?.get(m, url, body);
    if (hit) {
      const cs = detectCharset({ headers: hit.headers, bytes: Buffer.from(hit.body ?? ''), prefer });
      this.jar?.fromSetCookie(url, hit.setCookie);
      const out = {
        code: hit.status,
        headers: hit.headers ?? {},
        body: hit.body ?? '',
        bytes: Buffer.byteLength(hit.body ?? ''),
        url: hit.finalUrl || url,
        charset: cs,
        mode: 'replay',
      };
      this.onCall?.({ method: m, url, status: out.code, bytes: out.bytes, ms: Date.now() - started, mode: 'replay', charset: cs });
      return out;
    }

    if (this.offline) {
      const err = this.cassette
        ? this.cassette.miss(m, url, body)
        : new NetworkError('OFFLINE', `离线模式禁止网络请求：${m} ${url}`, url);
      this.onCall?.({ method: m, url, status: 0, bytes: 0, ms: Date.now() - started, mode: 'error', charset: null, error: err.code ?? 'ERROR' });
      throw err;
    }

    let result;
    try {
      result = this.live(m, url, merged, body, prefer);
    } catch (err) {
      this.onCall?.({ method: m, url, status: 0, bytes: 0, ms: Date.now() - started, mode: 'error', charset: null, error: err.code ?? 'ERROR' });
      throw err;
    }
    if (this.cassette?.record) {
      this.cassette.store({
        key: this.cassette.constructor.key(m, url, body),
        method: m,
        url,
        status: result.code,
        headers: result.headers,
        finalUrl: result.url,
        setCookie: result.setCookie,
        body: result.body,
      });
    }
    this.onCall?.({ method: m, url, status: result.code, bytes: result.bytes, ms: Date.now() - started, mode: 'live', charset: result.charset });
    return result;
  }

  live(method, url, headers, body, preferCharset) {
    const headerFile = this.headerFileOnce();
    const marker = `__LD_META_${Math.random().toString(36).slice(2)}__`;
    // OkHttp 会把非 ASCII 查询参数按 UTF-8 百分号编码；curl 原样发送会被站点 400
    const curlUrl = encodeURI(url);
    const args = [
      '-sS', '-L', '--max-redirs', '5', '--compressed',
      '--max-time', String(Math.max(1, Math.ceil(this.timeout / 1000))),
      '-X', method,
      '-D', headerFile,
      '-w', `\n${marker}%{http_code}\n%{url_effective}`,
      '--url', curlUrl,
    ];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    if (body !== '' && method !== 'HEAD') args.push('--data-binary', '@-');

    const run = spawnSync('curl', args, {
      input: body !== '' && method !== 'HEAD' ? body : undefined,
      maxBuffer: 64 * 1024 * 1024,
      encoding: null,
    });
    if (run.error) {
      if (run.error.code === 'ENOENT') {
        throw new NetworkError('NO_CURL', '未找到 curl；离线模式请加 --offline 或 --cassette。', url);
      }
      throw new NetworkError('CURL_ERROR', String(run.error.message), url);
    }
    if (run.status !== 0) {
      const stderr = run.stderr ? run.stderr.toString('utf8').trim() : '';
      const code = run.status === 28 ? 'TIMEOUT' : 'CURL_EXIT';
      throw new NetworkError(code, `curl 退出码 ${run.status}：${stderr || '无 stderr'}`, url);
    }

    const stdout = run.stdout ?? Buffer.alloc(0);
    const markerBuf = Buffer.from(`\n${marker}`);
    const idx = stdout.lastIndexOf(markerBuf);
    const bodyBuf = idx >= 0 ? stdout.subarray(0, idx) : stdout;
    const meta = idx >= 0 ? stdout.subarray(idx + markerBuf.length).toString('utf8') : '';
    const [codeText, finalUrl] = meta.split('\n');
    const status = Number(codeText) || 0;

    const headerText = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, 'latin1') : '';
    const { headers: respHeaders, setCookie } = parseHeaderDump(headerText);
    const charset = detectCharset({ headers: respHeaders, bytes: bodyBuf, prefer: preferCharset });
    const text = decodeBody(bodyBuf, charset);
    this.jar?.fromSetCookie(url, setCookie);

    return {
      code: status,
      headers: respHeaders,
      body: text,
      bytes: bodyBuf.length,
      url: finalUrl || url,
      charset,
      setCookie,
      mode: 'live',
    };
  }
}

export function parseHeaderDump(text) {
  const blocks = String(text).split(/\r?\n\r?\n/).filter((block) => block.trimStart().startsWith('HTTP/'));
  const last = blocks.at(-1) ?? '';
  const headers = {};
  const setCookie = [];
  // 中间跳转响应的 Set-Cookie 同样要进 jar（OkHttp 跟随重定向时全部接收）
  for (const block of blocks) {
    for (const line of block.split(/\r?\n/).slice(1)) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const name = line.slice(0, idx).trim();
      if (name.toLowerCase() === 'set-cookie') setCookie.push(line.slice(idx + 1).trim());
    }
  }
  for (const line of last.split(/\r?\n/).slice(1)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!name || name.toLowerCase() === 'set-cookie') continue;
    headers[name] = value;
  }
  return { headers: lowerKeys(headers), setCookie };
}
