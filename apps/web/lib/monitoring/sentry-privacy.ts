import type { ErrorEvent, EventHint, StackFrame, getClient } from '@sentry/nextjs';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';

type SentryClient = NonNullable<ReturnType<typeof getClient>>;
type SentryTransport = NonNullable<ReturnType<SentryClient['getTransport']>>;
export type SentryTransportEnvelope = Parameters<SentryTransport['send']>[0];

const ERROR_TYPES = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError']);

export function safeErrorType(value: unknown): string {
  return typeof value === 'string' && ERROR_TYPES.has(value) ? value : 'Error';
}

function safeFrame(frame: StackFrame): StackFrame {
  const raw = frame.filename && frame.filename.length <= 1024 ? frame.filename.split(/[?#]/, 1)[0] : '';
  const match = raw.match(/(?:^|\/)((?:_next\/static|app|components|lib|hooks|contexts|integrations)\/[a-zA-Z0-9_./()\[\]-]{1,240}\.(?:js|mjs|cjs|ts|tsx))$/);
  const filename = match && !match[1].includes('..') ? match[1] : undefined;
  const functionName = frame.function && /^[a-zA-Z_$][a-zA-Z0-9_.$<> ]{0,95}$/.test(frame.function)
    ? frame.function : undefined;
  return {
    ...(filename ? { filename } : {}),
    ...(functionName ? { function: functionName } : {}),
    ...(Number.isSafeInteger(frame.lineno) && frame.lineno! > 0 ? { lineno: frame.lineno } : {}),
    ...(Number.isSafeInteger(frame.colno) && frame.colno! >= 0 ? { colno: frame.colno } : {}),
    ...(typeof frame.in_app === 'boolean' ? { in_app: frame.in_app } : {}),
  };
}

/** Rebuild an allowlisted event; SDK defaults or future enrichment cannot leak request/AI data. */
export function sanitizeSentryEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  try {
    if (hint) hint.attachments = [];
    const values = event.exception?.values?.slice(-5).map((exception) => ({
      type: safeErrorType(exception.type),
      value: `${safeErrorType(exception.type)} captured`,
      ...(exception.stacktrace?.frames ? {
        stacktrace: { frames: exception.stacktrace.frames.slice(-40).map(safeFrame) },
      } : {}),
      ...(exception.mechanism ? {
        mechanism: { type: 'generic', handled: exception.mechanism.handled === true },
      } : {}),
    }));
    const safe: ErrorEvent = {
      type: undefined,
      ...(event.event_id && /^[a-f0-9]{32}$/i.test(event.event_id) ? { event_id: event.event_id } : {}),
      ...(typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
      platform: 'javascript',
      level: event.level === 'fatal' ? 'fatal' : 'error',
      ...(event.release && /^[a-f0-9]{7,40}$/i.test(event.release) ? { release: event.release } : {}),
      ...(event.environment && ['production', 'preview', 'development', 'test'].includes(event.environment) ? { environment: event.environment } : {}),
      ...(values?.length ? { exception: { values } } : { message: 'Application error' }),
    };
    assertPrivacySafe(safe, { maxEntries: 1000 });
    return safe;
  } catch {
    return null;
  }
}

/** Keep Next's request-error hook; do not add raw process logs/exit handlers or session aggregation. */
export function sentryErrorOnlyIntegrations<T extends { name: string }>(integrations: T[]): T[] {
  const excluded = new Set(['BrowserSession', 'BrowserTracing', 'OnUncaughtException', 'OnUnhandledRejection']);
  return integrations.filter((integration) => !excluded.has(integration.name));
}

export function validSentryDsn(value: string | undefined): string | undefined {
  if (!value || value.length > 512) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.password || url.port || url.search || url.hash
      || !/^[a-f0-9]{16,64}$/i.test(url.username) || !/^\/\d+$/.test(url.pathname)
      || !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return undefined;
    return value;
  } catch { return undefined; }
}

export const sentryPrivacyOptions = {
  integrations: sentryErrorOnlyIntegrations,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  },
  enableLogs: false,
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  autoSessionTracking: false,
  sendClientReports: false,
  maxBreadcrumbs: 0,
  beforeBreadcrumb: () => null,
  beforeSend: sanitizeSentryEvent,
};
