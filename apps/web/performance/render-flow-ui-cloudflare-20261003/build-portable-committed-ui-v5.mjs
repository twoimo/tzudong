import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {redactCliText} from '../../scripts/privacy-safe-cli-log.mjs';
assert.equal(process.versions.node.split('.')[0],'24');
const source=process.env.TZUDONG_UI_SOURCE_WORKTREE||'/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong',root=new URL('./',import.meta.url),app=new URL('../../',root);
const sha=process.argv[2],label=process.argv[3];assert.match(sha,/^[a-f0-9]{40}$/);assert.match(label,/^[a-z0-9-]{1,20}$/);
const out=new URL(`build-candidate-${label}/`,root),distDir=`.next-ui-${label}`;await mkdir(out);
const scratch=await mkdtemp(join(tmpdir(),'tzudong-ui-committed-')),checkout=join(scratch,'source'),web=join(checkout,'apps/web'),hash=x=>createHash('sha256').update(x).digest('hex');
try {
 await mkdir(checkout);const archive=join(scratch,'source.tar');execFileSync('git',['archive','--format=tar',`--output=${archive}`,sha,'apps/web'],{cwd:source});execFileSync('tar',['-xf',archive,'-C',checkout,'--exclude=apps/web/performance']);
 const font=execFileSync('git',['show',`${sha}:assets/source-fonts/ChosunCentennial_otf.otf`],{cwd:source,maxBuffer:16*1024*1024});assert.equal(hash(font),'8c2eeb55898708b108032eb0baddabfbf7c98a78c3411a2f2601c7bdeff1cfb7');
 await cp(new URL('node_modules/',app),join(web,'node_modules'),{recursive:true,mode:constants.COPYFILE_FICLONE});
 const config={};for(const line of (await readFile(process.env.TZUDONG_UI_PUBLIC_CONFIGURATION_FILE||new URL('.env.production.local',app),'utf8')).split('\n')){const at=line.indexOf('=');if(at<1)continue;const key=line.slice(0,at);if(['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_NAVER_CLIENT_ID'].includes(key))config[key]=JSON.parse(line.slice(at+1));}assert.equal(Object.keys(config).length,3);
 const names=execFileSync('git',['diff','--name-only','--no-renames','f6e5d940dc88c2d74fdff9c5e6ca6d470d4b980f',sha,'--','apps/web'],{cwd:source,encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const inputs=[];for(const p of [...names.filter(p=>p!=='apps/web/public/fonts/ChosunCentennial_otf.otf'),'apps/web/lib/marker-pool.ts','apps/web/package-lock.json']){const path=p.slice('apps/web/'.length);inputs.push({path,sha256:hash(await readFile(join(web,path)))});}
 let log='';const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build','--webpack'],{cwd:web,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',VERCEL_GIT_COMMIT_SHA:sha,TZUDONG_NEXT_DIST_DIR:distDir,...config},stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{const safe=redactCliText(b.toString(),16384);log+=safe;process.stdout.write(safe);});const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});await writeFile(new URL('build.log',out),log,{flag:'wx'});assert.equal(code,0);
 const built=join(web,distDir),standalone=join(built,'standalone/apps/web');await cp(join(built,'static'),join(standalone,distDir,'static'),{recursive:true});await cp(join(web,'public'),join(standalone,'public'),{recursive:true});
 const buildId=(await readFile(join(built,'BUILD_ID'),'utf8')).trim();await cp(built,new URL(distDir,app),{recursive:true,errorOnExist:true,force:false,mode:constants.COPYFILE_FICLONE});
 await writeFile(new URL('receipt.json',out),JSON.stringify({sourceCommit:sha,sourceTree:execFileSync('git',['rev-parse',sha+'^{tree}'],{cwd:source,encoding:'utf8'}).trim(),inputs,distDir,buildId,node:process.version,next:JSON.parse(await readFile(join(web,'node_modules/next/package.json'),'utf8')).version,configurationNames:Object.keys(config),privateConfigurationInArtifacts:false,removedWebPublicFontBytes:font.length,retainedFontSha256:hash(font),fontRedirectAtExplicitRoute:true,poolOrderCandidateIncluded:false,onlyCommittedSource:true,deployed:false},null,2)+'\n',{flag:'wx'});
}finally{await rm(scratch,{recursive:true,force:true});}
