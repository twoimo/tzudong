const GEMINI_MODEL_PATTERN = /^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MAX_GEMINI_MODEL_LENGTH = 80;
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

// Match Google's announced redirect without changing other model families or revisions.
export function migrateDeprecatedGeminiModel(value) {
  if (typeof value !== 'string') return value;
  const id = value.trim().replace(/^models\//, '');
  return id === 'gemini-3.7-flash' ? DEFAULT_GEMINI_MODEL : value;
}

function fixedModelError() {
  const error = new Error('GEMINI_MODEL_INVALID');
  error.code = 'GEMINI_MODEL_INVALID';
  return error;
}

export function assertSupportedGeminiThinking(model, thinkingLevel) {
  const value = migrateDeprecatedGeminiModel(model);
  const id = typeof value === 'string' ? value.replace(/^models\//, '') : '';
  if (/^gemini-3\.8-flash(?:-[0-9]{3})?$/.test(id)
      && String(thinkingLevel || '').trim().toUpperCase() === 'MINIMAL') {
    throw Object.assign(new Error('GEMINI_THINKING_LEVEL_UNSUPPORTED'), { code: 'GEMINI_THINKING_LEVEL_UNSUPPORTED' });
  }
}

export function resolveGeminiModel(value, fallback = DEFAULT_GEMINI_MODEL) {
  const candidate = migrateDeprecatedGeminiModel(typeof value === 'string' && value.trim() ? value.trim() : fallback);
  if (
    typeof candidate !== 'string'
    || candidate.length > MAX_GEMINI_MODEL_LENGTH
    || !GEMINI_MODEL_PATTERN.test(candidate)
  ) {
    throw fixedModelError();
  }
  return candidate;
}
