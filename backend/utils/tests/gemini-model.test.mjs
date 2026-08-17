import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveGeminiModel } from '../gemini-model.mjs';

test('accepts canonical Gemini model identifiers and applies the fixed fallback', () => {
  assert.equal(resolveGeminiModel(undefined), 'gemini-3.7-flash');
  assert.equal(resolveGeminiModel(' gemini-2.5-flash '), 'gemini-2.5-flash');
  assert.equal(resolveGeminiModel('gemini-exp-1206'), 'gemini-exp-1206');
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
