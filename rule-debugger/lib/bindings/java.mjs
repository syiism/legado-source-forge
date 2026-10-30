import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  md5Encode,
  md5Encode16,
  base64Encode,
  base64Decode,
  base64DecodeBytes,
  hexEncode,
  hexDecode,
  hexDecodeBytes,
  digestHex,
  digestBase64,
  hmacHex,
  hmacBase64,
  createSymmetricCrypto,
  createAsymmetricCrypto,
  createSign,
  signedBytesOf,
} from '../crypto.mjs';
import { normalizeCharset } from '../net/charset.mjs';

export class UnsupportedApiError extends Error {
  constructor(api, hint) {
    super(`${api} 在离线调试器中不可用${hint ? `：${hint}` : ''}`);
    this.name = 'UnsupportedApiError';
    this.code = 'UNSUPPORTED_API';
    this.api = api;
  }
}

const DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function formatDate(ts, format = 'yyyy/MM/dd HH:mm', offsetMinutes = null) {
  const time = Number(ts) || Date.now();
  const date = new Date(offsetMinutes === null ? time : time + offsetMinutes * 60000);
  const g = (name) => (offsetMinutes === null ? date[`get${name}`]() : date[`getUTC${name}`]());
  return String(format).replace(/yyyy|SSS|MM|dd|HH|mm|ss/g, (token) => {
    if (token === 'yyyy') return String(g('FullYear'));
    if (token === 'MM') return pad(g('Month') + 1);
    if (token === 'dd') return pad(g('Date'));
    if (token === 'HH') return pad(g('Hours'));
    if (token === 'mm') return pad(g('Minutes'));
    if (token === 'ss') return pad(g('Seconds'));
    if (token === 'SSS') return pad(g('Milliseconds'), 3);
    return token;
  });
}

function headerObject(headers) {
  if (!headers) return {};
  if (typeof headers === 'string') {
    try {
      const parsed = JSON.parse(headers);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return { ...headers };
}

function normalizeAjaxOptions(options) {
  if (options === undefined || options === null) return {};
  if (typeof options === 'string') return { headers: headerObject(options) };
  if (typeof options === 'number') return {};
  return {
    method: options.method,
    headers: headerObject(options.headers),
    body: options.body,
    charset: options.charset,
  };
}

function splitUrlOptions(text) {
  const raw = String(text);
  const idx = raw.lastIndexOf(',{');
  if (idx < 0) return { url: raw, options: {} };
  try {
    const parsed = JSON.parse(raw.slice(idx + 1));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { url: raw.slice(0, idx), options: parsed };
    }
  } catch {
    // 不是请求选项，按原 URL 处理
  }
  return { url: raw, options: {} };
}

function serializeBody(body) {
  if (body === undefined || body === null) return '';
  if (typeof body === 'object') return JSON.stringify(body);
  return String(body);
}

function makeResponse(res) {
  return {
    body: () => res.body,
    code: () => res.code,
    headers: () => ({ ...res.headers }),
    url: () => res.url,
    toString: () => res.body,
  };
}

export function makeJavaBindings({ client, store, hooks, sourceApi }) {
  const onceWarn = new Set();
  const warnOnce = (api, message) => {
    if (onceWarn.has(api)) return;
    onceWarn.add(api);
    hooks.warn(message);
  };

  const decodeBytes = (bytes, charset) => {
    const label = normalizeCharset(charset) ?? 'utf-8';
    try {
      return new TextDecoder(label).decode(Buffer.from(Array.from(bytes ?? [], (x) => x & 255)));
    } catch {
      return Buffer.from(Array.from(bytes ?? [], (x) => x & 255)).toString('utf8');
    }
  };

  const encodeBytes = (text, charset) => {
    const label = normalizeCharset(charset) ?? 'utf-8';
    if (label !== 'utf-8') throw new UnsupportedApiError('java.strToBytes', `离线只支持 UTF-8 编码，收到 ${charset}`);
    return signedBytesOf(Buffer.from(String(text), 'utf8'));
  };

  const unsupported = (api, hint) => () => {
    throw new UnsupportedApiError(api, hint);
  };

  const perform = (method, rawUrl, extra = {}) => {
    const { url, options } = splitUrlOptions(rawUrl);
    const httpMethod = options.method || extra.method || method;
    const body = extra.body !== undefined && extra.body !== null ? extra.body : options.body;
    const params = {
      headers: { ...headerObject(options.headers), ...headerObject(extra.headers) },
      // Legado 的 AnalyzeUrl 对 GET/HEAD 忽略 body（OkHttp 不允许 GET 带体）
      body: httpMethod === 'POST' ? serializeBody(body) : '',
      charset: extra.charset ?? options.charset,
    };
    return client.request(httpMethod, url, params);
  };

  const performSafe = (method, url, extra) => {
    try {
      return { res: perform(method, url, extra) };
    } catch (err) {
      if (err.code === 'OFFLINE' || err.code === 'CASSETTE_MISS') throw err;
      hooks.warn(`网络请求失败：${err.message}`);
      return { error: err };
    }
  };

  const java = {
    toast: (msg) => hooks.log('toast', String(msg)),
    longToast: (msg) => hooks.log('longToast', String(msg)),
    log: (msg) => hooks.log('log', String(msg)),
    logType: () => '',
    refreshExplore: () => hooks.noop('java.refreshExplore'),
    reLoginView: () => hooks.noop('java.reLoginView'),
    upLoginData: () => hooks.noop('java.upLoginData'),
    refreshJSLib: () => hooks.noop('java.refreshJSLib'),
    refreshContent: () => hooks.noop('java.refreshContent'),
    showBrowser: () => hooks.noop('java.showBrowser'),
    showReadingBrowser: () => hooks.noop('java.showReadingBrowser'),
    open: () => hooks.noop('java.open'),
    openUrl: () => hooks.noop('java.openUrl'),
    qread: () => hooks.noop('java.qread'),
    setContent: () => hooks.noop('java.setContent'),
    getAppVariant: () => 'legado',
    deviceID: () => 'debugger-device',
    androidId: () => '9774d56d682e549c',
    getWebViewUA: () => DEFAULT_UA,
    randomUUID: () => randomUUID(),

    getSource: () => sourceApi,
    put: (key, value) => store.put(key, value),
    get: (key) => store.get(key),

    ajax(url, options) {
      const result = performSafe('GET', url, normalizeAjaxOptions(options));
      return result.res ? result.res.body : (result.error?.message ?? '');
    },
    ajaxAll(urls, options) {
      return Array.from(urls ?? []).map((url) => {
        const result = performSafe('GET', url, normalizeAjaxOptions(options));
        return makeResponse(result.res ?? { code: 0, headers: {}, body: result.error?.message ?? '', url: String(url) });
      });
    },
    ajaxTestAll(urls, options) {
      return java.ajaxAll(urls, options);
    },
    connect(url, headers) {
      const result = performSafe('GET', url, { headers });
      return makeResponse(result.res ?? { code: 0, headers: {}, body: result.error?.message ?? '', url: String(url) });
    },
    get(url, headers) {
      const result = performSafe('GET', url, { headers });
      return makeResponse(result.res ?? { code: 0, headers: {}, body: result.error?.message ?? '', url: String(url) });
    },
    head(url, headers) {
      const result = performSafe('HEAD', url, { headers });
      return makeResponse(result.res ?? { code: 0, headers: {}, body: result.error?.message ?? '', url: String(url) });
    },
    post(url, body, headers) {
      const result = performSafe('POST', url, { headers, body });
      return makeResponse(result.res ?? { code: 0, headers: {}, body: result.error?.message ?? '', url: String(url) });
    },

    md5Encode,
    md5Encode16,
    base64Encode,
    base64Decode,
    base64DecodeToByteArray: base64DecodeBytes,
    hexEncodeToString: hexEncode,
    hexDecodeToString: hexDecode,
    hexDecodeToByteArray: hexDecodeBytes,
    digestHex,
    digestBase64Str: digestBase64,
    HMacHex: hmacHex,
    HMacBase64: hmacBase64,
    createSymmetricCrypto,
    createAsymmetricCrypto,
    createSign,
    strToBytes: encodeBytes,
    bytesToStr: decodeBytes,
    encodeURI(str, enc = 'UTF-8') {
      return encodeURIComponent(String(str))
        .replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
        .replace(/%20/g, '+');
    },
    timeFormat(ts) {
      return formatDate(ts);
    },
    timeFormatUTC(ts, format, sh = 0) {
      return formatDate(ts, format, Number(sh) * 60);
    },
    htmlFormat(str) {
      warnOnce('htmlFormat', 'java.htmlFormat 需要 HTML 解析，已原样返回');
      return String(str);
    },
    t2s(text) {
      warnOnce('t2s', 'java.t2s（繁转简）需要字库，已原样返回');
      return String(text);
    },
    s2t(text) {
      warnOnce('s2t', 'java.s2t（简转繁）需要字库，已原样返回');
      return String(text);
    },
    toNumChapter: (title) => String(title ?? ''),
    toURL: (url, base) => {
      try {
        return new URL(String(url), base || undefined).toString();
      } catch {
        return String(url);
      }
    },
    getReadBookConfig: () => ({}),
    getThemeMode: () => 0,
    getThemeConfig: () => ({}),
    getVerificationCode: () => {
      warnOnce('java.getVerificationCode', 'java.getVerificationCode 需要真机 WebView 验证码识别，离线返回空串');
      return '';
    },

    startBrowser: unsupported('java.startBrowser', '需要真机 WebView，请在真机上验证'),
    startBrowserAwait: unsupported('java.startBrowserAwait', '需要真机交互'),
    startBrowserDp: unsupported('java.startBrowserDp', '需要真机交互'),
    webView: unsupported('java.webView', '需要真机 WebView'),
    webViewGetSource: unsupported('java.webViewGetSource', '需要真机 WebView'),
    webViewGetOverrideUrl: unsupported('java.webViewGetOverrideUrl', '需要真机 WebView'),
    openVideoPlayer: unsupported('java.openVideoPlayer', '需要真机播放器'),
    downloadFile: unsupported('java.downloadFile', '需要真机下载器'),
    cacheFile: unsupported('java.cacheFile', '需要真机缓存目录'),
    importScript: unsupported('java.importScript', '离线不加载外部脚本'),

    getFile: (path) => fs.readFileSync(String(path), 'utf8'),
    readFile: (path) => fs.readFileSync(String(path), 'utf8'),
    readTxtFile: (path) => fs.readFileSync(String(path), 'utf8'),
    deleteFile: (path) => fs.rmSync(String(path), { force: true }),
    getTxtInFolder: unsupported('java.getTxtInFolder', '需要真机目录'),
    getZipStringContent: unsupported('java.getZipStringContent', '需要真机压缩包'),
    getZipByteArrayContent: unsupported('java.getZipByteArrayContent', '需要真机压缩包'),
    getRarStringContent: unsupported('java.getRarStringContent', '需要真机压缩包'),
    get7zStringContent: unsupported('java.get7zStringContent', '需要真机压缩包'),
    unzipFile: unsupported('java.unzipFile', '需要真机压缩包'),
    un7zFile: unsupported('java.un7zFile', '需要真机压缩包'),
    unrarFile: unsupported('java.unrarFile', '需要真机压缩包'),
    unArchiveFile: unsupported('java.unArchiveFile', '需要真机压缩包'),
    queryBase64TTF: unsupported('java.queryBase64TTF', '需要字体解析'),
    queryTTF: unsupported('java.queryTTF', '需要字体解析'),
    replaceFont: unsupported('java.replaceFont', '需要字体解析'),
  };

  return java;
}
