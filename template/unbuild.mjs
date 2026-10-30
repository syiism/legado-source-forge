// unbuild.mjs · 把成品书源反向拆进 src/
// 用法：node unbuild.mjs <书源.json> [--verify]
//   --verify：拆完立即装配并与输入逐字节比对（要求输入是 Legado 导出格式：字母序 + 2 空格缩进）
// 原则：只搬运不改写；包装形态（@js: / <js>…</js> + 尾部选择器 / 裸值）记入 src/wrappers.json。
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';
import {
  TOP_KEYS, META_KEYS, TOP_FILES, OPTIONAL_TOP_CODE, SHELL, RULES,
  ABSENT_CODE, WRAPPERS_FILE, BUILD_FILE,
} from './layout.mjs';

const B = fileURLToPath(new URL('.', import.meta.url));
const args = argv.slice(2);
const srcPath = args.find((a) => !a.startsWith('--'));
if (!srcPath) { console.error('用法：node unbuild.mjs <书源.json> [--verify]'); exit(2); }
const doVerify = args.includes('--verify');
const rawText = readFileSync(srcPath, 'utf8');
const parsed = JSON.parse(rawText);
if (!Array.isArray(parsed) || parsed.length !== 1) { console.error('✘ 仅支持单书源数组'); exit(1); }
const book = parsed[0];

function fail(msg) { console.error('✘ ' + msg); exit(1); }
function assert(ok, msg) { if (!ok) fail(msg); }

// ---- 0. 顶层字段集合必须与规范一致（顺序可不同，用于保留非规范序工程） ----
const inputKeys = Object.keys(book);
const canonicalKeys = TOP_KEYS.filter((k) => book[k] !== undefined);
assert(inputKeys.length === canonicalKeys.length &&
  inputKeys.every((k) => canonicalKeys.includes(k)),
  '顶层字段与规范不一致：\n  输入: ' + inputKeys.join(',') +
  '\n  规范: ' + canonicalKeys.join(','));
for (const k of inputKeys) assert(TOP_KEYS.includes(k), '未登记的顶层字段 ' + k);

// ---- 0b. 探测输出格式并写 src/build.json（保留人工配置的 file/indent 等） ----
// 缩进取全文最小正缩进：数组元素层级固定比键多一层，按首行键判断会误判
const leading = rawText.split('\n').slice(1)
  .map((line) => (line.match(/^( +)/) || [null, ''])[1].length)
  .filter((n) => n > 0);
const indent = leading.length ? Math.min(...leading) : 2;
const newline = rawText.endsWith('\n');
let cfg = {};
if (existsSync(B + BUILD_FILE)) {
  try { cfg = JSON.parse(readFileSync(B + BUILD_FILE, 'utf8')); } catch (e) { cfg = {}; }
}
if (indent === 2) delete cfg.indent; else cfg.indent = indent;
if (newline) delete cfg.newline; else cfg.newline = false;
if (inputKeys.join(',') === canonicalKeys.join(',')) delete cfg.topOrder; else cfg.topOrder = inputKeys;
const rel = relative(B, resolve(srcPath));
if (rel && !rel.startsWith('..') && !isAbsolute(rel)) cfg.file = rel;

// ---- 1. 清空生成目录（meta.json / build.json 也重写） ----
for (const d of ['shell', 'optional', 'rules']) {
  rmSync(B + 'src/' + d, { recursive: true, force: true });
  mkdirSync(B + 'src/' + d, { recursive: true });
}

// ---- 2. 包装识别 ----
function detect(name, v) {
  if (v.startsWith('@js:')) {
    const nl = v[4] === '\n';
    return { mode: '@js', lead: nl ? '@js:\n' : '@js:', body: v.slice(nl ? 5 : 4) };
  }
  if (v.startsWith('<js>')) {
    const nl = v[4] === '\n';
    const start = nl ? 5 : 4;
    const idx = v.lastIndexOf('</js>');
    assert(idx >= start, name + ' 缺少 </js>');
    return {
      mode: 'js', lead: nl ? '<js>\n' : '<js>',
      body: v.slice(start, idx), suffix: v.slice(idx + 5),
    };
  }
  return { mode: 'raw', body: v };
}

// ---- 3. meta.json（缺省键写 null；长文本/JS 顶层字段改落文件） ----
const topFileKeys = new Set(TOP_FILES.map((t) => t.key));
const meta = {};
for (const k of META_KEYS) meta[k] = (topFileKeys.has(k) || book[k] === undefined) ? null : book[k];
writeFileSync(B + 'src/meta.json', JSON.stringify(meta, null, 2) + '\n');

// ---- 3b. 顶层长文本 / header ----
for (const t of TOP_FILES) {
  writeFileSync(B + t.file, book[t.key] === undefined ? ABSENT_CODE + '\n' : book[t.key]);
}

// ---- 4. jsLib / 顶层纯 JS ----
writeFileSync(B + 'src/jslib.js', book.jsLib === undefined ? ABSENT_CODE + '\n' : book.jsLib);
for (const o of OPTIONAL_TOP_CODE) {
  writeFileSync(B + o.file, book[o.key] === undefined ? ABSENT_CODE + '\n' : book[o.key]);
}

// ---- 5. 登录壳（完整字段值；loginUi 按包装识别写单文件） ----
const wrappers = {};
for (const sh of SHELL) {
  const raw = book[sh.key];
  const v = typeof raw === 'string' && raw !== '' ? raw : undefined;
  if (!sh.wrap) {
    writeFileSync(B + sh.file, v === undefined ? ABSENT_CODE + '\n' : v);
    continue;
  }
  if (v === undefined) { writeFileSync(B + sh.file, ABSENT_CODE + '\n'); continue; }
  const d = detect(sh.key, v);
  wrappers[sh.key] = { mode: d.mode, lead: d.lead };
  if (d.suffix) wrappers[sh.key].suffix = d.suffix;
  writeFileSync(B + sh.file, d.body);
}

// ---- 6. 规则对象（完整字段骨架；缺省占位） ----
const groupKeys = new Set(RULES.map((g) => g.key));
for (const k of inputKeys) {
  if (k.startsWith('rule') && !groupKeys.has(k)) fail('未登记的规则对象 ' + k);
}
for (const g of RULES) {
  const obj = book[g.key];
  mkdirSync(B + g.dir, { recursive: true });
  const known = new Set(g.fields.map((f) => f.name));
  if (obj !== undefined) {
    assert(obj && typeof obj === 'object', g.key + ' 不是对象');
    for (const k of Object.keys(obj)) {
      assert(known.has(k), g.key + ' 含未登记字段 ' + k);
      assert(typeof obj[k] === 'string', g.key + '.' + k + ' 不是字符串');
    }
    // 仅当现有字段相对字母序乱序时才记入 ruleOrder（缺字段不算乱序，build 会按 layout 顺序跳过）
    const fieldNames = g.fields.map((f) => f.name);
    const present = Object.keys(obj);
    const canonicalPresent = fieldNames.filter((n) => present.includes(n));
    if (present.join(',') !== canonicalPresent.join(',')) {
      cfg.ruleOrder = cfg.ruleOrder || {};
      cfg.ruleOrder[g.key] = present.concat(fieldNames.filter((n) => !present.includes(n)));
    }
  }
  let textOut = `// ${g.key} 非代码字段（完整规则文本；null = 未启用）\n`;
  for (const f of g.fields) {
    const v = obj === undefined ? undefined : obj[f.name];
    const wrapped = v !== undefined && (v.startsWith('@js:') || v.startsWith('<js>'));
    if (f.kind === 'text' || (f.kind === 'both' && !wrapped)) {
      textOut += v === undefined
        ? `\nexport const ${f.name} = null; // 未启用\n`
        : `\nexport const ${f.name} = ${JSON.stringify(v)};\n`;
      continue;
    }
    const p = B + g.dir + '/' + f.name + '.js';
    if (v === undefined) { writeFileSync(p, ABSENT_CODE + '\n'); continue; }
    const d = detect(g.key + '.' + f.name, v);
    wrappers[g.key + '.' + f.name] = { mode: d.mode, lead: d.lead };
    if (d.suffix) wrappers[g.key + '.' + f.name].suffix = d.suffix;
    writeFileSync(p, d.body);
  }
  writeFileSync(B + g.dir + '/index.mjs', textOut);
}

// ---- 7. 包装清单 + 输出配置（build 按此还原） ----
writeFileSync(B + WRAPPERS_FILE, JSON.stringify(wrappers, null, 2) + '\n');
if (cfg.ruleOrder && !Object.keys(cfg.ruleOrder).length) delete cfg.ruleOrder;
writeFileSync(B + BUILD_FILE, JSON.stringify(cfg, null, 2) + '\n');

// ---- 8. 汇总 + 可选回环 ----
console.log('拆出 ' + inputKeys.length + ' 个顶层字段；包装条目 ' + Object.keys(wrappers).length);
console.log('  build.json: ' + (Object.keys(cfg).length ? JSON.stringify(cfg) : '默认（2 空格 + 尾换行 + 字母序）'));
for (const g of RULES) {
  const n = g.fields.filter((f) => f.kind === 'code').length;
  console.log('  ' + g.key.padEnd(12) + g.fields.length + ' 字段（' + n + ' 个 .js）');
}
execFileSync(process.execPath, [B + 'build.mjs', ...(doVerify ? ['--verify', srcPath] : [])], { stdio: 'inherit' });
