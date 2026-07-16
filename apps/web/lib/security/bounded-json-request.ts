export const BOUNDED_JSON_REQUEST_ERROR = {
  unsupportedMediaType: 'UNSUPPORTED_MEDIA_TYPE',
  invalidContentLength: 'INVALID_CONTENT_LENGTH',
  bodyTooLarge: 'BODY_TOO_LARGE',
  invalidJson: 'INVALID_JSON',
} as const;

export const BOUNDED_JSON_REQUEST_READ_TIMEOUT_MS = 1_000;

const CANCELLATION_TIMEOUT_MS = 25;

type BoundedJsonRequestErrorCode =
  typeof BOUNDED_JSON_REQUEST_ERROR[keyof typeof BOUNDED_JSON_REQUEST_ERROR];

type BoundedJsonRequestFailure = {
  ok: false;
  code: BoundedJsonRequestErrorCode;
};

type ReadOutcome =
  | { kind: 'read'; result: ReadableStreamReadResult<Uint8Array> }
  | { kind: 'aborted' }
  | { kind: 'timedOut' }
  | { kind: 'failed' };

type JsonCursor = {
  source: string;
  index: number;
};

export type BoundedJsonRequestResult =
  | { ok: true; value: unknown }
  | BoundedJsonRequestFailure;

function failure(code: BoundedJsonRequestErrorCode): BoundedJsonRequestFailure {
  return { ok: false, code };
}

function isJsonMediaType(value: string | null): boolean {
  if (!value) return false;

  const parts = value.split(';');
  if (parts[0]?.trim().toLowerCase() !== 'application/json') return false;
  if (parts.length === 1) return true;
  if (parts.length !== 2) return false;

  return /^charset\s*=\s*(?:utf-8|"utf-8")\s*$/i.test(parts[1]?.trim() ?? '');
}

function declaredLengthExceedsMaximum(value: string, maximumBytes: number): boolean {
  const normalizedLength = value.replace(/^0+/, '') || '0';
  const normalizedMaximum = String(maximumBytes);
  return normalizedLength.length > normalizedMaximum.length
    || (normalizedLength.length === normalizedMaximum.length && normalizedLength > normalizedMaximum);
}

function contentLengthResult(
  value: string | null,
  maximumBytes: number,
): BoundedJsonRequestFailure | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    return failure(BOUNDED_JSON_REQUEST_ERROR.invalidContentLength);
  }
  if (declaredLengthExceedsMaximum(value, maximumBytes)) {
    return failure(BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge);
  }

  const declaredLength = Number(value);
  if (!Number.isSafeInteger(declaredLength)) {
    return failure(BOUNDED_JSON_REQUEST_ERROR.invalidContentLength);
  }

  return null;
}

async function settleCancellation(cancel: () => Promise<unknown> | unknown) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(cancel()),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, CANCELLATION_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Fixed failures must not depend on cancellation behavior.
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function cancelBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) return;
  await settleCancellation(() => body.cancel());
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  await settleCancellation(() => reader.cancel());
}

async function failAfterBody(
  body: ReadableStream<Uint8Array> | null,
  code: BoundedJsonRequestErrorCode,
): Promise<BoundedJsonRequestResult> {
  await cancelBody(body);
  return failure(code);
}

async function failAfterReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  code: BoundedJsonRequestErrorCode,
): Promise<BoundedJsonRequestResult> {
  await cancelReader(reader);
  return failure(code);
}

async function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<ReadOutcome> {
  if (signal?.aborted) return { kind: 'aborted' };

  const remaining = deadline - Date.now();
  if (remaining <= 0) return { kind: 'timedOut' };

  let read: Promise<ReadOutcome>;
  try {
    read = reader.read().then(
      (result): ReadOutcome => ({ kind: 'read', result }),
      (): ReadOutcome => ({ kind: 'failed' }),
    );
  } catch {
    return { kind: 'failed' };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timedOut = new Promise<ReadOutcome>((resolve) => {
    timeout = setTimeout(() => resolve({ kind: 'timedOut' }), remaining);
  });
  const aborted = new Promise<ReadOutcome>((resolve) => {
    if (!signal) return;
    onAbort = () => resolve({ kind: 'aborted' });
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([read, timedOut, aborted]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

function invalidJson(): never {
  throw new SyntaxError();
}

function skipJsonWhitespace(cursor: JsonCursor) {
  while (true) {
    const character = cursor.source[cursor.index];
    if (character !== ' ' && character !== '\n' && character !== '\r' && character !== '\t') return;
    cursor.index += 1;
  }
}

function isJsonDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function parseJsonString(cursor: JsonCursor): string {
  if (cursor.source[cursor.index] !== '"') invalidJson();
  cursor.index += 1;

  let decoded = '';
  while (cursor.index < cursor.source.length) {
    const character = cursor.source[cursor.index] as string;
    cursor.index += 1;

    if (character === '"') return decoded;
    if (character === '\\') {
      const escape = cursor.source[cursor.index];
      cursor.index += 1;
      switch (escape) {
        case '"':
        case '\\':
        case '/':
          decoded += escape;
          break;
        case 'b':
          decoded += '\b';
          break;
        case 'f':
          decoded += '\f';
          break;
        case 'n':
          decoded += '\n';
          break;
        case 'r':
          decoded += '\r';
          break;
        case 't':
          decoded += '\t';
          break;
        case 'u': {
          const hexadecimal = cursor.source.slice(cursor.index, cursor.index + 4);
          if (!/^[0-9a-f]{4}$/i.test(hexadecimal)) invalidJson();
          decoded += String.fromCharCode(Number.parseInt(hexadecimal, 16));
          cursor.index += 4;
          break;
        }
        default:
          invalidJson();
      }
      continue;
    }

    if (character.charCodeAt(0) < 0x20) invalidJson();
    decoded += character;
  }

  return invalidJson();
}

function parseJsonNumber(cursor: JsonCursor) {
  if (cursor.source[cursor.index] === '-') cursor.index += 1;

  const firstDigit = cursor.source[cursor.index];
  if (firstDigit === '0') {
    cursor.index += 1;
    if (isJsonDigit(cursor.source[cursor.index])) invalidJson();
  } else if (firstDigit !== undefined && firstDigit >= '1' && firstDigit <= '9') {
    cursor.index += 1;
    while (isJsonDigit(cursor.source[cursor.index])) cursor.index += 1;
  } else {
    invalidJson();
  }

  if (cursor.source[cursor.index] === '.') {
    cursor.index += 1;
    if (!isJsonDigit(cursor.source[cursor.index])) invalidJson();
    while (isJsonDigit(cursor.source[cursor.index])) cursor.index += 1;
  }

  const exponent = cursor.source[cursor.index];
  if (exponent === 'e' || exponent === 'E') {
    cursor.index += 1;
    const sign = cursor.source[cursor.index];
    if (sign === '+' || sign === '-') cursor.index += 1;
    if (!isJsonDigit(cursor.source[cursor.index])) invalidJson();
    while (isJsonDigit(cursor.source[cursor.index])) cursor.index += 1;
  }
}

function parseJsonLiteral(cursor: JsonCursor, literal: 'true' | 'false' | 'null') {
  if (!cursor.source.startsWith(literal, cursor.index)) invalidJson();
  cursor.index += literal.length;
}

function parseJsonArray(cursor: JsonCursor, nesting: number) {
  cursor.index += 1;
  skipJsonWhitespace(cursor);
  if (cursor.source[cursor.index] === ']') {
    cursor.index += 1;
    return;
  }

  while (true) {
    parseJsonValue(cursor, nesting);
    skipJsonWhitespace(cursor);

    const separator = cursor.source[cursor.index];
    cursor.index += 1;
    if (separator === ']') return;
    if (separator !== ',') invalidJson();
    skipJsonWhitespace(cursor);
  }
}

function parseJsonObject(cursor: JsonCursor, nesting: number) {
  cursor.index += 1;
  skipJsonWhitespace(cursor);
  if (cursor.source[cursor.index] === '}') {
    cursor.index += 1;
    return;
  }

  const memberNames = new Set<string>();
  while (true) {
    skipJsonWhitespace(cursor);
    const memberName = parseJsonString(cursor);
    if (memberNames.has(memberName)) invalidJson();
    memberNames.add(memberName);

    skipJsonWhitespace(cursor);
    if (cursor.source[cursor.index] !== ':') invalidJson();
    cursor.index += 1;
    parseJsonValue(cursor, nesting);
    skipJsonWhitespace(cursor);

    const separator = cursor.source[cursor.index];
    cursor.index += 1;
    if (separator === '}') return;
    if (separator !== ',') invalidJson();
    skipJsonWhitespace(cursor);
  }
}

function parseJsonValue(cursor: JsonCursor, nesting: number) {
  skipJsonWhitespace(cursor);
  const character = cursor.source[cursor.index];
  switch (character) {
    case '{':
      parseJsonObject(cursor, nesting + 1);
      return;
    case '[':
      parseJsonArray(cursor, nesting + 1);
      return;
    case '"':
      parseJsonString(cursor);
      return;
    case 't':
      parseJsonLiteral(cursor, 'true');
      return;
    case 'f':
      parseJsonLiteral(cursor, 'false');
      return;
    case 'n':
      parseJsonLiteral(cursor, 'null');
      return;
    default:
      parseJsonNumber(cursor);
  }
}

function validateJsonWithoutDuplicateMembers(source: string) {
  const cursor = { source, index: 0 };
  parseJsonValue(cursor, 0);
  skipJsonWhitespace(cursor);
  if (cursor.index !== source.length) invalidJson();
}

export async function readBoundedJsonRequest(
  request: Request,
  maximumBytes: number,
): Promise<BoundedJsonRequestResult> {
  const bodyReadDeadline = Date.now() + BOUNDED_JSON_REQUEST_READ_TIMEOUT_MS;
  const body = request.body;

  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    return failAfterBody(body, BOUNDED_JSON_REQUEST_ERROR.invalidJson);
  }
  if (!isJsonMediaType(request.headers.get('content-type'))) {
    return failAfterBody(body, BOUNDED_JSON_REQUEST_ERROR.unsupportedMediaType);
  }

  const declaredLengthHeader = request.headers.get('content-length');
  const contentLengthError = contentLengthResult(declaredLengthHeader, maximumBytes);
  if (contentLengthError) {
    return failAfterBody(body, contentLengthError.code);
  }
  const declaredLength = declaredLengthHeader === null ? null : Number(declaredLengthHeader);
  if (!body) return failure(BOUNDED_JSON_REQUEST_ERROR.invalidJson);
  if (request.signal?.aborted) {
    return failAfterBody(body, BOUNDED_JSON_REQUEST_ERROR.invalidJson);
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    return failAfterBody(body, BOUNDED_JSON_REQUEST_ERROR.invalidJson);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const outcome = await readWithDeadline(reader, request.signal, bodyReadDeadline);
      if (outcome.kind !== 'read' || request.signal?.aborted) {
        return failAfterReader(reader, BOUNDED_JSON_REQUEST_ERROR.invalidJson);
      }

      const { done, value } = outcome.result;
      if (done) break;
      if (!value) {
        return failAfterReader(reader, BOUNDED_JSON_REQUEST_ERROR.invalidJson);
      }

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        return failAfterReader(reader, BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge);
      }
      chunks.push(value);
    }

    if (Date.now() >= bodyReadDeadline || request.signal?.aborted) {
      return failAfterReader(reader, BOUNDED_JSON_REQUEST_ERROR.invalidJson);
    }
    if (declaredLength !== null && totalBytes !== declaredLength) {
      return failAfterReader(reader, BOUNDED_JSON_REQUEST_ERROR.invalidContentLength);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      validateJsonWithoutDuplicateMembers(source);
      return { ok: true, value: JSON.parse(source) as unknown };
    } catch {
      return failAfterReader(reader, BOUNDED_JSON_REQUEST_ERROR.invalidJson);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A read or cancellation can remain pending after the bounded cleanup window.
    }
  }
}
