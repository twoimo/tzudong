// Bundle for an isolated loopback browser harness; the transport performs no network I/O.
import * as Sentry from '@sentry/nextjs';
import { sentryPrivacyOptions, type SentryTransportEnvelope } from '../lib/monitoring/sentry-privacy';

const envelopes: SentryTransportEnvelope[] = [];
Sentry.init({
  ...sentryPrivacyOptions,
  dsn: `https://${'a'.repeat(32)}@o1.ingest.sentry.io/1`,
  transport: () => ({
    send: async (envelope: SentryTransportEnvelope) => { envelopes.push(envelope); return { statusCode: 200 }; },
    flush: async () => true,
  }),
});
Sentry.withScope((scope) => {
  scope.setUser({ id: 'synthetic-private-user', email: 'synthetic-private@example.test' });
  scope.addAttachment({ filename: 'synthetic-private-ocr.txt', data: 'synthetic-private OCR' });
  scope.setExtra('raw_ocr', 'synthetic-private OCR');
  Sentry.captureException(new TypeError('synthetic-private token=fixture-only'));
});
await Sentry.flush(1000);
const itemTypes: string[] = [];
for (const envelope of envelopes) for (const [header] of envelope[1]) itemTypes.push(header.type);
const proof = {
  events: itemTypes.filter((type) => type === 'event').length,
  sessions: itemTypes.filter((type) => ['session', 'sessions'].includes(type)).length,
  attachments: itemTypes.filter((type) => type === 'attachment').length,
  otherItems: itemTypes.filter((type) => type !== 'event').length,
  sensitiveValuesPresent: JSON.stringify(envelopes).includes('synthetic-private'),
  sessionIntegrationPresent: Boolean(Sentry.getClient()?.getIntegrationByName('BrowserSession')),
  tracingIntegrationPresent: Boolean(Sentry.getClient()?.getIntegrationByName('BrowserTracing')),
};
document.body.textContent = JSON.stringify(proof);
document.body.dataset.sentryProofReady = 'true';
