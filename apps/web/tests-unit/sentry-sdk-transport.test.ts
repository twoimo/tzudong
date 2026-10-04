import { expect, test } from 'bun:test';
import * as Sentry from '@sentry/nextjs';
import { sentryPrivacyOptions, type SentryTransportEnvelope } from '../lib/monitoring/sentry-privacy';

test('actual Sentry SDK applies the privacy filter before a transport sees an error', async () => {
  const envelopes: SentryTransportEnvelope[] = [];
  const exceptionListeners = process.listenerCount('uncaughtException');
  const rejectionListeners = process.listenerCount('unhandledRejection');
  const previousRelease = process.env.SENTRY_RELEASE;
  process.env.SENTRY_RELEASE = 'fixture-ci-release';
  try {
  Sentry.init({
    ...sentryPrivacyOptions, dsn: `https://${'a'.repeat(32)}@o1.ingest.sentry.io/1`,
    transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }),
  });
  expect(process.listenerCount('uncaughtException')).toBe(exceptionListeners);
  expect(process.listenerCount('unhandledRejection')).toBe(rejectionListeners);
  expect(Sentry.getClient()?.getIntegrationByName('BrowserSession')).toBeUndefined();
  expect(Sentry.getClient()?.getIntegrationByName('ProcessSession')).toBeUndefined();
  Sentry.withScope((scope) => {
    scope.setUser({ id: 'secret-user', email: 'secret@example.test', ip_address: '10.0.0.1' });
    scope.addAttachment({ filename: 'secret-ocr.txt', data: 'secret raw OCR' });
    scope.setExtra('raw_ocr', 'secret OCR'); scope.setTag('api_key', 'secret token');
    scope.addBreadcrumb({ message: 'secret provider diagnostics' });
    Sentry.captureException(new TypeError('secret@example.test secret OCR'));
  });
  await Sentry.flush(1000);
  expect(envelopes.length).toBe(1);
  expect(envelopes.flatMap(envelope => envelope[1].map(item => item[0].type))).toEqual(['event']);
  expect(JSON.stringify(envelopes)).not.toContain('secret');
  const event = envelopes[0][1].find((item) => item[0].type === 'event')?.[1] as { exception?: { values: Array<{ type: string; value: string }> } };
  expect(event.exception?.values[0].type).toBe('TypeError');
  expect(event.exception?.values[0].value).toBe('TypeError captured');
  } finally {
    await Sentry.close(1000);
    if (previousRelease === undefined) delete process.env.SENTRY_RELEASE;
    else process.env.SENTRY_RELEASE = previousRelease;
  }
});
