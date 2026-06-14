import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type EnvPatch = Record<string, string | undefined>;

function withEnv<T>(patch: EnvPatch, callback: () => T | Promise<T>): Promise<T> | T {
  const previous: EnvPatch = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const key of Object.keys(patch)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = callback();
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function createCommand(stdoutJson: unknown) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'tzudong-storyboard-caption-provenance-'));
  const commandPath = path.join(tempDir, 'storyboard-command.sh');
  writeFileSync(
    commandPath,
    [
      '#!/usr/bin/env bash',
      'cat >/dev/null',
      `printf '%s\n' ${JSON.stringify(JSON.stringify(stdoutJson))}`,
    ].join('\n'),
    'utf8',
  );
  chmodSync(commandPath, 0o755);
  return { commandPath, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
}

const request = {
  prompt: 'caption provenance test storyboard',
  tone: 'warm' as const,
  targetLengthMinutes: 18,
  sourceLimit: 20,
  segmentCount: 4,
  includeProductionNotes: true,
  generationMode: 'backend_agent' as const,
};

describe('admin storyboard caption provenance diagnostics', () => {
  test('passes provider-aware caption diagnostics through graph retrieval without leaking local paths', async () => {
    const command = createCommand({
      storyboard: { exportMarkdown: '# caption proof', operatorBrief: 'caption proof' },
      backendAgent: {
        graph: {
          status: 'used',
          runtime: 'langgraph',
          mode: 'graph_command',
          threadId: 'storyboard-caption-proof',
          checkpointer: 'MemorySaver',
          checkpointerScope: 'per_process_only',
          nodesVisited: ['extract_slots', 'supervisor', 'researcher', 'designer'],
          interrupts: [],
          toolsCalled: ['search_scene_data'],
          retrieval: {
            status: 'used',
            usedModels: { embedding: 'BAAI/bge-m3', reranker: 'BAAI/bge-reranker-v2-m3' },
            operations: { supabaseRpc: 'match_documents_hybrid', mmrApplied: true, captionLookup: 'get_video_captions_for_range' },
            caption: {
              lookupStatus: 'used',
              provider: 'openai_vision_gpt55',
              model: 'gpt-5.5',
              authMode: 'platform_api_key',
              schemaVersion: 2,
              frameCount: 8,
              truncatedFrames: 2,
              requestHash: 'abc123hash',
              parserStatus: 'strict_json',
              latencyMs: 1234,
              responseId: 'resp_123',
              filePath: '/home/twoimo/secret/frame.jpg',
            },
          },
        },
      },
    });

    try {
      await withEnv(
        {
          STORYBOARD_AGENT_COMMAND: command.commandPath,
          STORYBOARD_AGENT_RUNTIME: 'langgraph',
          TZUYANG_HEATMAP_DIR: path.join(os.tmpdir(), `missing-tzudong-heatmap-${Date.now()}`),
        },
        async () => {
          const { generateStoryboardWithBackendAgent } = await import(`../lib/admin/storyboard/backend-agent.ts?case=${Math.random()}`);
          const result = await generateStoryboardWithBackendAgent(request);
          const caption = result.backendAnalysis.backendAgent?.graph?.retrieval?.caption;
          const serialized = JSON.stringify(result.backendAnalysis.backendAgent?.graph);

          expect(caption?.lookupStatus).toBe('used');
          expect(caption?.provider).toBe('openai_vision_gpt55');
          expect(caption?.model).toBe('gpt-5.5');
          expect(caption?.authMode).toBe('platform_api_key');
          expect(caption?.schemaVersion).toBe(2);
          expect(caption?.frameCount).toBe(8);
          expect(caption?.truncatedFrames).toBe(2);
          expect(caption?.requestHash).toBe('abc123hash');
          expect(serialized).not.toContain('/home/twoimo/secret/frame.jpg');
          expect(serialized).not.toContain('auth.json');
        },
      );
    } finally {
      command.cleanup();
    }
  });

  test('keeps unavailable caption lookup explicit for fallback diagnostics', async () => {
    const command = createCommand({
      storyboard: { exportMarkdown: '# caption unavailable', operatorBrief: 'caption unavailable' },
      backendAgent: {
        graph: {
          status: 'used',
          runtime: 'langgraph',
          mode: 'graph_command',
          threadId: 'storyboard-caption-unavailable',
          checkpointer: 'MemorySaver',
          checkpointerScope: 'per_process_only',
          nodesVisited: ['extract_slots', 'supervisor', 'researcher', 'designer'],
          interrupts: [],
          toolsCalled: ['search_scene_data'],
          retrieval: {
            status: 'used',
            operations: { captionLookup: 'get_video_captions_for_range' },
            caption: {
              lookupStatus: 'unavailable',
              provider: 'unknown_legacy',
              authMode: 'unknown_legacy',
              fallbackReason: 'empty_caption_result',
            },
          },
        },
      },
    });

    try {
      await withEnv(
        {
          STORYBOARD_AGENT_COMMAND: command.commandPath,
          STORYBOARD_AGENT_RUNTIME: 'langgraph',
          TZUYANG_HEATMAP_DIR: path.join(os.tmpdir(), `missing-tzudong-heatmap-${Date.now()}`),
        },
        async () => {
          const { generateStoryboardWithBackendAgent } = await import(`../lib/admin/storyboard/backend-agent.ts?case=${Math.random()}`);
          const result = await generateStoryboardWithBackendAgent(request);
          expect(result.backendAnalysis.backendAgent?.graph?.retrieval?.caption?.lookupStatus).toBe('unavailable');
          expect(result.backendAnalysis.backendAgent?.graph?.retrieval?.caption?.fallbackReason).toBe('empty_caption_result');
        },
      );
    } finally {
      command.cleanup();
    }
  });
});
