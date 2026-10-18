import {writeFile,access} from 'node:fs/promises';
const [phase,sha]=process.argv.slice(2);if(!['before','after'].includes(phase)||!/^[a-f0-9]{40}$/.test(sha))throw Error('INVALID_INPUT');
const file=new URL(`privacy-gate-${phase}-v2.json`,import.meta.url);try{await access(file);throw Error('PRESERVE_EXISTING_RECEIPT')}catch(e){if(e.code!=='ENOENT')throw e}
const h=await fetch('https://www.tzudong.app/api/health',{cache:'no-store'}).then(r=>r.json());if(h.gitSha!==sha)throw Error('HEALTH_SHA_CHANGED');
const r=await fetch('https://www.tzudong.app/api/privacy/location-readiness',{cache:'no-store'});const p=await r.json();
if(r.status!==200||!['available','unavailable'].includes(p.status)||!['DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED','DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED'].includes(p.reasonCode)||Object.keys(p).sort().join(',')!=='reasonCode,status')throw Error('READINESS_SCHEMA_CHANGED');
if(phase==='after'){const baseline=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('privacy-gate-before-v2.json',import.meta.url),'utf8'));if(p.status!==baseline.status||p.reasonCode!==baseline.reasonCode)throw Error('READINESS_STATE_CHANGED');}
const x={observedAt:new Date().toISOString(),phase,gitSha:sha,httpStatus:r.status,status:p.status,reasonCode:p.reasonCode,scope:'Public server-owned readiness readback; preserve observed baseline state. Response code is not independent legal evidence. No permission request or coordinate collection.'};
await writeFile(file,JSON.stringify(x,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(x));
