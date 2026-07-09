import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLiveProviderValidation } from '../src/live-validation.js';
import {
  REPORT_DIR,
  ensureDirs,
  resolvePath,
  writeJson,
} from '../src/utils.js';

export async function runLiveValidationCli(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv);
  const runValidation = dependencies.runLiveProviderValidation || runLiveProviderValidation;
  const result = await runValidation();
  if (result.skipped) {
    return {
      result,
      output: `Skipped live validation. ${result.reason}`,
    };
  }

  const payload = { ...result };
  if (args.writeReport) {
    await (dependencies.ensureDirs || ensureDirs)();
    const reportDir = resolvePath(args.reportDir, REPORT_DIR);
    const reportPath = resolvePath(
      args.report,
      path.join(reportDir, `live-validation-${result.target}.json`),
    );
    await (dependencies.writeJson || writeJson)(reportPath, { ...payload });
    payload.report = reportPath;
  }

  return {
    result: payload,
    output: JSON.stringify(payload, null, 2),
  };
}

export function parseArgs(argv) {
  const result = {
    writeReport: false,
    report: '',
    reportDir: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write-report') result.writeReport = true;
    else if (arg === '--report') result.report = requireValue(argv, index += 1, arg);
    else if (arg === '--report-dir') result.reportDir = requireValue(argv, index += 1, arg);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: npm run validate:live -- [options]

Options:
  --write-report          Write a sanitized live-validation report under reports/.
  --report <path>         Write the report to a specific path.
  --report-dir <path>     Directory for default live-validation-<target>.json reports.
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { output } = await runLiveValidationCli();
  console.log(output);
}
