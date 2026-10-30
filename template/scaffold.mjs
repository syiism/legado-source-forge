// scaffold.mjs · 补齐初始骨架（只创建缺失文件，绝不覆盖已有内容）
// 用法：node scaffold.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  META_KEYS, DEFAULT_META, TOP_FILES, OPTIONAL_TOP_CODE, SHELL, RULES,
  ABSENT_CODE, WRAPPERS_FILE,
} from './layout.mjs';

const B = fileURLToPath(new URL('.', import.meta.url));
const created = [];

function ensure(file, content) {
  if (existsSync(B + file)) return;
  mkdirSync(file.includes('/') ? B + file.slice(0, file.lastIndexOf('/')) : B, { recursive: true });
  writeFileSync(B + file, content);
  created.push(file);
}

const meta = {};
for (const k of META_KEYS) meta[k] = DEFAULT_META[k];
ensure('src/meta.json', JSON.stringify(meta, null, 2) + '\n');
ensure('src/jslib.js', ABSENT_CODE + '\n');
ensure(WRAPPERS_FILE, '{}\n');
ensure('src/build.json', '{}\n');
for (const t of TOP_FILES) ensure(t.file, ABSENT_CODE + '\n');
for (const o of OPTIONAL_TOP_CODE) ensure(o.file, ABSENT_CODE + '\n');
const LOGINUI_JS_SCAFFOLD = `// loginUi（build 时自动加 @js: 前缀）
// 末尾必须返回 JSON 字符串，action 填 loginUrl 里的函数名。
// 启用时删掉注释符号即可；全部为注释时视为未启用。
//
// let res = [];
// res.push({ name: '账号', type: 'text', action: '' });
// res.push({ name: '密码', type: 'text', action: '' });
// res.push({ name: '登录', type: 'button', action: 'login()' });
// JSON.stringify(res);
//
// 固定 JSON 也可以直接返回：
// JSON.stringify([{ name: '账号', type: 'text', action: '' }]);
`;

for (const sh of SHELL) {
  ensure(sh.file, sh.key === 'loginUi' ? LOGINUI_JS_SCAFFOLD : ABSENT_CODE + '\n');
}

for (const g of RULES) {
  mkdirSync(B + g.dir, { recursive: true });
  let textOut = `// ${g.key} 非代码字段（完整规则文本；null = 未启用）\n`;
  for (const f of g.fields) {
    if (f.kind === 'text' || f.kind === 'both') textOut += `\nexport const ${f.name} = null; // 未启用\n`;
    else ensure(g.dir + '/' + f.name + '.js', ABSENT_CODE + '\n');
  }
  ensure(g.dir + '/index.mjs', textOut);
}

console.log(created.length ? '补齐 ' + created.length + ' 个文件：' : '骨架已完整，无新增文件。');
for (const f of created) console.log('  + ' + f);
