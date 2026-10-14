import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sentryPrivacyOptions } from '../../lib/monitoring/sentry-privacy';
const Sentry = createRequire(import.meta.url)('@sentry/nextjs') as typeof import('@sentry/nextjs');
const runtime = '/Users/twoimo/.codex/runtime-cache/sentry-activation-20261015';
const settings = JSON.parse(readFileSync(runtime + '/connection.json', 'utf8'));
const token = readFileSync(runtime + '/read-token.txt', 'utf8').trim();
Sentry.init({ ...sentryPrivacyOptions, dsn: settings.dsn, environment: 'test', release: '18400459f85f3fee574db6bdc33159ef8bcc88b2' });
let id = '';
Sentry.withScope(scope => {
  scope.setUser({ email: 'sentry-synthetic-private@example.test', ip_address: '10.0.0.1' });
  scope.setExtra('raw_ocr', 'sentry-synthetic-private@example.test');
  scope.addAttachment({ filename: 'synthetic-private.txt', data: 'sentry-synthetic-private@example.test' });
  id = Sentry.captureException(new RangeError('sentry-synthetic-private@example.test'));
});
const flushed = await Sentry.flush(10000);
let readback: Record<string, unknown> | null = null;
for (let n = 0; n < 20; n++) {
  const response = await fetch(`${settings.url}/api/0/projects/${settings.org}/${settings.project}/events/${id}/`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
  if (response.ok) {
    const e = await response.json();
    readback = { status: response.status, idMatches: e.eventID === id, sensitivePresent: JSON.stringify(e).includes('sentry-synthetic-private@example.test'), userPresent: Boolean(e.user?.email || e.user?.ip_address || e.user?.id), environment: e.tags?.find((t: { key: string }) => t.key === 'environment')?.value };
    break;
  }
  if (response.status !== 404) throw Error('NODE_EVENT_READBACK_FAILED');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await Sentry.close(1000);
const proof = { node: process.version, sdk: '11.4.0', eventId: id, flushed, readback, scope: 'Isolated actual Node SDK and source privacy filter, synthetic event; not a deployed Next route failure or field metric.' };
writeFileSync(process.argv[2], JSON.stringify(proof, null, 2) + '\n');
if (!readback?.idMatches || readback.sensitivePresent || readback.userPresent) throw Error('NODE_EVENT_PRIVACY_OR_RECEIPT_FAILED');
console.log(JSON.stringify(proof));
