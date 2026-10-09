import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const webRoot = resolve(import.meta.dir, '..');
const script = resolve(webRoot, 'scripts/verify-ocr-gemini-live.ts');
const nonexistentEnv = '/unused-ocr-verification-operator.env';
function invoke(args: string[]) {
  return spawnSync(process.execPath, ['run', script, nonexistentEnv, ...args], {
    cwd: webRoot, encoding: 'utf8', timeout: 15_000,
  });
}

test('rejects unknown or incomplete options before reading credentials or contacting the provider', () => {
  for (const args of [['--unknown'], ['--output-dir']]) {
    const result = invoke(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('verification_arguments_invalid');
    expect(result.stderr).not.toContain('ENOENT');
  }
});

test('cannot write into the performance root or outside its evidence subdirectories', () => {
  for (const destination of ['performance', '../outside-ocr-verification']) {
    const result = invoke(['--output-dir', destination]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('verification_output_outside_performance');
    expect(result.stderr).not.toContain('ENOENT');
  }
});

test('an existing uncertain receipt remains byte-identical and blocks a new provider attempt', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/ocr-cli-boundary-'));
  try {
    const destination = resolve(root, 'run');
    mkdirSync(destination);
    const receipt = resolve(destination, 'ocr-live-readback.json');
    const original = '{"pending":"provider","callsStarted":1,"passed":false}\n';
    writeFileSync(receipt, original);
    const result = invoke(['--current-candidate-defaults', '--output-dir', destination]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('existing_receipt_requires_readback');
    expect(result.stderr).not.toContain('ENOENT');
    expect(readFileSync(receipt, 'utf8')).toBe(original);
  } finally {
    rmSync(root, { recursive: true });
  }
});
