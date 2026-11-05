import { expect, test } from 'bun:test';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertExpectedModelIdentity,
  createOcrGeminiLiveAttemptState,
  invokeAdmittedGeneration,
  isGenerationDeliveryUnknown,
  recordGenerationCallStarted,
  recordModelMetadataRequest,
} from '../scripts/ocr-gemini-live-attempt';
import { resolveOcrVerificationConfiguration } from '../scripts/verify-ocr-gemini-live';

const webRoot = resolve(import.meta.dir, '..');
const scripts = {
  ocr: resolve(webRoot, 'scripts/verify-ocr-gemini-live.ts'),
  storyboard: resolve(webRoot, 'scripts/verify-storyboard-gemini-live.ts'),
};
const nonexistentEnv = '/unused-gemini-verification-operator.env';

function invoke(script: string, envFile: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['run', script, envFile, ...args], {
    cwd: webRoot,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ...env },
  });
}

test('historical OCR configuration fails closed and records only safe resolved provenance', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-cli-historical-config-'));
  try {
    const missing = resolve(root, 'missing.env');
    expect(() => resolveOcrVerificationConfiguration({
      currentCandidate: false,
      source: { GEMINI_API_KEY: 'not-returned' },
      historicalConfigPath: missing,
      historicalConfigPathExplicit: true,
    })).toThrow('historical_ocr_configuration_required');

    const insecure = resolve(root, 'insecure.env');
    writeFileSync(insecure, 'GEMINI_OCR_MODEL=gemini-3.8-flash\n', { mode: 0o644 });
    // chmod creates the intended unsafe fixture even under Nightly's umask 077.
    chmodSync(insecure, 0o644);
    expect(() => resolveOcrVerificationConfiguration({
      currentCandidate: false,
      source: {},
      historicalConfigPath: insecure,
      historicalConfigPathExplicit: true,
    })).toThrow('historical_ocr_configuration_invalid');

    const unpinned = resolve(root, 'unpinned.env');
    writeFileSync(unpinned, 'GEMINI_THINKING_LEVEL=MEDIUM\n', { mode: 0o600 });
    expect(() => resolveOcrVerificationConfiguration({
      currentCandidate: false,
      source: {},
      historicalConfigPath: unpinned,
      historicalConfigPathExplicit: true,
    })).toThrow('historical_ocr_model_required');

    const pinned = resolve(root, 'pinned.env');
    writeFileSync(pinned, [
      'GEMINI_OCR_DEFAULT_MODEL=gemini-3.8-flash',
      'GEMINI_THINKING_LEVEL=MEDIUM',
      '',
    ].join('\n'), { mode: 0o600 });
    const resolved = resolveOcrVerificationConfiguration({
      currentCandidate: false,
      source: { GEMINI_API_KEY: 'not-returned' },
      historicalConfigPath: pinned,
      historicalConfigPathExplicit: true,
    });
    expect(resolved.config).toEqual({
      GEMINI_OCR_DEFAULT_MODEL: 'gemini-3.8-flash',
      GEMINI_THINKING_LEVEL: 'MEDIUM',
    });
    expect(resolved.provenance).toEqual({
      settingsSource: 'historical-operating-snapshot',
      snapshotLocator: 'explicit-secure-snapshot',
      modelSettingSource: 'GEMINI_OCR_DEFAULT_MODEL',
      thinkingSettingSource: 'GEMINI_THINKING_LEVEL',
    });
    expect(JSON.stringify(resolved.provenance)).not.toContain('not-returned');
    expect(JSON.stringify(resolved.provenance)).not.toContain(root);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('OCR CLI rejects a missing historical snapshot before reserving evidence or accessing the provider', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-cli-historical-missing-'));
  try {
    const envFile = resolve(root, 'operator.env');
    const destination = resolve(root, 'run');
    const secret = 'synthetic-test-only';
    writeFileSync(envFile, `GEMINI_API_KEY=${secret}\n`, { mode: 0o600 });
    const result = invoke(scripts.ocr, envFile, ['--output-dir', destination], {
      TZUDONG_OCR_HISTORICAL_CONFIG_PATH: resolve(root, 'missing.env'),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('historical_ocr_configuration_required');
    expect(result.stderr).not.toContain(secret);
    expect(() => readFileSync(resolve(destination, 'ocr-live-readback.json'))).toThrow();
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('both live CLIs reject incomplete, duplicate, unknown, and excess options before reading credentials', () => {
  const cases = [
    [scripts.ocr, ['--unknown']],
    [scripts.ocr, ['--output-dir']],
    [scripts.ocr, ['--current-candidate-defaults', '--current-candidate-defaults']],
    [scripts.storyboard, ['--pro-image', '--pro-image']],
    [scripts.storyboard, ['--output-dir', '--pro-image']],
    [scripts.storyboard, ['unexpected-positional']],
  ] as const;
  for (const [script, args] of cases) {
    const result = invoke(script, nonexistentEnv, [...args]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('verification_arguments_invalid');
    expect(result.stderr).not.toContain('ENOENT');
  }
});

test('both live CLIs cannot write into the performance root or outside its evidence subdirectories', () => {
  for (const script of Object.values(scripts)) {
    for (const destination of ['performance', '../outside-gemini-verification']) {
      const result = invoke(script, nonexistentEnv, ['--output-dir', destination]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('verification_output_outside_performance');
      expect(result.stderr).not.toContain('ENOENT');
    }
  }
});

test('existing OCR and storyboard pending receipts remain byte-identical and block provider access', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-cli-pending-'));
  try {
    const original = '{"pending":"provider","generationCallsStarted":1,"passed":false}\n';
    const cases = [
      [scripts.ocr, 'ocr-live-readback.json', ['--current-candidate-defaults']],
      [scripts.storyboard, 'gemini-live-generation.json', []],
      [scripts.storyboard, 'gemini-live-pro-image.json', ['--pro-image']],
    ] as const;
    for (const [script, filename, flags] of cases) {
      const destination = resolve(root, filename.replace('.json', ''));
      mkdirSync(destination);
      const receipt = resolve(destination, filename);
      writeFileSync(receipt, original);
      const result = invoke(script, nonexistentEnv, [...flags, '--output-dir', destination]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('existing_receipt_requires_readback');
      expect(readFileSync(receipt, 'utf8')).toBe(original);
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('operator env must be an owner-only regular non-symlink file before provider modules load', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-cli-env-'));
  try {
    const envFile = resolve(root, 'operator.env');
    const envLink = resolve(root, 'operator-link.env');
    writeFileSync(envFile, 'GEMINI_API_KEY=synthetic-test-only\n', { mode: 0o600 });
    symlinkSync(envFile, envLink);

    const symlinkResult = invoke(scripts.storyboard, envLink, ['--output-dir', resolve(root, 'symlink-run')]);
    expect(symlinkResult.status).not.toBe(0);
    expect(symlinkResult.stderr).toContain('operator_env_file_invalid');

    chmodSync(envFile, 0o644);
    const modeResult = invoke(scripts.ocr, envFile, ['--current-candidate-defaults', '--output-dir', resolve(root, 'mode-run')]);
    expect(modeResult.status).not.toBe(0);
    expect(modeResult.stderr).toContain('operator_env_file_permissions_invalid');
    expect(modeResult.stderr).not.toContain('synthetic-test-only');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('storyboard refuses an earlier image before reservation or provider access', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-cli-image-'));
  try {
    const envFile = resolve(root, 'operator.env');
    const destination = resolve(root, 'run');
    const image = resolve(destination, 'gemini-live-image.jpg');
    writeFileSync(envFile, 'GEMINI_API_KEY=synthetic-test-only\n', { mode: 0o600 });
    mkdirSync(destination);
    writeFileSync(image, 'historical-image');
    const result = invoke(scripts.storyboard, envFile, ['--output-dir', destination]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('existing_artifact_requires_readback');
    expect(result.stderr).not.toContain('synthetic-test-only');
    expect(readFileSync(image, 'utf8')).toBe('historical-image');
    expect(() => readFileSync(resolve(destination, 'gemini-live-generation.json'))).toThrow();
  } finally {
    rmSync(root, { recursive: true });
  }
});

test.each([
  ['timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
  ['rejection', () => Promise.reject(new Error('metadata unavailable'))],
] as const)('OCR metadata %s records no generation admission or delivery uncertainty', async (_name, getModel) => {
  const state = createOcrGeminiLiveAttemptState();
  const persisted: Array<Readonly<typeof state>> = [];
  recordModelMetadataRequest(state, (next) => persisted.push({ ...next }));

  await expect(getModel()).rejects.toBeTruthy();
  expect(state).toEqual({
    generationCallsStarted: 0,
    generationRequestsAdmitted: 0,
    providerRequestsStarted: 1,
  });
  expect(isGenerationDeliveryUnknown(state)).toBe(false);
  expect(persisted).toEqual([{ ...state }]);
});

test('OCR metadata with the wrong model identity records no generation admission or delivery uncertainty', () => {
  const state = createOcrGeminiLiveAttemptState();
  recordModelMetadataRequest(state, () => {});

  expect(() => assertExpectedModelIdentity('models/not-the-configured-model', 'gemini-3.8-flash'))
    .toThrow('model_identity_mismatch');
  expect(state.generationCallsStarted).toBe(0);
  expect(state.generationRequestsAdmitted).toBe(0);
  expect(state.providerRequestsStarted).toBe(1);
  expect(isGenerationDeliveryUnknown(state)).toBe(false);
});

test('OCR generation failure is delivery-unknown only after the durable generation admission', async () => {
  const state = createOcrGeminiLiveAttemptState();
  const events: string[] = [];
  const persist = (next: Readonly<typeof state>) => {
    events.push(`persist:${next.generationRequestsAdmitted}`);
  };
  recordModelMetadataRequest(state, persist);
  assertExpectedModelIdentity('models/gemini-3.8-flash', 'gemini-3.8-flash');
  recordGenerationCallStarted(state, persist);

  await expect(invokeAdmittedGeneration(state, persist, async () => {
    events.push('provider');
    throw new Error('generation response lost');
  })).rejects.toThrow('generation response lost');
  expect(events).toEqual(['persist:0', 'persist:0', 'persist:1', 'provider']);
  expect(state).toEqual({
    generationCallsStarted: 1,
    generationRequestsAdmitted: 1,
    providerRequestsStarted: 2,
  });
  expect(isGenerationDeliveryUnknown(state)).toBe(true);
});

test('OCR generation is not invoked when durable admission persistence fails', async () => {
  const state = createOcrGeminiLiveAttemptState();
  recordModelMetadataRequest(state, () => {});
  recordGenerationCallStarted(state, () => {});
  let providerCalls = 0;

  await expect(invokeAdmittedGeneration(state, () => {
    throw new Error('receipt_fsync_failed');
  }, async () => {
    providerCalls += 1;
    return 'unreachable';
  })).rejects.toThrow('receipt_fsync_failed');
  expect(providerCalls).toBe(0);
  expect(state.generationRequestsAdmitted).toBe(0);
  expect(state.providerRequestsStarted).toBe(1);
  expect(isGenerationDeliveryUnknown(state)).toBe(false);
});
