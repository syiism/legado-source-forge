export function makeMapLike(map) {
  return {
    get: (key) => (map.has(String(key)) ? map.get(String(key)) : null),
    put: (key, value) => {
      map.set(String(key), String(value));
      return value;
    },
    remove: (key) => map.delete(String(key)),
    containsKey: (key) => map.has(String(key)),
    keySet: () => [...map.keys()],
    values: () => [...map.values()],
    size: () => map.size,
    isEmpty: () => map.size === 0,
    toString: () => JSON.stringify(Object.fromEntries(map)),
    toJSON: () => Object.fromEntries(map),
  };
}

export function makeSourceBindings({ source, store, jar, hooks }) {
  const sourceApi = {
    bookSourceUrl: source?.bookSourceUrl ?? '',
    bookSourceName: source?.bookSourceName ?? '',
    bookSourceGroup: source?.bookSourceGroup ?? '',
    bookSourceType: source?.bookSourceType ?? 0,
    getKey: () => source?.bookSourceUrl ?? '',
    getTag: () => source?.bookSourceGroup ?? '',
    getVariable(...args) {
      if (args.length === 0) return store.getVariable('');
      return store.getVariable(String(args[0]));
    },
    setVariable(...args) {
      if (args.length >= 2) return store.putVariable(String(args[0]), args[1]);
      return store.setVariableRaw(args[0]);
    },
    putVariable(...args) {
      if (args.length >= 2) return store.putVariable(String(args[0]), args[1]);
      return store.setVariableRaw(args[0]);
    },
    put: (key, value) => store.put(key, value),
    get: (key) => store.get(key),
    putConcurrent(value) {
      hooks.noop('source.putConcurrent');
      return value;
    },
    getLoginInfoMap: () => makeMapLike(store.loginInfo),
    getLoginInfo() {
      return store.loginInfo.size ? JSON.stringify(Object.fromEntries(store.loginInfo)) : '';
    },
    putLoginInfo(info) {
      try {
        const parsed = JSON.parse(String(info));
        for (const [k, v] of Object.entries(parsed)) store.loginInfo.set(String(k), String(v));
      } catch {
        return false;
      }
      return true;
    },
    getLoginHeader: () => store.loginHeader,
    putLoginHeader(header) {
      store.loginHeader = String(header ?? '');
      hooks.noop('source.putLoginHeader');
    },
    removeLoginHeader() {
      store.loginHeader = '';
    },
    refreshExplore() {
      hooks.noop('source.refreshExplore');
    },
    refreshJSLib() {
      hooks.noop('source.refreshJSLib');
    },
    getLoginUrl: () => source?.loginUrl ?? '',
    getLoginUi: () => source?.loginUi ?? '',
    getHeaderMap: () => {
      try {
        return JSON.parse(source?.header ?? '{}');
      } catch {
        return {};
      }
    },
    getRule(key) {
      if (!key) return '';
      const k = String(key);
      if (source && source[k] !== undefined) return String(source[k] ?? '');
      const dotMap = { search:'ruleSearch', ruleSearch:'ruleSearch', bookinfo:'ruleBookInfo',
        ruleBookInfo:'ruleBookInfo', toc:'ruleToc', ruleToc:'ruleToc',
        content:'ruleContent', ruleContent:'ruleContent', review:'ruleReview', ruleReview:'ruleReview' };
      const parts = k.split('.');
      if (parts.length >= 2) {
        const grp = dotMap[parts[0].toLowerCase()] || dotMap[parts[0]];
        if (grp && source?.[grp]) {
          const fld = source[grp][parts[1]];
          if (fld !== undefined) return String(fld ?? '');
        }
      }
      return '';
    },
  };

  const cache = {
    get: (key) => store.cacheGet(key),
    put: (key, value, saveTime = 0) => store.cachePut(key, value, saveTime),
    delete: (key) => store.cacheDelete(key),
    getFromMemory: (key) => store.memGet(key),
    putMemory: (key, value) => store.memPut(key, value),
    deleteMemory: (key) => store.memDelete(key),
    getFile(key) {
      hooks.warn('cache.getFile 需要设备文件缓存，离线返回空串');
      return '';
    },
    putFile(key, value) {
      hooks.warn('cache.putFile 需要设备文件缓存，已忽略');
      return value;
    },
    deleteFile(key) {
      hooks.noop('cache.deleteFile');
      return true;
    },
  };

  const cookie = {
    getCookie: (url) => jar.headerFor(url),
    setCookie: (url, value) => jar.setCookie(url, value),
    replaceCookie: (url, value) => jar.replaceCookie(url, value),
    removeCookie: (url) => jar.removeCookie(url),
    getKey: (url) => jar.getKey(url),
    setKey: (...args) => {
      hooks.noop('cookie.setKey');
      return args[0];
    },
  };

  // 变量存取挂为「非枚举」属性: runner 在 flow 模式切换书本时会执行
  //   for (const k of Object.keys(book)) delete book[k];
  // 来重置数据字段; 若 getVariable/putVariable 是可枚举自身属性, 会被一并删掉,
  // 随后书源规则里的 book.getVariable("custom") 就抛 "is not a function".
  // 非枚举属性不在 Object.keys 中, 既不会被 delete, 也不会被 Object.assign 覆盖.
  const attachVariableBag = (obj) => {
    const bag = new Map();
    const def = (name, fn) => Object.defineProperty(obj, name, {
      value: fn, enumerable: false, configurable: true, writable: true,
    });
    def('getVariable', (key) => (bag.has(String(key)) ? bag.get(String(key)) : ''));
    def('putVariable', (key, value) => {
      if (value === null || value === undefined) { bag.delete(String(key)); return true; }
      bag.set(String(key), String(value));
      return true;
    });
    def('removeVariable', (key) => { bag.delete(String(key)); return true; });
    return obj;
  };

  const makeBook = (data = {}) => attachVariableBag({
    name: '',
    author: '',
    bookUrl: '',
    tocUrl: '',
    origin: '',
    originName: '',
    ...data,
  });

  const makeChapter = (data = {}) => attachVariableBag({
    title: '',
    url: '',
    index: 0,
    ...data,
  });

  return { source: sourceApi, cache, cookie, makeBook, makeChapter };
}
