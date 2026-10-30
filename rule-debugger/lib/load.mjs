import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export class BuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildError';
    this.code = 'BUILD_FAILED';
  }
}

export function loadSourceFile(file) {
  const abs = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const source = Array.isArray(data) ? data[0] : data;
  if (!source || typeof source !== 'object') throw new Error(`不是有效的书源 JSON：${abs}`);
  return source;
}

export function loadProject(dir) {
  const abs = path.resolve(dir);
  const build = path.join(abs, 'build.mjs');
  if (!fs.existsSync(build)) throw new BuildError(`未找到 ${build}（--project 需要 template 骨架工程）`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legado-debug-build-'));
  const out = path.join(tmp, 'source.json');
  const run = spawnSync(process.execPath, [build, '--out', out], { cwd: abs, encoding: 'utf8' });
  if (run.status !== 0) {
    const detail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    throw new BuildError(`构建失败：${build}\n${detail}`);
  }
  try {
    return { source: loadSourceFile(out), project: abs };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function loadSource({ source, project }) {
  if (project) return loadProject(project);
  if (source) return { source: loadSourceFile(source), project: null };
  throw new Error('需要 --source <书源.json> 或 --project <工程目录>');
}
