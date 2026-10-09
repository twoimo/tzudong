import { describe, expect, test } from 'bun:test';
import type { ErrorEvent } from '@sentry/nextjs';
import { sanitizeSentryEvent, sentryPrivacyOptions, validSentryDsn } from '../lib/monitoring/sentry-privacy';

describe('Sentry event privacy', () => {
  test('preserves validated opaque IDs containing phone-like digits while still removing actual personal data', () => {
    const eventId='a01012345678'+'a'.repeat(20);
    const release='b01012345678'+'b'.repeat(28);
    const safe=sanitizeSentryEvent({type:undefined,event_id:eventId,release,
      user:{email:'private@example.test'},message:'010-1234-5678',
      exception:{values:[{type:'TypeError',value:'private@example.test'}]}});
    expect(safe?.event_id).toBe(eventId);
    expect(safe?.release).toBe(release);
    expect(safe?.user).toBeUndefined();
    expect(safe?.message).toBeUndefined();
    expect(safe?.exception?.values?.[0].value).toBe('TypeError captured');
    expect(sanitizeSentryEvent({type:undefined,event_id:'private@example.test',release:'private@example.test'})?.event_id).toBeUndefined();
  });
  test('retains error type and repository frame while dropping request, OCR, identity and provider diagnostics', () => {
    const event: ErrorEvent = {
      type: undefined, event_id: 'a'.repeat(32), level: 'error', timestamp: 1,
      user: { email: 'private@example.test', ip_address: '1.2.3.4' },
      request: { url: 'https://tzudong.app?token=private', headers: { Cookie: 'private' }, data: { raw_ocr: 'private OCR' } },
      extra: { diagnostic: 'provider private', lat: 37.123456 },
      tags: { token: 'private' }, contexts: { device: { name: 'private device' } },
      breadcrumbs: [{ message: 'private message' }], message: 'raw body',
      exception: { values: [{ type: 'TypeError', value: 'private@example.test Bearer private',
        stacktrace: { frames: [{ filename: '/Users/private/project/app/admin/page.tsx?token=private', function: 'loadPage', lineno: 42, vars: { raw_ocr: 'private OCR' }, pre_context: ['private source'], context_line: 'secret' }] } }] },
    };
    const safe = sanitizeSentryEvent(event);
    expect(safe?.exception?.values?.[0]).toEqual({ type: 'TypeError', value: 'TypeError captured', stacktrace: { frames: [{ filename: 'app/admin/page.tsx', function: 'loadPage', lineno: 42 }] } });
    expect(safe?.event_id).toBe('a'.repeat(32));
    expect(JSON.stringify(safe)).not.toContain('private');
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(event.user?.email).toBe('private@example.test');
  });

  test('bounds frames/exceptions and refuses unknown diagnostic types, functions and external paths', () => {
    const safe = sanitizeSentryEvent({ type: undefined, exception: { values: Array.from({ length: 20 }, () => ({ type: 'api_key=secret', value: 'secret', stacktrace: { frames: Array.from({ length: 100 }, () => ({ filename: '/private/uploads/secret.txt', function: 'secret@example.test', vars: { secret: true } })) } })) } });
    expect(safe?.exception?.values?.length).toBe(5);
    expect(safe?.exception?.values?.[0].stacktrace?.frames?.length).toBe(40);
    expect(safe?.exception?.values?.[0].type).toBe('Error');
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  test('turns off all sensitive SDK 11 defaults, telemetry categories and breadcrumbs', () => {
    expect(sentryPrivacyOptions.dataCollection).toEqual({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 });
    expect(sentryPrivacyOptions.beforeBreadcrumb()).toBeNull();
    expect(sentryPrivacyOptions.enableLogs).toBe(false);
    expect(sentryPrivacyOptions.tracesSampleRate).toBe(0);
    expect(sentryPrivacyOptions.replaysOnErrorSampleRate).toBe(0);
  });

  test('fails closed for malformed or credential-bearing DSNs', () => {
    const dsn = `https://${'a'.repeat(32)}@o1.ingest.sentry.io/123`;
    expect(validSentryDsn(dsn)).toBe(dsn);
    for (const bad of [undefined, '', 'http://example.test/1', 'https://bad:secret@example.test/1', `${dsn}?secret=x`, `${dsn}#secret`, `${dsn}:12`]) expect(validSentryDsn(bad)).toBeUndefined();
  });
});
