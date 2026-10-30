#!/usr/bin/env node
import { parseArgs, usage } from '../lib/cli.mjs';
import { run } from '../lib/runner.mjs';
import { renderHuman, renderJson, sanitizeReport } from '../lib/report.mjs';
import { UsageError } from '../lib/rule.mjs';
import { BuildError } from '../lib/load.mjs';
import { CassetteMiss } from '../lib/net/cassette.mjs';

let config;
try {
  config = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`参数错误：${err.message}\n\n${usage()}`);
  process.exit(2);
}

if (config.help) {
  console.log(usage());
  process.exit(0);
}

try {
  const { report, exitCode } = run(config);
  const sanitized = sanitizeReport(report, config.output.showSecrets);
  if (config.output.json) {
    console.log(renderJson(sanitized));
  } else {
    console.log(renderHuman(sanitized, config.output));
  }
  process.exitCode = exitCode;
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`参数错误：${err.message}`);
    process.exit(2);
  }
  if (err instanceof BuildError) {
    console.error(err.message);
    process.exit(4);
  }
  if (err instanceof CassetteMiss || err?.code === 'CASSETTE_MISS') {
    console.error(err.message);
    process.exit(3);
  }
  console.error(err?.stack ?? String(err));
  process.exit(1);
}
