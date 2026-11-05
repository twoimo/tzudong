import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  STORYBOARD_ARCHIVE_WORKFLOW,
  assertExecutableStoryboardRequest,
  storyboardProductionDocumentSchema,
  storyboardProductionRequestSchema,
  storyboardStoredProductionRequestSchema,
} from '../lib/admin/storyboard/production-contract';
import {
  StoryboardProductionStore,
  type ProductionDatabase,
  type ProductionProject,
} from '../lib/admin/storyboard/production-store';

const now = new Date().toISOString();

function archivedProject(): ProductionProject {
  const id = randomUUID();
  const request = storyboardStoredProductionRequestSchema.parse({
    workflow: STORYBOARD_ARCHIVE_WORKFLOW,
    requestId: randomUUID(),
    prompt: 'readable archive fixture',
    sceneCount: 5,
    providers: {
      externalAI: true,
      text: { id: 'chatgpt-manual', model: 'historical-text-model' },
      image: { id: 'grok-manual', model: 'historical-image-model' },
    },
  });
  const historicalProof = (providerId: 'chatgpt-manual' | 'grok-manual', model: string) => ({
    providerId,
    model,
    verification: 'user-import' as const,
    generatedAt: now,
    requestId: randomUUID(),
    responseId: null,
    responseModel: null,
    modelEvidence: 'unverified' as const,
  });
  const document = storyboardProductionDocumentSchema.parse({
    schema: STORYBOARD_ARCHIVE_WORKFLOW,
    projectId: id,
    revision: 3,
    generatedAt: now,
    title: 'Historical project',
    logline: 'Archive remains readable.',
    textProvenance: historicalProof('chatgpt-manual', 'historical-text-model'),
    scenes: Array.from({ length: 5 }, (_, index) => ({
      sceneNo: index + 1,
      title: `Scene ${index + 1}`,
      durationSec: 10,
      description: 'Historical scene',
      visualDirection: 'Historical direction',
      narration: '',
      caption: '',
      productionNotes: ['Historical note'],
      imagePrompt: 'Historical image prompt',
      sourceIds: [],
      revision: 0,
      image: null,
      imageError: null,
    })),
  });
  return { id, revision: 3, request, document, status: 'ready', createdAt: now, updatedAt: now };
}

describe('Gemini-only execution and readable archive boundary', () => {
  test('decodes historical projects but never admits them as executable requests', () => {
    const project = archivedProject();
    expect(project.request.workflow).toBe(STORYBOARD_ARCHIVE_WORKFLOW);
    expect(project.document?.title).toBe('Historical project');
    expect(() => assertExecutableStoryboardRequest(project.request)).toThrow('archived_project_read_only');
  });

  test('rejects a non-Gemini create before any database or queue RPC', async () => {
    let rpcCalls = 0;
    const database: ProductionDatabase = {
      async rpc() { rpcCalls++; return { data: null, error: null }; },
      async asset() { throw new Error('unexpected_asset_access'); },
    };
    const request = {
      workflow: 'storyboard-gemini-v1',
      requestId: randomUUID(),
      prompt: 'must not dispatch',
      sceneCount: 5,
      providers: {
        externalAI: true,
        text: { id: 'openai-api', model: 'other-text' },
        image: { id: 'xai-api', model: 'other-image' },
      },
    };
    const unapprovedModel = { ...request, providers: { externalAI: true,
      text: { id: 'gemini-api', model: 'gemini-unapproved-text' },
      image: { id: 'gemini-api', model: 'gemini-unapproved-image' } } };
    const store = new StoryboardProductionStore({ database });
    for (const value of [request, unapprovedModel]) {
      expect(storyboardProductionRequestSchema.safeParse(value).success).toBe(false);
      await expect(store.create(randomUUID(), value)).rejects.toThrow('invalid_request');
    }
    expect(rpcCalls).toBe(0);
  });

  test('rejects a legacy worker catalog before claim RPC', async () => {
    let rpcCalls = 0;
    const database: ProductionDatabase = {
      async rpc() { rpcCalls++; return { data: null, error: null }; },
      async asset() { throw new Error('unexpected_asset_access'); },
    };
    const store = new StoryboardProductionStore({ database });
    await expect(store.workerOperation({
      id: randomUUID(),
      ownerId: randomUUID(),
      models: [{ id: 'legacy-model', owned_by: 'mlx-serve', capabilities: ['chat'],
        loaded: true, bytes_on_disk: 1, bytes_resident: 1 }],
    }, { action: 'claim' })).rejects.toThrow('invalid_request');
    expect(rpcCalls).toBe(0);
  });

  test('allows an archive read and rejects its retry before a mutation RPC', async () => {
    const project = archivedProject();
    const actions: unknown[] = [];
    const database: ProductionDatabase = {
      async rpc(_name, args) {
        actions.push(args.p_action);
        if (args.p_action !== 'read') throw new Error('unexpected_mutation_rpc');
        return { data: { ok: true, project, job: null, events: [] }, error: null };
      },
      async asset() { throw new Error('unexpected_asset_access'); },
    };
    const store = new StoryboardProductionStore({ database });
    expect((await store.get(randomUUID(), project.id)).project.document?.title).toBe('Historical project');
    actions.length = 0;
    await expect(store.apply(randomUUID(), project.id, {
      action: 'retry', revision: project.revision, requestId: randomUUID(),
    })).rejects.toThrow('archived_project_read_only');
    expect(actions).toEqual(['read']);
  });

  test('active storyboard runtime inventory has no legacy execution selectors or executable scripts', () => {
    const webRoot = join(import.meta.dir, '..');
    const removed = [
      'lib/admin/storyboard/mlx-client.ts',
      'lib/admin/storyboard/mlx-transport.ts',
      'scripts/storyboard-mlx-worker.ts',
      'scripts/storyboard-mlx-live.ts',
      'scripts/storyboard-local-bridge.ts',
      'scripts/storyboard-eight-real-provider-smoke.ts',
      'scripts/storyboard-rag-ollama-pull.mjs',
      'scripts/storyboard-gemini-only.mjs',
      'scripts/codex-imagegen-storyboard-provider.py',
    ];
    for (const path of removed) expect(existsSync(join(webRoot, path))).toBe(false);

    const activeRuntime = [
      'lib/admin/storyboard/outbound-worker.ts',
      'lib/admin/storyboard/production-store.ts',
      'lib/admin/storyboard/production-api.ts',
      'components/admin/storyboard/LocalStoryboardWorkspace.tsx',
      'components/admin/storyboard/LegacyStoryboardReference.tsx',
      'scripts/storyboard-gemini-worker.ts',
      'app/api/admin/storyboard/production/[id]/images/route.ts',
    ];
    const forbidden = /local-mlx|chatgpt-manual|grok-manual|openai-api|xai-api|mlx-client|mlx-transport/;
    for (const path of activeRuntime) expect(readFileSync(join(webRoot, path), 'utf8')).not.toMatch(forbidden);
    expect(readFileSync(join(webRoot, 'app/api/admin/storyboard/production/[id]/images/route.ts'), 'utf8'))
      .toContain('retiredStoryboardApi');
    const generator = readFileSync(join(webRoot, 'components/admin/storyboard/AdminStoryboardGenerator.tsx'), 'utf8');
    expect(generator).toContain('LocalStoryboardWorkspace');
    expect(generator).not.toContain('LegacyStoryboardReference');
    for (const path of ['app/api/admin/storyboard/route.ts', 'app/api/admin/storyboard/chat/route.ts',
      'app/api/admin/storyboard/images/route.ts']) {
      expect(readFileSync(join(webRoot, path), 'utf8')).toContain('retiredStoryboardApi');
    }

    const packageJson = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['storyboard:gemini-worker']).toBe('bun scripts/storyboard-gemini-worker.ts');
    for (const name of ['storyboard:image-proof', 'storyboard:local-bridge', 'storyboard:eight-real-smoke', 'storyboard:rag-ollama-pull']) {
      expect(packageJson.scripts[name]).toBeUndefined();
    }

    const migration = readFileSync(join(webRoot, '..', '..', 'backend', 'supabase', 'migrations',
      '20261013093518_storyboard_gemini_execution_v1.sql'), 'utf8');
    expect(migration).toContain("p_payload->>'workflow' IS DISTINCT FROM 'storyboard-gemini-v1'");
    expect(migration).toContain("q.request->>'workflow' = 'storyboard-gemini-v1'");
    expect(migration).toContain("request#>>'{providers,text,model}' = 'gemini-3.8-flash'");
    expect(migration).toContain("request#>>'{providers,image,model}' IN ('gemini-3.1-flash-image','gemini-3-pro-image')");
    expect(migration).toContain("RAISE EXCEPTION 'archived_project_read_only'");
    expect(migration).toContain('CREATE FUNCTION public.storyboard_production_reject_archived_write() RETURNS trigger');
    for (const table of ['projects', 'jobs', 'assets', 'events', 'revisions', 'restores']) {
      expect(migration).toContain(`CREATE TRIGGER storyboard_archive_${table}_write_guard`);
    }
    expect(migration).toContain("IF p_action NOT IN ('edit','regenerate','retry','cancel','restore')");
    expect(migration).toContain("status = 'generating'");
  });
});
