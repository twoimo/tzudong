import { describe, expect, test } from 'bun:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  STORYBOARD_WORKFLOW, MAX_STORYBOARD_IMAGE_BYTES, StoryboardProductionError,
  storyboardProductionRequestSchema, type StoryboardProductionDocument,
  type StoryboardProductionAsset, type StoryboardProductionProvenance,
} from '../lib/admin/storyboard/production-contract';
import { prepareStoryboardAsset, storyboardHash } from '../lib/admin/storyboard/production-assets';
import {
  StoryboardProductionStore, productionActionSchema, manualStoryboardProvenance, validateLocalStoryboardProvenance,
  type ProductionDatabase, type ProductionProject, type ProductionStorage,
} from '../lib/admin/storyboard/production-store';
import {
  authenticateStoryboardWorker, storyboardWorkerTokenHash, workerOperationSchema,
  type ProductionWorkerIdentity,
} from '../lib/admin/storyboard/production-worker-auth';
import { createStoryboardProductionApi, productionApiFailure, readStoryboardMultipart } from '../lib/admin/storyboard/production-api';

// These are unit boundary doubles. The separate PostgreSQL suite exercises real persistence/locks.
const ownerId = randomUUID();
const workerId = randomUUID();
const jobId = randomUUID();
const leaseToken = randomUUID();
const site = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080').origin;
const models = [
  { id: 'installed-text', capabilities: ['chat'], loaded: false, bytes_on_disk: 1000, bytes_resident: 0 },
  { id: 'installed-image', capabilities: ['image'], loaded: true, bytes_on_disk: 1000, bytes_resident: 1000 },
];
const identity: ProductionWorkerIdentity = { id: workerId, ownerId, models };
const req = () => storyboardProductionRequestSchema.parse({ workflow: STORYBOARD_WORKFLOW,
  requestId: randomUUID(), prompt: 'unit fixture', sceneCount: 5,
  providers: { text: { id: 'local-mlx', model: 'installed-text' }, image: { id: 'local-mlx', model: 'installed-image' } },
});
const draft = () => ({ title: 'Unit fixture', logline: 'Contract tests', scenes: Array.from({ length: 5 }, (_, index) => ({
  sceneNo: index + 1, title: `Scene ${index + 1}`, durationSec: 10, description: 'A scene', visualDirection: 'Static frame',
  narration: '', caption: '', productionNotes: ['Unit fixture'], imagePrompt: 'An empty table', sourceIds: [] as string[],
})) });
const proof = (modality = 'image'): StoryboardProductionProvenance => ({ providerId: 'local-mlx', model: `installed-${modality}`,
  verification: 'local-worker', generatedAt: new Date().toISOString(), requestId: randomUUID(), responseId: null,
  responseModel: null, modelEvidence: 'installed-catalog-and-request' });
function project(): ProductionProject {
  const id = randomUUID();
  const document: StoryboardProductionDocument = { ...draft(), schema: STORYBOARD_WORKFLOW, projectId: id, revision: 0,
    generatedAt: new Date().toISOString(), textProvenance: proof('text'),
    scenes: draft().scenes.map((scene) => ({ ...scene, revision: 0, image: null, imageError: null })),
  };
  return { id, revision: 0, request: req(), document, status: 'generating',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function read(project: ProductionProject) { return { ok: true, project, job: null, events: [] }; }
function check(project: ProductionProject, sceneNo = 1) {
  return { ok: true, project, kind: 'generate', models, sceneRevision: project.document!.scenes[sceneNo - 1].revision,
    job: { id: jobId, status: 'claimed', stage: 'images', sceneNo: null, errorCode: null, attempts: 1, lastHeartbeat: new Date().toISOString() } };
}
function row(project: ProductionProject, asset: StoryboardProductionAsset, sceneNo = 1) {
  return { id: asset.id, project_id: project.id, owner_id: ownerId, scene_no: sceneNo, scene_revision: 1, metadata: asset };
}
const unusedDb: ProductionDatabase = {
  async rpc() { throw new Error('unexpected_database_access'); },
  async asset() { throw new Error('unexpected_asset_access'); },
};
class UnitStorage implements ProductionStorage {
  files = new Map<string, { bytes: Buffer; mime: string }>();
  downloads: string[] = [];
  removed: string[][] = [];
  async upload(path: string, bytes: Buffer, mime: string) {
    if (this.files.has(path)) throw new Error('unexpected_overwrite');
    this.files.set(path, { bytes: Buffer.from(bytes), mime });
  }
  async download(path: string) {
    this.downloads.push(path);
    const file = this.files.get(path);
    if (!file) throw new Error('missing_unit_file');
    return new Blob([new Uint8Array(file.bytes)], { type: file.mime });
  }
  async remove(paths: string[]) { this.removed.push(paths); for (const path of paths) this.files.delete(path); }
}
async function png() {
  return sharp({ create: { width: 128, height: 72, channels: 3, background: '#667788' } }).png().toBuffer();
}
function jsonRequest(value: unknown, origin: string = site) {
  return new Request(`${site}/api/admin/storyboard/production`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(value) });
}
function api(store = new StoryboardProductionStore({ database: unusedDb }), userId = ownerId) {
  return createStoryboardProductionApi({ store, requireAdmin: async () => ({ ok: true, userId }),
    authenticateWorker: async () => identity });
}
async function exportFixture() {
  const p = project();
  p.request.providers.image = { id: 'manual', model: '' };
  p.status = 'awaiting_import';
  const prepared = await prepareStoryboardAsset(await png(), p.id, manualStoryboardProvenance(p.request.providers.image));
  p.document!.scenes[0].image = prepared.asset;
  p.document!.scenes[0].revision = 1;
  const storage = new UnitStorage();
  for (const file of prepared.files) await storage.upload(file.path, file.bytes, file.mime);
  const database: ProductionDatabase = {
    async rpc() { return { data: read(p), error: null }; },
    async asset(owner, id, assetId) {
      return { data: owner === ownerId && id === p.id && assetId === prepared.asset.id ? row(p, prepared.asset) : null, error: null };
    },
  };
  return { p, prepared, storage, database, store: new StoryboardProductionStore({ database, storage }) };
}

describe('worker authentication and proof boundary', () => {
  test('hashes canonical 32-byte-or-longer base64url token text with SHA256', () => {
    const token = randomBytes(32).toString('base64url');
    expect(storyboardWorkerTokenHash(`Bearer ${token}`)).toBe(createHash('sha256').update(token).digest('hex'));
    for (const value of [null, 'Bearer short', `Bearer ${token}=`, `Bearer ${randomBytes(31).toString('base64url')}`, `Bearer ${token},extra`]) {
      expect(() => storyboardWorkerTokenHash(value)).toThrow('worker_unauthorized');
    }
    expect(() => storyboardWorkerTokenHash(`Bearer ${randomBytes(97).toString('base64url')}`)).toThrow('worker_unauthorized');
  });
  test('DB lookup gets only the hash and must return one UUID owner', async () => {
    const token = randomBytes(32).toString('base64url');
    let supplied = '';
    const request = new Request(`${site}/api/storyboard-worker`, { headers: { Authorization: `Bearer ${token}` } });
    const authenticated = await authenticateStoryboardWorker(request, async (hash) => { supplied = hash; return identity; });
    expect(supplied).toMatch(/^[a-f0-9]{64}$/);
    expect(supplied).not.toContain(token);
    expect(authenticated.ownerId).toBe(ownerId);
    await expect(authenticateStoryboardWorker(request, async () => ({ ...identity, ownerId: 'e2e-admin-route-bypass' })))
      .rejects.toThrow('worker_unauthorized');
    await expect(authenticateStoryboardWorker(request, async () => { throw new Error('private DB diagnostics'); }))
      .rejects.toThrow('persistence_unavailable');
  });
  test('requires paired heartbeat job and lease and forbids full document or diagnostic fields', () => {
    expect(workerOperationSchema.safeParse({ action: 'heartbeat', models, jobId }).success).toBe(false);
    expect(workerOperationSchema.safeParse({ action: 'heartbeat', models, jobId, leaseToken }).success).toBe(true);
    expect(workerOperationSchema.safeParse({ action: 'draft', jobId, leaseToken, document: project().document }).success).toBe(false);
    expect(workerOperationSchema.safeParse({ action: 'scene-error', jobId, leaseToken, sceneNo: 1, errorCode: 'raw provider response' }).success).toBe(false);
    expect(workerOperationSchema.safeParse({ action: 'claim', serviceRoleKey: 'not-accepted' }).success).toBe(false);
  });
  test('requires configured local model, installed catalog capability and consistent evidence', () => {
    expect(validateLocalStoryboardProvenance(proof(), req(), models, 'image').verification).toBe('local-worker');
    for (const changed of [{ model: 'other' }, { responseModel: 'other' }, { verification: 'official-api' },
      { modelEvidence: 'unverified' }, { modelEvidence: 'response', responseModel: null }]) {
      expect(() => validateLocalStoryboardProvenance({ ...proof(), ...changed }, req(), models, 'image')).toThrow('model_identity_mismatch');
    }
    expect(() => validateLocalStoryboardProvenance(proof(), req(), [], 'image')).toThrow('model_not_installed');
    expect(() => validateLocalStoryboardProvenance(proof(), req(), models.map((model) => ({ ...model, capabilities: ['chat'] })), 'image'))
      .toThrow('model_capability_mismatch');
    expect(validateLocalStoryboardProvenance({ ...proof(), responseModel: 'installed-image', modelEvidence: 'response' }, req(), models, 'image').modelEvidence).toBe('response');
  });
  test('manual proof is always generated as unverified user import', () => {
    const imported = manualStoryboardProvenance({ id: 'grok-manual', model: 'chosen-model' });
    expect(imported).toMatchObject({ providerId: 'grok-manual', model: 'chosen-model', verification: 'user-import',
      responseId: null, responseModel: null, modelEvidence: 'unverified' });
    expect(imported.requestId).not.toBe(manualStoryboardProvenance({ id: 'manual', model: '' }).requestId);
    expect(() => manualStoryboardProvenance({ id: 'local-mlx', model: 'installed-image' })).toThrow('invalid_request');
  });
});

describe('admin/API contracts and bounded failures', () => {
  test('historical restore validates its strict envelope', () => {
    const value = { action: 'restore', revision: 12, targetRevision: 10, requestId: randomUUID() };
    expect(productionActionSchema.safeParse(value).success).toBe(true);
    expect(productionActionSchema.safeParse({ ...value, sceneNo: 2 }).success).toBe(true);
    expect(productionActionSchema.safeParse({ ...value, targetRevision: undefined }).success).toBe(false);
    expect(productionActionSchema.safeParse({ ...value, provider: 'local-mlx' }).success).toBe(false);
  });
  test('restore goes through the atomic admin RPC without worker or model calls', async () => {
    const p = project(); p.status = 'ready'; p.revision = 13;
    p.document!.revision = 13;
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const store = new StoryboardProductionStore({ database: { ...unusedDb, async rpc(name, args) {
      calls.push({ name, args });
      return { data: args.p_action === 'read' ? read(p) : { ok: true, project: p, job: null }, error: null };
    } } });
    const restore = { action: 'restore', revision: 12, targetRevision: 10, requestId: randomUUID() };
    await store.apply(ownerId, p.id, restore);
    await store.apply(ownerId, p.id, restore);
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.name === 'storyboard_production_admin')).toBe(true);
    for (const call of calls.filter((call) => call.args.p_action !== 'read')) expect(call).toEqual({ name: 'storyboard_production_admin', args: {
      p_owner_id: ownerId, p_action: 'restore', p_project_id: p.id, p_revision: 12,
      p_payload: { targetRevision: 10, requestId: restore.requestId },
    } });
  });
  test('restore refuses missing or corrupt original bytes before any mutation', async () => {
    const fixture = await exportFixture();
    fixture.p.revision = 2; fixture.p.document!.revision = 2;
    const preview = structuredClone(fixture.p.document!); preview.revision = 1;
    const actions: unknown[] = [];
    const store = new StoryboardProductionStore({ storage: fixture.storage, database: {
      ...fixture.database, async rpc(_name, args) {
        actions.push(args.p_action);
        return { data: args.p_action === 'versions' ? { ok: true, versions: [], preview } : read(fixture.p), error: null };
      },
    } });
    const original = fixture.prepared.asset.original;
    fixture.storage.files.delete(original.path);
    await expect(store.apply(ownerId, fixture.p.id, { action: 'restore', revision: 2, targetRevision: 1, requestId: randomUUID() })).rejects.toThrow('restore_asset_missing');
    fixture.storage.files.set(original.path, { bytes: Buffer.alloc(original.bytes), mime: original.mime });
    await expect(store.apply(ownerId, fixture.p.id, { action: 'restore', revision: 2, targetRevision: 1, requestId: randomUUID() })).rejects.toThrow('restore_asset_missing');
    expect(actions).toEqual(['read', 'versions', 'read', 'versions']);
  });
  test('versions and preview use the authenticated existing project GET handler', async () => {
    const id = randomUUID();
    const calls: Record<string, unknown>[] = [];
    const store = new StoryboardProductionStore({ database: { ...unusedDb, async rpc(name, args) {
      expect(name).toBe('storyboard_production_admin'); calls.push(args);
      return { data: { ok: true, versions: [], preview: null }, error: null };
    } } });
    const result = await api(store).projectGET(new Request(`${site}?versions=1&targetRevision=12`), { params: Promise.resolve({ id }) });
    expect(result.status).toBe(200);
    expect(calls).toEqual([{ p_owner_id: ownerId, p_action: 'versions', p_project_id: id, p_revision: null, p_payload: { targetRevision: 12 } }]);
  });
  test('restore DB failures have bounded HTTP codes', async () => {
    for (const [code, status] of [['version_not_found', 404], ['restore_asset_missing', 409], ['revision_conflict', 409], ['project_busy', 409]] as const) {
      const store = new StoryboardProductionStore({ database: { ...unusedDb, async rpc() {
        return { data: null, error: { message: code } };
      } } });
      const result = await api(store).projectPOST(jsonRequest({ action: 'restore', revision: 12, targetRevision: 10, requestId: randomUUID() }),
        { params: Promise.resolve({ id: randomUUID() }) });
      expect(result.status).toBe(status);
      expect(await result.json()).toEqual({ ok: false, error: code });
    }
  });
  test('all admin endpoints require auth before params, body, storage or DB work', async () => {
    let authCalls = 0;
    const handlers = createStoryboardProductionApi({ store: new StoryboardProductionStore({ database: unusedDb }),
      requireAdmin: async () => { authCalls++; return { ok: false, response: new Response('private auth error', { status: 401 }) }; } });
    const context = { params: Promise.resolve({ id: 'invalid', assetId: 'invalid' }) };
    const denied = await Promise.all([
      handlers.listGET(new Request(site)), handlers.listPOST(jsonRequest({})),
      handlers.projectGET(new Request(site), context), handlers.projectPOST(jsonRequest({}), context),
      handlers.imagePOST(jsonRequest({}), context), handlers.assetGET(new Request(site), context),
      handlers.exportGET(new Request(site), context),
    ]);
    expect(authCalls).toBe(7);
    for (const response of denied) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });
  test('synthetic dev/e2e identities cannot become UUID owners', async () => {
    const response = await api(undefined, 'e2e-admin-route-bypass').listPOST(jsonRequest(req()));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'owner_forbidden' });
  });
  test('admin mutations reject cross-origin even with an arbitrary bearer header', async () => {
    const request = jsonRequest(req(), 'https://untrusted.invalid');
    request.headers.set('Authorization', 'Bearer arbitrary-csrf-bypass-attempt');
    const response = await api().listPOST(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'origin_forbidden' });
    expect(request.bodyUsed).toBe(false);
  });
  test('invalid IDs and unknown payload fields fail before DB calls', async () => {
    expect((await api().projectGET(new Request(site), { params: Promise.resolve({ id: '../other-owner' }) })).status).toBe(400);
    const invalid = { ...req(), ownerId: randomUUID() };
    expect((await api().listPOST(jsonRequest(invalid))).status).toBe(400);
    expect(productionActionSchema.safeParse({ action: 'edit', revision: 0, sceneNo: 1,
      scene: { ...draft().scenes[0], image: { url: 'https://untrusted.invalid' } } }).success).toBe(false);
    expect(productionActionSchema.safeParse({ action: 'import-text', revision: 0, projectId: randomUUID(),
      schema: STORYBOARD_WORKFLOW, draft: draft(), provenance: proof() }).success).toBe(false);
  });
  test('external providers need consent and configured official APIs never dispatch', async () => {
    for (const modality of ['text', 'image'] as const) {
      const request = req(); request.providers[modality] = { id: 'chatgpt-manual', model: '' };
      expect(await (await api().listPOST(jsonRequest(request))).json()).toEqual({ ok: false, error: 'external_ai_disabled' });
      request.providers.externalAI = true; request.providers[modality] = { id: 'openai-api', model: 'selected' };
      const response = await api().listPOST(jsonRequest(request));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: 'provider_not_configured' });
    }
  });
  test('actual JSON size is bounded even with a false content-length', async () => {
    const request = new Request(site, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: site, 'Content-Length': '0' },
      body: JSON.stringify({ data: 'x'.repeat(200 * 1024) }) });
    expect((await api().listPOST(request)).status).toBe(413);
  });
  test('fixed error response never includes exception strings or DB diagnostics', async () => {
    for (const error of [new Error('token=private'), new StoryboardProductionError('raw provider failure token=private')]) {
      expect(await productionApiFailure(error).json()).toEqual({ ok: false, error: 'provider_failed' });
    }
    const store = new StoryboardProductionStore({ database: { ...unusedDb,
      async rpc() { return { data: null, error: { message: 'provider body password=private' } }; } } });
    expect(await (await api(store).listGET(new Request(site))).json()).toEqual({ ok: false, error: 'persistence_unavailable' });
  });
  test('worker endpoint authenticates before consuming invalid JSON', async () => {
    const request = jsonRequest({ action: 'claim' });
    const handlers = createStoryboardProductionApi({ authenticateWorker: async () => { throw new StoryboardProductionError('worker_unauthorized'); } });
    expect((await handlers.workerPOST(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });
});

describe('multipart and transactional image checkpoints', () => {
  test('rejects unknown and duplicate multipart fields', async () => {
    const form = new FormData(); form.set('revision', '0'); form.set('file', new File([await png()], 'input.png', { type: 'image/png' }));
    form.append('revision', '1');
    await expect(readStoryboardMultipart(new Request(site, { method: 'POST', body: form }), ['revision', 'file'])).rejects.toThrow('invalid_request');
    form.delete('revision'); form.set('revision', '0'); form.set('provenance', JSON.stringify(proof()));
    await expect(readStoryboardMultipart(new Request(site, { method: 'POST', body: form }), ['revision', 'file'])).rejects.toThrow('invalid_request');
  });
  test('bounds chunked multipart bytes before parsing a file', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_STORYBOARD_IMAGE_BYTES + 32 * 1024 + 1)); controller.close();
    } });
    const request = new Request(site, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=fixture' },
      body, duplex: 'half' } as RequestInit);
    await expect(readStoryboardMultipart(request, ['file'])).rejects.toThrow('request_too_large');
  });
  test('manual image import rejects projectId mismatch and provenance metadata', async () => {
    const id = randomUUID();
    const form = new FormData(); form.set('revision', '0'); form.set('sceneNo', '1'); form.set('projectId', randomUUID());
    form.set('schema', STORYBOARD_WORKFLOW); form.set('file', new File([await png()], 'input.png', { type: 'image/png' }));
    const post = () => new Request(site, { method: 'POST', headers: { Origin: site }, body: form });
    expect((await api().imagePOST(post(), { params: Promise.resolve({ id }) })).status).toBe(400);
    form.set('projectId', id); form.set('provenance', JSON.stringify(proof()));
    expect((await api().imagePOST(post(), { params: Promise.resolve({ id }) })).status).toBe(400);
  });
  test('rechecks lease after upload and removes unreferenced variants after cancellation', async () => {
    const p = project();
    const storage = new UnitStorage();
    const actions: string[] = [];
    const database: ProductionDatabase = {
      async rpc(_name, args) {
        actions.push(String(args.p_action));
        if (args.p_action === 'check') return { data: check(p), error: null };
        expect(storage.files.size).toBe(2);
        expect(args.p_lease_token).toBe(leaseToken);
        expect(args.p_payload).toMatchObject({ sceneNo: 1, sceneRevision: 0 });
        return { data: null, error: { message: 'worker_lease_lost' } };
      },
      async asset() { return { data: null, error: null }; },
    };
    const store = new StoryboardProductionStore({ database, storage });
    await expect(store.workerImage(identity, jobId, leaseToken, 1, proof(), await png(), 'image/png')).rejects.toThrow('worker_lease_lost');
    expect(actions).toEqual(['check', 'image']);
    expect(storage.files.size).toBe(0);
    expect(storage.removed[0]).toHaveLength(2);
  });
  test('reads back an uncertain checkpoint before cleanup and accepts only its committed asset', async () => {
    const p = project(); const storage = new UnitStorage();
    let persisted: ReturnType<typeof row> | null = null;
    let writes = 0;
    const database: ProductionDatabase = {
      async rpc(_name, args) {
        if (args.p_action === 'check') return { data: check(p), error: null };
        writes++;
        const payload = args.p_payload as { asset: StoryboardProductionAsset };
        persisted = row(p, payload.asset);
        return { data: null, error: { message: 'transport result was lost' } };
      },
      async asset() { return { data: persisted, error: null }; },
    };
    const store = new StoryboardProductionStore({ database, storage });
    expect(await store.workerImage(identity, jobId, leaseToken, 1, proof(), await png(), 'image/png')).toEqual({ ok: true });
    expect(writes).toBe(1);
    expect(storage.removed).toHaveLength(0);
    expect(storage.files.size).toBe(2);
  });
  test('keeps uploaded files private when checkpoint readback is itself uncertain', async () => {
    const p = project(); const storage = new UnitStorage();
    const database: ProductionDatabase = {
      async rpc(_name, args) { return args.p_action === 'check' ? { data: check(p), error: null }
        : { data: null, error: { message: 'transport failure' } }; },
      async asset() { return { data: null, error: { message: 'readback unavailable' } }; },
    };
    const store = new StoryboardProductionStore({ database, storage });
    await expect(store.workerImage(identity, jobId, leaseToken, 1, proof(), await png(), 'image/png')).rejects.toThrow('persistence_unavailable');
    expect(storage.removed).toHaveLength(0);
    expect(storage.files.size).toBe(2);
  });
  test('rejects mismatched MIME or provenance before any upload', async () => {
    const p = project(); const storage = new UnitStorage();
    const database = { ...unusedDb, async rpc() { return { data: check(p), error: null }; } };
    const store = new StoryboardProductionStore({ database, storage });
    await expect(store.workerImage(identity, jobId, leaseToken, 1, proof(), await png(), 'image/jpeg')).rejects.toThrow('invalid_image');
    await expect(store.workerImage(identity, jobId, leaseToken, 1, { ...proof(), model: 'wrong' }, await png(), 'image/png')).rejects.toThrow('model_identity_mismatch');
    expect(storage.files.size).toBe(0);
  });
});

describe('private asset downloads and bounded reopenable exports', () => {
  test('exports original plus WebP bytes and preserves request/document fields', async () => {
    const fixture = await exportFixture();
    const bytes = await fixture.store.exportProject(ownerId, fixture.p.id);
    const exported = JSON.parse(bytes.toString());
    expect(exported.schema).toBe('storyboard-export-v1');
    expect(exported.project).toEqual(fixture.p);
    expect(exported.document).toEqual(fixture.p.document);
    expect(exported.files).toHaveLength(2);
    for (const file of exported.files) {
      expect(storyboardHash(Buffer.from(file.base64, 'base64'))).toBe(file.sha256);
      expect(fixture.storage.files.get(file.path)?.bytes.equals(Buffer.from(file.base64, 'base64'))).toBe(true);
    }
    const response = await api(fixture.store).exportGET(new Request(site), { params: Promise.resolve({ id: fixture.p.id }) });
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  test('selects only the exact DB variant basename and checks MIME and SHA256', async () => {
    const fixture = await exportFixture();
    const original = fixture.prepared.asset.original;
    const download = () => fixture.store.downloadAsset(ownerId, fixture.p.id, fixture.prepared.asset.id, 'original.png');
    expect((await download()).bytes.equals(fixture.prepared.files[0].bytes)).toBe(true);
    await expect(fixture.store.downloadAsset(ownerId, fixture.p.id, fixture.prepared.asset.id, '../original.png')).rejects.toThrow('invalid_asset_variant');
    const stored = fixture.storage.files.get(original.path)!;
    const changed = Buffer.from(stored.bytes); changed[changed.length - 1] ^= 1;
    fixture.storage.files.set(original.path, { bytes: changed, mime: original.mime });
    await expect(download()).rejects.toThrow('invalid_asset');
    fixture.storage.files.set(original.path, { bytes: stored.bytes, mime: 'text/html' });
    await expect(download()).rejects.toThrow('invalid_asset');
  });
  test('refuses URL parameters and extra/duplicate variant selectors', async () => {
    const p = project(); const context = { params: Promise.resolve({ id: p.id, assetId: randomUUID() }) };
    for (const query of ['variant=https://example.invalid/image.png', 'variant=original.png&url=https://example.invalid',
      'variant=original.png&variant=web-128.webp', '']) {
      expect((await api().assetGET(new Request(`${site}/asset?${query}`), context)).status).toBe(400);
    }
  });
  test('export rejects document asset claims that differ from authoritative rows', async () => {
    const fixture = await exportFixture();
    fixture.p.document!.scenes[0].image = structuredClone(fixture.prepared.asset);
    fixture.p.document!.scenes[0].image!.original.sha256 = '0'.repeat(64);
    await expect(fixture.store.exportProject(ownerId, fixture.p.id)).rejects.toThrow('invalid_asset');
    expect(fixture.storage.downloads).toHaveLength(0);
  });
  test('checks total base64 export budget before downloading any object', async () => {
    const fixture = await exportFixture();
    const rows = new Map<string, ReturnType<typeof row>>();
    for (const scene of fixture.p.document!.scenes) {
      const asset = structuredClone(fixture.prepared.asset);
      asset.id = randomUUID();
      asset.original.path = `${fixture.p.id}/${asset.id}/original.png`; asset.original.bytes = MAX_STORYBOARD_IMAGE_BYTES;
      for (const variant of asset.web) { variant.path = `${fixture.p.id}/${asset.id}/web-128.webp`; variant.bytes = MAX_STORYBOARD_IMAGE_BYTES; }
      scene.image = asset;
      rows.set(asset.id, row(fixture.p, asset, scene.sceneNo));
    }
    const database = { ...fixture.database, async asset(_owner: string, _project: string, id: string) { return { data: rows.get(id) ?? null, error: null }; } };
    const store = new StoryboardProductionStore({ database, storage: fixture.storage });
    await expect(store.exportProject(ownerId, fixture.p.id)).rejects.toThrow('export_too_large');
    expect(fixture.storage.downloads).toHaveLength(0);
  });
});
