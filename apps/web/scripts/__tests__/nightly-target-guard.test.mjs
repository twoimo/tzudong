import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { assertHostedNightlyTargetAllowed } from '../nightly-target-guard.mjs';

// Pure contract checks below are supplemented by whole-module VM tests. Never
// import the live CLI: its startup performs cleanup and may execute test suites.
const source = readFileSync(new URL('../run-nightly-regression.mjs', import.meta.url), 'utf8');
function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing source boundary: ${startMarker}`);
  return source.slice(start, end);
}

const identityDeclaration = block('const hostedIdentityKeys = [', 'const browserEnvironmentKeys = [');
const requiredDeclaration = block('const hostedRequiredEnvironment = [', 'const localUrlEnvironment = [');
const requiredKeys = new Function(`${identityDeclaration}\n${requiredDeclaration}\nreturn hostedRequiredEnvironment;`)();
const hostedValidator = new Function(
  'assertHostedNightlyTargetAllowed',
  `${identityDeclaration}\n${requiredDeclaration}\n${block('function validateHostedEnvironment(environment)', 'function validateEnvironment(')}
   return validateHostedEnvironment;`,
)(assertHostedNightlyTargetAllowed);
const validateTarget = new Function(
  'assertHostedNightlyTargetAllowed',
  `return function(environment) {
    ${block('  const projectRef = environment.NIGHTLY_SUPABASE_PROJECT_REF.trim();', "  if (!environment.NIGHTLY_ADMIN_EMAIL.trim()")}
    return projectRef;
  };`,
)(assertHostedNightlyTargetAllowed);

const productionRef = 'aqlcofblfxdrjhhdmarw';
const fixtureRef = 'nightly-target-fixture';
const endpoint = (ref) => `https://${ref}.supabase.co/`;
const target = (ref, url) => ({ NIGHTLY_SUPABASE_PROJECT_REF: ref, NEXT_PUBLIC_SUPABASE_URL: url });
const denial = /^Hosted nightly mode forbids known production Supabase targets\.$/;

for (const [name, ref, url] of [
  ['matching production pair', productionRef, endpoint(productionRef)],
  ['production reference with different endpoint', productionRef, endpoint(fixtureRef)],
  ['production endpoint with different reference', fixtureRef, endpoint(productionRef)],
  ['normalized uppercase production hostname', fixtureRef, `https://${productionRef.toUpperCase()}.supabase.co/`],
  ['production endpoint with nonroot path', fixtureRef, `${endpoint(productionRef)}rest/v1`],
]) {
  test(`pure denial: ${name}`, () => {
    assert.throws(() => assertHostedNightlyTargetAllowed(ref, new URL(url)), { message: denial });
    assert.throws(() => validateTarget(target(ref, url)), { message: denial });
  });
}

for (const [name, ref, url] of [
  ['malformed URL', fixtureRef, 'not-a-url'],
  ['different project', fixtureRef, endpoint('different-fixture')],
  ['invalid reference', 'INVALID_REF', endpoint(fixtureRef)],
  ['HTTP', fixtureRef, `http://${fixtureRef}.supabase.co/`],
  ['nondefault port', fixtureRef, `https://${fixtureRef}.supabase.co:444/`],
  ['nonroot path', fixtureRef, `${endpoint(fixtureRef)}rest/v1`],
  ['query', fixtureRef, `${endpoint(fixtureRef)}?test=1`],
  ['fragment', fixtureRef, `${endpoint(fixtureRef)}#test`],
  ['userinfo', fixtureRef, `https://fixture@${fixtureRef}.supabase.co/`],
  ['lookalike hostname', fixtureRef, `https://${fixtureRef}.supabase.co.invalid/`],
  ['production lookalike', fixtureRef, `${endpoint(productionRef).slice(0, -1)}.invalid/`],
  ['loopback', fixtureRef, 'http://127.0.0.1:54321/'],
]) {
  test(`exact target contract rejects ${name}`, () => {
    assert.throws(() => validateTarget(target(ref, url)));
  });
}

for (const url of [endpoint(fixtureRef), `https://${fixtureRef}.supabase.co`, `https://${fixtureRef}.supabase.co:443/`]) {
  test(`retains syntactically matching endpoint: ${url}`, () => {
    assert.equal(validateTarget(target(` ${fixtureRef} `, ` ${url} `)), fixtureRef);
    // Syntactic acceptance is not evidence of ownership/nonproduction status.
  });
}

test('all nine required variables remain mandatory with no input', () => {
  assert.deepEqual(requiredKeys, [
    'NIGHTLY_SUPABASE_PROJECT_REF', 'TS7_RELEASE_ID', 'VERCEL_GIT_COMMIT_SHA',
    'VERCEL_DEPLOYMENT_ID', 'VERCEL_PROJECT_ID', 'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NIGHTLY_ADMIN_EMAIL', 'NIGHTLY_ADMIN_PASSWORD',
  ]);
  assert.throws(() => hostedValidator({}), {
    message: `Missing required hosted nightly environment variable(s): ${requiredKeys.join(', ')}`,
  });
});

for (const key of requiredKeys) {
  test(`missing/blank ${key} fails before target admission`, () => {
    // Presence markers only; the URL is deliberately invalid, and this branch
    // must stop before parsing it. No usable host/credential pair is constructed.
    const environment = Object.fromEntries(requiredKeys.map((name) => [name, 'presence-only']));
    for (const value of [undefined, '', ' \t ']) {
      environment[key] = value;
      assert.throws(() => hostedValidator(environment), {
        message: `Missing required hosted nightly environment variable(s): ${key}`,
      });
    }
  });
}

test('local dispatch retains provenance enforcement and its own validator', () => {
  const localEnvironment = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/' };
  const calls = [];
  const validate = new Function('validateLocalEnvironment', 'validateHostedEnvironment', 'path',
    `${block('function validateEnvironment(mode, environment, provenance)', 'function signalChild(')}\nreturn validateEnvironment;`,
  )(
    (environment) => { calls.push(environment); return { ...environment, NIGHTLY_MODE: 'local' }; },
    () => assert.fail('local must not enter hosted validation'),
    path,
  );
  assert.throws(() => validate('local', localEnvironment), /verified env provenance receipt/);
  assert.equal(calls.length, 0);
  assert.deepEqual(validate('local', localEnvironment, { digest: 'fixture-digest' }), {
    ...localEnvironment, NIGHTLY_MODE: 'local', NIGHTLY_ENV_PROVENANCE: 'verified',
    NIGHTLY_ENV_PROVENANCE_SHA256: 'fixture-digest', NIGHTLY_ENV_FILE: undefined,
  });
  assert.deepEqual(calls, [localEnvironment]);
});

// Node 24 requires --experimental-vm-modules for these tests. Fail rather than
// silently skip the admission checks when that flag is missing.
assert.equal(typeof vm.SourceTextModule, 'function',
  'Run node --experimental-vm-modules --test scripts/__tests__/nightly-target-guard.test.mjs');
const guardSource = readFileSync(new URL('../nightly-target-guard.mjs', import.meta.url), 'utf8');

// Both modules retain their actual imports, dispatcher, validation and startup.
// Only the hostname suffix is rewritten to reserved .invalid in memory. Presence
// markers below are not credentials and are never paired with a real hostname.
// This proves offline admission wiring, not live CLI/Hosted or Local acceptance.
async function runOfflineModule(suite, failure, runnerSource = source, validateOnly = false) {
  const effects = [];
  const evidence = [];
  const errors = [];
  const logs = [];
  const imports = [];
  const ref = failure === 'production-target' ? productionRef : fixtureRef;
  const hostRef = failure === 'production-hostname' ? productionRef : ref;
  const environment = failure === 'missing-nine' ? {} : {
    NIGHTLY_SUPABASE_PROJECT_REF: ref,
    TS7_RELEASE_ID: 'presence-only',
    VERCEL_GIT_COMMIT_SHA: 'presence-only',
    VERCEL_DEPLOYMENT_ID: 'presence-only',
    VERCEL_PROJECT_ID: 'presence-only',
    NEXT_PUBLIC_SUPABASE_URL: `https://${hostRef}.supabase.invalid/`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'presence-only',
    NIGHTLY_ADMIN_EMAIL: 'nightly@example.invalid',
    NIGHTLY_ADMIN_PASSWORD: 'presence-only',
    APP_PORT: '4317',
  };
  const forbidden = (name) => () => {
    effects.push(name);
    throw new Error(`Offline boundary reached: ${name}`);
  };
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  let exitCode = 0;
  const processStub = {
    env: environment,
    argv: ['node', 'runner', '--mode', 'hosted', '--suite', suite,
      ...(validateOnly ? ['--validate-only'] : [])],
    once() {},
    get exitCode() { return exitCode; },
    set exitCode(value) { exitCode = value; finish(); },
    exit: forbidden('exit'),
    kill: forbidden('kill'),
  };
  const context = vm.createContext({
    URL,
    process: processStub,
    console: {
      log(value) { logs.push(value); finish(); },
      error(value) { errors.push(value); },
    },
    fetch: forbidden('network'),
    setTimeout: forbidden('runner timer'),
  }, { codeGeneration: { strings: false, wasm: false } });
  const module = new vm.SourceTextModule(
    runnerSource.replaceAll('.supabase.co', '.supabase.invalid'),
    {
      context,
      identifier: 'file:///offline/apps/web/scripts/run-nightly-regression.mjs',
      initializeImportMeta(meta) {
        meta.url = 'file:///offline/apps/web/scripts/run-nightly-regression.mjs';
      },
    },
  );
  const filesystem = { constants: {}, realpathSync: (value) => value };
  for (const name of [
    'closeSync', 'createWriteStream', 'existsSync', 'fstatSync', 'ftruncateSync',
    'lstatSync', 'openSync', 'readFileSync', 'readdirSync', 'statSync', 'writeFileSync',
  ]) filesystem[name] = forbidden(`fs.${name}`);
  const evidenceBoundary = {
    removePrivatePlaywrightReport() { evidence.push('cleanup-private'); },
    removeSanitizedPlaywrightFailureEvidence() { evidence.push('cleanup-sanitized'); },
    replaceWithNightlyRunnerStageEvidence(_path, stage) { evidence.push(stage); },
    writeNightlyRunnerStageEvidence: forbidden('write-stage-evidence'),
    preparePrivatePlaywrightReport: forbidden('prepare-report'),
    sanitizePrivatePlaywrightReport: forbidden('sanitize-report'),
    async completeNightlyCleanupTasks(tasks) {
      for (const task of tasks) await task();
      return false;
    },
  };
  const boundaries = new Map([
    ['node:fs', filesystem],
    ['node:crypto', { createHash, randomBytes: forbidden('randomBytes') }],
    ['node:path', { default: path }],
    ['node:url', { fileURLToPath }],
    ['node:child_process', { spawn: forbidden('spawn') }],
    ['dotenv', { config: forbidden('envfile') }],
    ['./nightly-playwright-failure-evidence.mjs', evidenceBoundary],
  ]);
  const linked = new Map();
  await module.link((specifier) => {
    imports.push(specifier);
    if (linked.has(specifier)) return linked.get(specifier);
    let dependency;
    if (specifier === './nightly-target-guard.mjs') {
      dependency = new vm.SourceTextModule(
        guardSource.replaceAll('.supabase.co', '.supabase.invalid'), { context },
      );
    } else {
      assert.ok(boundaries.has(specifier), `Unapproved offline import: ${specifier}`);
      const exports = boundaries.get(specifier);
      dependency = new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context });
    }
    linked.set(specifier, dependency);
    return dependency;
  });
  let watchdog;
  try {
    await module.evaluate({ timeout: 1_000 });
    await Promise.race([
      finished,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('Offline runner did not finish')), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
  }
  return { suite, exitCode, effects, evidence, errors, logs, imports };
}

function assertAdmissionDenied(result, failure) {
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.errors, [failure === 'missing-nine'
    ? `[nightly] Missing required hosted nightly environment variable(s): ${requiredKeys.join(', ')}`
    : '[nightly] Hosted nightly mode forbids known production Supabase targets.']);
  assert.deepEqual(result.logs, []);
  assert.deepEqual(result.effects, [], 'admission must precede test/spawn/filesystem boundaries');
  assert.ok(result.imports.includes('./nightly-target-guard.mjs'));
  assert.deepEqual(result.evidence, [
    'cleanup-sanitized', 'cleanup-private', ...(result.suite === 'unit' ? [] : ['admission']),
  ]);
}

function replaceOnce(input, before, after) {
  assert.equal(input.split(before).length, 2, 'mutation must change exactly one source location');
  return input.replace(before, after);
}

for (const suite of ['unit', 'e2e', 'all']) {
  for (const failure of ['production-target', 'production-hostname', 'missing-nine']) {
    test(`whole module ${suite}: ${failure}, validateOnly=false`, async () => {
      assertAdmissionDenied(await runOfflineModule(suite, failure), failure);
    });
  }
  test(`whole module ${suite}: matching reserved endpoint validates`, async () => {
    const result = await runOfflineModule(suite, 'allowed', source, true);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.effects, []);
    assert.deepEqual(result.logs, [`Nightly hosted environment validation passed (${suite}).`]);
    assert.ok(result.imports.includes('./nightly-target-guard.mjs'));
  });
  for (const [mutation, before, after] of [
    ['bypassed Hosted dispatcher', 'return validateHostedEnvironment(environment);', 'return environment;'],
    ['removed guard import', "import { assertHostedNightlyTargetAllowed } from './nightly-target-guard.mjs';\n", ''],
  ]) {
    test(`mutation self-check ${suite}: ${mutation} fails admission assertions`, async () => {
      const mutant = replaceOnce(source, before, after);
      const result = await runOfflineModule(suite, 'production-target', mutant);
      // The exact same assertion as the unmutated test must reject this mutant.
      assert.throws(() => assertAdmissionDenied(result, 'production-target'), assert.AssertionError);
      if (mutation === 'bypassed Hosted dispatcher') {
        assert.ok(result.effects.includes(suite === 'e2e' ? 'fs.lstatSync' : 'spawn'));
      } else {
        assert.deepEqual(result.effects, []);
        assert.deepEqual(result.errors, ['[nightly] assertHostedNightlyTargetAllowed is not defined']);
        assert.ok(!result.imports.includes('./nightly-target-guard.mjs'));
      }
    });
  }
}
