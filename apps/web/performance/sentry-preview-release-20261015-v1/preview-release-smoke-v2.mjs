import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const root = '/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web';
const { chromium } = createRequire(root + '/package.json')('@playwright/test');
const config = JSON.parse(readFileSync('/Users/twoimo/.codex/runtime-cache/sentry-activation-20261015/connection.json'));
const ingest = new URL(config.dsn).origin;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const rows = [];
const previewOrigin='https://tzudong-gpzvq2kcx-twoimos-projects.vercel.app';
const oidc=process.env.VERCEL_OIDC_TOKEN;
if(!oidc)throw Error('PREVIEW_OIDC_MISSING');
const token = readFileSync('/Users/twoimo/.codex/runtime-cache/sentry-activation-20261015/read-token.txt','utf8').trim();
async function readback(id){
 for(let n=0;n<20;n++){
  const query=new URLSearchParams({project:config.projectId,query:'issue.category:error',limit:'50',statsPeriod:'14d'});
  const list=await fetch(`${config.url}/api/0/organizations/${config.org}/issues/?${query}`,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});
  if(!list.ok)throw Error('ISSUE_READBACK_FAILED');
  const issues=await list.json();
  for(const issue of issues){
   if(issue.project?.id!==config.projectId||issue.project?.slug!==config.project||issue.metadata?.type!=='TypeError')continue;
   const r=await fetch(`${config.url}/api/0/organizations/${config.org}/issues/${issue.id}/events/${id}/`,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});
   if(r.ok){const e=await r.json();return {status:r.status,idMatches:e.eventID===id,type:e.metadata?.type,releaseMatches:e.release?.version==='da65ba93c46bb6f3e212ec158cc17357ec05e474',environment:e.tags?.find(t=>t.key==='environment')?.value,userPresent:Boolean(e.user?.email||e.user?.ip_address||e.user?.id),messageSanitized:JSON.stringify(e).includes('TypeError captured'),syntheticPrivatePresent:JSON.stringify(e).includes('sentry-synthetic-private@example.test')};}
   if(r.status!==404)throw Error('EVENT_READBACK_FAILED_'+r.status);
  }
  await new Promise(resolve=>setTimeout(resolve,1000));
 }throw Error('EVENT_READBACK_TIMEOUT');
}
try {
  for (const viewport of [{ width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await context.route(previewOrigin+'/**', route=>route.continue({headers:{...route.request().headers(),'x-vercel-trusted-oidc-idp-token':oidc}}));
    const page = await context.newPage();
    const sends = [];
    const transportFailures=[];
    page.on("requestfailed",q=>{if(new URL(q.url()).origin===ingest)transportFailures.push({kind:"failed",code:q.failure()?.errorText})});
    page.on("response",r=>{if(new URL(r.url()).origin===ingest)transportFailures.push({kind:"response",status:r.status()})});
    let cspBlocked = 0, pageErrors = 0;
    page.on('pageerror', () => pageErrors++);
    page.on('console', m => { if (m.type() === 'error' && m.text().includes('Content Security Policy') && m.text().includes(new URL(ingest).hostname)) cspBlocked++; });
    page.on('request', request => {
      if (new URL(request.url()).origin !== ingest) return;
      const body = request.postData() ?? '';
      let header = {};
      try { header = JSON.parse(body.split('\n')[0]); } catch {}
      sends.push({ httpResponseUnobserved: true, eventId: header.event_id ?? null, containsSyntheticPrivate: body.includes('sentry-synthetic-private@example.test'), itemTypes: body.split('\n').flatMap(s => { try { const j = JSON.parse(s); return j.type ? [j.type] : []; } catch { return []; } }) });
    });
    const response = await page.goto(previewOrigin+'/auth/required?reason=mypage&next=%2Fmypage', { waitUntil: 'networkidle', timeout: 30000 });
    await page.getByRole('heading', { name: '로그인이 필요합니다', exact: true }).waitFor({ timeout: 15000 });
    const csp = response.headers()['content-security-policy'];
    if (!csp?.includes(ingest)) throw Error('CSP_INGEST_ORIGIN_MISSING');
    const pageErrorsBeforeInjection = pageErrors;
    const reply = page.waitForRequest(r => new URL(r.url()).origin === ingest, { timeout: 20000 });
    await page.evaluate(() => setTimeout(() => { throw new TypeError('sentry-synthetic-private@example.test'); }, 0));
    await reply;
    let received;
    try{received=await readback(sends.at(-1).eventId)}catch(e){writeFileSync(new URL("./preview-receipt-diagnostic-v2.json",import.meta.url),JSON.stringify({sends,transportFailures,pageErrors,cspBlocked,failure:"EVENT_READBACK_FAILED"},null,2)+"\n");throw e;}
    if(!received.idMatches || !received.releaseMatches || received.syntheticPrivatePresent || received.userPresent)throw Error('EVENT_READBACK_PRIVACY_FAILED');
    await page.screenshot({ path: new URL('./login-' + viewport.width + '.png', import.meta.url).pathname });
    rows.push({ viewport, status: response.status(), ingestionOriginAllowed: true, cspBlocked, pageErrorsBeforeInjection, pageErrors, received, events: sends });
    await context.close();
  }
  writeFileSync(new URL('./preview-release-smoke-v2.json', import.meta.url), JSON.stringify({ kind:'actual-protected-vercel-preview-sentry-receipt', browser: browser.version(), sdk: '11.4.0', deploymentId:'dpl_BKmLDcSFdSR6gB35WN7GhjrJ8aKN', sourceCommit:'da65ba93c46bb6f3e212ec158cc17357ec05e474', scope: 'One clean Chrome context; actual protected Vercel preview. Development OIDC attached only to the exact preview origin, never Sentry or other requests. Synthetic TypeError; no production alias, physical phone, or field claim.', rows }, null, 2) + '\n');
  console.log(JSON.stringify({ rows: rows.length, received: rows.map(r => r.received), sensitiveValuesPresent: rows.some(r => r.events.some(e => e.containsSyntheticPrivate)), cspBlocked: rows.reduce((n, r) => n + r.cspBlocked, 0) }));
} finally { await browser.close(); }
