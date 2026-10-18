import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const [phase,sha]=process.argv.slice(2);if(!['before','after'].includes(phase)||!/^[a-f0-9]{40}$/.test(sha))throw Error('INVALID_INPUT');
const health=await fetch('https://www.tzudong.app/api/health',{cache:'no-store'}).then(r=>r.json());if(health.gitSha!==sha)throw Error('LIVE_SHA_CHANGED');
const paths=['/api/public-popularity','/assets/badges/badge_popular_fire_40.webp','/assets/badges/badge_popular_fire_80.webp','/assets/badges/badge_popular_rainbow_40.webp','/assets/badges/badge_popular_rainbow_80.webp'];
const rows=await Promise.all(paths.map(async path=>{const r=await fetch('https://www.tzudong.app'+path,{cache:'no-store'});let row={path,status:r.status};if(phase==='after'){if(!r.ok)throw Error('PUBLIC_ASSET_UNAVAILABLE');const b=Buffer.from(await r.arrayBuffer());row={...row,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};if(path.endsWith('.webp')&&!b.subarray(0,4).equals(Buffer.from('RIFF')))throw Error('NOT_WEBP');}else await r.body?.cancel();return row}));
const output={phase,gitSha:sha,deploymentId:health.deploymentId,scope:'public response status and stored content hashes; no performance or activation claim',rows};await writeFile(new URL(`public-assets-${phase}-v1.json`,import.meta.url),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
