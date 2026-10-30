import vm from 'node:vm';

export class Sandbox {
  constructor({ jsLib, globals = {}, timeout = 60000 } = {}) {
    this.timeout = timeout;
    this.context = vm.createContext(Object.assign(Object.create(null), globals));
    if (jsLib) this.loadJsLib(jsLib);
  }

  script(code, filename) {
    return new vm.Script(code, { filename }).runInContext(this.context, { timeout: this.timeout });
  }

  loadJsLib(code) {
    return this.script(code, 'jsLib');
  }

  set(name, value) {
    this.context[name] = value;
  }

  runAtom(code) {
    return this.script(`(function(){ return eval(${JSON.stringify(code)}); })()`, 'atom');
  }

  runExpression(code) {
    return this.script(`(function(){ return eval(${JSON.stringify(code)}); })()`, 'expr');
  }
}

export function rhinoHint(err) {
  const message = String(err?.message ?? err ?? '');
  const hints = [];
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
