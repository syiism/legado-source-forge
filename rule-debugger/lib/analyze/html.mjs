// Zero-dependency HTML parser + jsoup-style CSS selector for the offline debugger.
// Implements the subset of Legado java.getElement/getElements and selector suffixes.

const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr','!doctype']);

function parseAttrs(str) {
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(str))) {
    const key = m[1];
    const val = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '';
    if (!(key.toLowerCase() in attrs)) attrs[key] = val;
  }
  return attrs;
}

function parseHtml(src) {
  const root = { type: 'root', children: [], parent: null };
  const stack = [root];
  const len = src.length;
  let i = 0;
  const textBuf = [];
  const flush = () => {
    if (!textBuf.length) return;
    const text = textBuf.join('');
    textBuf.length = 0;
    if (text === '') return;
    const top = stack[stack.length - 1];
    top.children.push({ type: 'text', text, parent: top });
  };
  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { textBuf.push(src.slice(i)); break; }
    if (lt > i) textBuf.push(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const end = src.indexOf('-->', lt); i = end < 0 ? len : end + 3; continue; }
    if (src.startsWith('<!', lt)) { const end = src.indexOf('>', lt); i = end < 0 ? len : end + 1; continue; }
    const gt = src.indexOf('>', lt);
    if (gt < 0) { textBuf.push(src.slice(i)); break; }
    const inner = src.slice(lt + 1, gt);
    flush();
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) { if (stack[s].tag === name) { stack.length = s; break; } }
    } else {
      const selfClose = /\/\s*$/.test(inner);
      const body = inner.replace(/\/\s*$/, '').trim();
      const m = /^([A-Za-z][\w:-]*)/.exec(body);
      if (!m) { i = gt + 1; continue; }
      const tag = m[1].toLowerCase();
      const attrs = parseAttrs(body.slice(m[1].length));
      const node = { type: 'element', tag, attrs, children: [], parent: stack[stack.length - 1] };
      stack[stack.length - 1].children.push(node);
      if (!selfClose && !VOID.has(tag)) stack.push(node);
    }
    i = gt + 1;
  }
  flush();
  return root;
}

function collectText(node) {
  let out = '';
  for (const c of node.children || []) {
    if (c.type === 'text') out += c.text;
    else if (c.type === 'element') out += collectText(c);
  }
  return out;
}

function renderNode(node) {
  if (node.type === 'text') return node.text;
  if (node.type !== 'element') return '';
  let attrs = '';
  for (const k in node.attrs) attrs += ' ' + k + '="' + node.attrs[k] + '"';
  if (VOID.has(node.tag)) return '<' + node.tag + attrs + '>';
  return '<' + node.tag + attrs + '>' + node.children.map(renderNode).join('') + '</' + node.tag + '>';
}

class Element {
  constructor(node) { this._n = node; }
  get tagName() { return this._n.tag.toUpperCase(); }
  attr(name, def) {
    const a = this._n.attrs || {};
    let v = a[name];
    if (v === undefined) { for (const k in a) { if (k.toLowerCase() === String(name).toLowerCase()) { v = a[k]; break; } } }
    return v !== undefined ? v : (def === undefined ? '' : def);
  }
  hasAttr(name) { return this.attr(name, '\u0000') !== '\u0000'; }
  id() { return this.attr('id'); }
  className() { return this.attr('class'); }
  classes() { return this.className().split(/\s+/).filter(Boolean); }
  text() { return collectText(this._n).replace(/\s+/g, ' ').trim(); }
  wholeText() { return collectText(this._n); }
  ownText() {
    let t = '';
    for (const c of this._n.children) if (c.type === 'text') t += c.text;
    return t.replace(/\s+/g, ' ').trim();
  }
  html() { return this._n.children.map(renderNode).join('').trim(); }
  outerHtml() { return renderNode(this._n); }
  toString() { return this.outerHtml(); }
  val() { return this.attr('value') || this.text(); }
  data(key) { return this.attr('data-' + key); }
  get children() { return new Elements(this._n.children.filter((c) => c.type === 'element').map((c) => new Element(c))); }
  get childNodes() { return this._n.children; }
  select(sel) { return queryAll(this._n, sel); }
  selectFirst(sel) { const r = this.select(sel); return r.size() ? r.first() : null; }
  nextElementSibling() {
    const p = this._n.parent; if (!p) return null;
    const sibs = p.children; const idx = sibs.indexOf(this._n);
    for (let k = idx + 1; k < sibs.length; k++) if (sibs[k].type === 'element') return new Element(sibs[k]);
    return null;
  }
  parentEl() { return this._n.parent && this._n.parent.type === 'element' ? new Element(this._n.parent) : null; }
}

class Elements extends Array {
  size() { return this.length; }
  first() { return this.length ? this[0] : null; }
  last() { return this.length ? this[this.length - 1] : null; }
  get(i) { return this[i] || null; }
  eq(i) { return this[i < 0 ? this.length + i : i] || null; }
  attr(name) { return this.length ? this[0].attr(name) : ''; }
  text() { return this.map((e) => e.text()).join(''); }
  html() { return this.map((e) => e.html()).join(''); }
  each(fn) { this.forEach((e, idx, arr) => fn(e, idx, arr)); return this; }
  hasAttr() { return this.length > 0; }
  select(sel) { const out = new Elements(); for (const e of this) for (const x of e.select(sel)) out.push(x); return out; }
  val() { return this.length ? this[0].val() : ''; }
  toString() { return this.map((e) => e.outerHtml()).join(''); }
}

function allDescendants(rootNode) {
  const out = [];
  const walk = (n) => { for (const c of n.children || []) { if (c.type === 'element') { out.push(new Element(c)); walk(c); } } };
  walk(rootNode);
  return out;
}

function parseSimple(s) {
  const matchers = [];
  let rest = s.trim();
  const m0 = /^[A-Za-z][\w:-]*/.exec(rest);
  if (m0) { matchers.push({ t: 'tag', v: m0[0].toLowerCase() }); rest = rest.slice(m0[0].length); }
  const re = /([#.][\w:-]+)|\[([\w:.-]+)(?:([~^|]?=)["']?([^\]"]*?)["']?\])|:([\w-]+)(?:\(([^)]*)\))?|(\[[\w:.-]+\])/g;
  let m;
  while ((m = re.exec(rest))) {
    if (m[1]) matchers.push(m[1][0] === '#' ? { t: 'id', v: m[1].slice(1) } : { t: 'class', v: m[1].slice(1) });
    else if (m[2]) matchers.push({ t: 'attr', name: m[2], op: m[3] || '=', val: m[4] !== undefined ? m[4] : null });
    else if (m[5]) matchers.push({ t: 'pseudo', name: m[5], arg: m[6] });
    else if (m[7]) matchers.push({ t: 'attr', name: m[7].slice(1, -1), op: 'exists', val: null });
  }
  return matchers;
}

function matchSimple(el, matchers) {
  for (const mt of matchers) {
    if (mt.t === 'tag' && el._n.tag !== mt.v) return false;
    else if (mt.t === 'id' && el.id() !== mt.v) return false;
    else if (mt.t === 'class' && !el.classes().includes(mt.v)) return false;
    else if (mt.t === 'attr') {
      const present = el.hasAttr(mt.name);
      const v = present ? el.attr(mt.name) : undefined;
      if (mt.op === 'exists') { if (!present) return false; }
      else {
        if (!present) return false;
        if (mt.op === '=' && v !== mt.val) return false;
        if (mt.op === '^=' && !v.startsWith(mt.val)) return false;
        if (mt.op === '$=' && !v.endsWith(mt.val)) return false;
        if (mt.op === '*=' && !v.includes(mt.val)) return false;
        if (mt.op === '~=' && !v.split(/\s+/).includes(mt.val)) return false;
        if (mt.op === '|=' && !(v === mt.val || v.startsWith(mt.val + '-'))) return false;
      }
    } else if (mt.t === 'pseudo') {
      const p = el._n.parent;
      const els = p ? p.children.filter((c) => c.type === 'element') : [];
      const idx = els.indexOf(el._n);
      if (mt.name === 'first-child') { if (idx !== 0) return false; }
      else if (mt.name === 'last-child') { if (idx !== els.length - 1) return false; }
      else if (mt.name === 'nth-child') { if (String(idx + 1) !== String(mt.arg).trim()) return false; }
      else if (mt.name === 'empty') { if (el._n.children.length) return false; }
      else if (mt.name === 'not') { const sub = parseSelector(mt.arg); if (sub.some((g) => matchSelectorPath(el, g))) return false; }
      else return false;
    }
  }
  return true;
}

function parseSelector(text) {
  return String(text).split(',').map((part) => {
    const seq = [];
    const pieces = part.trim().split(/(\s*>\s*|\s+)/);
    for (const pc of pieces) {
      if (pc === '') continue;
      if (/^\s*>\s*$/.test(pc)) { seq.push({ comb: '>' }); continue; }
      if (/^\s+$/.test(pc)) { seq.push({ comb: ' ' }); continue; }
      seq.push({ sel: parseSimple(pc) });
    }
    return seq;
  });
}

function matchSelectorPath(el, chain) {
  const sels = chain.filter((c) => c.sel).map((c) => c.sel);
  if (!sels.length) return false;
  if (!matchSimple(el, sels[sels.length - 1])) return false;
  let cur = el.parentEl();
  for (let s = sels.length - 2; s >= 0; s--) {
    while (cur) { if (matchSimple(cur, sels[s])) break; cur = cur.parentEl(); }
    if (!cur) return false;
    cur = cur.parentEl();
  }
  return true;
}

function queryAll(scopeNode, selector) {
  const groups = parseSelector(selector);
  const nodes = (scopeNode.type === 'root' || scopeNode.type === 'element') ? allDescendants(scopeNode) : [];
  const seen = new Set();
  const res = new Elements();
  for (const g of groups) {
    for (const el of nodes) {
      if (matchSelectorPath(el, g) && !seen.has(el._n)) { seen.add(el._n); res.push(el); }
    }
  }
  return res;
}

export function parseDocument(html) { return parseHtml(String(html || '')); }

// Legado 规则用 `.N` 表示「第 N 个匹配元素」（h1.0、.blk-item.0），
// 而 CSS 会把 `.0` 当成类名。选出元素后再按该后缀取索引。
function applyIndexSuffix(els, token) {
  const out = new Elements();
  if (token === 'first') { if (els.size()) out.push(els.first()); return out; }
  if (token === 'last') { if (els.size()) out.push(els.last()); return out; }
  if (token === 'even') { for (let i = 1; i < els.size(); i += 2) out.push(els.get(i)); return out; }
  if (token === 'odd') { for (let i = 0; i < els.size(); i += 2) out.push(els.get(i)); return out; }
  const n = Number(token);
  const el = els.get(n < 0 ? els.size() + n : n);
  if (el) out.push(el);
  return out;
}

export function selectIn(html, selector) {
  const text = String(selector ?? '').trim();
  // 规则里剩余的 `@` 是 Legado 的链式选择器分隔符（如 .blk@.blk-body@text）。
  if (text.includes('@')) return selectChain(html, text);
  const m = /\.(first|last|even|odd|-?\d+)$/.exec(text);
  const base = m ? text.slice(0, m.index).trim() : text;
  const els = queryAll(parseDocument(html), base || text);
  return m ? applyIndexSuffix(els, m[1]) : els;
}

export function splitSelectorAttr(rule) {
  const text = String(rule || '').trim();
  let depth = 0; let lastAt = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '@' && depth === 0) lastAt = i;
  }
  if (lastAt <= 0) return { selector: text, attr: null };
  return { selector: text.slice(0, lastAt), attr: text.slice(lastAt + 1) || null };
}

function applyAttr(el, directive) {
  if (!directive) return el.text();
  const d = String(directive).toLowerCase();
  if (d === 'text') return el.text();
  if (d === 'html' || d === 'innerhtml') return el.html();
  if (d === 'outerhtml') return el.outerHtml();
  if (d === 'owntext') return el.ownText();
  if (d === 'val' || d === 'value') return el.val();
  if (d === 'tagname') return el.tagName;
  return el.attr(directive);
}

export function looksLikeHtml(value) {
  if (typeof value !== 'string') return false;
  return /<[A-Za-z][^>]*>/.test(value);
}

export function evaluateSelector(html, rule, all = false) {
  const { selector, attr } = splitSelectorAttr(rule);
  const els = selectIn(html, selector);
  if (all) return Array.from(els.map((e) => applyAttr(e, attr)));
  if (!els.size()) return '';
  return applyAttr(els.first(), attr);
}

function singleton(el) { const e = new Elements(); if (el) e.push(el); return e; }
function fromArr(arr) { const e = new Elements(); for (const x of arr) e.push(x); return e; }

export function selectChain(html, rule) {
  const text = String(rule || '');
  const root = parseDocument(html);
  const segs = [];
  let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    if (c === '@' && depth === 0) { segs.push(cur); cur = ''; }
    else cur += c;
  }
  segs.push(cur);
  let current = new Elements();
  let started = false;
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si].trim();
    if (seg === '') continue;
    let css = seg;
    let idxSuffix = null;
    const im = /\.(last|first|even|odd|\d+)$/.exec(seg);
    if (im) { idxSuffix = im[1]; css = seg.slice(0, im.index); }
    if (!started) { current = queryAll(root, css || seg); started = true; }
    else if (css) {
      const merged = new Elements(); const seen = new Set();
      for (const e of current) for (const x of e.select(css)) if (!seen.has(x._n)) { seen.add(x._n); merged.push(x); }
      current = merged;
    }
    if (idxSuffix) {
      if (idxSuffix === 'last') current = singleton(current.last());
      else if (idxSuffix === 'first') current = singleton(current.first());
      else if (idxSuffix === 'even') current = Elements.from ? fromArr(current.filter((e, i) => i % 2 === 1)) : fromArr(current.filter((e, i) => i % 2 === 1));
      else if (idxSuffix === 'odd') current = fromArr(current.filter((e, i) => i % 2 === 0));
      else { const n = Number(idxSuffix); current = singleton(current[n < 0 ? current.length + n : n]); }
    }
  }
  return current;
}
