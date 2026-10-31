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

function runBuild(build, out, cwd, extraArgs = []) {
  return spawnSync(process.execPath, [build, '--out', out, ...extraArgs], { cwd, encoding: 'utf8' });
}

function buildDetail(run) {
  return `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
}

export function loadProject(dir, { noGate = false } = {}) {
  const abs = path.resolve(dir);
  const build = path.join(abs, 'build.mjs');
  if (!fs.existsSync(build)) throw new BuildError(`未找到 ${build}（--project 需要 template 骨架工程）`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legado-debug-build-'));
  const out = path.join(tmp, 'source.json');
  const warnings = [];
  let run = runBuild(build, out, abs, noGate ? ['--no-gate'] : []);
  // 含 {{}} 占位符的 @js 规则无法过 new Function 门禁，工程自带的逃生口是 --no-gate。
  if (run.status !== 0 && !noGate && /语法门禁失败|gate failed/i.test(buildDetail(run))) {
    const retry = runBuild(build, out, abs, ['--no-gate']);
    if (retry.status === 0) {
      const firstLine = buildDetail(run).split('\n').find((line) => line.trim()) ?? '';
      warnings.push(`构建门禁失败，已用 --no-gate 重试：${firstLine}`);
      run = retry;
    }
  }
  if (run.status !== 0) {
    throw new BuildError(`构建失败：${build}\n${buildDetail(run)}`);
  }
  try {
    return { source: loadSourceFile(out), project: abs, warnings };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function loadSource({ source, project, build }) {
  if (project) return loadProject(project, { noGate: Boolean(build?.noGate) });
  if (source) return { source: loadSourceFile(source), project: null, warnings: [] };
  throw new Error('需要 --source <书源.json> 或 --project <工程目录>');
}
