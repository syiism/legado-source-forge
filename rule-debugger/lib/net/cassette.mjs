import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXTERNAL_THRESHOLD = 256 * 1024;

export class CassetteMiss extends Error {
  constructor(key, url, nearest) {
    super(`cassette 未命中：${url}\n  键 ${key}\n  最近条目：\n${nearest.map((n) => `    ${n.key}  ${n.url}`).join('\n') || '    （空）'}`);
    this.name = 'CassetteMiss';
    this.code = 'CASSETTE_MISS';
    this.key = key;
    this.url = url;
  }
}

export class Cassette {
  constructor(file, { record = false } = {}) {
    this.file = file;
    this.record = record;
    this.entries = new Map();
    this.dirty = false;
  }

  static key(method, url, body = '') {
    const bodySha = crypto.createHash('sha256').update(String(body ?? '')).digest('hex');
    return crypto.createHash('sha256')
      .update(`${String(method).toUpperCase()}\n${url}\n${bodySha}`)
      .digest('hex');
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return this;
    const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    const dir = path.dirname(this.file);
    for (const entry of data.entries ?? []) {
      if (entry.bodyFile) entry.body = fs.readFileSync(path.resolve(dir, entry.bodyFile), 'utf8');
      this.entries.set(entry.key, entry);
    }
    return this;
  }

  get(method, url, body) {
    const key = Cassette.key(method, url, body);
    const hit = this.entries.get(key);
    if (!hit) return null;
    return hit;
  }

  miss(method, url, body) {
    const key = Cassette.key(method, url, body);
    const target = String(url);
    const common = (a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return i;
    };
    const nearest = [...this.entries.values()]
      .map((e) => ({ e, score: common(String(e.url), target) }))
      .filter((x) => x.score >= 8)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.e);
    return new CassetteMiss(key, url, nearest);
  }

  store(entry) {
    this.entries.set(entry.key, entry);
    this.dirty = true;
  }

  save() {
    if (!this.file || !this.record) return;
    const dir = path.dirname(this.file);
    const externalDir = `${path.basename(this.file)}.d`;
    const entries = [...this.entries.values()].map((entry) => {
      if (entry.body && entry.body.length > EXTERNAL_THRESHOLD) {
        const rel = path.join(externalDir, `${entry.key}.txt`);
        fs.mkdirSync(path.join(dir, externalDir), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), entry.body);
        const { body, ...rest } = entry;
        return { ...rest, bodyFile: rel };
      }
      return entry;
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ v: 1, entries }, null, 2) + '\n');
  }
}
