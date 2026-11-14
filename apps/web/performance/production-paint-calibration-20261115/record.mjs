import { readFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  VERSION, TOOL_FILES, SOURCE_FILES, URL, OUTCOMES, check, sha, descriptor,
  jsonAt, bytesAt, writeOnce, utc, gitPattern, hashPattern, validateIdentity,
  validatePlan, visitPaths, filePath, schemaProblems, checkReceipt, expectedArtifacts, parseJsonBytes,
} from './evidence.mjs';

const command = process.argv[2];
const { values: args } = parseArgs({ args: process.argv.slice(3), strict: true, options: Object.fromEntries([
  'root', 'repository', 'protocol-sha256', 'source-sha', 'source-tree', 'identity', 'frozen-at',
  'ordinal', 'started-at', 'observed-at', 'observed-url', 'outcome', 'raw',
].map((key) => [key, { type: 'string' }])) });
const root = args.root;
const repository = args.repository;
try {
  check(typeof root === 'string' && typeof repository === 'string', '--root and --repository are required');
  check(hashPattern.test(args['protocol-sha256']) && sha(bytesAt(root, 'protocol.json')) === args['protocol-sha256'], 'Provide the protocol hash frozen before observations');
  if (command === 'plan') {
    check(!existsSync(filePath(root, 'inputs/plan.json')), 'Plan already exists; it cannot be replaced');
    const identity = parseJsonBytes(readFileSync(args.identity));
    validateIdentity(identity, args['source-sha']);
    check(gitPattern.test(args['source-tree']) && utc(args['frozen-at']), 'Full tree and actual freeze timestamp required');
    const plan = {
      schemaVersion: `${VERSION}.plan.v1`, frozenAtUtc: args['frozen-at'],
      sourceSha: args['source-sha'], sourceTree: args['source-tree'],
      protocolSha256: args['protocol-sha256'], browserSurface: 'cua-cloud-cdp', browserVersion: null,
      plannedOrdinals: [1, 2, 3], identity,
      sourceFiles: SOURCE_FILES.map((path) => descriptor(repository, path)),
      toolFiles: TOOL_FILES.map((path) => descriptor(root, path)),
    };
    validatePlan(plan, root, repository, args['protocol-sha256']);
    console.log(JSON.stringify(writeOnce(root, 'inputs/plan.json', plan)));
  } else {
    const plan = jsonAt(root, 'inputs/plan.json');
    validatePlan(plan, root, repository, args['protocol-sha256']);
    const schema = jsonAt(root, 'snapshot.schema.json');
    if (command === 'attempt') {
      const ordinal = Number(args.ordinal);
      const paths = visitPaths(ordinal);
      check(!existsSync(filePath(root, paths.raw)) && !existsSync(filePath(root, paths.receipt)), 'Planned attempt already retained; replacement is forbidden');
      const outcome = args.outcome ?? (args.raw ? 'captured' : null);
      check(OUTCOMES.includes(outcome), 'Explicit supported outcome required');
      const unattempted = outcome === 'not-executed-access-block';
      check(utc(args['observed-at']) && (unattempted ? !args['started-at'] : utc(args['started-at'])), 'Actual capture timestamps required');
      check(Date.parse(args['observed-at']) >= Date.parse(plan.frozenAtUtc), 'Capture precedes frozen plan');
      if (!unattempted) check(Date.parse(args['started-at']) >= Date.parse(plan.frozenAtUtc) && Date.parse(args['observed-at']) >= Date.parse(args['started-at']), 'Capture timestamps out of order');
      const observedUrl = args['observed-url'];
      check([URL, 'other', 'not-navigated'].includes(observedUrl) && (!unattempted || observedUrl === 'not-navigated'), 'Use exact observed URL or fixed category');
      if (ordinal > 1) {
        const previous = jsonAt(root, visitPaths(ordinal - 1).receipt);
        check(Date.parse(args['observed-at']) >= Date.parse(previous.observedAtUtc), 'Captures are out of planned order');
        if (!unattempted) check(Date.parse(args['started-at']) >= Date.parse(previous.observedAtUtc), 'Do not overlap planned visits');
      }
      if (unattempted) check(Array.from({ length: ordinal - 1 }, (_, i) => jsonAt(root, visitPaths(i + 1).receipt)).some((r) => r.outcome === 'blocked-access'), 'No prior access block to explain unexecuted visit');
      let snapshot = null;
      if (outcome === 'captured') {
        check(typeof args.raw === 'string', 'Captured attempt needs original DOM JSON bytes');
        const raw = readFileSync(args.raw);
        check(raw.length <= 262144, 'Raw payload exceeds bound');
        check(schemaProblems(parseJsonBytes(raw), schema).length === 0, 'Raw payload is not the fixed numeric/enum schema; retain only an invalid-diagnostic-payload receipt');
        snapshot = writeOnce(root, paths.raw, raw);
      } else check(!args.raw, 'Unavailable or invalid payload must not be persisted as a snapshot');
      const receipt = {
        schemaVersion: `${VERSION}.receipt.v1`, ordinal,
        startedAtUtc: unattempted ? null : args['started-at'], observedAtUtc: args['observed-at'],
        observedUrl, outcome, snapshot,
      };
      checkReceipt(receipt, ordinal, root, plan, schema);
      console.log(JSON.stringify({ snapshot, receipt: writeOnce(root, paths.receipt, receipt) }));
    } else if (command === 'seal') {
      for (const ordinal of [1, 2, 3]) checkReceipt(jsonAt(root, visitPaths(ordinal).receipt), ordinal, root, plan, schema);
      const map = {
        schemaVersion: `${VERSION}.artifact-map.v1`, protocolSha256: args['protocol-sha256'],
        items: expectedArtifacts(root).map((path) => descriptor(root, path)),
      };
      console.log(JSON.stringify({ artifactMap: writeOnce(root, 'artifact-map.json', map), instruction: 'Record this SHA-256 separately before running analysis.' }));
    } else throw new Error('Command must be plan, attempt, or seal');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Calibration recording failed');
  process.exitCode = 1;
}
