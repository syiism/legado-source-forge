const SECRET_KEY = /(password|passwd|pwd|token|cookie|session|sid|secret|csrf)/i;

export function truncateText(text, maxChars = 2000, full = false) {
  const s = String(text ?? '');
  if (full || s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n…（已截断，共 ${s.length} 字符；用 --full 查看全部）`;
}

export function redactValue(key, value, showSecrets) {
  if (showSecrets) return value;
  return SECRET_KEY.test(String(key)) ? '***' : value;
}

export function redactMap(map, showSecrets) {
  const out = {};
  for (const [k, v] of Object.entries(map ?? {})) out[k] = redactValue(k, v, showSecrets);
  return out;
}

function indent(text, prefix) {
  return String(text).split('\n').map((line) => prefix + line).join('\n');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function renderHuman(report, options = {}) {
  const { full = false, maxChars = 2000, quiet = false, showSecrets = false } = options;
  const lines = [];

  const name = report.source.name || '(未命名书源)';
  lines.push(`▶ ${name}`);
  if (report.source.project) lines.push(`  工程：${report.source.project}`);
  else if (report.source.file) lines.push(`  文件：${report.source.file}`);
  for (const warning of report.build?.warnings ?? []) lines.push(`  build: ${warning}`);
  const bindBits = [];
  if (report.bindings.key !== '' && report.bindings.key !== null) bindBits.push(`key=${report.bindings.key}`);
  if (report.bindings.page !== null && report.bindings.page !== undefined) bindBits.push(`page=${report.bindings.page}`);
  if (report.bindings.baseUrl) bindBits.push(`baseUrl=${report.bindings.baseUrl}`);
  const varCount = Object.keys(report.bindings.vars ?? {}).length;
  if (varCount) bindBits.push(`vars=${varCount}`);
  if (bindBits.length) lines.push(`  绑定：${bindBits.join('  ')}`);

  for (const step of report.steps) {
    lines.push('');
    const suffix = step.suffix?.kind && step.suffix.kind !== 'none' ? `  suffix=${step.suffix.kind}` : '';
    const inputs = [];
    if (step.bindings?.key !== '' && step.bindings?.key !== undefined) inputs.push(`key=${step.bindings.key}`);
    if (step.bindings?.page !== undefined) inputs.push(`page=${step.bindings.page}`);
    if (step.bindings?.baseUrl) inputs.push(`baseUrl=${step.bindings.baseUrl}`);
    const inputText = inputs.length ? `  ${inputs.join(' ')}` : '';
    lines.push(`[${step.index + 1}] ${step.label}  (${step.mode}${suffix}, ${formatBytes(step.sourceBytes)}, ${step.ms} ms)${inputText}`);

    for (const item of step.logs ?? []) {
      if (quiet && (item.kind === 'noop' || item.kind === 'toast' || item.kind === 'longToast')) continue;
      lines.push(indent(`[${item.kind}] ${truncateText(item.text, maxChars, full)}`, '  '));
    }
    for (const call of step.net ?? []) {
      if (call.mode === 'error') {
        lines.push(`  net: ${call.method} ${truncateText(call.url, maxChars, full)} → 失败 (${call.error ?? 'ERROR'}, ${call.ms} ms)`);
      } else {
        lines.push(`  net: ${call.method} ${truncateText(call.url, maxChars, full)} → ${call.status} (${formatBytes(call.bytes)}, ${call.ms} ms, ${call.mode}${call.charset ? `, ${call.charset}` : ''})`);
      }
    }
    const vars = step.vars?.vars ?? [];
    for (const change of vars) {
      lines.push(`  var: ${change.key} = ${change.to === undefined ? '(删除)' : truncateText(JSON.stringify(redactValue(change.key, change.to, showSecrets)), maxChars, full)}`);
    }
    if (step.vars?.rawChanged) lines.push(`  var.raw: ${formatBytes(step.vars.raw.length)} 字符`);
    for (const change of step.vars?.ruleMap ?? []) {
      lines.push(`  rule: ${change.key} = ${change.to === undefined ? '(删除)' : truncateText(JSON.stringify(redactValue(change.key, change.to, showSecrets)), maxChars, full)}`);
    }

    if (step.error) {
      lines.push(`  ✗ ${step.error.message}`);
      for (const hint of step.error.hints ?? []) lines.push(`    hint: ${hint}`);
      if (!full && step.error.stack) lines.push(indent(step.error.stack.split('\n').slice(0, 4).join('\n'), '    '));
    } else {
      lines.push(`  result: ${step.result.type}, ${formatBytes(step.result.size)}`);
      if (step.result.text !== '') lines.push(indent(truncateText(step.result.text, maxChars, full), '    '));
      if (step.requestOptions) {
        lines.push(`  request options: ${truncateText(JSON.stringify(step.requestOptions.json), maxChars, full)}`);
      }
    }

    if (step.suffixApplied) {
      lines.push(`  suffix ${step.suffix.text} → ${step.suffixApplied.type}, ${formatBytes(step.suffixApplied.size)}`);
      if (step.suffixApplied.text !== '') lines.push(indent(truncateText(step.suffixApplied.text, maxChars, full), '    '));
    } else if (step.suffix?.kind === 'options') {
      lines.push(`  suffix: 请求选项 ${truncateText(JSON.stringify(step.suffix.json), maxChars, full)}（加 --follow 才会发请求）`);
    } else if (step.suffix?.kind === 'selector') {
      lines.push(`  suffix: CSS 选择器「${step.suffix.text}」需要选择器引擎，已跳过`);
    } else if (step.suffix?.kind === 'regex') {
      lines.push(`  suffix: 正则「${step.suffix.text}」需要选择器引擎，已跳过`);
    }
  }

  if (report.flow) {
    const flow = report.flow;
    const book = flow.book ?? {};
    const chapter = flow.chapter ?? {};
    const nth = (index) => (Number.isInteger(index) ? index + 1 : '?');
    lines.push('');
    lines.push(`▶ flow: 《${book.name || '?'}》第 ${nth(flow.search?.index)}/${flow.search?.total ?? '?'} 本 → 第 ${nth(flow.toc?.index)}/${flow.toc?.total ?? '?'} 章《${chapter.title || '?'}》`);
    if (flow.content) lines.push(`  正文：${formatBytes(flow.content.bytes ?? flow.content.chars)}`);
  }

  lines.push('');
  const netCount = report.steps.reduce((n, s) => n + (s.net?.length ?? 0), 0);
  lines.push(`${report.ok ? '✔' : '✗'} ${report.steps.length} 步，${netCount} 次网络调用${report.ok ? '' : `，${report.steps.filter((s) => s.error).length} 步失败`}`);
  return lines.join('\n');
}

export function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

export function sanitizeReport(report, showSecrets) {
  if (showSecrets) return report;
  const clone = structuredClone(report);
  clone.bindings.vars = redactMap(clone.bindings.vars, false);
  clone.bindings.login = redactMap(clone.bindings.login, false);
  for (const step of clone.steps ?? []) {
    for (const change of step.vars?.vars ?? []) {
      if (change.to !== undefined) change.to = redactValue(change.key, change.to, false);
    }
    for (const change of step.vars?.ruleMap ?? []) {
      if (change.to !== undefined) change.to = redactValue(change.key, change.to, false);
    }
    if (step.vars?.loginInfo) step.vars.loginInfo = redactMap(step.vars.loginInfo, false);
  }
  return clone;
}
