import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root='/Users/twoimo/.codex/worktrees/naver-resize-gate-20261012/tzudong/apps/web';
const require=createRequire(root+'/package.json');
const {createClient}=require('@supabase/supabase-js');
const {parse}=require('dotenv');
const release='1884f87e53c4567ead7c9a0fb394b09b91a70396';
const result={release,checkedAtUtc:new Date().toISOString(),readOnly:true,credentialsPersisted:false,fieldComparisonAdmission:0,distinctUsersKnown:false,eligibleDenominatorKnown:false,browserCohortsKnown:false,tabletCohortKnown:false};
try {
  const env=parse(await readFile('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
  const url=env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=env.SUPABASE_SERVICE_ROLE_KEY??env.SUPABASE_SECRET_KEY;
  assert.equal(url,'https://aqlcofblfxdrjhhdmarw.supabase.co');
  assert.ok(typeof secret==='string'&&secret.startsWith('sb_secret_'));
  const client=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await client.from('app_web_vitals_histogram')
    .select('observed_day,release_sha,device,metric,navigation,bucket,sample_count')
    .eq('release_sha',release).order('observed_day',{ascending:true}).limit(1000)
    .abortSignal(AbortSignal.timeout(10000));
  assert.ok(!error&&Array.isArray(data));
  assert.ok(data.length<1000,'bounded_read_incomplete');
  const counts={CLS:0,INP:0,LCP:0},devices={mobile:0,desktop:0};
  const days=new Set();
  for(const row of data) {
    assert.equal(row.release_sha,release);
    assert.ok(Object.hasOwn(counts,row.metric)&&Object.hasOwn(devices,row.device));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(row.observed_day));
    assert.ok(Number.isSafeInteger(row.sample_count)&&row.sample_count>0);
    counts[row.metric]+=row.sample_count;devices[row.device]+=row.sample_count;days.add(row.observed_day);
  }
  result.status='passed';result.histogramRows=data.length;result.metricInstances=counts;
  result.deviceMetricInstances=devices;result.observedDays=[...days].sort();
  result.metricSamplesAreNotIndependentUsers=true;
  result.sourceScope='Existing v1 aggregate records, not new prospective browser/device protocol';
} catch {
  result.status='unavailable';result.failure='bounded_current_field_read_unavailable';
}
await writeFile(new URL('summary-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
