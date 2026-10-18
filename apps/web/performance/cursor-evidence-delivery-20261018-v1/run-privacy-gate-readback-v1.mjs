import {writeFile,access} from 'node:fs/promises';
const [phase,sha]=process.argv.slice(2);if(!['before','after'].includes(phase)||!/^[a-f0-9]{40}$/.test(sha))throw Error('INVALID_INPUT');
const file=new URL(`privacy-gate-${phase}-v1.json`,import.meta.url);try{await access(file);throw Error('PRESERVE_EXISTING_RECEIPT')}catch(e){if(e.code!=='ENOENT')throw e}
const h=await fetch('https://www.tzudong.app/api/health',{cache:'no-store'}).then(r=>r.json());if(h.gitSha!==sha)throw Error('HEALTH_SHA_CHANGED');
const r=await fetch('https://www.tzudong.app/api/privacy/location-readiness',{cache:'no-store'});const p=await r.json();
if(r.status!==200||p.status!=='unavailable'||p.reasonCode!=='DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED'||Object.keys(p).sort().join(',')!=='reasonCode,status')throw Error('READINESS_BOUNDARY_CHANGED');
const x={observedAt:new Date().toISOString(),phase,gitSha:sha,httpStatus:r.status,status:p.status,reasonCode:p.reasonCode,scope:'Public server-owned readiness remains unavailable; no permission request, coordinate collection or feature activation'};
await writeFile(file,JSON.stringify(x,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(x));
