import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('retired storyboard producer entrypoints', () => {
  test('refuses old producers even when the former manual gates are enabled', () => {
    const directory = mkdtempSync(join(tmpdir(),'storyboard-retired-'));
    const marker=join(directory,'unexpected-provider-start');
    const commands = [
      [process.execPath,'scripts/storyboard-eight-real-provider-smoke.ts','--all'],
      ['node','scripts/storyboard-rag-ollama-pull.mjs','--yes'],
      ['python3','scripts/codex-imagegen-storyboard-provider.py','--prove','--auth-file',join(directory,'unreadable-auth')],
    ];
    try {
      for (const command of commands) {
        const result=spawnSync(command[0],command.slice(1),{cwd:resolve(import.meta.dir,'..'),encoding:'utf8',timeout:5000,
          env:{...process.env,STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE:'1',STORYBOARD_RAG_PULL_OLLAMA_MODELS:'1',
            STORYBOARD_LOCAL_CODEX_COMMAND:`touch ${marker}`,STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE:join(directory,'unreadable-proof')}});
        expect(result.status).toBe(2);
        expect(JSON.parse(result.stdout.trim())).toMatchObject({code:'storyboard_gemini_only'});
        expect(existsSync(marker)).toBe(false);
      }
    } finally { rmSync(directory,{recursive:true,force:true}); }
  });
});
