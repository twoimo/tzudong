import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const Sentry = createRequire(import.meta.url)('@sentry/nextjs') as typeof import('@sentry/nextjs');
const runtime = '/Users/twoimo/.codex/runtime-cache/sentry-activation-20261015';
const settings = JSON.parse(readFileSync(runtime + '/connection.json', 'utf8'));
const token = readFileSync(runtime + '/read-token.txt', 'utf8').trim();
process.env.SENTRY_DSN=settings.dsn;
process.env.NEXT_PUBLIC_SENTRY_RELEASE='4397d53a3aa3ba7ded3f1ce82bb2e950aef09ca6';
process.env.VERCEL_ENV='test';
await import('../../sentry.server.config');
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
  const query = new URLSearchParams({project:settings.projectId,query:'issue.category:error',limit:'50',statsPeriod:'14d'});
  const list = await fetch(`${settings.url}/api/0/organizations/${settings.org}/issues/?${query}`, {headers:{Authorization:`Bearer ${token}`},redirect:'error'});
  if(!list.ok)throw Error('NODE_ISSUE_READBACK_FAILED');
  const issues=await list.json();
  const issue=issues.find((row:{project:{id:string;slug:string};metadata:{type:string}})=>row.project?.id===settings.projectId&&row.project?.slug===settings.project&&row.metadata?.type==='RangeError');
  if(!issue){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
  const response = await fetch(`${settings.url}/api/0/organizations/${settings.org}/issues/${issue.id}/events/${id}/`, {headers:{Authorization:`Bearer ${token}`},redirect:'error'});
  if (response.ok) {
    const e = await response.json();
    readback = { status: response.status, idMatches: e.eventID === id, sensitivePresent: JSON.stringify(e).includes('sentry-synthetic-private@example.test'), userPresent: Boolean(e.user?.email || e.user?.ip_address || e.user?.id), releaseMatches:e.release?.version==='4397d53a3aa3ba7ded3f1ce82bb2e950aef09ca6', environment: e.tags?.find((t: { key: string }) => t.key === 'environment')?.value };
    break;
  }
  if (response.status !== 404) throw Error('NODE_EVENT_READBACK_FAILED');
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await Sentry.close(1000);
const proof = { node: process.version, sdk: '11.4.0', eventId: id, flushed, readback, scope: 'Actual source server initialization and Node SDK, synthetic error, immutable SHA binding; not a deployed Next route failure or field metric.' };
writeFileSync(process.argv[2], JSON.stringify(proof, null, 2) + '\n');
if (!readback?.idMatches || !readback.releaseMatches || readback.sensitivePresent || readback.userPresent) throw Error('NODE_EVENT_PRIVACY_OR_RECEIPT_FAILED');
console.log(JSON.stringify(proof));
