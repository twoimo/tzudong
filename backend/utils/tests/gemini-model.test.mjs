import assert from 'node:assert/strict';
import test from 'node:test';

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_GEMINI_MODEL, migrateDeprecatedGeminiModel, assertSupportedGeminiThinking, resolveGeminiModel } from '../gemini-model.mjs';

test('accepts canonical Gemini model identifiers and applies the fixed fallback', () => {
  assert.equal(resolveGeminiModel(undefined), 'gemini-3.8-flash');
  assert.equal(resolveGeminiModel(' gemini-3.7-flash '), 'gemini-3.8-flash');
  assert.equal(resolveGeminiModel('models/gemini-3.7-flash'), 'gemini-3.8-flash');
  assert.equal(resolveGeminiModel(undefined, 'gemini-3.7-flash'), 'gemini-3.8-flash');
  assert.equal(resolveGeminiModel(' gemini-2.5-flash '), 'gemini-2.5-flash');
  assert.equal(resolveGeminiModel('gemini-exp-1206'), 'gemini-exp-1206');
});

test('legacy model compatibility preserves other families and explicit revisions across JS, Python, and shell', () => {
  const backend = fileURLToPath(new URL('../../', import.meta.url));
  const shell = fileURLToPath(new URL('../gemini-model.sh', import.meta.url));
  for (const model of ['gemini-3.7-flash', 'models/gemini-3.7-flash', DEFAULT_GEMINI_MODEL,
    'gemini-2.5-flash', 'gemini-3-pro-image', 'gemini-3.7-flash-001', 'gemini-3.7-flash-lite']) {
    const expected = ['gemini-3.7-flash', 'models/gemini-3.7-flash'].includes(model) ? DEFAULT_GEMINI_MODEL : model;
    assert.equal(migrateDeprecatedGeminiModel(model), expected);
    const env = { PATH: process.env.PATH, FX_MODEL: model, PYTHONPATH: backend };
    const pythonResult = execFileSync(process.env.RUN_DAILY_PYTHON || 'python3', ['-c',
      'import os; from utils.gemini_model import migrate_deprecated_gemini_model; print(migrate_deprecated_gemini_model(os.environ["FX_MODEL"]))'], { env, encoding: 'utf8' }).trim();
    assert.equal(pythonResult, expected);
    const shellResult = execFileSync('bash', ['-c',
      'source "$1"; PRIMARY_MODEL="$FX_MODEL"; FALLBACK_MODEL="$FX_MODEL"; WEB_GEMINI_MODEL="$FX_MODEL"; TZUDONG_STAGE_CURRENT_MODEL="$FX_MODEL"; migrate_deprecated_gemini_model_vars PRIMARY_MODEL FALLBACK_MODEL WEB_GEMINI_MODEL TZUDONG_STAGE_CURRENT_MODEL; printf "%s\\n" "$PRIMARY_MODEL" "$FALLBACK_MODEL" "$WEB_GEMINI_MODEL" "$TZUDONG_STAGE_CURRENT_MODEL"', '_', shell], { env, encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(shellResult, Array(4).fill(expected));
  }
});

test('unsupported 3.8 thinking rejects legacy overrides while supported levels and older models remain usable', () => {
  for (const model of ['gemini-3.7-flash', 'models/gemini-3.7-flash', DEFAULT_GEMINI_MODEL, 'models/gemini-3.8-flash-001']) {
    for (const level of ['MINIMAL', 'minimal', ' minimal '])
      assert.throws(() => assertSupportedGeminiThinking(model, level), { code: 'GEMINI_THINKING_LEVEL_UNSUPPORTED' });
    for (const level of ['LOW', 'MEDIUM', 'HIGH', undefined])
      assert.doesNotThrow(() => assertSupportedGeminiThinking(model, level));
  }
  assert.doesNotThrow(() => assertSupportedGeminiThinking('gemini-2.5-flash', 'MINIMAL'));
});

test('rejects shell syntax, paths, controls, flags, and non-Gemini identifiers', () => {
  for (const value of [
    'gemini-2.5-flash; touch sentinel',
    'gemini-2.5-flash$(whoami)',
    'gemini-2.5-flash && calc',
    '../gemini-2.5-flash',
    '--help',
    'other-provider-model',
    'gemini-2.5-flash\n--yolo',
    `gemini-${'x'.repeat(100)}`,
  ]) {
    assert.throws(
      () => resolveGeminiModel(value),
      (error) => error?.code === 'GEMINI_MODEL_INVALID' && error.message === 'GEMINI_MODEL_INVALID',
      value,
    );
  }
});
