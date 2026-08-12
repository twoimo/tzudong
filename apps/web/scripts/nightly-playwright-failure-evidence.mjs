import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const MAX_PRIVATE_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 8 * 1024;
const MAX_TESTS = 128;
const MAX_RESULTS_PER_TEST = 8;
const MAX_REPORT_ERRORS = 64;
const RUNNER_STAGE_FAILURE_CLASSES = new Map([
  ['admission', new Set([
    'contract_rejected', 'custody_rejected', 'runtime_unavailable', 'unexpected_failure',
  ])],
  ['log_open', new Set(['custody_rejected'])],
  ['app_spawn', new Set(['process_spawn_failed'])],
  ['health', new Set([
    'application_exit', 'health_timeout', 'process_spawn_failed', 'runtime_unavailable',
  ])],
  ['report_prepare', new Set(['custody_rejected'])],
  ['playwright', new Set(['process_spawn_failed'])],
  ['sanitize', new Set(['report_rejected'])],
  ['diagnostics', new Set(['diagnostics_rejected'])],
  ['cleanup', new Set(['cleanup_rejected'])],
]);

const SPEC_IDS = new Map([
  ['smoke.spec.ts', 'PW-SMOKE'],
  ['navigation.spec.ts', 'PW-NAV'],
  ['browser-title.spec.ts', 'PW-TITLE'],
  ['mobile-home-map.spec.ts', 'PW-MAP'],
  ['local-supabase-admin.spec.ts', 'PW-ADMIN'],
]);
const TEST_STATUSES = ['expected', 'flaky', 'skipped', 'unexpected'];
const RESULT_STATUSES = ['failed', 'interrupted', 'passed', 'skipped', 'timedOut'];
const FAILURE_CLASSES = [
  'failed',
  'interrupted',
  'no_result',
  'runner_error',
  'timed_out',
  'unexpected_pass',
];

function fail(message) {
  throw new Error(message);
}

function ownerUidMatches(fileStat) {
  return typeof process.getuid !== 'function' || fileStat.uid === process.getuid();
}

function assertOwnerOnlyRegularFile(filePath, label, maxBytes) {
  let fileStat;
  try {
    fileStat = lstatSync(filePath);
  } catch {
    fail(`${label} is unavailable.`);
  }
  if (
    !fileStat.isFile()
    || fileStat.isSymbolicLink()
    || !ownerUidMatches(fileStat)
    || (fileStat.mode & 0o777) !== 0o600
    || fileStat.size > maxBytes
  ) {
    fail(`${label} custody mismatch.`);
  }
  return fileStat;
}

function openOwnerOnlyForTruncate(filePath, label) {
  let existing;
  try {
    existing = lstatSync(filePath);
  } catch {
    existing = undefined;
  }
  if (
    existing
    && (
      !existing.isFile()
      || existing.isSymbolicLink()
      || !ownerUidMatches(existing)
      || (existing.mode & 0o777) !== 0o600
    )
  ) {
    fail(`${label} custody mismatch.`);
  }
  let descriptor;
  try {
    const flags = fsConstants.O_WRONLY
      | fsConstants.O_NOFOLLOW
      | (existing ? 0 : fsConstants.O_CREAT | fsConstants.O_EXCL);
    descriptor = openSync(filePath, flags, 0o600);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !ownerUidMatches(opened) || (opened.mode & 0o777) !== 0o600) {
      fail(`${label} custody mismatch.`);
    }
    ftruncateSync(descriptor, 0);
    closeSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the fixed custody failure below.
      }
    }
    if (error instanceof Error && error.message === `${label} custody mismatch.`) {
      throw error;
    }
    fail(`${label} could not be prepared.`);
  }
}

function writeOwnerOnlyCanonicalFile(filePath, label, body, maxBytes) {
  const bodyBytes = Buffer.byteLength(body);
  if (bodyBytes > maxBytes) {
    fail(`${label} exceeded its size bound.`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW,
      0o600,
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !ownerUidMatches(opened) || (opened.mode & 0o777) !== 0o600) {
      fail(`${label} custody mismatch.`);
    }
    ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, body, { encoding: 'utf8' });
    fsyncSync(descriptor);
    const written = fstatSync(descriptor);
    const current = lstatSync(filePath);
    if (
      !written.isFile()
      || !ownerUidMatches(written)
      || (written.mode & 0o777) !== 0o600
      || written.size !== bodyBytes
      || !current.isFile()
      || current.isSymbolicLink()
      || current.dev !== written.dev
      || current.ino !== written.ino
    ) {
      fail(`${label} custody mismatch.`);
    }
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message === `${label} custody mismatch.`
        || error.message === `${label} exceeded its size bound.`
      )
    ) {
      throw error;
    }
    fail(`${label} could not be written.`);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the fixed write or custody failure above.
      }
    }
  }
}

export function preparePrivatePlaywrightReport(filePath) {
  const parent = path.dirname(filePath);
  let parentStat;
  try {
    parentStat = lstatSync(parent);
  } catch {
    try {
      mkdirSync(parent, { mode: 0o700 });
      parentStat = lstatSync(parent);
    } catch {
      fail('Private Playwright JSON report directory could not be prepared.');
    }
  }
  if (
    !parentStat.isDirectory()
    || parentStat.isSymbolicLink()
    || !ownerUidMatches(parentStat)
    || (parentStat.mode & 0o022) !== 0
  ) {
    fail('Private Playwright JSON report directory custody mismatch.');
  }
  openOwnerOnlyForTruncate(filePath, 'Private Playwright JSON report');
}

function prepareEvidenceDirectory(filePath) {
  const parent = path.dirname(filePath);
  let parentStat;
  try {
    parentStat = lstatSync(parent);
  } catch {
    try {
      mkdirSync(parent, { mode: 0o700 });
      parentStat = lstatSync(parent);
    } catch {
      fail('Sanitized Playwright failure evidence directory could not be prepared.');
    }
  }
  if (
    !parentStat.isDirectory()
    || parentStat.isSymbolicLink()
    || !ownerUidMatches(parentStat)
    || (parentStat.mode & 0o022) !== 0
  ) {
    fail('Sanitized Playwright failure evidence directory custody mismatch.');
  }
}

export function writeNightlyRunnerStageEvidence(filePath, stage, failureClass) {
  if (!RUNNER_STAGE_FAILURE_CLASSES.get(stage)?.has(failureClass)) {
    fail('Nightly runner stage evidence contract mismatch.');
  }
  const evidence = {
    schema: 'nightly-e2e-runner-stage-evidence-v1',
    source: 'nightly-runner-stage-v1',
    command_exit_code: 1,
    outcome: 'failure',
    stage,
    failure_class: failureClass,
  };
  const body = `${JSON.stringify(evidence)}\n`;
  prepareEvidenceDirectory(filePath);
  writeOwnerOnlyCanonicalFile(
    filePath,
    'Nightly runner stage evidence',
    body,
    MAX_EVIDENCE_BYTES,
  );
  return evidence;
}

export function replaceWithNightlyRunnerStageEvidence(
  filePath,
  stage,
  error,
  preservePlaywrightEvidence,
) {
  if (preservePlaywrightEvidence) return false;
  try {
    removeSanitizedPlaywrightFailureEvidence(filePath);
  } catch {
    // The descriptor-bound writer remains the fail-closed authority.
  }
  writeNightlyRunnerStageEvidence(
    filePath,
    stage,
    classifyNightlyRunnerStageFailure(stage, error),
  );
  return true;
}

export async function completeNightlyCleanupTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length !== 3 || tasks.some((task) => typeof task !== 'function')) {
    fail('Nightly browser cleanup task contract mismatch.');
  }
  let cleanupFailed = false;
  for (const task of tasks) {
    try {
      await task();
    } catch {
      cleanupFailed = true;
    }
  }
  return cleanupFailed;
}

export function classifyNightlyRunnerStageFailure(stage, error) {
  if (!RUNNER_STAGE_FAILURE_CLASSES.has(stage)) return 'unexpected_failure';
  const message = error instanceof Error ? error.message : '';
  if (stage === 'admission') {
    if (/owner-only|custody|regular file|directory/.test(message)) return 'custody_rejected';
    if (/receipt|provenance|configuration|source-bound|generated project-scoped/.test(message)) {
      return 'contract_rejected';
    }
    if (/service state|readiness|Compose stack|running and healthy/.test(message)) {
      return 'runtime_unavailable';
    }
  }
  if (stage === 'log_open' || stage === 'report_prepare') return 'custody_rejected';
  if (stage === 'app_spawn') return 'process_spawn_failed';
  if (stage === 'health') {
    if (message === 'Nightly application exited before the health endpoint became ready.') {
      return 'application_exit';
    }
    if (message.startsWith('Unable to start the nightly app:')) return 'process_spawn_failed';
    if (message.startsWith('Application did not become ready within ')) return 'health_timeout';
    return 'runtime_unavailable';
  }
  if (stage === 'playwright') return 'process_spawn_failed';
  if (stage === 'sanitize') return 'report_rejected';
  if (stage === 'diagnostics') return 'diagnostics_rejected';
  if (stage === 'cleanup') return 'cleanup_rejected';
  return 'unexpected_failure';
}

export function removePrivatePlaywrightReport(filePath) {
  let existing;
  try {
    existing = lstatSync(filePath);
  } catch {
    return;
  }
  if (
    !existing.isFile()
    || existing.isSymbolicLink()
    || !ownerUidMatches(existing)
    || (existing.mode & 0o777) !== 0o600
  ) {
    fail('Private Playwright JSON report cleanup custody mismatch.');
  }
  unlinkSync(filePath);
}

export function removeSanitizedPlaywrightFailureEvidence(filePath) {
  let existing;
  try {
    existing = lstatSync(filePath);
  } catch {
    return;
  }
  if (
    !existing.isFile()
    || existing.isSymbolicLink()
    || !ownerUidMatches(existing)
    || (existing.mode & 0o777) !== 0o600
  ) {
    fail('Sanitized Playwright failure evidence cleanup custody mismatch.');
  }
  unlinkSync(filePath);
}

function fixedCountRecord(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function boundedInteger(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}

function specIdFromReportFile(value) {
  if (typeof value !== 'string') {
    fail('Playwright JSON report contains an invalid spec identity.');
  }
  const normalized = value.replaceAll('\\', '/');
  const basename = path.posix.basename(normalized);
  if (normalized !== basename && normalized !== `tests/${basename}`) {
    fail('Playwright JSON report contains an uncurated spec identity.');
  }
  const specId = SPEC_IDS.get(basename);
  if (!specId) {
    fail('Playwright JSON report contains an uncurated spec identity.');
  }
  return specId;
}

function classifyUnexpectedResult(results) {
  if (results.length === 0) return 'no_result';
  const finalStatus = results.at(-1).status;
  if (finalStatus === 'timedOut') return 'timed_out';
  if (finalStatus === 'interrupted') return 'interrupted';
  if (finalStatus === 'failed') return 'failed';
  if (finalStatus === 'passed') return 'unexpected_pass';
  fail('Playwright JSON report contains an invalid unexpected result.');
}

function collectSpecs(suites) {
  if (!Array.isArray(suites)) {
    fail('Playwright JSON report suites are invalid.');
  }
  const specs = [];
  let visitedSuites = 0;
  const walk = (suite, inheritedSpecId = undefined) => {
    visitedSuites += 1;
    if (visitedSuites > MAX_TESTS * 4 || !suite || typeof suite !== 'object') {
      fail('Playwright JSON report suite bound exceeded.');
    }
    const suiteSpecId = specIdFromReportFile(suite.file);
    if (inheritedSpecId !== undefined && inheritedSpecId !== suiteSpecId) {
      fail('Playwright JSON report suite identity mismatch.');
    }
    if (suite.specs !== undefined) {
      if (!Array.isArray(suite.specs) || suite.specs.length > MAX_TESTS) {
        fail('Playwright JSON report spec bound exceeded.');
      }
      specs.push(...suite.specs.map((spec) => ({ spec, suiteSpecId })));
    }
    if (suite.suites !== undefined) {
      if (!Array.isArray(suite.suites) || suite.suites.length > MAX_TESTS) {
        fail('Playwright JSON report suite bound exceeded.');
      }
      for (const child of suite.suites) walk(child, suiteSpecId);
    }
  };
  for (const suite of suites) walk(suite);
  return specs;
}

export function buildNightlyPlaywrightFailureEvidence(report, commandExitCode) {
  if (
    !report
    || typeof report !== 'object'
    || !boundedInteger(commandExitCode, 255)
    || !Array.isArray(report.errors)
    || report.errors.length > MAX_REPORT_ERRORS
    || !report.stats
    || typeof report.stats !== 'object'
  ) {
    fail('Playwright JSON report contract mismatch.');
  }

  const testStatusCounts = fixedCountRecord(TEST_STATUSES);
  const resultStatusCounts = fixedCountRecord(RESULT_STATUSES);
  const failureClassCounts = fixedCountRecord(FAILURE_CLASSES);
  const failures = [];
  const nextIndexBySpec = new Map();
  const specs = collectSpecs(report.suites);
  let totalTestCount = 0;

  for (const { spec, suiteSpecId } of specs) {
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.tests) || spec.tests.length !== 1) {
      fail('Playwright JSON report test shape mismatch.');
    }
    const specId = specIdFromReportFile(spec.file);
    if (specId !== suiteSpecId) {
      fail('Playwright JSON report spec identity mismatch.');
    }
    const testIndex = nextIndexBySpec.get(specId) ?? 0;
    nextIndexBySpec.set(specId, testIndex + 1);
    const test = spec.tests[0];
    if (
      !test
      || typeof test !== 'object'
      || test.projectName !== 'chromium'
      || !TEST_STATUSES.includes(test.status)
      || !Array.isArray(test.results)
      || test.results.length > MAX_RESULTS_PER_TEST
    ) {
      fail('Playwright JSON report test contract mismatch.');
    }
    totalTestCount += 1;
    if (totalTestCount > MAX_TESTS) {
      fail('Playwright JSON report test bound exceeded.');
    }
    testStatusCounts[test.status] += 1;

    let resultErrorCount = 0;
    for (const result of test.results) {
      if (
        !result
        || typeof result !== 'object'
        || !RESULT_STATUSES.includes(result.status)
        || !Array.isArray(result.errors)
        || result.errors.length > MAX_REPORT_ERRORS
      ) {
        fail('Playwright JSON report result contract mismatch.');
      }
      resultStatusCounts[result.status] += 1;
      resultErrorCount += result.errors.length;
      if (resultErrorCount > MAX_REPORT_ERRORS) {
        fail('Playwright JSON report result error bound exceeded.');
      }
    }

    if (test.status === 'unexpected') {
      const classification = classifyUnexpectedResult(test.results);
      failureClassCounts[classification] += 1;
      failures.push({
        spec_id: specId,
        test_index: testIndex,
        classification,
        attempt_count: test.results.length,
        result_error_count: resultErrorCount,
      });
    }
  }

  if (failures.length > MAX_REPORT_ERRORS) {
    fail('Playwright JSON report failure bound exceeded.');
  }
  for (const status of TEST_STATUSES) {
    if (!boundedInteger(report.stats[status], MAX_TESTS) || report.stats[status] !== testStatusCounts[status]) {
      fail('Playwright JSON report status count mismatch.');
    }
  }
  if (commandExitCode === 0 && totalTestCount === 0) {
    fail('Playwright JSON report contains no successful test evidence.');
  }

  const reportErrorCount = report.errors.length;
  failureClassCounts.runner_error = reportErrorCount;
  let runnerFailureCount = reportErrorCount;
  if (commandExitCode !== 0 && failures.length === 0 && reportErrorCount === 0) {
    runnerFailureCount = 1;
    failureClassCounts.runner_error = 1;
  }
  const failureCount = failures.length + runnerFailureCount;
  if ((commandExitCode === 0) !== (failureCount === 0)) {
    fail('Playwright JSON report exit and failure counts disagree.');
  }

  return {
    schema: 'nightly-playwright-failure-evidence-v1',
    source: 'playwright-json-report-v2',
    command_exit_code: commandExitCode,
    outcome: commandExitCode === 0 ? 'success' : 'failure',
    test_count: totalTestCount,
    test_status_counts: testStatusCounts,
    result_status_counts: resultStatusCounts,
    report_error_count: reportErrorCount,
    failure_count: failureCount,
    failure_class_counts: failureClassCounts,
    failures,
  };
}

export function sanitizePrivatePlaywrightReport(rawReportPath, outputPath, commandExitCode) {
  assertOwnerOnlyRegularFile(
    rawReportPath,
    'Private Playwright JSON report',
    MAX_PRIVATE_REPORT_BYTES,
  );
  let report;
  try {
    report = JSON.parse(readFileSync(rawReportPath, 'utf8'));
  } catch {
    fail('Private Playwright JSON report is not valid JSON.');
  }
  const evidence = buildNightlyPlaywrightFailureEvidence(report, commandExitCode);
  const body = `${JSON.stringify(evidence)}\n`;
  prepareEvidenceDirectory(outputPath);
  writeOwnerOnlyCanonicalFile(
    outputPath,
    'Sanitized Playwright failure evidence',
    body,
    MAX_EVIDENCE_BYTES,
  );
  return evidence;
}
