export class Store {
  constructor({ raw = '', vars = {}, loginInfo = {}, loginHeader = '', ruleMap = {} } = {}) {
    this.raw = String(raw ?? '');
    this.vars = new Map(Object.entries(vars));
    this.loginInfo = new Map(Object.entries(loginInfo));
    this.loginHeader = String(loginHeader ?? '');
    this.ruleMap = new Map(Object.entries(ruleMap));
    if (!this.raw && this.vars.size) this.raw = JSON.stringify(Object.fromEntries(this.vars));
    this.disk = new Map();
    this.mem = new Map();
    this.events = [];
    this.step = 0;
  }

  event(type, payload = {}) {
    this.events.push({ step: this.step, type, ...payload });
  }

  parsedRaw() {
    if (!this.raw) return null;
    try {
      const v = JSON.parse(this.raw);
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }

  getVariable(key) {
    if (key === undefined || key === null || key === '') return this.raw;
    if (this.vars.has(String(key))) return this.vars.get(String(key));
    const parsed = this.parsedRaw();
    return parsed ? parsed[String(key)] ?? '' : '';
  }

  setVariableRaw(value) {
    const next = value === null || value === undefined ? '' : String(value);
    const before = this.raw;
    this.raw = next;
    const parsed = this.parsedRaw();
    if (parsed && !Array.isArray(parsed)) {
      this.vars = new Map(Object.entries(parsed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    } else if (!parsed) {
      this.vars = new Map();
    }
    if (before !== next) this.event('var.raw', { from: before, to: next });
    return next;
  }

  // Legado 的 source.getVariable() 返回整串源变量 JSON，规则普遍 JSON.parse 后取键；
  // 因此按 key 写变量时必须同步回 raw，否则 getVariable() 看不到 --var / --state 注入的值。
  syncRawFromVars() {
    const next = JSON.stringify(Object.fromEntries(this.vars));
    if (next === this.raw) return;
    const before = this.raw;
    this.raw = next;
    this.event('var.raw', { from: before, to: next });
  }

  putVariable(key, value) {
    const k = String(key);
    const had = this.vars.has(k);
    if (value === null || value === undefined) {
      this.vars.delete(k);
      this.syncRawFromVars();
      this.event('var.del', { key: k });
      return had;
    }
    const v = String(value);
    this.vars.set(k, v);
    this.syncRawFromVars();
    this.event('var.set', { key: k, value: v });
    return true;
  }

  get(key) {
    return this.ruleMap.has(String(key)) ? this.ruleMap.get(String(key)) : '';
  }

  put(key, value) {
    const v = String(value);
    this.ruleMap.set(String(key), v);
    this.event('rule.put', { key: String(key), value: v });
    return v;
  }

  setLogin(key, value) {
    this.loginInfo.set(String(key), String(value));
    this.event('login.set', { key: String(key), value: String(value) });
  }

  cacheGet(key) {
    const k = String(key);
    const hit = this.disk.get(k);
    if (!hit) return '';
    if (hit.expireAt && Date.now() > hit.expireAt) {
      this.disk.delete(k);
      return '';
    }
    this.event('cache.get', { key: k, hit: true });
    return hit.value;
  }

  cachePut(key, value, ttl = 0) {
    const k = String(key);
    const v = String(value);
    const n = Number(ttl) || 0;
    this.disk.set(k, { value: v, expireAt: n > 0 ? Date.now() + n : 0 });
    this.event('cache.put', { key: k, value: v, ttl: n });
    return v;
  }

  cacheDelete(key) {
    const k = String(key);
    const had = this.disk.delete(k);
    if (had) this.event('cache.del', { key: k });
    return had;
  }

  memGet(key) {
    const k = String(key);
    const v = this.mem.get(k);
    this.event('cache.mem.get', { key: k, hit: v !== undefined });
    return v === undefined ? '' : v;
  }

  memPut(key, value) {
    const k = String(key);
    const v = String(value);
    this.mem.set(k, v);
    this.event('cache.mem.put', { key: k, value: v });
    return v;
  }

  memDelete(key) {
    const k = String(key);
    const had = this.mem.delete(k);
    if (had) this.event('cache.mem.del', { key: k });
    return had;
  }

  snapshot() {
    return {
      raw: this.raw,
      vars: Object.fromEntries(this.vars),
      loginInfo: Object.fromEntries(this.loginInfo),
      loginHeader: this.loginHeader,
      ruleMap: Object.fromEntries(this.ruleMap),
      disk: [...this.disk.keys()],
      mem: [...this.mem.keys()],
    };
  }

  diff(before) {
    const after = this.snapshot();
    const changes = [];
    for (const [k, v] of Object.entries(after.vars)) {
      if (!(k in before.vars)) changes.push({ key: k, from: undefined, to: v });
      else if (before.vars[k] !== v) changes.push({ key: k, from: before.vars[k], to: v });
    }
    for (const k of Object.keys(before.vars)) {
      if (!(k in after.vars)) changes.push({ key: k, from: before.vars[k], to: undefined });
    }
    return {
      rawChanged: before.raw !== after.raw,
      raw: after.raw,
      vars: changes,
      loginInfo: Object.fromEntries(this.loginInfo),
      cache: {
        added: after.disk.filter((k) => !before.disk.includes(k)),
        removed: before.disk.filter((k) => !after.disk.includes(k)),
      },
    };
  }

  exportState() {
    return {
      raw: this.raw,
      vars: Object.fromEntries(this.vars),
      loginInfo: Object.fromEntries(this.loginInfo),
      loginHeader: this.loginHeader,
      ruleMap: Object.fromEntries(this.ruleMap),
      cache: Object.fromEntries([...this.disk].map(([k, v]) => [k, { value: v.value, expireAt: v.expireAt }])),
      mem: Object.fromEntries(this.mem),
    };
  }

  static fromState(state = {}) {
    const store = new Store({
      raw: state.raw,
      vars: state.vars,
      loginInfo: state.loginInfo,
      loginHeader: state.loginHeader,
      ruleMap: state.ruleMap,
    });
    for (const [k, v] of Object.entries(state.cache ?? {})) {
      store.disk.set(k, { value: String(v.value ?? ''), expireAt: Number(v.expireAt) || 0 });
    }
    for (const [k, v] of Object.entries(state.mem ?? {})) store.mem.set(k, String(v));
    return store;
  }
}
