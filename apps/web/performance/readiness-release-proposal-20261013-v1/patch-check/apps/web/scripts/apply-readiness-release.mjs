#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { selectDirectDatabaseTransport } from './apply-supabase-migration.mjs';
import { ID, loadRelease, executeRelease } from './readiness-release.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
export function protectedContext(env, gitImpl=spawnSync) {
  if(env.GITHUB_ACTIONS!=='true' || env.GITHUB_EVENT_NAME!=='workflow_dispatch' || env.GITHUB_REPOSITORY!=='twoimo/tzudong' || env.GITHUB_REF!=='refs/heads/main' || env.GITHUB_REF_NAME!=='main' || env.G037_WRITE_FREEZE!=='active' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'') || env.READINESS_VALIDATED_SHA!==env.GITHUB_SHA) fail('READINESS_PROTECTED_CONTEXT_REQUIRED');
  const head=gitImpl('git',['rev-parse','--verify','HEAD'],{cwd:root,encoding:'utf8'});
  const branch=gitImpl('git',['symbolic-ref','--quiet','HEAD'],{cwd:root,encoding:'utf8'});
  if(head.status!==0 || head.stdout.trim()!==env.GITHUB_SHA || branch.status!==1 || branch.stdout.trim()) fail('READINESS_DETACHED_SHA_REQUIRED');
}
export function main(argv=process.argv.slice(2),env=process.env) {
  if(argv.some(x=>!['--dry-run','--verify-terminal-state','--json'].includes(x)) || new Set(argv).size!==argv.length || (argv.includes('--dry-run')&&argv.includes('--verify-terminal-state'))) fail('READINESS_ARGUMENT_INVALID');
  const compiled=loadRelease(root,env.READINESS_RELEASE_MANIFEST_SHA256);
  const result={id:ID,manifestSha256:compiled.manifestSha256,bundleSha256:compiled.manifest.bundle.sha256,units:11,dryRun:argv.includes('--dry-run'),outcome:'bytes_validated',writeAttempts:0};
  if(!result.dryRun) {
    protectedContext(env);
    const {databaseUrl}=selectDirectDatabaseTransport(env);
    // Bind the direct URL to the same reviewed project before opening a socket.
    const target=new URL(databaseUrl),project='aqlcofblfxdrjhhdmarw';
    if(!((target.hostname===`db.${project}.supabase.co` && decodeURIComponent(target.username)==='postgres') || (target.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(target.username)===`postgres.${project}`))) fail('READINESS_PROJECT_MISMATCH');
    if(argv.includes('--verify-terminal-state')) {
      const {runPsql}=transport;
      let state; try { state=JSON.parse(runPsql(databaseUrl,compiled.reconciliation,true)); } catch { fail('READINESS_READBACK_UNAVAILABLE'); }
      if(state.state!=='final') fail('READINESS_FINAL_CONFLICT');
      result.outcome='already_applied';
    } else Object.assign(result,executeRelease(databaseUrl,compiled));
  }
  console.log(JSON.stringify(result)); return result;
}
import * as transport from './apply-supabase-migration.mjs';
if(import.meta.url===`file://${process.argv[1]}`) {
  try { main(); } catch(error) {
    // Never emit provider errors, SQL, URLs or stack traces.
    const code=/^READINESS_[A-Z_]{1,80}$/.test(error?.code??'')?error.code:'READINESS_VALIDATION_OR_TRANSPORT_FAILED';
    process.stderr.write(JSON.stringify({status:'failed',code})+'\n');process.exitCode=1;
  }
}
