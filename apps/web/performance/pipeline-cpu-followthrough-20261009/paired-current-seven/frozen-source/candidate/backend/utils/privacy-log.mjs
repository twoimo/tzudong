const DEFAULT_MAX_LENGTH = 4_096;
const REDACTED = '[REDACTED]';
const BOUNDED = '[TRUNCATED]';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi;
const SECRET_QUERY = /([?&;](?:api[_-]?key|access[_-]?key|password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session(?:[_-]?id)?|sid|authorization|credential|service[_-]?role|private[_-]?key)=)[^&#\s]*/gi;
const BEARER = /\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const CREDENTIAL = /\b(?:password|passwd|pwd|passphrase|secret|credentials?|api[_-]?key|access[_-]?key|authorization|client[_-]?secret|service[_-]?role(?:[_-]?key)?|private[_-]?key|token|cookie|session(?:[_-]?id)?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}&\]]+)/gi;
const JWT = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const RRN = /(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(^|[^\d])(?:\+?82[-.\s]?)?(?:0?1[016789]|0?2|0?[3-6][1-5]|0?70)[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/gm;
const LOCATION = /(?:\b(?:lat|latitude|lng|lon|longitude|coordinates?|coords?)\b|위도|경도|좌표)\s*[:=]\s*\(?\s*-?\d{1,3}(?:\.\d+)?(?:\s*[,/]\s*-?\d{1,3}(?:\.\d+)?)?\s*\)?/gi;
const RAW_OCR = /\b(?:raw[_\s-]?ocr|ocr[_\s-]?(?:raw|text|result|content))\s*[:=]\s*(?:"[^"]*"|'[^']*'|.*)$/gim;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const SAFE_ERROR_CODE = /^(?:[A-Z][A-Z0-9_]{1,79}|\d{3,5}|[a-z][a-z0-9_]{2,79})$/;

function ownString(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function ownHttpStatus(value) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'status');
    if (!descriptor || !('value' in descriptor)) return null;
    const status = descriptor.value;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return `HTTP_${status}`;
    }
    if (typeof status === 'string' && /^\d{3}$/.test(status)) {
      return `HTTP_${status}`;
    }
  } catch {
    return null;
  }
  return null;
}

function boundedLength(value) {
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, DEFAULT_MAX_LENGTH)
    : DEFAULT_MAX_LENGTH;
}

export function redactLogText(value, maxLength = DEFAULT_MAX_LENGTH) {
  const limit = boundedLength(maxLength);
  if (typeof value !== 'string') return '[REDACTED:non_text]'.slice(0, limit);
  if (value.length > limit) return BOUNDED.slice(0, limit);

  const redacted = value
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(PRIVATE_KEY, REDACTED)
    .replace(SECRET_QUERY, `$1${REDACTED}`)
    .replace(RAW_OCR, REDACTED)
    .replace(RRN, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, (_, prefix = '') => `${prefix}${REDACTED}`)
    .replace(LOCATION, REDACTED)
    .replace(BEARER, REDACTED)
    .replace(CREDENTIAL, REDACTED)
    .replace(JWT, REDACTED);

  return redacted.length > limit ? BOUNDED.slice(0, limit) : redacted;
}

export function safeErrorName(error) {
  const name = ownString(error, 'name');
  if (name && SAFE_ERROR_NAME.test(name)) return name;
  try {
    return error instanceof Error ? 'Error' : 'backend_error';
  } catch {
    return 'backend_error';
  }
}

export function logSafeError(error, write = (line) => process.stderr.write(line)) {
  const name = safeErrorName(error);
  const ownCode = ownString(error, 'code');
  const message = typeof error?.message === 'string' ? error.message : '';
  const messageCode = SAFE_ERROR_CODE.test(message) ? message : null;
  const code = (ownCode && SAFE_ERROR_CODE.test(ownCode) ? ownCode : null)
    || ownHttpStatus(error)
    || messageCode;
  const line = `error=${name}${code ? ` code=${code}` : ''}\n`;
  write(line);
  return line;
}
