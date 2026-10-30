const ALIASES = {
  'utf8': 'utf-8',
  'utf-8': 'utf-8',
  'gb2312': 'gbk',
  'gbk': 'gbk',
  'gb18030': 'gbk',
  'big5': 'big5',
  'big5-hkscs': 'big5',
  'iso-8859-1': 'windows-1252',
  'latin1': 'windows-1252',
};

export function normalizeCharset(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase().replace(/["']/g, '');
  return ALIASES[key] ?? key;
}

export function charsetFromContentType(contentType) {
  const match = /charset\s*=\s*["']?([\w-]+)/i.exec(String(contentType ?? ''));
  return match ? normalizeCharset(match[1]) : null;
}

export function sniffMetaCharset(bytes) {
  const head = Buffer.from(bytes).subarray(0, 4096).toString('latin1');
  const match = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return match ? normalizeCharset(match[1]) : null;
}

export function headerValue(headers, name) {
  const target = String(name).toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

export function detectCharset({ headers = {}, bytes, prefer, sniff = true } = {}) {
  return normalizeCharset(prefer)
    ?? charsetFromContentType(headerValue(headers, 'content-type'))
    ?? (sniff ? sniffMetaCharset(bytes) : null)
    ?? 'utf-8';
}

export function decodeBody(bytes, charset = 'utf-8') {
  const buf = Buffer.from(bytes);
  const label = normalizeCharset(charset) ?? 'utf-8';
  let text;
  try {
    text = new TextDecoder(label, { fatal: false }).decode(buf);
  } catch {
    text = buf.toString('utf8');
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
