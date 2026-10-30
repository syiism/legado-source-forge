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

  const makeVariableBag = () => {
    const bag = new Map();
    return {
      getVariable: (key) => (bag.has(String(key)) ? bag.get(String(key)) : ''),
      putVariable: (key, value) => {
        if (value === null || value === undefined) {
          bag.delete(String(key));
          return true;
        }
        bag.set(String(key), String(value));
        return true;
      },
    };
  };

  const makeBook = (data = {}) => ({
    name: '',
    author: '',
    bookUrl: '',
    tocUrl: '',
    origin: '',
    originName: '',
    ...data,
    ...makeVariableBag(),
  });

  const makeChapter = (data = {}) => ({
    title: '',
    url: '',
    index: 0,
    ...data,
    ...makeVariableBag(),
  });

  return { source: sourceApi, cache, cookie, makeBook, makeChapter };
}
