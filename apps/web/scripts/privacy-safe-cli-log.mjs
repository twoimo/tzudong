const CLASS_CODE_PATTERN = /^[a-z][a-z0-9_]{2,79}$/;
const STATUS_PATTERN = /^(?:applied|skipped|failed)$/;

const DEFAULT_MAX_CLI_TEXT_LENGTH = 1_024;
const REDACTED = (kind) => `[REDACTED:${kind}]`;
const boundedMarker = (limit) => REDACTED('bounded').slice(0, limit);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;
const RRN_PATTERN = /\b\d{6}[-\s]?[1-8]\d{6}\b/g;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const KOREAN_PHONE_PATTERN =
  /(?:^|[^\d])(?:\+?82[-.\s]?)?(?:0?1[016789]|0?2|0?[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/gm;
const PHONE_PATTERN =
  /(^|[^\d])(?:\+\d{1,3}(?:[-.\s]?\(?\d{1,4}\)?){2,4}|\d{2,4}[-.\s]\d{3,4}[-.\s]\d{4})(?!\d)/g;
const SECRET_URL_PATTERN =
  /\b(?:https?|wss?):\/\/[^\s"'<>]*[?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|jwt|api[_-]?key|key|secret|password|passphrase|credential|authorization|cookie|session(?:[_-]?(?:id|token|key|secret))?|onboarding(?:[_-]?(?:token|session|state|code|value))?|challenge|(?:supabase[_-]?)?service(?:[_-]?(?:role|key))(?:[_-]?key)?)=[^\s"'<>]*/gi;
const CREDENTIAL_PATTERN =
  /\b(?:password|passphrase|secret|credentials?|api[_-]?key|access[_-]?key|authorization|client[_-]?secret|(?:supabase[_-]?)?service(?:[_-]?(?:role|key))(?:[_-]?key)?|private[_-]?key)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&\]]+)/gi;
const BEARER_TOKEN_PATTERN = /\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const COMPACT_JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const TOKEN_PATTERN =
  /\b(?:access|refresh|id)?[_-]?(?:token|jwt)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&\]]+)/gi;
const COOKIE_PATTERN =
  /\b(?:set[_-]?cookie|cookie)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&\]]+)/gi;
const SESSION_PATTERN =
  /\b(?:session(?:[_-]?(?:id|token|key|secret))?|onboarding(?:[_-]?(?:token|session|state|code|value))?|challenge)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&\]]+)/gi;
const COORDINATE_PATTERN =
  /(?:\b(?:lat|latitude|lng|lon|longitude|coordinates?|coords?)\b|위도|경도|좌표)["']?\s*[:=]\s*\(?\s*-?\d{1,3}(?:\.\d+)?(?:\s*[,/]\s*-?\d{1,3}(?:\.\d+)?)?\s*\)?/gi;
const RAW_OCR_PATTERN =
  /\b(?:raw[_\s-]?ocr|ocr[_\s-]?(?:raw|text|result))(?:\s+(?:text|result))?["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|.*)$/gi;
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const SAFE_ERROR_CODE_PATTERN = /^(?:[A-Z][A-Z0-9_]{1,79}|TS\d{1,6}|\d{5}|[a-z][a-z0-9_]{2,79})$/;

const boundedCliTextLength = (value) => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, DEFAULT_MAX_CLI_TEXT_LENGTH)
    : DEFAULT_MAX_CLI_TEXT_LENGTH
);

const ownDataString = (value, key) => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return null;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
};

const nativeErrorName = (error) => {
  try {
    if (error instanceof AggregateError) return 'AggregateError';
    if (error instanceof EvalError) return 'EvalError';
    if (error instanceof RangeError) return 'RangeError';
    if (error instanceof ReferenceError) return 'ReferenceError';
    if (error instanceof SyntaxError) return 'SyntaxError';
    if (error instanceof TypeError) return 'TypeError';
    if (error instanceof URIError) return 'URIError';
    if (error instanceof Error) return 'Error';
  } catch {
    // A proxy can reject identity checks; do not inspect it further.
  }

  return 'cli_error';
};

const safeCliErrorCode = (error) => {
  const code = ownDataString(error, 'code');
  return code && SAFE_ERROR_CODE_PATTERN.test(code) ? code : null;
};

const boundedCount = (value) => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
);
/**
 * Redacts untrusted CLI text without coercing non-text values or retaining
 * unbounded diagnostics.
 */
export const redactCliText = (value, maxLength = DEFAULT_MAX_CLI_TEXT_LENGTH) => {
  const limit = boundedCliTextLength(maxLength);
  if (typeof value !== 'string') return REDACTED('non_text').slice(0, limit);
  if (value.length > limit) return boundedMarker(limit);

  const redacted = value
    .replace(CONTROL_CHARACTER_PATTERN, ' ')
    .replace(SECRET_URL_PATTERN, REDACTED('secret_url'))
    .replace(RAW_OCR_PATTERN, REDACTED('raw_ocr'))
    .replace(RRN_PATTERN, REDACTED('rrn'))
    .replace(EMAIL_PATTERN, REDACTED('email'))
    .replace(KOREAN_PHONE_PATTERN, (_, prefix = '') => `${prefix}${REDACTED('phone')}`)
    .replace(PHONE_PATTERN, (_, prefix) => `${prefix}${REDACTED('phone')}`)
    .replace(COORDINATE_PATTERN, REDACTED('precise_location'))
    .replace(BEARER_TOKEN_PATTERN, REDACTED('token'))
    .replace(CREDENTIAL_PATTERN, REDACTED('credential'))
    .replace(COMPACT_JWT_PATTERN, REDACTED('token'))
    .replace(TOKEN_PATTERN, REDACTED('token'))
    .replace(COOKIE_PATTERN, REDACTED('cookie'))
    .replace(SESSION_PATTERN, REDACTED('session'));

  return redacted.length > limit ? boundedMarker(limit) : redacted;
};

/** Returns a bounded identifier without reading an exception diagnostic. */
export const safeCliErrorName = (error) => {
  const name = ownDataString(error, 'name');
  return name && SAFE_ERROR_NAME_PATTERN.test(name) ? name : nativeErrorName(error);
};

/** Emits only a safe error identifier and an allowlisted machine-readable code. */
export const logCliError = (error, write = (line) => process.stderr.write(line)) => {
  const name = safeCliErrorName(error);
  const code = safeCliErrorCode(error);
  const line = `error=${name}${code ? ` code=${code}` : ''}\n`;

  write(line);
  return line;
};

/** Emits only retention class, status, and aggregate counts. */
export const privacySafeCliLog = (entry, write = (line) => process.stdout.write(line)) => {
  const classCode = typeof entry?.classCode === 'string' && CLASS_CODE_PATTERN.test(entry.classCode)
    ? entry.classCode
    : 'scheduler';
  const status = typeof entry?.status === 'string' && STATUS_PATTERN.test(entry.status)
    ? entry.status
    : 'failed';
  const eligible = boundedCount(entry?.eligible);
  const held = boundedCount(entry?.held);
  const scanned = boundedCount(entry?.scanned);

  write(`classCode=${classCode} status=${status} eligible=${eligible} held=${held} scanned=${scanned}\n`);
};
