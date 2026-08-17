const GEMINI_MODEL_PATTERN = /^gemini-[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MAX_GEMINI_MODEL_LENGTH = 80;

function fixedModelError() {
  const error = new Error('GEMINI_MODEL_INVALID');
  error.code = 'GEMINI_MODEL_INVALID';
  return error;
}

export function resolveGeminiModel(value, fallback = 'gemini-3.7-flash') {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  if (
    typeof candidate !== 'string'
    || candidate.length > MAX_GEMINI_MODEL_LENGTH
    || !GEMINI_MODEL_PATTERN.test(candidate)
  ) {
    throw fixedModelError();
  }
  return candidate;
}
