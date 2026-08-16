import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PINNED_BUDGET_SHA256 as scorerBudgetPin, PINNED_RAW_SCHEMA_SHA256 as scorerRawPin, PINNED_SCORED_SCHEMA_SHA256 as scorerScoredPin, assertTrustedDirectory as assertScorerTrustedDirectory, budgets, canonicalBytes, compareRankedItems, derive, reserveAggregate, sameWindowsArtifactPath as scorerSameWindowsArtifactPath, stripWindowsVerbatimPrefix as scorerStripWindowsVerbatimPrefix } from '../scripts/score-performance-backlog.mjs';
import { PINNED_BUDGET_SHA256 as validatorBudgetPin, PINNED_RAW_SCHEMA_SHA256 as validatorRawPin, PINNED_SCORED_SCHEMA_SHA256 as validatorScoredPin, assertTrustedDirectory as assertValidatorTrustedDirectory, budgetTable as validatorBudgets, canonical as validatorCanonical, recompute, sameWindowsArtifactPath as validatorSameWindowsArtifactPath, stripWindowsVerbatimPrefix as validatorStripWindowsVerbatimPrefix } from '../scripts/validate-performance-backlog.mjs';
setDefaultTimeout(90_000);

const web = resolve(import.meta.dir, '..');
const performance = join(web, 'performance');
const fixtures = join(web, 'fixtures', 'performance-backlog');
const scorer = join(web, 'scripts', 'score-performance-backlog.mjs');
const validator = join(web, 'scripts', 'validate-performance-backlog.mjs');
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const APPROVED_INVENTORY = [
  'cwv.lcp.p75_ms|public|route.root|public_critical',
  'cwv.inp.p75_ms|public|route.root|public_critical',
  'cwv.cls.p75_milli|public|route.root|public_critical',
  'browser.long_task.max_ms|public|route.root|public_critical',
  'browser.long_task_total_p75_ms|public|route.root|public_critical',
  'interaction.app_owned_p75_ms|public|route.root|public_critical',
  'route.first_load_js.public_gzip_kib|public|route.root|public_critical',
  'route.first_load_js.shell_gzip_kib|shell|app.shell|public_critical',
  'route.first_load_js.admin_gzip_kib|admin|route.admin|admin_operator',
  'route.first_load_js.creative_gzip_kib|creative|route.admin.creative|admin_operator',
  'route.total_transfer_public_kib|public|route.root|public_critical',
  'route.image_transfer_kib|public|route.root|public_critical',
  'route.api_payload_public_kib|api|api.public_bounded|public_secondary',
  'route.api_payload_admin_kib|admin|api.admin|admin_operator',
  'route.server_public_p75_ms|public|route.root|public_critical',
  'route.server_auth_p75_ms|shell|auth.recovery|public_critical',
  'api.bounded_p95_ms|api|api.public_bounded|public_secondary',
  'api.external_backed_p95_ms|api|api.external_backed|public_secondary',
  'map.ready_p75_ms|map|route.root.map|public_critical',
  'admin.shell_usable_p75_ms|admin|route.admin|admin_operator',
  'admin.loaded_switch_p75_ms|admin|route.admin.loaded_switch|admin_operator',
  'admin.lazy_ui_p75_ms|admin|route.admin.lazy_ui|admin_operator',
  'supabase.query_p95_ms|supabase|supabase.public_read|public_secondary',
  'supabase.rows_returned_per_request|supabase|supabase.public_read|public_secondary',
  'supabase.response_kib_per_request|supabase|supabase.public_read|public_secondary',
  'supabase.requests_per_user_action|supabase|supabase.public_action|public_secondary',
  'vercel.function_package_mib|vercel|vercel.production_function|protected_production',
  'vercel.function_cold_p95_ms|vercel|vercel.production_function|protected_production',
  'vercel.function_warm_p95_ms|vercel|vercel.production_function|protected_production',
  'vercel.function_peak_memory_mib|vercel|vercel.production_function|protected_production',
  'typescript.native_cold_p75_ms|typescript|typescript.native|developer',
  'typescript.native_warm_p75_ms|typescript|typescript.native|developer',
  'typescript.native_peak_rss_mib|typescript|typescript.native|developer',
  'backend.no_work_p75_ms|backend|backend.daily|publication',
  'backend.delta_total_p75_ms|backend|backend.daily|publication',
  'backend.peak_rss_mib|backend|backend.daily|publication',
].sort(compareText);
const APPROVED_PINS = {
  raw: '1b9a7b84e08496ad5eeda2823b9f92524cbf02025c5d6177c787e2f826d3d11b',
  scored: '04d50a9f126fe8cfca3c166c04f4b5ece121ba5617649a38e8f4a9619d5c4207',
  budget: '7e563fc1c1c18cfa7878f45218768d13f400db364e75f06e482d2c858eeabb37',
} as const;
const APPROVED_SCORED_SHA256 = '1d93266a9f0663daac1589e6ab6934e9f54977751b5cc6ed8a1c30d96288138e';
const APPROVED_PROSE_TEMPLATES = [
  'Disable the candidate feature.',
  'Reduce a bounded rendering delay without collecting private records.',
  'Reduce the bounded candidate metric without collecting private records.',
  'Restore backup.',
  'Restore the previous batch.',
  'Restore the previous deployment.',
  'Revert the candidate commit.',
  'Run the declared verification tests.',
  'Stop and escalate on a trust failure.',
  'Stop on a measured regression.',
  'Stop on regression.',
  'Stop writes.',
] as const;
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value);
const write = (path: string, value: unknown) => writeFileSync(path, `${canonical(value)}\n`);
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const run = (args: string[]) => Bun.spawnSync(['node', ...args], { cwd: web, stdout: 'pipe', stderr: 'pipe' });
const runSuccess = (args: string[], detail = '') => {
  const result = run(args);
  if (result.exitCode !== 0) {
    const stderr = Buffer.from(result.stderr).toString('utf8');
    throw new Error(`${stderr || `governance CLI exited ${result.exitCode}`}${detail ? `\n${detail}` : ''}`);
  }
  return result;
};
const SHA = '0123456789abcdef0123456789abcdef01234567';
const TREE = 'abcdef0123456789abcdef0123456789abcdef01';
const CONFIG = sha256('sanitized-config');
const PROFILE = sha256('sanitized-profile');
const AS_OF = '2026-07-10T00:00:00.000000Z';
const context = (root: string, map: string, input: string, extra: string[] = []) => [
  '--artifact-root', root, '--artifact-map', map, '--artifact-map-sha256', sha256(readFileSync(join(root, map))),
  '--release-id', 'release-019f4809', '--candidate-sha', SHA, '--candidate-tree', TREE,
  '--config-sha256', CONFIG, '--data-profile-sha256', PROFILE, '--frozen-as-of', AS_OF, ...extra,
];
const withMapDigest = (args: string[], digest: string) => {
  const changed = [...args];
  changed[changed.indexOf('--artifact-map-sha256') + 1] = digest;
  return changed;
};
const GATE_EVIDENCE = {
  app_owned_invocation_errors: 'function_summary',
  candidate_related_failed_production_deployments: 'deployment_summary',
  duplicate_hot_query_count: 'sanitized_query_summary',
  new_auth_rls_service_role_no_store_confirmation_readback_audit_violations: 'sanitized_security_review',
  required_cell_console_page_network_errors: 'sanitized_browser_summary',
  required_manifest_validator_failures: 'validator_summary',
} as const;

/** Build a bounded, sanitized artifact root. No producer output or source trace is used. */
function rootWithAllRows() {
  const root = mkdtempSync(join(tmpdir(), 'performance-v2-'));
  const budget = read(join(performance, 'performance-budgets.v1.json'));
  const rawSchema = readFileSync(join(performance, 'backlog-raw.schema.json'));
  const scoredSchema = readFileSync(join(performance, 'backlog-scored.schema.json'));
  const artifacts: Record<string, string> = {};
  const put = (path: string, value: unknown) => { const target = join(root, path); const bytes = `${canonical(value)}\n`; mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); return artifacts[path] = sha256(bytes); };
  cpSync(join(performance, 'backlog-raw.schema.json'), join(root, 'raw.schema.json'));
  cpSync(join(performance, 'backlog-scored.schema.json'), join(root, 'scored.schema.json'));
  cpSync(join(performance, 'performance-budgets.v1.json'), join(root, 'budget.json'));
  const candidate = { sha: SHA, tree: TREE };
  const healthPath = 'receipts/health.json';
  const coverage = Object.entries(GATE_EVIDENCE)
    .map(([gate, evidenceForm]) => ({ gate, evidenceForm, count: 0 }))
    .sort((left, right) => compareText(left.gate, right.gate));
  put(healthPath, { schemaVersion: 'performance-health-source.v1', releaseId: 'release-019f4809', candidate, configSha256: CONFIG, dataProfileSha256: PROFILE, window: { start: '2026-07-09T00:00:00.000000Z', end: AS_OF }, coverage, incidents: [] });
  const items = budget.budgets.map((row: Record<string, unknown>, index: number) => {
    const key = row.key as string;
    const id = `row-${String(index).padStart(2, '0')}`;
    const forms = row.evidenceForms as string[];
    const samples = Number(row.sampleMinimum);
    const absolute = Number(row.absoluteBudget);
    const measurementPath = `receipts/${id}.json`;
    const observations = Array.from({ length: samples }, (_, number) => ({ id: `baseline-${String(number).padStart(5, '0')}`, cohort: 'baseline', capturedAt: '2026-07-09T12:00:00.000000Z', value: absolute, ownershipBasisPoints: 10000 })).concat(Array.from({ length: samples }, (_, number) => ({ id: `candidate-${String(number).padStart(5, '0')}`, cohort: 'candidate', capturedAt: AS_OF, value: absolute + Math.max(Number(row.absoluteNoiseFloor) + 1, Math.ceil(absolute / 4)), ownershipBasisPoints: 10000 }))).sort((left, right) => compareText(left.id, right.id));
    const attestations = ['baseline', 'candidate'].flatMap((cohort) => forms.map((evidenceForm) => ({ cohort, evidenceForm, providerId: evidenceForm === 'external_provider' ? 'sanitized-provider' : null, capturedAt: AS_OF, sourceSha256: sha256(`${id}:${cohort}:${evidenceForm}`) }))).sort((left, right) => compareText(`${left.cohort}\0${left.evidenceForm}\0${left.providerId ?? ''}`, `${right.cohort}\0${right.evidenceForm}\0${right.providerId ?? ''}`));
    put(measurementPath, { schemaVersion: 'performance-measurement-source.v1', releaseId: 'release-019f4809', candidate, configSha256: CONFIG, dataProfileSha256: PROFILE, key, surfaceClass: row.surfaceClass, targetId: row.targetId, availability: { status: 'available', reason: null }, window: { start: '2026-07-09T00:00:00.000000Z', end: AS_OF }, observations, attestations });
    const manifestPath = `manifests/${id}.json`;
    put(manifestPath, { schemaVersion: 'performance-design-manifest.v1', releaseId: 'release-019f4809', candidate, configSha256: CONFIG, dataProfileSha256: PROFILE, candidateId: id, hypothesis: 'Reduce a bounded rendering delay without collecting private records.', symbols: [{ path: 'apps/web/app/page.tsx', symbol: 'Page' }], files: [{ path: 'apps/web/app/page.tsx', addedNonTestLoc: 1, deletedNonTestLoc: 0 }], tests: [{ id: 'governance-unit', kind: 'unit', path: 'apps/web/tests-unit/performance-backlog-governance.test.ts' }], boundaries: [], rollback: { kind: 'revert_candidate', steps: ['Revert the candidate commit.'], verificationTestIds: ['governance-unit'] }, stopConditions: [{ id: 'regression', condition: 'Stop on regression.', requiredAction: 'stop_and_revert' }] });
    return { id, key, surfaceClass: row.surfaceClass, targetId: row.targetId, measurement: { path: measurementPath, sha256: artifacts[measurementPath] }, manifest: { path: manifestPath, sha256: artifacts[manifestPath] } };
  }).sort((left: { id: string }, right: { id: string }) => compareText(left.id, right.id));
  const rawPath = 'backlog.raw.json';
  put(rawPath, { schemaVersion: 'performance-backlog-raw.v2', releaseId: 'release-019f4809', candidate, configSha256: CONFIG, dataProfileSha256: PROFILE, frozenAsOf: AS_OF, healthReceipt: { path: healthPath, sha256: artifacts[healthPath] }, items });
  const mapPath = 'trusted-artifacts.json';
  write(join(root, mapPath), { schemaVersion: 'performance-trusted-artifacts.v1', releaseId: 'release-019f4809', candidate, configSha256: CONFIG, dataProfileSha256: PROFILE, frozenAsOf: AS_OF, pins: { rawSchema: { path: 'raw.schema.json', sha256: sha256(rawSchema) }, scoredSchema: { path: 'scored.schema.json', sha256: sha256(scoredSchema) }, budget: { path: 'budget.json', sha256: sha256(readFileSync(join(performance, 'performance-budgets.v1.json'))) } }, artifacts });
  return { root, mapPath, rawPath, artifacts };
}

function scoreAndValidate(fixture: ReturnType<typeof rootWithAllRows>, scored = 'backlog.scored.json') {
  runSuccess([scorer, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--output', scored])]);
  const first = readFileSync(join(fixture.root, scored));
  const detached = `${scored}.sha256`;
  writeFileSync(join(fixture.root, detached), `${sha256(first)}\n`);
  const map = read(join(fixture.root, fixture.mapPath));
  map.artifacts[scored] = sha256(first);
  map.artifacts[detached] = sha256(readFileSync(join(fixture.root, detached)));
  write(join(fixture.root, fixture.mapPath), map);
  const stateSummary = read(join(fixture.root, scored)).items.map((item: Record<string, unknown>) => ({
    id: item.id,
    status: item.status,
    decision: item.decision,
    reason: item.reason,
    rank: item.rank,
  }));
  runSuccess(
    [validator, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored])],
    JSON.stringify(stateSummary),
  );
  return { scored, first };
}
const stderr = (result: ReturnType<typeof run>) => Buffer.from(result.stderr).toString('utf8');
const expectFailure = (args: string[], category: string) => {
  const result = run(args);
  expect(result.exitCode).not.toBe(0);
  expect(stderr(result)).toBe(`performance backlog: ${category}\n`);
};
const expectFailurePrefix = (args: string[], category: string) => {
  const result = run(args);
  expect(result.exitCode).not.toBe(0);
  expect(stderr(result).startsWith(`performance backlog: ${category}`)).toBe(true);
};
type FatalCategory = string | { scorer: string; validator: string };
const expectFatalBoth = (name: string, prepare: (fixture: ReturnType<typeof rootWithAllRows>) => FatalCategory) => {
  const fixture = rootWithAllRows();
  try {
    const { scored } = scoreAndValidate(fixture, `${name}.baseline.scored.json`);
    const detached = `${scored}.sha256`;
    const baselineMap = read(join(fixture.root, fixture.mapPath));
    delete baselineMap.artifacts[scored];
    delete baselineMap.artifacts[detached];
    write(join(fixture.root, fixture.mapPath), baselineMap);
    const category = prepare(fixture);
    const scorerCategory = typeof category === 'string' ? category : category.scorer;
    const validatorCategory = typeof category === 'string' ? category : category.validator;
    expectFailure([scorer, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--output', `${name}.scored.json`])], scorerCategory);
    if (!scorerCategory.startsWith('artifact map')) {
      const validatorMap = read(join(fixture.root, fixture.mapPath));
      validatorMap.artifacts[scored] = sha256(readFileSync(join(fixture.root, scored)));
      validatorMap.artifacts[detached] = sha256(readFileSync(join(fixture.root, detached)));
      write(join(fixture.root, fixture.mapPath), validatorMap);
    }
    expectFailure([validator, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored])], validatorCategory);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
};
const rewriteArtifact = (fixture: ReturnType<typeof rootWithAllRows>, path: string, value: unknown) => {
  write(join(fixture.root, path), value);
  const map = read(join(fixture.root, fixture.mapPath));
  const digest = sha256(readFileSync(join(fixture.root, path)));
  map.artifacts[path] = digest;
  if (path !== fixture.rawPath) {
    const raw = read(join(fixture.root, fixture.rawPath));
    if (raw.healthReceipt.path === path) raw.healthReceipt.sha256 = digest;
    for (const item of raw.items) {
      if (item.measurement.path === path) item.measurement.sha256 = digest;
      if (item.manifest.path === path) item.manifest.sha256 = digest;
    }
    write(join(fixture.root, fixture.rawPath), raw);
    map.artifacts[fixture.rawPath] = sha256(readFileSync(join(fixture.root, fixture.rawPath)));
  }
  write(join(fixture.root, fixture.mapPath), map);
};
const scoredItem = (fixture: ReturnType<typeof rootWithAllRows>, path = 'matrix.scored.json') => {
  const { scored } = scoreAndValidate(fixture, path);
  return read(join(fixture.root, scored)).items as Record<string, unknown>[];
};
const firstItem = (fixture: ReturnType<typeof rootWithAllRows>) => read(join(fixture.root, fixture.rawPath)).items[0] as {
  id: string; measurement: { path: string }; manifest: { path: string };
};
const itemForKey = (fixture: ReturnType<typeof rootWithAllRows>, key: string) => {
  const item = read(join(fixture.root, fixture.rawPath)).items.find((row: { key: string }) => row.key === key);
  if (!item) throw new Error(`missing fixture row for ${key}`);
  return item as { id: string; measurement: { path: string }; manifest: { path: string } };
};
const pureContext = {
  '--release-id': 'release-019f4809',
  '--candidate-sha': SHA,
  '--candidate-tree': TREE,
  '--config-sha256': CONFIG,
  '--data-profile-sha256': PROFILE,
  '--frozen-as-of': AS_OF,
};
const pureData = (fixture: ReturnType<typeof rootWithAllRows>, budgetValue = read(join(performance, 'performance-budgets.v1.json'))) => {
  const raw = read(join(fixture.root, fixture.rawPath));
  const health = read(join(fixture.root, raw.healthReceipt.path));
  const receipts = new Map(raw.items.map((item: any) => [item.id, read(join(fixture.root, item.measurement.path))]));
  const manifests = new Map(raw.items.map((item: any) => [item.id, read(join(fixture.root, item.manifest.path))]));
  return { raw, health, receipts, manifests, budgetValue, table: budgets(budgetValue) };
};
const selfHashedBudget = (mutate: (budget: any) => void) => {
  const budget = read(join(performance, 'performance-budgets.v1.json'));
  mutate(budget);
  const unsigned = { ...budget };
  delete unsigned.sha256;
  budget.sha256 = sha256(canonicalBytes(unsigned, {}, {}));
  return budget;
};
const deriveBoth = (fixture: ReturnType<typeof rootWithAllRows>, data: ReturnType<typeof pureData>) => {
  const rawSha256 = 'a'.repeat(64);
  const scored = derive(data.raw, { path: fixture.rawPath, sha256: rawSha256 }, data.table, data.receipts, data.manifests, data.health, pureContext);
  const independentlyScored = recompute(
    data.raw,
    validatorBudgets(data.budgetValue),
    data.receipts,
    data.manifests,
    data.health,
    { ...pureContext, '--input': fixture.rawPath },
  );
  independentlyScored.raw.sha256 = rawSha256;
  expect(independentlyScored).toEqual(scored);
  return scored;
};
const derivePure = (fixture: ReturnType<typeof rootWithAllRows>, budgetValue?: any) => {
  const data = pureData(fixture, budgetValue);
  return { data, scored: deriveBoth(fixture, data) };
};

describe('performance backlog v2 governance contracts', () => {
  test('uses the approved closed inventory, independent pins, and sanitized typed fixture seeds', () => {
    const budget = read(join(performance, 'performance-budgets.v1.json'));
    const raw = read(join(fixtures, 'golden-raw.v1.json'));
    const invalid = read(join(fixtures, 'invalid-derived-raw.v1.json'));
    const source = read(join(fixtures, 'evidence', 'home-lcp-summary.json'));
    const rawSchema = read(join(performance, 'backlog-raw.schema.json'));
    const inventory = (rows: Array<{ key: string; surfaceClass: string; targetId: string; impact?: string }>) => rows
      .map((row) => [row.key, row.surfaceClass, row.targetId, row.impact].filter((part) => part !== undefined).join('|'))
      .sort(compareText);
    expect(inventory(budget.budgets)).toEqual(APPROVED_INVENTORY);
    expect(inventory(raw.items)).toEqual(APPROVED_INVENTORY.map((tuple) => tuple.split('|').slice(0, 3).join('|')));
    expect(raw.schemaVersion).toBe('performance-backlog-raw.v2');
    expect({ raw: scorerRawPin, scored: scorerScoredPin, budget: scorerBudgetPin }).toEqual(APPROVED_PINS);
    expect({ raw: validatorRawPin, scored: validatorScoredPin, budget: validatorBudgetPin }).toEqual(APPROVED_PINS);
    expect(rawSchema.$defs.safeText.enum).toEqual(APPROVED_PROSE_TEMPLATES);
    expect(invalid.score).toBe(999);
    expect(source).toMatchObject({ schemaVersion: 'performance-measurement-source.v1', availability: { status: 'available', reason: null } });
    expect(source).not.toHaveProperty('score');
    expect(source.observations).toHaveLength(2);
    expect(source.attestations).toHaveLength(2);
  });
  test('canonicalizes numeric-looking keys lexicographically and applies every comparator tie-break in order', () => {
    const numericKeys = { 2: 'two', 10: 'ten', a: 'letter' };
    const expectedCanonical = '{"10":"ten","2":"two","a":"letter"}';
    expect(canonicalBytes(numericKeys, {}, {}).toString('utf8')).toBe(`${expectedCanonical}\n`);
    expect(validatorCanonical(numericKeys, {}, {})).toBe(expectedCanonical);

    const impactPoints = {
      admin_operator: 350,
      developer: 150,
      protected_production: 450,
      public_critical: 500,
      public_secondary: 425,
      publication: 450,
    };
    const base = {
      id: 'tie-b',
      score: 7000,
      severity: 'P1',
      impact: 'developer',
      confidenceMarginBasisPoints: 2000,
      risk: 'low',
      effort: 'small',
    };
    const precedes = (left: Record<string, unknown>, right: Record<string, unknown>) => {
      const comparison = compareRankedItems({ ...base, ...left }, { ...base, ...right }, impactPoints);
      expect(comparison).toBeLessThan(0);
      expect(compareRankedItems({ ...base, ...right }, { ...base, ...left }, impactPoints)).toBeGreaterThan(0);
    };
    precedes({ score: 7001 }, { score: 7000 });
    precedes({ severity: 'P0' }, { severity: 'P1' });
    precedes({ impact: 'public_critical' }, { impact: 'developer' });
    precedes({ confidenceMarginBasisPoints: 2001 }, { confidenceMarginBasisPoints: 2000 });
    precedes({ risk: 'low' }, { risk: 'medium' });
    precedes({ effort: 'small' }, { effort: 'medium' });
    precedes({ id: 'tie-a' }, { id: 'tie-b' });
  });
  test('reserves the aggregate byte budget before an over-cap artifact can allocate', () => {
    const total = { n: 64 * 1024 * 1024 - 1 };
    reserveAggregate(total, 1);
    expect(total.n).toBe(64 * 1024 * 1024);
    expect(() => reserveAggregate(total, 1)).toThrow('performance backlog: aggregate cap');
    expect(total.n).toBe(64 * 1024 * 1024);
  });
  test('normalizes only Windows verbatim prefixes while rejecting artifact aliases', () => {
    const checkedOut = 'C:\\actions\\_work\\tzudong\\performance';
    const verbatim = '\\\\?\\C:\\actions\\_work\\tzudong\\performance';
    const unc = '\\\\server\\share\\performance';
    const verbatimUnc = '\\\\?\\UNC\\server\\share\\performance';
    for (const strip of [scorerStripWindowsVerbatimPrefix, validatorStripWindowsVerbatimPrefix]) {
      expect(strip(verbatim)).toBe(checkedOut);
      expect(strip(verbatimUnc)).toBe(unc);
    }
    for (const samePath of [scorerSameWindowsArtifactPath, validatorSameWindowsArtifactPath]) {
      expect(samePath(verbatim, checkedOut)).toBe(true);
      expect(samePath('C:\\actions\\_work\\tzudong\\Receipts\\item.json', 'C:\\actions\\_work\\tzudong\\receipts\\item.json')).toBe(false);
      expect(samePath('C:\\junction\\performance\\item.json', 'C:\\actions\\_work\\tzudong\\performance\\item.json')).toBe(false);
    }
  });
  test('accepts alternate realpath spellings only for the same non-reparse directory identity', async () => {
    const requested = resolve('alternate-artifact-root');
    const canonicalRoot = resolve('canonical-artifact-root');
    const directory = {
      dev: 1n,
      ino: 2n,
      size: 0n,
      mtimeNs: 3n,
      ctimeNs: 4n,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
    const filesystem = {
      lstat: async () => directory,
      realpath: async () => canonicalRoot,
    };
    for (const assertTrustedDirectory of [assertScorerTrustedDirectory, assertValidatorTrustedDirectory]) {
      await expect(assertTrustedDirectory(requested, 'artifact root alias', filesystem)).resolves.toBe(canonicalRoot);
      await expect(assertTrustedDirectory(requested, 'artifact root alias', {
        ...filesystem,
        lstat: async () => ({ ...directory, isSymbolicLink: () => true }),
      })).rejects.toThrow('performance backlog: artifact root alias');
    }
  });
  test('rejects symlink or junction artifact roots and output parents', () => {
    const fixture = rootWithAllRows();
    const rootAlias = `${fixture.root}-alias`;
    const outputTarget = join(fixture.root, 'output-target');
    const outputAlias = join(fixture.root, 'output-alias');
    try {
      symlinkSync(fixture.root, rootAlias, process.platform === 'win32' ? 'junction' : 'dir');
      expectFailure([scorer, ...context(rootAlias, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--output', 'backlog.scored.json'])], 'artifact root alias');
      expectFailure([validator, ...context(rootAlias, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', 'backlog.scored.json'])], 'artifact root alias');

      mkdirSync(outputTarget);
      symlinkSync(outputTarget, outputAlias, process.platform === 'win32' ? 'junction' : 'dir');
      expectFailure([scorer, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--output', 'output-alias/backlog.scored.json'])], 'invalid canonical output');
    } finally {
      rmSync(rootAlias, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test('independently scores and validates canonical protected artifacts deterministically', () => {
    const fixture = rootWithAllRows();
    try {
      const one = scoreAndValidate(fixture);
      const rerun = rootWithAllRows();
      try {
        const two = scoreAndValidate(rerun);
        expect(one.first).toEqual(two.first);
        expect(sha256(one.first)).toBe(APPROVED_SCORED_SHA256);
        const scored = read(join(fixture.root, one.scored));
        expect(scored.items).toHaveLength(36);
        expect(scored.ranking.admittedIds).toHaveLength(3);
        const outputDir = process.env.GOVERNANCE_CI_OUTPUT_DIR;
        if (outputDir) {
          const name = 'backlog.scored.json';
          mkdirSync(outputDir, { recursive: true });
          writeFileSync(join(outputDir, name), one.first);
          writeFileSync(join(outputDir, `${name}.sha256`), `${sha256(one.first)}\n`);
        }
      } finally { rmSync(rerun.root, { recursive: true, force: true }); }
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });

  test('fails both CLIs for derived fields, path aliases, and symlinked artifacts', () => {
    expectFatalBoth('derived-raw', (fixture) => {
      write(join(fixture.root, fixture.rawPath), read(join(fixtures, 'invalid-derived-raw.v1.json')));
      const map = read(join(fixture.root, fixture.mapPath));
      map.artifacts[fixture.rawPath] = sha256(readFileSync(join(fixture.root, fixture.rawPath)));
      write(join(fixture.root, fixture.mapPath), map);
      return 'invalid raw';
    });
    for (const [name, path] of [
      ['parent-path', '../escape.json'],
      ['drive-path', 'C:/escape.json'],
      ['unc-path', '//server/share.json'],
      ['backslash-path', 'receipts\\escape.json'],
    ] as const) {
      expectFatalBoth(name, (fixture) => {
        const map = read(join(fixture.root, fixture.mapPath));
        map.artifacts[path] = '0'.repeat(64);
        write(join(fixture.root, fixture.mapPath), map);
        return { scorer: 'invalid path', validator: 'map artifact' };
      });
    }
    expectFatalBoth('symlinked-measurement', (fixture) => {
      const raw = read(join(fixture.root, fixture.rawPath));
      const map = read(join(fixture.root, fixture.mapPath));
      const original = raw.items[0].measurement;
      const linkedPath = 'linked-measurement.json';
      symlinkSync(join(fixture.root, original.path), join(fixture.root, linkedPath));
      raw.items[0].measurement = { path: linkedPath, sha256: original.sha256 };
      delete map.artifacts[original.path];
      map.artifacts[linkedPath] = original.sha256;
      write(join(fixture.root, fixture.rawPath), raw);
      map.artifacts[fixture.rawPath] = sha256(readFileSync(join(fixture.root, fixture.rawPath)));
      write(join(fixture.root, fixture.mapPath), map);
      return 'invalid artifact';
    });
  }, 90_000);
  test('rejects a wrong out-of-band map pin before parsing in both CLIs', () => {
    const fixture = rootWithAllRows();
    try {
      const wrongDigest = '0'.repeat(64);
      expectFailure([
        scorer,
        ...withMapDigest(context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--output', 'wrong-map-pin.scored.json']), wrongDigest),
      ], 'artifact hash mismatch');
      const { scored } = scoreAndValidate(fixture, 'map-pin-baseline.scored.json');
      expectFailure([
        validator,
        ...withMapDigest(context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored]), wrongDigest),
      ], 'artifact hash mismatch');
      for (const source of [readFileSync(scorer, 'utf8'), readFileSync(validator, 'utf8')]) {
        for (const token of ['O_NOFOLLOW', 'mtimeNs', 'ctimeNs', 'sameSnapshot', 'artifact changed']) {
          expect(source).toContain(token);
        }
      }
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });

  test('applies rank-cap admission deterministically for zero through four otherwise eligible rows', () => {
    for (const count of [0, 1, 2, 3, 4]) {
      const fixture = rootWithAllRows();
      try {
        const raw = read(join(fixture.root, fixture.rawPath));
        raw.items = raw.items.slice(0, count);
        write(join(fixture.root, fixture.rawPath), raw);
        const digest = sha256(readFileSync(join(fixture.root, fixture.rawPath)));
        const map = read(join(fixture.root, fixture.mapPath));
        map.artifacts[fixture.rawPath] = digest;
        const requiredArtifacts = new Set([
          fixture.rawPath,
          raw.healthReceipt.path,
          ...raw.items.flatMap((item: { measurement: { path: string }; manifest: { path: string } }) => [
            item.measurement.path,
            item.manifest.path,
          ]),
        ]);
        for (const path of Object.keys(map.artifacts)) {
          if (!requiredArtifacts.has(path)) delete map.artifacts[path];
        }
        write(join(fixture.root, fixture.mapPath), map);
        const { scored } = scoreAndValidate(fixture, 'count.scored.json');
        const result = read(join(fixture.root, scored));
        expect(result.ranking.admittedIds).toHaveLength(Math.min(count, 3));
        expect(result.ranking.deferredIds).toHaveLength(Math.max(0, count - 3));
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
  });
  test('keeps unavailable precedence, filtered observations, evidence, and health gates externally observable', () => {
    const cases: Array<{ name: string; mutate: (receipt: Record<string, any>, raw: Record<string, any>) => void; reason: string }> = [
      { name: 'access', mutate: (r) => { r.availability = { status: 'unavailable', reason: 'access_blocked' }; r.observations = []; r.attestations = []; }, reason: 'source_unavailable_access_blocked' },
      { name: 'not-produced', mutate: (r) => { r.availability = { status: 'unavailable', reason: 'source_not_produced' }; r.observations = []; r.attestations = []; }, reason: 'source_unavailable_not_produced' },
      { name: 'redacted', mutate: (r) => { r.availability = { status: 'unavailable', reason: 'source_redacted' }; r.observations = []; r.attestations = []; }, reason: 'source_unavailable_redacted' },
      { name: 'failed', mutate: (r) => { r.availability = { status: 'unavailable', reason: 'collection_failed' }; r.observations = []; r.attestations = []; }, reason: 'source_unavailable_collection_failed' },
      { name: 'stale-first', mutate: (r) => { r.window = { start: '2026-07-01T00:00:00.000000Z', end: '2026-07-01T01:00:00.000000Z' }; r.observations.forEach((o: any) => { o.capturedAt = '2026-07-01T00:30:00.000000Z'; }); r.attestations.forEach((a: any) => a.capturedAt = '2026-07-01T00:30:00.000000Z'); }, reason: 'stale' },
      { name: 'window-second', mutate: (r) => { r.window.start = '2026-07-09T23:30:00.000000Z'; r.observations.forEach((o: any) => o.capturedAt = AS_OF); r.attestations.forEach((a: any) => a.capturedAt = AS_OF); }, reason: 'window_too_short' },
      { name: 'samples-third', mutate: (r) => { r.observations.forEach((o: any) => o.ownershipBasisPoints = 0); }, reason: 'insufficient_samples' },
      { name: 'evidence-fourth', mutate: (r) => { r.attestations = r.attestations.filter((a: any) => a.cohort !== 'candidate'); }, reason: 'missing_evidence_form' },
    ];
    for (const scenario of cases) {
      const fixture = rootWithAllRows();
      try {
        const item = firstItem(fixture), receipt = read(join(fixture.root, item.measurement.path));
        scenario.mutate(receipt, read(join(fixture.root, fixture.rawPath)));
        rewriteArtifact(fixture, item.measurement.path, receipt);
        expect(scoredItem(fixture, `${scenario.name}.scored.json`).find((row) => row.id === item.id)).toMatchObject({ status: 'not_rankable', reason: scenario.reason });
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
    for (const gate of Object.keys(GATE_EVIDENCE)) {
      const fixture = rootWithAllRows();
      try {
        const raw = read(join(fixture.root, fixture.rawPath)), health = read(join(fixture.root, raw.healthReceipt.path));
        health.incidents = [{ id: `incident-${gate}`, gate, capturedAt: AS_OF }];
        health.coverage = health.coverage.map((row: any) => ({ ...row, count: row.gate === gate ? 1 : 0 }));
        rewriteArtifact(fixture, raw.healthReceipt.path, health);
        const { scored: scoredPath } = scoreAndValidate(fixture, 'health.scored.json');
        const scored = read(join(fixture.root, scoredPath));
        expect(scored).toMatchObject({ releaseBlocked: true, ranking: { admittedIds: [], deferredIds: [] } });
        expect(scored.items.some((row: any) => row.status === 'release_blocked' && row.reason === 'health_gate_failed')).toBe(true);
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
  }, 90_000);

  test('treats unknown selectors as not-rankable, selector mismatches as fatal, and validates scorer tampering independently', () => {
    const unknown = rootWithAllRows();
    try {
      const item = firstItem(unknown), raw = read(join(unknown.root, unknown.rawPath)), receipt = read(join(unknown.root, item.measurement.path));
      raw.items[0].key = 'future.metric'; receipt.key = 'future.metric';
      rewriteArtifact(unknown, unknown.rawPath, raw); rewriteArtifact(unknown, item.measurement.path, receipt);
      expect(scoredItem(unknown, 'unknown.scored.json').find((row) => row.id === item.id)).toMatchObject({ status: 'not_rankable', reason: 'unknown_budget_key' });
    } finally { rmSync(unknown.root, { recursive: true, force: true }); }
    const invalidUnknown = rootWithAllRows();
    try {
      const item = firstItem(invalidUnknown);
      const receipt = read(join(invalidUnknown.root, item.measurement.path));
      receipt.key = 'future.invalid_window';
      receipt.window.end = '2026-02-30T00:00:00.000000Z';
      rewriteArtifact(invalidUnknown, item.measurement.path, receipt);
      const raw = read(join(invalidUnknown.root, invalidUnknown.rawPath));
      raw.items[0].key = receipt.key;
      rewriteArtifact(invalidUnknown, invalidUnknown.rawPath, raw);
      expectFailure([scorer, ...context(invalidUnknown.root, invalidUnknown.mapPath, invalidUnknown.rawPath, ['--input', invalidUnknown.rawPath, '--output', 'invalid-unknown.scored.json'])], 'invalid timestamp');
    } finally { rmSync(invalidUnknown.root, { recursive: true, force: true }); }
    const mismatch = rootWithAllRows();
    try {
      const item = firstItem(mismatch);
      const receipt = read(join(mismatch.root, item.measurement.path));
      const surfaceClass = receipt.surfaceClass === 'admin' ? 'public' : 'admin';
      receipt.surfaceClass = surfaceClass;
      rewriteArtifact(mismatch, item.measurement.path, receipt);
      const raw = read(join(mismatch.root, mismatch.rawPath));
      raw.items[0].surfaceClass = surfaceClass;
      rewriteArtifact(mismatch, mismatch.rawPath, raw);
      expectFailure([scorer, ...context(mismatch.root, mismatch.mapPath, mismatch.rawPath, ['--input', mismatch.rawPath, '--output', 'mismatch.scored.json'])], 'selector mismatch');
    } finally { rmSync(mismatch.root, { recursive: true, force: true }); }
    const fixture = rootWithAllRows();
    try {
      const { scored } = scoreAndValidate(fixture), supplied = read(join(fixture.root, scored));
      supplied.items[0].score = 1;
      write(join(fixture.root, scored), supplied);
      const detached = `${scored}.sha256`, map = read(join(fixture.root, fixture.mapPath));
      writeFileSync(join(fixture.root, detached), `${sha256(readFileSync(join(fixture.root, scored)))}\n`);
      map.artifacts[scored] = sha256(readFileSync(join(fixture.root, scored)));
      map.artifacts[detached] = sha256(readFileSync(join(fixture.root, detached)));
      write(join(fixture.root, fixture.mapPath), map);
      expectFailurePrefix([validator, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored])], 'scored recomputation mismatch');
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
  test('rejects impossible not-rankable reasons before recomputation', () => {
    const fixture = rootWithAllRows();
    try {
      const { scored } = scoreAndValidate(fixture);
      const supplied = read(join(fixture.root, scored));
      Object.assign(supplied.items[0], {
        status: 'not_rankable',
        decision: 'not_eligible',
        reason: 'rank_cap',
        rank: null,
      });
      write(join(fixture.root, scored), supplied);
      const detached = `${scored}.sha256`;
      writeFileSync(join(fixture.root, detached), `${sha256(readFileSync(join(fixture.root, scored)))}\n`);
      const map = read(join(fixture.root, fixture.mapPath));
      map.artifacts[scored] = sha256(readFileSync(join(fixture.root, scored)));
      map.artifacts[detached] = sha256(readFileSync(join(fixture.root, detached)));
      write(join(fixture.root, fixture.mapPath), map);
      expectFailure([validator, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored])], 'invalid scored.items');
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }, 90_000);
  test('rejects schema-invalid admitted rank four and deferred rank one', () => {
    for (const [name, select, rank] of [
      ['admitted-rank-four', (items: any[]) => items.find((item) => item.decision === 'admitted'), 4],
      ['deferred-rank-one', (items: any[]) => items.find((item) => item.decision === 'deferred_rank_cap'), 1],
    ] as const) {
      const fixture = rootWithAllRows();
      try {
        const { scored } = scoreAndValidate(fixture, `${name}.baseline.scored.json`);
        const supplied = read(join(fixture.root, scored));
        select(supplied.items).rank = rank;
        write(join(fixture.root, scored), supplied);
        const detached = `${scored}.sha256`, map = read(join(fixture.root, fixture.mapPath));
        writeFileSync(join(fixture.root, detached), `${sha256(readFileSync(join(fixture.root, scored)))}\n`);
        map.artifacts[scored] = sha256(readFileSync(join(fixture.root, scored)));
        map.artifacts[detached] = sha256(readFileSync(join(fixture.root, detached)));
        write(join(fixture.root, fixture.mapPath), map);
        expectFailure([validator, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored])], 'invalid scored.items');
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
  }, 90_000);

  test('rejects duplicate item identities, noncanonical UTF-8/LF bytes, and missing map references', () => {
    const cases: Array<{ name: string; prepare: (fixture: ReturnType<typeof rootWithAllRows>) => FatalCategory }> = [
      { name: 'duplicate-object', prepare: (f) => { const raw = read(join(f.root, f.rawPath)); raw.items.push({ ...raw.items[0] }); rewriteArtifact(f, f.rawPath, raw); return 'duplicate raw.items'; } },
      { name: 'bom', prepare: (f) => { const bytes = readFileSync(join(f.root, f.rawPath)); writeFileSync(join(f.root, f.rawPath), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])); const map = read(join(f.root, f.mapPath)); map.artifacts[f.rawPath] = sha256(readFileSync(join(f.root, f.rawPath))); write(join(f.root, f.mapPath), map); return { scorer: 'raw is not UTF-8/LF', validator: 'raw is not JSON' }; } },
      { name: 'crlf', prepare: (f) => { const text = readFileSync(join(f.root, f.rawPath), 'utf8').replace(/\n/g, '\r\n'); writeFileSync(join(f.root, f.rawPath), text); const map = read(join(f.root, f.mapPath)); map.artifacts[f.rawPath] = sha256(readFileSync(join(f.root, f.rawPath))); write(join(f.root, f.mapPath), map); return { scorer: 'raw is not UTF-8/LF', validator: 'raw is not canonical' }; } },
      { name: 'missing-ref', prepare: (f) => { const map = read(join(f.root, f.mapPath)); delete map.artifacts[f.rawPath]; write(join(f.root, f.mapPath), map); return { scorer: 'missing map artifact', validator: 'map missing raw' }; } },
    ];
    for (const scenario of cases) expectFatalBoth(scenario.name, scenario.prepare);
  });
  test('derives confidence boundaries, half-away bps, exact relative rejection, and score caps from integer receipts', () => {
    for (const [excess, margin, confidence] of [[5998, 1999, 'low'], [5999, 2000, 'medium'], [11998, 3999, 'medium'], [11999, 4000, 'high']] as const) {
      const fixture = rootWithAllRows();
      try {
        const item = itemForKey(fixture, 'backend.delta_total_p75_ms');
        const receipt = read(join(fixture.root, item.measurement.path));
        const budget = read(join(performance, 'performance-budgets.v1.json')).budgets.find((row: { key: string }) => row.key === 'backend.delta_total_p75_ms');
        const observed = budget.absoluteBudget + excess;
        const values = [observed - 5000, observed - 5000, observed - 5000, observed, observed + 5000, observed + 5000, observed + 5000];
        let index = 0;
        receipt.observations.forEach((observation: { cohort: string; value: number }) => { observation.value = observation.cohort === 'candidate' ? values[index++] : budget.absoluteBudget; });
        rewriteArtifact(fixture, item.measurement.path, receipt);
        expect(scoredItem(fixture, `confidence-${excess}.scored.json`).find((row) => row.id === item.id)).toMatchObject({
          confidenceMarginBasisPoints: margin,
          confidence,
        });
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
    const even = rootWithAllRows();
    try {
      const item = itemForKey(even, 'supabase.requests_per_user_action'), receipt = read(join(even.root, item.measurement.path));
      const values = [...Array(14).fill(8), 11, ...Array(15).fill(14)];
      let index = 0;
      receipt.observations.forEach((observation: { cohort: string; value: number }) => { observation.value = observation.cohort === 'candidate' ? values[index++] : 10; });
      rewriteArtifact(even, item.measurement.path, receipt);
      expect(scoredItem(even, 'even-median.scored.json').find((row) => row.id === item.id)).toMatchObject({
        observed: 11,
        confidenceMarginBasisPoints: 1667,
        confidence: 'low',
      });
    } finally { rmSync(even.root, { recursive: true, force: true }); }
    const zero = rootWithAllRows();
    try {
      const item = itemForKey(zero, 'supabase.requests_per_user_action'), receipt = read(join(zero.root, item.measurement.path));
      receipt.observations.forEach((observation: { value: number }) => { observation.value = 10; });
      rewriteArtifact(zero, item.measurement.path, receipt);
      expect(scoredItem(zero, 'zero-excess.scored.json').find((row) => row.id === item.id)).toMatchObject({
        observed: 10,
        confidenceMarginBasisPoints: 0,
        reason: 'below_absolute_budget',
      });
    } finally { rmSync(zero.root, { recursive: true, force: true }); }

    const relative = rootWithAllRows();
    try {
      const item = firstItem(relative), receipt = read(join(relative.root, item.measurement.path));
      receipt.observations.forEach((observation: { cohort: string; value: number }) => { observation.value = observation.cohort === 'candidate' ? 1650 : 1501; });
      rewriteArtifact(relative, item.measurement.path, receipt);
      expect(149n * 10000n < 1000n * 1501n).toBe(true);
      expect(scoredItem(relative, 'relative.scored.json').find((row) => row.id === item.id)).toMatchObject({ reason: 'below_relative_threshold' });
    } finally { rmSync(relative.root, { recursive: true, force: true }); }

    const capped = rootWithAllRows();
    try {
      const item = itemForKey(capped, 'browser.long_task.max_ms'), receipt = read(join(capped.root, item.measurement.path));
      receipt.observations.forEach((observation: { cohort: string; value: number }) => { observation.value = observation.cohort === 'candidate' ? 100000 : 50; });
      rewriteArtifact(capped, item.measurement.path, receipt);
      expect(scoredItem(capped, 'capped.scored.json').find((row) => row.id === item.id)).toMatchObject({
        severity: 'P0',
        score: 13000,
        scoreComponents: { percentOverBudgetBasisPoints: 10000, affectedBasisPoints: 10000 },
      });
    } finally { rmSync(capped.root, { recursive: true, force: true }); }
    const noncritical = rootWithAllRows();
    try {
      const item = firstItem(noncritical), receipt = read(join(noncritical.root, item.measurement.path));
      receipt.observations.forEach((observation: { cohort: string; value: number }) => { observation.value = observation.cohort === 'candidate' ? 100000 : 1500; });
      rewriteArtifact(noncritical, item.measurement.path, receipt);
      expect(scoredItem(noncritical, 'noncritical.scored.json').find((row) => row.id === item.id)).toMatchObject({ severity: 'P1' });
    } finally { rmSync(noncritical.root, { recursive: true, force: true }); }
  }, 90_000);
  test('checks scorer and validator states at the noise, confidence, and exact relative boundaries', () => {
    const cases: Array<{ name: string; mutate: (fixture: ReturnType<typeof rootWithAllRows>) => string; expected: Record<string, unknown> }> = [
      {
        name: 'noise-floor',
        mutate: (fixture) => {
          const item = firstItem(fixture), receipt = read(join(fixture.root, item.measurement.path));
          receipt.observations.forEach((row: any) => { row.value = row.cohort === 'candidate' ? 1600 : 1500; });
          rewriteArtifact(fixture, item.measurement.path, receipt);
          return item.id;
        },
        expected: { status: 'not_rankable', decision: 'not_eligible', reason: 'at_or_below_noise_floor', rank: null },
      },
      {
        name: 'confidence',
        mutate: (fixture) => {
          const item = itemForKey(fixture, 'backend.delta_total_p75_ms');
          const receipt = read(join(fixture.root, item.measurement.path));
          const budget = read(join(performance, 'performance-budgets.v1.json')).budgets.find((row: any) => row.key === 'backend.delta_total_p75_ms');
          const observed = budget.absoluteBudget + 400000;
          const values = [observed - 1500000, observed - 1500000, observed - 1500000, observed, observed + 1500000, observed + 1500000, observed + 1500000];
          let index = 0;
          receipt.observations.forEach((row: any) => { row.value = row.cohort === 'candidate' ? values[index++] : budget.absoluteBudget; });
          rewriteArtifact(fixture, item.measurement.path, receipt);
          return item.id;
        },
        expected: { status: 'not_rankable', decision: 'not_eligible', reason: 'confidence_below_medium', rank: null },
      },
      {
        name: 'relative-equality',
        mutate: (fixture) => {
          const item = firstItem(fixture), receipt = read(join(fixture.root, item.measurement.path));
          receipt.observations.forEach((row: any) => { row.value = row.cohort === 'candidate' ? 1650 : 1500; });
          rewriteArtifact(fixture, item.measurement.path, receipt);
          return item.id;
        },
        expected: { status: 'rankable', decision: 'deferred_rank_cap', reason: 'rank_cap' },
      },
    ];
    for (const scenario of cases) {
      const fixture = rootWithAllRows();
      try {
        const itemId = scenario.mutate(fixture);
        expect(scoredItem(fixture, `${scenario.name}.scored.json`).find((row) => row.id === itemId)).toMatchObject(scenario.expected);
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
  }, 90_000);

  test('fails closed for embedded bindings, duplicate attestation identities, noncanonical maps, substitutions, and detached hashes', () => {
    const cases: Array<{ name: string; prepare: (fixture: ReturnType<typeof rootWithAllRows>) => FatalCategory }> = [
      { name: 'unbound-health', prepare: (f) => { const raw = read(join(f.root, f.rawPath)); raw.healthReceipt.sha256 = '0'.repeat(64); rewriteArtifact(f, f.rawPath, raw); return 'unbound health reference'; } },
      { name: 'duplicate-attestation', prepare: (f) => { const item = firstItem(f), receipt = read(join(f.root, item.measurement.path)); receipt.attestations.push({ ...receipt.attestations[0] }); rewriteArtifact(f, item.measurement.path, receipt); return 'duplicate measurement.attestations'; } },
      { name: 'duplicate-observation', prepare: (f) => { const item = firstItem(f), receipt = read(join(f.root, item.measurement.path)); receipt.observations.push({ ...receipt.observations[0] }); rewriteArtifact(f, item.measurement.path, receipt); return 'duplicate measurement.observations'; } },
      { name: 'noncanonical-map', prepare: (f) => { writeFileSync(join(f.root, f.mapPath), readFileSync(join(f.root, f.mapPath), 'utf8').replaceAll('{', '{ ')); return 'artifact map is not canonical'; } },
      { name: 'duplicate-map-key', prepare: (f) => { writeFileSync(join(f.root, f.mapPath), readFileSync(join(f.root, f.mapPath), 'utf8').replace('"schemaVersion":', '"schemaVersion":"performance-trusted-artifacts.v1","schemaVersion":')); return { scorer: 'artifact map duplicate key', validator: 'duplicate JSON key' }; } },
      { name: 'pinned-substitution', prepare: (f) => { const schema = read(join(f.root, 'raw.schema.json')); schema.$comment = 'substituted'; write(join(f.root, 'substituted.schema.json'), schema); const map = read(join(f.root, f.mapPath)); map.pins.rawSchema = { path: 'substituted.schema.json', sha256: sha256(readFileSync(join(f.root, 'substituted.schema.json'))) }; write(join(f.root, f.mapPath), map); return 'pinned contract digest'; } },
    ];
    for (const scenario of cases) expectFatalBoth(scenario.name, scenario.prepare);

    const fixture = rootWithAllRows();
    try {
      const { scored } = scoreAndValidate(fixture);
      const detached = `${scored}.sha256`, map = read(join(fixture.root, fixture.mapPath));
      writeFileSync(join(fixture.root, detached), `${'0'.repeat(64)}\n`);
      map.artifacts[detached] = sha256(readFileSync(join(fixture.root, detached)));
      write(join(fixture.root, fixture.mapPath), map);
      expectFailure([validator, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored])], 'detached scored hash mismatch');
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }, 90_000);
  test('health incidents override unavailable, stale, and unknown-budget rows globally', () => {
    const fixture = rootWithAllRows();
    try {
      const raw = read(join(fixture.root, fixture.rawPath));
      const [unavailable, stale, unknown] = raw.items;
      const unavailableReceipt = read(join(fixture.root, unavailable.measurement.path));
      unavailableReceipt.availability = { status: 'unavailable', reason: 'access_blocked' };
      unavailableReceipt.observations = [];
      unavailableReceipt.attestations = [];
      rewriteArtifact(fixture, unavailable.measurement.path, unavailableReceipt);
      const staleReceipt = read(join(fixture.root, stale.measurement.path));
      staleReceipt.window = { start: '2026-07-01T00:00:00.000000Z', end: '2026-07-01T01:00:00.000000Z' };
      staleReceipt.observations.forEach((row: any) => { row.capturedAt = '2026-07-01T00:30:00.000000Z'; });
      staleReceipt.attestations.forEach((row: any) => { row.capturedAt = '2026-07-01T00:30:00.000000Z'; });
      rewriteArtifact(fixture, stale.measurement.path, staleReceipt);
      const unknownReceipt = read(join(fixture.root, unknown.measurement.path));
      unknown.key = 'unknown.health_override';
      unknownReceipt.key = unknown.key;
      rewriteArtifact(fixture, unknown.measurement.path, unknownReceipt);
      const changedRaw = read(join(fixture.root, fixture.rawPath));
      changedRaw.items.find((row: any) => row.id === unknown.id).key = unknown.key;
      rewriteArtifact(fixture, fixture.rawPath, changedRaw);
      const current = read(join(fixture.root, fixture.rawPath));
      const health = read(join(fixture.root, current.healthReceipt.path));
      health.incidents = [{ id: 'incident-global', gate: 'app_owned_invocation_errors', capturedAt: AS_OF }];
      health.coverage = health.coverage.map((row: any) => ({ ...row, count: row.gate === 'app_owned_invocation_errors' ? 1 : 0 }));
      rewriteArtifact(fixture, current.healthReceipt.path, health);
      const scored = scoredItem(fixture, 'global-health.scored.json');
      expect(scored).toHaveLength(36);
      expect(scored.every((row) => row.status === 'release_blocked' && row.decision === 'blocked' && row.reason === 'health_gate_failed' && row.rank === null)).toBe(true);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }, 90_000);

  test('rejects independent embedded health, measurement, and manifest digest mismatches in scorer and validator', () => {
    const cases: Array<{ name: string; reference: 'healthReceipt' | 'measurement' | 'manifest'; category: string }> = [
      { name: 'health', reference: 'healthReceipt', category: 'unbound health reference' },
      { name: 'measurement', reference: 'measurement', category: 'unbound measurement reference' },
      { name: 'manifest', reference: 'manifest', category: 'unbound manifest reference' },
    ];
    for (const scenario of cases) expectFatalBoth(`${scenario.name}-digest`, (fixture) => {
      const raw = read(join(fixture.root, fixture.rawPath));
      if (scenario.reference === 'healthReceipt') raw.healthReceipt.sha256 = '0'.repeat(64);
      else raw.items[0][scenario.reference].sha256 = '0'.repeat(64);
      rewriteArtifact(fixture, fixture.rawPath, raw);
      return scenario.category;
    });
  }, 90_000);

  test('derives manifest risk and effort across every boundary mode and exact scope thresholds', () => {
    const fixture = rootWithAllRows();
    try {
      const { data } = derivePure(fixture);
      const item = data.raw.items[0];
      const manifest = data.manifests.get(item.id);
      const rawSchema = read(join(performance, 'backlog-raw.schema.json'));
      manifest.rollback.steps = ['Stop writes.', 'Restore backup.'];
      const canonicalManifest = canonicalBytes(manifest, rawSchema.$defs.manifest, rawSchema).toString('utf8');
      expect(canonicalManifest.indexOf('Stop writes.')).toBeLessThan(canonicalManifest.indexOf('Restore backup.'));
      const cases = [
        ['auth', 'read_only', 'high', 'small', undefined],
        ['data', 'behavior_preserving', 'medium', 'small', undefined],
        ['schema', 'schema_or_rls', 'high', 'large', 'blocked_scope'],
        ['schema', 'behavior_preserving', 'high', 'large', 'blocked_scope'],
        ['deploy', 'deployment_or_rollback', 'high', 'small', undefined],
        ['batch', 'batch_publication', 'high', 'small', undefined],
        ['privacy', 'sensitive_evidence', 'high', 'small', undefined],
        ['dependency', 'dependency_change', 'medium', 'large', undefined],
        ['build', 'build_config_change', 'medium', 'large', undefined],
        ['runtime', 'runtime_config_change', 'medium', 'large', undefined],
        ['workflow', 'workflow_change', 'medium', 'large', undefined],
        ['auth', 'privileged_write', 'high', 'large', 'blocked_scope'],
      ] as const;
      for (const [boundary, mode, risk, effort, reason] of cases) {
        manifest.boundaries = [{ boundary, mode }];
        const scored = deriveBoth(fixture, data);
        expect(scored.items.find((row: any) => row.id === item.id)).toMatchObject({ risk, effort, ...(reason ? { reason } : {}) });
      }
      for (const [productFiles, loc, effort, reason] of [[2, 150, 'small', null], [3, 150, 'medium', null], [5, 150, 'medium', null], [6, 150, 'large', 'blocked_scope'], [1, 151, 'medium', null], [1, 500, 'medium', null], [1, 501, 'large', null], [1, 1000, 'large', null], [1, 1001, 'large', 'blocked_scope']] as const) {
        manifest.boundaries = [];
        manifest.files = Array.from({ length: productFiles }, (_, index) => ({ path: `apps/web/lib/governance-${index}.ts`, addedNonTestLoc: index === 0 ? loc : 0, deletedNonTestLoc: 0 }));
        const scored = deriveBoth(fixture, data);
        expect(scored.items.find((row: any) => row.id === item.id)).toMatchObject({ risk: 'low', effort, ...(reason ? { reason } : {}) });
      }
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
  test('scores every impact, risk, and effort class with independently checked penalty arithmetic', () => {
    const fixture = rootWithAllRows();
    try {
      const { data } = derivePure(fixture);
      const impactCases = [
        ['browser.long_task.max_ms', 500],
        ['vercel.function_cold_p95_ms', 450],
        ['backend.delta_total_p75_ms', 450],
        ['api.bounded_p95_ms', 425],
        ['admin.lazy_ui_p75_ms', 350],
        ['typescript.native_cold_p75_ms', 150],
      ] as const;
      for (const [key] of impactCases) {
        const item = data.raw.items.find((row: any) => row.key === key);
        const rowBudget = data.table.get(key);
        const receipt = data.receipts.get(item.id);
        receipt.observations.forEach((observation: any) => {
          observation.value = observation.cohort === 'candidate'
            ? rowBudget.absoluteBudget * 2 + rowBudget.absoluteNoiseFloor + 1
            : rowBudget.absoluteBudget;
        });
      }
      const impactScored = deriveBoth(fixture, data);
      for (const [key, impact] of impactCases) {
        expect(impactScored.items.find((row: any) => row.key === key).scoreComponents.impact).toBe(impact);
      }

      const target = data.raw.items.find((row: any) => row.key === 'api.bounded_p95_ms');
      const manifest = data.manifests.get(target.id);
      const classifications = [
        { boundaries: [], files: [{ path: 'apps/web/lib/a.ts', addedNonTestLoc: 1, deletedNonTestLoc: 0 }], risk: 0, effort: 0 },
        { boundaries: [{ boundary: 'data', mode: 'behavior_preserving' }], files: Array.from({ length: 3 }, (_, index) => ({ path: `apps/web/lib/m-${index}.ts`, addedNonTestLoc: 50, deletedNonTestLoc: 0 })), risk: 150, effort: 75 },
        { boundaries: [{ boundary: 'deploy', mode: 'deployment_or_rollback' }], files: [{ path: 'apps/web/lib/l.ts', addedNonTestLoc: 501, deletedNonTestLoc: 0 }], risk: 400, effort: 200 },
      ];
      for (const classification of classifications) {
        manifest.boundaries = classification.boundaries;
        manifest.files = classification.files;
        const scored = deriveBoth(fixture, data);
        const row = scored.items.find((entry: any) => entry.id === target.id);
        expect(row.scoreComponents).toMatchObject({ risk: classification.risk, effort: classification.effort });
        const components = row.scoreComponents;
        const independentlyCalculated = components.severity + components.impact
          + Math.min(2000, Math.floor(components.percentOverBudgetBasisPoints * 20 / 100))
          + Math.min(500, Math.floor(components.affectedBasisPoints * 5 / 100))
          - classification.risk - classification.effort;
        expect(row.score).toBe(independentlyCalculated);
      }
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });

  test('rejects unsafe manifest text and missing rollback verification references', () => {
    const hypothesisCategory = 'invalid manifest.hypothesis';
    const rollbackTextCategory: FatalCategory = { scorer: 'invalid manifest.rollback.steps[0]', validator: 'invalid manifest.rollback.steps' };
    const stopTextCategory: FatalCategory = { scorer: 'invalid manifest.stopConditions[0].condition', validator: 'invalid manifest.stopConditions.condition' };
    const symbolCategory: FatalCategory = { scorer: 'invalid manifest.symbols[0].symbol', validator: 'invalid manifest.symbols.symbol' };
    const cases: Array<{ name: string; mutate: (manifest: any) => void; category: FatalCategory }> = [
      { name: 'unsafe', mutate: (manifest) => { manifest.hypothesis = 'Send token to a remote endpoint.'; }, category: hypothesisCategory },
      { name: 'uppercase-secret', mutate: (manifest) => { manifest.hypothesis = 'SECRET=live-value'; }, category: hypothesisCategory },
      { name: 'non-http-url', mutate: (manifest) => { manifest.hypothesis = 'Fetch ftp://internal.example'; }, category: hypothesisCategory },
      { name: 'credential-prefix', mutate: (manifest) => { manifest.hypothesis = 'ghp_' + 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210'; }, category: hypothesisCategory },
      { name: 'header-ip', mutate: (manifest) => { manifest.rollback.steps = ['X-Forwarded-For 10.0.0.1']; }, category: rollbackTextCategory },
      { name: 'sql-ddl', mutate: (manifest) => { manifest.stopConditions[0].condition = 'DROP TABLE perf_samples'; }, category: stopTextCategory },
      { name: 'symbol-token', mutate: (manifest) => { manifest.symbols[0].symbol = 'ghp_' + 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210'; }, category: symbolCategory },
      { name: 'sql-values', mutate: (manifest) => { manifest.hypothesis = 'VALUES (1)'; }, category: hypothesisCategory },
      { name: 'arbitrary-host', mutate: (manifest) => { manifest.hypothesis = 'example.ai'; }, category: hypothesisCategory },
      { name: 'ipv6', mutate: (manifest) => { manifest.rollback.steps = ['2001:db8::1']; }, category: rollbackTextCategory },
      { name: 'symbol-live-key', mutate: (manifest) => { manifest.symbols[0].symbol = `sk_${'live_51abcdefghijklmnopqrstuv'}`; }, category: symbolCategory },
      { name: 'symbol-opaque', mutate: (manifest) => { manifest.symbols[0].symbol = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'; }, category: symbolCategory },
      { name: 'basic-credential', mutate: (manifest) => { manifest.hypothesis = 'Basic dXNlcjpwYXNz'; }, category: hypothesisCategory },
      { name: 'sql-show', mutate: (manifest) => { manifest.stopConditions[0].condition = 'SHOW TABLES'; }, category: stopTextCategory },
      { name: 'symbol-digitless-ipv6', mutate: (manifest) => { manifest.symbols[0].symbol = 'dead:beef:cafe:fade:bead:face:aced:deaf'; }, category: symbolCategory },
      { name: 'rollback', mutate: (manifest) => { manifest.rollback.verificationTestIds = ['missing-test']; }, category: 'manifest rollback reference' },
    ];
    for (const scenario of cases) expectFatalBoth(`${scenario.name}-manifest`, (fixture) => {
      const item = firstItem(fixture), manifest = read(join(fixture.root, item.manifest.path));
      scenario.mutate(manifest);
      rewriteArtifact(fixture, item.manifest.path, manifest);
      return scenario.category;
    });
    for (const [index, symbol] of ['User.find', 'Provider.run', 'Database.select', 'generateStoryboardWithBackendAgent'].entries()) {
      const fixture = rootWithAllRows();
      try {
        const item = firstItem(fixture), manifest = read(join(fixture.root, item.manifest.path));
        manifest.symbols[0].symbol = symbol;
        rewriteArtifact(fixture, item.manifest.path, manifest);
        const { scored } = scoreAndValidate(fixture, `safe-symbol-${index}.scored.json`);
        expect(read(join(fixture.root, scored)).items).toHaveLength(36);
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
    const proseFixture = rootWithAllRows();
    try {
      const { data } = derivePure(proseFixture);
      const manifest = data.manifests.get(data.raw.items[0].id);
      for (const template of APPROVED_PROSE_TEMPLATES) {
        manifest.hypothesis = template;
        deriveBoth(proseFixture, data);
      }
    } finally { rmSync(proseFixture.root, { recursive: true, force: true }); }
  }, 90_000);

  test('counts each observation once regardless of complete multi-form attestations', () => {
    const fixture = rootWithAllRows();
    try {
      const key = 'api.external_backed_p95_ms';
      const budget = selfHashedBudget((value) => {
        value.budgets.find((row: any) => row.key === key).sampleMinimum = 1;
      });
      const { data } = derivePure(fixture, budget);
      const item = data.raw.items.find((row: any) => row.key === key);
      const rowBudget = data.table.get(key);
      const receipt = data.receipts.get(item.id);
      receipt.observations = [
        { id: 'baseline-single', cohort: 'baseline', capturedAt: AS_OF, value: rowBudget.absoluteBudget, ownershipBasisPoints: 10000 },
        { id: 'candidate-single', cohort: 'candidate', capturedAt: AS_OF, value: rowBudget.absoluteBudget * 2 + rowBudget.absoluteNoiseFloor + 1, ownershipBasisPoints: 10000 },
      ];
      expect(receipt.attestations).toHaveLength(4);
      const scored = deriveBoth(fixture, data);
      expect(scored.items.find((row: any) => row.id === item.id)).toMatchObject({
        sampleCount: 1,
        eligibleCount: 1,
        affectedCount: 1,
      });
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
  test('uses odd nearest-rank MAD, half-away ties, and zero-denominator excess in pure BigInt derivation', () => {
    const fixture = rootWithAllRows();
    try {
      const budget = selfHashedBudget((value) => {
        const row = value.budgets.find((entry: any) => entry.key === 'supabase.requests_per_user_action');
        row.absoluteBudget = 15;
        row.absoluteNoiseFloor = 0;
      });
      const { data } = derivePure(fixture, budget);
      const item = data.raw.items.find((row: any) => row.key === 'supabase.requests_per_user_action');
      const receipt = data.receipts.get(item.id);
      const values = [...Array(15).fill(0), 16, ...Array(15).fill(32)];
      receipt.observations = [
        ...values.map((value, index) => ({ id: `candidate-odd-${index}`, cohort: 'candidate', capturedAt: AS_OF, value, ownershipBasisPoints: 10000 })),
        ...values.map((_, index) => ({ id: `baseline-odd-${index}`, cohort: 'baseline', capturedAt: AS_OF, value: 15, ownershipBasisPoints: 10000 })),
      ];
      const scored = deriveBoth(fixture, data);
      expect(scored.items.find((row: any) => row.id === item.id)).toMatchObject({ observed: 16, baseline: 15, sampleCount: 31, confidenceMarginBasisPoints: 313, confidence: 'low' });
      receipt.observations.forEach((row: any) => { row.value = row.cohort === 'candidate' ? 16 : 15; });
      const zero = deriveBoth(fixture, data);
      expect(zero.items.find((row: any) => row.id === item.id)).toMatchObject({ observed: 16, confidenceMarginBasisPoints: 100000, confidence: 'high' });
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
  test('rejects duplicate raw and measurement keys, extra map artifacts, invalid calendar dates, bounded oversized roles, and every pin substitution', () => {
    const cases: Array<{ name: string; prepare: (fixture: ReturnType<typeof rootWithAllRows>) => FatalCategory }> = [
      {
        name: 'duplicate-raw-key',
        prepare: (fixture) => {
          const bytes = readFileSync(join(fixture.root, fixture.rawPath), 'utf8').replace('"releaseId":', '"releaseId":"release-019f4809","releaseId":');
          writeFileSync(join(fixture.root, fixture.rawPath), bytes);
          const map = read(join(fixture.root, fixture.mapPath)); map.artifacts[fixture.rawPath] = sha256(readFileSync(join(fixture.root, fixture.rawPath))); write(join(fixture.root, fixture.mapPath), map);
          return { scorer: 'raw duplicate key', validator: 'duplicate JSON key' };
        },
      },
      {
        name: 'duplicate-measurement-key',
        prepare: (fixture) => {
          const item = firstItem(fixture), path = item.measurement.path;
          const bytes = readFileSync(join(fixture.root, path), 'utf8').replace('"key":', '"key":"duplicate","key":');
          writeFileSync(join(fixture.root, path), bytes);
          const digest = sha256(readFileSync(join(fixture.root, path)));
          const raw = read(join(fixture.root, fixture.rawPath)); raw.items[0].measurement.sha256 = digest;
          write(join(fixture.root, fixture.rawPath), raw);
          const map = read(join(fixture.root, fixture.mapPath)); map.artifacts[path] = digest; map.artifacts[fixture.rawPath] = sha256(readFileSync(join(fixture.root, fixture.rawPath))); write(join(fixture.root, fixture.mapPath), map);
          return { scorer: 'measurement duplicate key', validator: 'duplicate JSON key' };
        },
      },
      {
        name: 'extra-artifact',
        prepare: (fixture) => {
          write(join(fixture.root, 'extra.json'), { bounded: true });
          const map = read(join(fixture.root, fixture.mapPath)); map.artifacts['extra.json'] = sha256(readFileSync(join(fixture.root, 'extra.json'))); write(join(fixture.root, fixture.mapPath), map);
          return { scorer: 'unexpected map entries', validator: 'unexpected map artifact' };
        },
      },
      {
        name: 'invalid-calendar',
        prepare: (fixture) => {
          const raw = read(join(fixture.root, fixture.rawPath)), health = read(join(fixture.root, raw.healthReceipt.path));
          health.window.end = '2026-02-30T00:00:00.000000Z';
          rewriteArtifact(fixture, raw.healthReceipt.path, health);
          return 'invalid timestamp';
        },
      },
      ...(['raw', 'health', 'measurement', 'manifest'] as const).map((role) => ({
        name: `oversized-${role}`,
        prepare: (fixture: ReturnType<typeof rootWithAllRows>) => {
          const raw = read(join(fixture.root, fixture.rawPath));
          const path = role === 'raw' ? fixture.rawPath : role === 'health' ? raw.healthReceipt.path : role === 'measurement' ? raw.items[0].measurement.path : raw.items[0].manifest.path;
          writeFileSync(join(fixture.root, path), Buffer.alloc((role === 'raw' || role === 'measurement' ? 8 : 2) * 1024 * 1024 + 1, 0x20));
          const digest = sha256(readFileSync(join(fixture.root, path)));
          if (role !== 'raw') {
            if (role === 'health') raw.healthReceipt.sha256 = digest;
            else raw.items[0][role].sha256 = digest;
            write(join(fixture.root, fixture.rawPath), raw);
          }
          const map = read(join(fixture.root, fixture.mapPath)); map.artifacts[path] = digest; map.artifacts[fixture.rawPath] = sha256(readFileSync(join(fixture.root, fixture.rawPath))); write(join(fixture.root, fixture.mapPath), map);
          return 'invalid artifact size';
        },
      })),
      ...(['rawSchema', 'scoredSchema', 'budget'] as const).map((pin) => ({
        name: `substituted-${pin}`,
        prepare: (fixture: ReturnType<typeof rootWithAllRows>) => {
          const path = `substituted-${pin}.json`;
          write(join(fixture.root, path), { substituted: pin });
          const map = read(join(fixture.root, fixture.mapPath)); map.pins[pin] = { path, sha256: sha256(readFileSync(join(fixture.root, path))) }; write(join(fixture.root, fixture.mapPath), map);
          return 'pinned contract digest';
        },
      })),
    ];
    for (const scenario of cases) expectFatalBoth(scenario.name, scenario.prepare);
  }, 90_000);
  test('enforces every direct artifact-size boundary through the protected CLIs', () => {
    const cases = [
      ['artifact-map', 1024 * 1024, true],
      ['raw-schema', 1024 * 1024, true],
      ['scored-schema', 1024 * 1024, true],
      ['budget', 1024 * 1024, true],
      ['raw', 8 * 1024 * 1024, true],
      ['health', 2 * 1024 * 1024, true],
      ['measurement', 8 * 1024 * 1024, true],
      ['manifest', 2 * 1024 * 1024, true],
      ['scored', 16 * 1024 * 1024, false],
      ['detached', 1024, false],
    ] as const;
    for (const [role, limit, scorerApplies] of cases) {
      const fixture = rootWithAllRows();
      try {
        const { scored } = scoreAndValidate(fixture, `${role}.baseline.scored.json`);
        const detached = `${scored}.sha256`, raw = read(join(fixture.root, fixture.rawPath));
        const path = role === 'artifact-map' ? fixture.mapPath
          : role === 'raw-schema' ? 'raw.schema.json'
            : role === 'scored-schema' ? 'scored.schema.json'
              : role === 'budget' ? 'budget.json'
                : role === 'raw' ? fixture.rawPath
                  : role === 'health' ? raw.healthReceipt.path
                    : role === 'measurement' ? raw.items[0].measurement.path
                      : role === 'manifest' ? raw.items[0].manifest.path
                        : role === 'scored' ? scored : detached;
        writeFileSync(join(fixture.root, path), Buffer.alloc(limit + 1, 0x20));
        if (role !== 'artifact-map') {
          const map = read(join(fixture.root, fixture.mapPath)), digest = sha256(readFileSync(join(fixture.root, path)));
          if (role === 'raw-schema') map.pins.rawSchema.sha256 = digest;
          else if (role === 'scored-schema') map.pins.scoredSchema.sha256 = digest;
          else if (role === 'budget') map.pins.budget.sha256 = digest;
          else {
            map.artifacts[path] = digest;
            if (role === 'health') raw.healthReceipt.sha256 = digest;
            else if (role === 'measurement' || role === 'manifest') raw.items[0][role].sha256 = digest;
            if (role === 'health' || role === 'measurement' || role === 'manifest') {
              write(join(fixture.root, fixture.rawPath), raw);
              map.artifacts[fixture.rawPath] = sha256(readFileSync(join(fixture.root, fixture.rawPath)));
            }
          }
          write(join(fixture.root, fixture.mapPath), map);
        }
        if (scorerApplies && role !== 'artifact-map') {
          const scorerMap = read(join(fixture.root, fixture.mapPath));
          delete scorerMap.artifacts[scored];
          delete scorerMap.artifacts[detached];
          write(join(fixture.root, fixture.mapPath), scorerMap);
        }
        if (scorerApplies) {
          expectFailure([scorer, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--output', `${role}.scored.json`])], 'invalid artifact size');
        }
        if (scorerApplies && role !== 'artifact-map') {
          const validatorMap = read(join(fixture.root, fixture.mapPath));
          validatorMap.artifacts[scored] = sha256(readFileSync(join(fixture.root, scored)));
          validatorMap.artifacts[detached] = sha256(readFileSync(join(fixture.root, detached)));
          write(join(fixture.root, fixture.mapPath), validatorMap);
        }
        expectFailure([validator, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored])], 'invalid artifact size');
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    }
  }, 90_000);
  test('fails both protected CLIs when canonical schema-valid measurement receipts cross the 64 MiB aggregate cap', () => {
    const fixture = rootWithAllRows();
    try {
      const { scored } = scoreAndValidate(fixture, 'aggregate.baseline.scored.json');
      const detached = `${scored}.sha256`;
      const raw = read(join(fixture.root, fixture.rawPath)), map = read(join(fixture.root, fixture.mapPath)), padding = 'x'.repeat(64);
      for (const item of raw.items.slice(0, 11)) {
        const receipt = read(join(fixture.root, item.measurement.path));
        receipt.observations = Array.from({ length: 32_000 }, (_, index) => ({
          id: `aggregate-${String(index).padStart(5, '0')}-${padding}`,
          cohort: index === 0 ? 'baseline' : 'candidate',
          capturedAt: AS_OF,
          value: 1,
          ownershipBasisPoints: 10000,
        }));
        write(join(fixture.root, item.measurement.path), receipt);
        const digest = sha256(readFileSync(join(fixture.root, item.measurement.path)));
        item.measurement.sha256 = digest;
        map.artifacts[item.measurement.path] = digest;
      }
      write(join(fixture.root, fixture.rawPath), raw);
      map.artifacts[fixture.rawPath] = sha256(readFileSync(join(fixture.root, fixture.rawPath)));
      delete map.artifacts[scored];
      delete map.artifacts[detached];
      write(join(fixture.root, fixture.mapPath), map);
      expectFailure([scorer, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--output', 'aggregate.scored.json'])], 'aggregate cap');
      map.artifacts[scored] = sha256(readFileSync(join(fixture.root, scored)));
      map.artifacts[detached] = sha256(readFileSync(join(fixture.root, detached)));
      write(join(fixture.root, fixture.mapPath), map);
      expectFailure([validator, ...context(fixture.root, fixture.mapPath, fixture.rawPath, ['--input', fixture.rawPath, '--scored', scored])], 'aggregate artifact cap');
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }, 90_000);

  test('keeps a named noncritical P0-sized regression at P1 and pins independent capped score arithmetic', () => {
    const fixture = rootWithAllRows();
    try {
      const item = itemForKey(fixture, 'supabase.requests_per_user_action');
      const receipt = read(join(fixture.root, item.measurement.path));
      const budget = read(join(performance, 'performance-budgets.v1.json')).budgets.find((row: any) => row.key === 'supabase.requests_per_user_action');
      receipt.observations.forEach((observation: any) => { observation.value = observation.cohort === 'candidate' ? 100000 : budget.absoluteBudget; });
      rewriteArtifact(fixture, item.measurement.path, receipt);
      expect(scoredItem(fixture, 'named-noncritical.scored.json').find((row) => row.id === item.id)).toMatchObject({
        severity: 'P1',
        score: 7925,
        scoreComponents: { severity: 5000, impact: 425, risk: 0, effort: 0, percentOverBudgetBasisPoints: 10000, affectedBasisPoints: 10000 },
      });
      expect(5000 + 425 + 2000 + 500).toBe(7925);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  }, 90_000);
});
