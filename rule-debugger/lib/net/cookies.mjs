function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}

function parseCookieLine(line) {
  const [pair, ...attrs] = String(line).split(';');
  const idx = pair.indexOf('=');
  if (idx < 0) return null;
  const cookie = { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() };
  for (const attr of attrs) {
    const [k, ...rest] = attr.split('=');
    const key = k.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (key === 'domain') cookie.domain = value.replace(/^\./, '').toLowerCase();
    else if (key === 'path') cookie.path = value || '/';
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'max-age') cookie.expires = Date.now() + Number(value) * 1000;
    else if (key === 'expires' && !cookie.expires) {
      const ts = Date.parse(value);
      if (!Number.isNaN(ts)) cookie.expires = ts;
    }
  }
  return cookie;
}

export class CookieJar {
  constructor(entries = []) {
    this.cookies = entries.map((c) => ({ ...c }));
  }

  static parseCookieHeader(value) {
    return String(value ?? '')
      .split(';')
      .map((part) => {
        const idx = part.indexOf('=');
        if (idx < 0) return null;
        return { name: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
      })
      .filter(Boolean);
  }

  seed(value) {
    for (const pair of CookieJar.parseCookieHeader(value)) {
      this.cookies.push({ ...pair, domain: '', path: '/', hostOnly: false });
    }
  }

  fromSetCookie(url, lines) {
    const host = hostOf(url);
    for (const line of lines ?? []) {
      const parsed = parseCookieLine(line);
      if (!parsed) continue;
      const cookie = {
        ...parsed,
        domain: parsed.domain || host,
        hostOnly: !parsed.domain,
        path: parsed.path || '/',
      };
      if (cookie.expires && cookie.expires <= Date.now()) {
        this.remove(cookie.name, cookie.domain, cookie.path);
        continue;
      }
      const idx = this.cookies.findIndex((c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path);
      if (idx >= 0) this.cookies[idx] = cookie;
      else this.cookies.push(cookie);
    }
  }

  matches(cookie, host, path) {
    if (cookie.expires && cookie.expires <= Date.now()) return false;
    if (cookie.domain) {
      const domainMatch = cookie.hostOnly ? host === cookie.domain : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
      if (!domainMatch) return false;
    }
    const cookiePath = cookie.path || '/';
    if (cookiePath !== '/' && !path.startsWith(cookiePath)) return false;
    return true;
  }

  headerFor(url) {
    const host = hostOf(url);
    const p = pathOf(url);
    return [...this.cookies]
      .filter((c) => this.matches(c, host, p))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  getCookie(url) {
    return this.headerFor(url);
  }

  getKey(url) {
    return hostOf(url);
  }

  setCookie(url, value) {
    const host = hostOf(url);
    for (const pair of CookieJar.parseCookieHeader(value)) {
      const cookie = { ...pair, domain: host, hostOnly: true, path: '/' };
      const idx = this.cookies.findIndex((c) => c.name === cookie.name && c.domain === host && c.path === '/');
      if (idx >= 0) this.cookies[idx] = cookie;
      else this.cookies.push(cookie);
    }
  }

  replaceCookie(url, value) {
    const host = hostOf(url);
    this.cookies = this.cookies.filter((c) => c.domain !== host);
    this.setCookie(url, value);
  }

  removeCookie(url) {
    const host = hostOf(url);
    const before = this.cookies.length;
    this.cookies = this.cookies.filter((c) => c.domain !== host);
    return before !== this.cookies.length;
  }

  remove(name, domain, path) {
    this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain && c.path === path));
  }

  toJSON() {
    return { version: 1, cookies: this.cookies };
  }

  static fromJSON(data) {
    return new CookieJar(Array.isArray(data?.cookies) ? data.cookies : []);
  }
}
