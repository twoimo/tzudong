import { writeFile } from 'node:fs/promises';
const sha=process.argv[2];if(!/^[a-f0-9]{40}$/.test(sha))throw Error('INVALID_SHA');
const rows=[];
for(const host of ['tzudong.app','www.tzudong.app']){
 let u=new URL('https://'+host+'/api/health'),chain=[];
 for(let i=0;i<4;i++){
  const r=await fetch(u,{redirect:'manual',cache:'no-store'});
  chain.push({host:u.hostname,path:u.pathname,status:r.status});
  if(r.status>=300&&r.status<400){const n=new URL(r.headers.get('location'),u);await r.body?.cancel();if(!['tzudong.app','www.tzudong.app'].includes(n.hostname)||n.search||n.protocol!=='https:'||n.pathname!=='/api/health')throw Error('UNEXPECTED_ALIAS_REDIRECT');u=n;continue;}
  if(r.status!==200)throw Error('ALIAS_HEALTH_UNAVAILABLE');const h=await r.json();if(h.gitSha!==sha||h.projectId!=='prj_sau35J5uUtShIQ9OKofRtOVVnTSl'||!h.ok)throw Error('ALIAS_SHA_MISMATCH');
  rows.push({requestedHost:host,chain,gitSha:h.gitSha,projectId:h.projectId,deploymentId:h.deploymentId});break;
 }
}
if(rows.length!==2)throw Error('REDIRECT_LIMIT');
const result={observedAt:new Date().toISOString(),scope:'public root/www alias and health correspondence only',rows};await writeFile(new URL('public-alias-after-v1.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
