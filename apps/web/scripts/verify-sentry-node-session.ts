/** Isolated synthetic SDK transport; never performs a Sentry network request. */
import { createRequire } from 'node:module';
import { sentryPrivacyOptions, sentryErrorOnlyIntegrations, type SentryTransportEnvelope } from '../lib/monitoring/sentry-privacy';
const Sentry=createRequire(import.meta.url)('@sentry/nextjs') as typeof import('@sentry/nextjs');

const baseline=process.argv[2]==='baseline';
if(!baseline && process.argv[2]!=='candidate')throw new Error('FIXTURE_MODE_REQUIRED');
const envelopes:SentryTransportEnvelope[]=[];
Sentry.init({
  ...sentryPrivacyOptions,release:'fixture-ci-release',
  integrations:items=>baseline ? [...sentryErrorOnlyIntegrations(items),...items.filter(item=>item.name==='ProcessSession')] : sentryErrorOnlyIntegrations(items),
  dsn:`https://${'a'.repeat(32)}@o1.ingest.sentry.io/1`,
  transport:()=>({send:async (envelope:SentryTransportEnvelope)=>{envelopes.push(envelope);return {statusCode:200};},flush:async()=>true}),
});
Sentry.withScope(scope=>{
  scope.setUser({id:'synthetic-private-user',email:'synthetic-private@example.test'});
  scope.addAttachment({filename:'synthetic-private-ocr.txt',data:'synthetic-private OCR'});
  scope.setExtra('raw_ocr','synthetic-private OCR');
  Sentry.captureException(new TypeError('synthetic-private OCR'));
});
await Sentry.flush(1000);
const itemTypes=envelopes.flatMap(envelope=>envelope[1].map(item=>item[0].type));
const report={kind:'sentry-node-release-session-fixture',mode:baseline?'baseline':'candidate',node:process.version,sdk:'11.4.0',envelopes:envelopes.length,itemTypes,events:itemTypes.filter(type=>type==='event').length,sessions:itemTypes.filter(type=>type==='session'||type==='sessions').length,attachments:itemTypes.filter(type=>type==='attachment').length,sensitiveValuesPresent:JSON.stringify(envelopes).includes('synthetic-private'),realNetworkCalls:0};
await Sentry.close(1000);
console.log(JSON.stringify(report));
