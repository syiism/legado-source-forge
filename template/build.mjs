// build.mjs · 模板装配：src/ → dist/
// 用法：
//   node build.mjs                        → dist/<书源名>.json + dist/jslib.js
//   node build.mjs --verify <书源.json>   → 与指定成品逐字节比对
//   node build.mjs --out <path>           → 指定输出路径
//
// 未启用字段（text=null / code=ABSENT_CODE / 空文件）不写进产物；规则对象整组全空时省略
//（ruleSearch / ruleToc / ruleContent 例外，输出 {} 占位）。字段与顶层键均按 layout 字母序输出。
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';
import {
  TOP_KEYS, META_KEYS, TOP_FILES, OPTIONAL_TOP_CODE, SHELL, RULES,
  ABSENT_CODE, WRAPPERS_FILE, BUILD_FILE, DEFAULT_META,
} from './layout.mjs';

import * as bookinfoText from './src/rules/bookinfo/index.mjs';
import * as contentText from './src/rules/content/index.mjs';
import * as exploreText from './src/rules/explore/index.mjs';
import * as reviewText from './src/rules/review/index.mjs';
import * as searchText from './src/rules/search/index.mjs';
import * as tocText from './src/rules/toc/index.mjs';

const B = fileURLToPath(new URL('.', import.meta.url));
const flag = (n) => argv.indexOf('--' + n);
const flagVal = (n) => (flag(n) >= 0 ? argv[flag(n) + 1] : null);
function fail(msg) { console.error('✘ ' + msg); exit(1); }

const TEXT_MOD = {
  ruleBookInfo: bookinfoText,
  ruleContent: contentText,
  ruleExplore: exploreText,
  ruleReview: reviewText,
  ruleSearch: searchText,
  ruleToc: tocText,
};
const wrappers = existsSync(B + WRAPPERS_FILE)
  ? JSON.parse(readFileSync(B + WRAPPERS_FILE, 'utf8'))
  : {};
const cfg = existsSync(B + BUILD_FILE)
  ? JSON.parse(readFileSync(B + BUILD_FILE, 'utf8'))
  : {};

function readText(file) {
  if (!existsSync(B + file)) return null;
  return readFileSync(B + file, 'utf8');
}
function absent(body) {
  return body === null || body.trim() === '' || body.trim() === ABSENT_CODE;
}
// 只有注释/空行也视为未启用（scaffold 的 loginUi.js 就是注释示例）
function commentOnly(body) {
  if (absent(body)) return true;
  return body.split('\n').every((line) => {
    const t = line.trim();
    return t === '' || t.startsWith('//');
  });
}
function wrap(key, body, defaultMode) {
  const w = wrappers[key] || {};
  const mode = w.mode || defaultMode;
  const suffix = w.suffix || '';
  const lead = w.lead || (mode === '@js' ? '@js:\n' : '<js>\n');
  if (mode === 'raw') return body;
  if (mode === '@js') return lead + body;
  if (mode === 'js') return lead + body + '</js>' + suffix;
  fail(key + ' 未知包装模式: ' + mode);
}
function textValue(group, f) {
  const mod = TEXT_MOD[group.key];
  const v = mod ? mod[f.name] : undefined;
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') fail(group.key + '.' + f.name + ' 不是字符串或 null');
  return v;
}
// 返回 { value, wrap } 或 null；both 字段优先取 .js 原子，否则取 index.mjs 完整规则文本
function fieldValue(group, f) {
  const atom = readText(group.dir + '/' + f.name + '.js');
  if (f.kind === 'code') return absent(atom) ? null : { value: atom, wrap: true };
  if (f.kind === 'both') {
    if (!absent(atom)) return { value: atom, wrap: true };
    const v = textValue(group, f);
    return v === null ? null : { value: v, wrap: false };
  }
  if (f.kind === 'text') {
    const v = textValue(group, f);
    return v === null ? null : { value: v, wrap: false };
  }
  fail(group.key + '.' + f.name + ' 未知 kind: ' + f.kind);
}

// ---- 1. 元字段 / jsLib / 顶层纯 JS ----
const meta = existsSync(B + 'src/meta.json')
  ? JSON.parse(readFileSync(B + 'src/meta.json', 'utf8'))
  : { ...DEFAULT_META };
const values = {};
for (const k of META_KEYS) {
  if (meta[k] !== null && meta[k] !== undefined) values[k] = meta[k];
}
// 长文本/JS 顶层字段：文件优先，meta 同名字段作旧工程回退
for (const t of TOP_FILES) {
  const body = readText(t.file);
  if (!absent(body)) values[t.key] = body;
}
const jslib = readText('src/jslib.js');
if (!absent(jslib)) values.jsLib = jslib;
for (const o of OPTIONAL_TOP_CODE) {
  const body = readText(o.file);
  if (!absent(body)) values[o.key] = body;
}

// ---- 2. 登录壳（文件即完整字段值；loginUi 按 wrap 装配） ----
for (const sh of SHELL) {
  const body = readText(sh.file);
  if (sh.wrap ? commentOnly(body) : absent(body)) continue;
  values[sh.key] = sh.wrap ? wrap(sh.key, body, sh.wrap) : body;
}

// ---- 3. 规则对象 ----
const ruleObjs = {};
for (const g of RULES) {
  const o = {};
  // 规则内字段序：build.json.ruleOrder 优先（非规范序工程逐字节还原用），缺省 layout 字母序
  const order = (cfg.ruleOrder && cfg.ruleOrder[g.key]) || g.fields.map((f) => f.name);
  for (const name of order) {
    const f = g.fields.find((x) => x.name === name);
    if (!f) fail(g.key + ' ruleOrder 含未登记字段: ' + name);
    const r = fieldValue(g, f);
    if (r === null) continue;
    o[f.name] = r.wrap ? wrap(g.key + '.' + f.name, r.value, f.defaultMode) : r.value;
  }
  if (Object.keys(o).length || g.always) ruleObjs[g.key] = o;
}
for (const [k, v] of Object.entries(ruleObjs)) values[k] = v;

// ---- 4. 顶层对象：按 build.json 的 topOrder（缺省规范字母序）输出 ----
const topOrder = Array.isArray(cfg.topOrder) && cfg.topOrder.length ? cfg.topOrder : TOP_KEYS;
for (const k of Object.keys(values)) if (!topOrder.includes(k)) fail('顶层字段未登记在 topOrder: ' + k);
const book = {};
for (const k of topOrder) if (values[k] !== undefined) book[k] = values[k];
const expectedTop = topOrder.filter((k) => values[k] !== undefined);
if (Object.keys(book).join(',') !== expectedTop.join(',')) fail('顶层键序与 build.json/topOrder 不一致');

// ---- 5. 语法门禁（只编译不执行；--no-gate 用于还原已知缺陷的旧产物） ----
const noGate = flag('no-gate') >= 0;
function gate(name, code) {
  if (noGate) return;
  try { new Function(code); } catch (e) { fail('语法门禁失败 ' + name + ': ' + e.message); }
}
function innerJs(v) {
  if (v.startsWith('@js:')) return v.slice(v[4] === '\n' ? 5 : 4);
  if (v.startsWith('<js>')) {
    const start = v[4] === '\n' ? 5 : 4;
    const idx = v.lastIndexOf('</js>');
    if (idx >= start) return v.slice(start, idx);
  }
  return null;
}
if (values.jsLib) gate('jsLib', values.jsLib);
for (const o of OPTIONAL_TOP_CODE) if (values[o.key]) gate(o.key, values[o.key]);
// header 常为 @js: 载荷；bookSourceComment 是纯文本，不做语法门禁
for (const t of TOP_FILES) {
  if (values[t.key] === undefined || t.key === 'bookSourceComment') continue;
  const js = innerJs(values[t.key]);
  if (js !== null) gate(t.key, js);
}
for (const sh of SHELL) {
  if (values[sh.key] === undefined) continue;
  if (sh.pureJs) {
    // loginUrl 允许是 URL（Legado 原生支持），只有 JS 形态才过门禁
    if (!/^https?:\/\//.test(values[sh.key])) gate(sh.key, values[sh.key]);
    continue;
  }
  const js = innerJs(values[sh.key]);
  if (js !== null) gate(sh.key, js);
}
for (const g of RULES) {
  for (const f of g.fields) {
    const r = fieldValue(g, f);
    if (r === null) continue;
    const key = g.key + '.' + f.name;
    if (!r.wrap) {
      const js = innerJs(r.value);
      if (js !== null) gate(key, js);
      continue;
    }
    const mode = (wrappers[key] || {}).mode || f.defaultMode;
    if (f.pureJs || mode !== 'raw') gate(key, r.value);
  }
}

// ---- 6. 输出（缩进/尾换行/文件名按 build.json，缺省 Legado 导出规范） ----
const indent = Number.isInteger(cfg.indent) ? cfg.indent : 2;
const newline = cfg.newline === undefined ? true : !!cfg.newline;
const out = JSON.stringify([book], null, indent) + (newline ? '\n' : '');
const vf = flagVal('verify');
const orig = vf ? readFileSync(vf, 'utf8') : null; // 先读目标，避免 outFile 与 vf 相同时自比
mkdirSync(B + 'dist', { recursive: true });
if (values.jsLib) writeFileSync(B + 'dist/jslib.js', values.jsLib);
const outFile = flagVal('out') || (cfg.file ? B + cfg.file
  : B + 'dist/' + String(values.bookSourceName || 'bookSource').replace(/[\\/]/g, '_') + '.json');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out);
console.log('jsLib  ' + (values.jsLib ? values.jsLib.length + ' 字符' : '未启用'));
console.log('规则   ' + Object.entries(ruleObjs).map(([k, o]) => k + '=' + Object.keys(o).length).join(' '));
console.log('written ' + outFile + '  (' + out.length + ' 字符)');

if (orig !== null) {
  if (orig === out) {
    console.log('✔ 逐字节还原（' + out.length + ' 字符）');
  } else {
    let i = 0; while (i < Math.min(orig.length, out.length) && orig[i] === out[i]) i++;
    console.error('✘ 与目标不一致，首个差异 @' + i +
      '\n  装配: ' + JSON.stringify(out.slice(Math.max(0, i - 60), i + 60)) +
      '\n  目标: ' + JSON.stringify(orig.slice(Math.max(0, i - 60), i + 60)));
    process.exit(1);
  }
}
