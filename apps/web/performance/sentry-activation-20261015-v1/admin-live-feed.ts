import { readFileSync, writeFileSync } from 'node:fs';
import { mock } from 'bun:test';
// Standalone server-only process: Next's server-only bundler sentinel has no npm package here.
// This substitutes only that sentinel, preserving the actual function, token, and HTTPS transport.
mock.module('server-only', () => ({}));
const { getAdminSentryIssues } = await import('../../lib/monitoring/sentry-admin');
const runtime='/Users/twoimo/.codex/runtime-cache/sentry-activation-20261015';
const config=JSON.parse(readFileSync(runtime+'/connection.json','utf8'));
const token=readFileSync(runtime+'/read-token.txt','utf8').trim();
const response=await getAdminSentryIssues('unresolved',null,{env:{SENTRY_ORG:config.org,SENTRY_PROJECT:config.project,SENTRY_PROJECT_ID:config.projectId,SENTRY_URL:config.url,SENTRY_ISSUES_READ_TOKEN:token,NEXT_PUBLIC_SENTRY_DSN:config.dsn,SENTRY_DSN:config.dsn}});
const safe={state:response.state,collection:response.collection,issueCount:response.issues.length,types:response.issues.map(x=>x.type),privateSentinelPresent:JSON.stringify(response).includes('sentry-synthetic-private@example.test'),scope:'Actual server feed function and Sentry API. Admin route authorization is covered by isolated tests, not a logged-in production CMS proof.'};
writeFileSync(process.argv[2],JSON.stringify(safe,null,2)+'\n');
if(response.state!=='connected'||response.issues.length<2||safe.privateSentinelPresent)throw Error('ADMIN_FEED_READBACK_FAILED');
console.log(JSON.stringify(safe));
