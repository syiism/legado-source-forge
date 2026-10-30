import vm from 'node:vm';

// Legado 实际是两级作用域：
//   共享作用域 = SharedJsScope（空 ScriptBindings，prototype 为 Rhino initStandardObjects）
//   规则作用域 = bindings（java/source/result/...），prototype 指向共享作用域
// 共享作用域里的 java 是 Rhino JavaPackage；只有规则作用域里的 java 才是 JsExtensions。
// 这里用「共享 vm 上下文 + 每步 with(scope)」还原：jsLib 加载期和 jsLib 函数内的自由 java
// 都落到 JavaPackage，规则原子里的 java 由 stepScope 上的同名绑定遮蔽。
const SHELL_KEYS = new Set(['Packages', 'console', 'print']);
const STEP_KEY = Symbol.for('legado.debug.step');

const JAVA_PACKAGE_HINT =
  'jsLib 在 Legado 中加载于 SharedJsScope（空 bindings）：其中的 java 是 Rhino JavaPackage，'
  + '不是规则层的 java.* 扩展。需在规则原子入口把 java/source 注入 jsLib（如 sqUseHost(java, source)），'
  + '再在 jsLib 内通过保存的引用调用。';

function javaStub(parentPath, prop) {
  const full = `${parentPath}.${prop}`;
  const fail = () => {
    const err = new Error(`Cannot call property ${prop} in object [JavaPackage ${parentPath}]`);
    err.code = 'JSPACKAGE_CALL';
    throw err;
  };
  return new Proxy(function javaPackageRef() {}, {
    get(target, key) {
      if (key === 'toString' || key === 'valueOf') return () => `[JavaPackage ${full}]`;
      if (typeof key === 'symbol') return Reflect.get(target, key);
      return javaStub(full, key);
    },
    apply: fail,
    construct: fail,
  });
}

function javaPackage(path, real) {
  const target = real && (typeof real === 'object' || typeof real === 'function') ? real : {};
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'symbol' || prop in t) {
        const value = Reflect.get(t, prop, receiver);
        return value && typeof value === 'object' ? javaPackage(`${path}.${prop}`, value) : value;
      }
      return javaStub(path, prop);
    },
  });
}

const RUN_SOURCE = `(function () {
  var S = globalThis[Symbol.for('legado.debug.step')];
  return (function () { with (S.scope) { return eval(S.code); } }).call(S.scope);
})()`;

const BIND_SOURCE = `(function (fn, scope) {
  return function () {
    var self = (this === undefined || this === globalThis) ? scope : this;
    return fn.apply(self, arguments);
  };
})`;

export class Sandbox {
  constructor({ jsLib, globals = {}, timeout = 60000 } = {}) {
    this.timeout = timeout;
    this.bindings = new Map();
    for (const [key, value] of Object.entries(globals)) {
      if (!SHELL_KEYS.has(key)) this.bindings.set(key, value);
    }

    const context = vm.createContext(Object.create(null));
    if ('Packages' in globals) context.Packages = globals.Packages;
    if ('console' in globals) context.console = globals.console;
    if ('print' in globals) context.print = globals.print;
    context.java = javaPackage('java', globals.Packages?.java);
    this.context = context;
    this.jsFunctions = [];

    if (jsLib) this.loadJsLib(jsLib);

    this.global = vm.runInContext('globalThis', context);
    this.binder = vm.runInContext(BIND_SOURCE, context);
    this.runner = new vm.Script(RUN_SOURCE, { filename: 'atom' });
  }

  script(code, filename) {
    return new vm.Script(code, { filename }).runInContext(this.context, { timeout: this.timeout });
  }

  loadJsLib(code) {
    const before = new Set(vm.runInContext('Object.getOwnPropertyNames(globalThis)', this.context));
    const value = this.script(code, 'jsLib');
    const after = vm.runInContext('Object.getOwnPropertyNames(globalThis)', this.context);
    this.jsFunctions = after.filter((name) => {
      if (before.has(name)) return false;
      try {
        return typeof vm.runInContext(name, this.context) === 'function';
      } catch {
        return false;
      }
    });
    return value;
  }

  set(name, value) {
    this.bindings.set(name, value);
  }

  // 规则作用域：自身持有规则层绑定，prototype 指向共享作用域（jsLib 声明）。
  // jsLib 的顶层函数再包一层，让原子顶层的裸调用拿到 this = 规则作用域，
  // 对齐 Rhino「this 取调用点所在作用域」的行为（jsLib 内部互相调用仍是共享作用域）。
  makeScope() {
    const scope = Object.create(this.global);
    for (const [name, value] of this.bindings) scope[name] = value;
    for (const name of this.jsFunctions) {
      const fn = this.global[name];
      if (typeof fn === 'function') scope[name] = this.binder(fn, scope);
    }
    return scope;
  }

  run(code) {
    this.context[STEP_KEY] = { scope: this.makeScope(), code };
    try {
      return this.runner.runInContext(this.context, { timeout: this.timeout });
    } finally {
      delete this.context[STEP_KEY];
    }
  }

  runAtom(code) {
    return this.run(code);
  }

  runExpression(code) {
    return this.run(code);
  }
}

export function rhinoHint(err) {
  const message = String(err?.message ?? err ?? '');
  const hints = [];
  if (/\[JavaPackage /.test(message)) {
    hints.push(JAVA_PACKAGE_HINT);
  }
  if (/\.length is not a function/.test(message)) {
    hints.push("Rhino 中 Java String 的 length 是方法引用：先用 '' + body / String(result) 转成 JS 字符串再取 .length。");
  }
  if (/\.slice is not a function/.test(message)) {
    hints.push('Rhino 中 Java String 没有 JS 的 .slice：先做字符串拼接转换（old = \'\' + body）再切。');
  }
  if (/Packages is not defined/.test(message)) {
    hints.push('Packages 由调试器注入；若缺失说明该调用发生在 jsLib 加载前。');
  }
  if (/Cannot read propert/.test(message)) {
    hints.push('空值访问：确认上一步 result / baseUrl / book 是否已传入（--result / --base-url）。');
  }
  const unsupported = /(\w+) is not a function/.exec(message);
  if (unsupported && /java\.|source\.|cache\.|cookie\./.test(unsupported[1] + message)) {
    hints.push('该 API 未在调试器中实现：可在 rule-debugger/lib/bindings 下补充桩件。');
  }
  return hints;
}
