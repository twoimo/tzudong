import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('retired storyboard producer entrypoints', () => {
  test('removes former executable provider scripts and keeps old backend entrypoints fail closed', () => {
    const root = resolve(import.meta.dir, '..');
    const removed = [
      'scripts/storyboard-eight-real-provider-smoke.ts',
      'scripts/storyboard-rag-ollama-pull.mjs',
      'scripts/storyboard-mlx-live.ts',
      'scripts/storyboard-mlx-worker.ts',
      'scripts/storyboard-local-bridge.ts',
      'scripts/codex-imagegen-storyboard-provider.py',
      '../../scripts/codex-imagegen-storyboard-provider.py',
    ];
    for (const path of removed) expect(existsSync(join(root, path))).toBe(false);

    for (const name of ['run-storyboard-agent.py','01-bge-embed-and-store-supabase.py','99-openai-embed-and-store-supabase.py']) {
      const result = spawnSync('python3', [`../../backend/storyboard-agent/scripts/${name}`], {
        cwd: root, encoding: 'utf8', timeout: 5000,
      });
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ code: 'storyboard_gemini_only' });
    }
  });
});
