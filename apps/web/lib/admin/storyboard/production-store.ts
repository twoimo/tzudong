import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import { createSupabaseStorageServerClient } from '@/lib/supabase/storage-server';
import {
  MAX_STORYBOARD_DOCUMENT_BYTES, MAX_STORYBOARD_IMAGE_BYTES, STORYBOARD_WORKFLOW,
  StoryboardProductionError, assertStoryboardProviderPolicy, parseStoryboardDraft,
  storyboardDraftSceneSchema, storyboardDraftSchema, storyboardProductionDocumentSchema,
  storyboardProductionRequestSchema, storyboardProvenanceSchema,
  type StoryboardProductionAsset, type StoryboardProductionDocument, type StoryboardProductionProvenance,
  type StoryboardProductionRequest, type StoryboardProvider,
} from './production-contract';
import { prepareStoryboardAsset, STORYBOARD_ASSET_BUCKET, storyboardHash, trustedStoryboardAsset } from './production-assets';
import {
  productionModelsSchema, productionUuid, workerFailureSchema, workerOperationSchema,
  type ProductionModel, type ProductionWorkerIdentity,
} from './production-worker-auth';

if (typeof window !== 'undefined') throw new Error('Storyboard persistence is server-only.');

export const MAX_STORYBOARD_EXPORT_BYTES = 96 * 1024 * 1024;
export const PRODUCTION_FAILURE_STATUSES: Readonly<Record<string, number>> = {
  invalid_request: 400, request_too_large: 413, document_too_large: 413, export_too_large: 413,
  invalid_scene: 400, invalid_asset: 502, invalid_asset_variant: 400, invalid_provenance: 400,
  unauthorized: 401, worker_unauthorized: 401, owner_forbidden: 403, origin_forbidden: 403,
  project_not_found: 404, asset_not_found: 404, revision_conflict: 409, worker_lease_lost: 409,
  request_conflict: 409, project_busy: 409, nothing_to_retry: 409,
  persistence_unavailable: 503, persistence_invalid_data: 502, storage_unavailable: 503,
  external_ai_disabled: 400, model_not_selected: 400, provider_not_configured: 503,
  model_not_installed: 409, model_capability_mismatch: 409, model_identity_mismatch: 409,
  invalid_structured_response: 400, invalid_image: 400, image_too_large: 413,
  provider_failed: 502,
  version_not_found: 404, restore_asset_missing: 409,
};
const knownErrors = new Set([...Object.keys(PRODUCTION_FAILURE_STATUSES), ...workerFailureSchema.options]);
const timestamp = z.iso.datetime({ offset: true });
export const productionProjectSchema = z.object({
  id: productionUuid, revision: z.number().int().nonnegative(),
  request: storyboardProductionRequestSchema, document: storyboardProductionDocumentSchema.nullable(),
  status: z.enum(['waiting_worker', 'generating', 'awaiting_import', 'partial', 'ready', 'failed', 'cancelled']),
  createdAt: timestamp, updatedAt: timestamp,
}).strict();
export const productionJobSchema = z.object({
  id: productionUuid, status: z.enum(['queued', 'claimed', 'succeeded', 'failed', 'cancelled']),
  stage: z.enum(['queued', 'text', 'images', 'complete', 'failed', 'cancelled']),
  sceneNo: z.number().int().min(1).max(12).nullable(), errorCode: workerFailureSchema.nullable(),
  attempts: z.number().int().min(0).max(3), lastHeartbeat: timestamp.nullable(),
}).strict();
const snapshotSchema = z.object({ ok: z.literal(true), project: productionProjectSchema, job: productionJobSchema.nullable() }).strict();
const eventSchema = z.object({
  id: z.string().regex(/^\d{1,20}$/), jobId: productionUuid.nullable(),
  operation: z.enum(['created', 'queued', 'claimed', 'edited', 'draft_saved', 'image_saved', 'scene_failed', 'cancelled', 'lease_expired', 'finished', 'restored']),
  revision: z.number().int().nonnegative(), sceneNo: z.number().int().min(1).max(12).nullable(),
  errorCode: workerFailureSchema.nullable(), createdAt: timestamp,
}).strict();
const readSchema = snapshotSchema.extend({ events: z.array(eventSchema).max(100) });
const listSchema = z.object({ ok: z.literal(true),
  projects: z.array(z.object({ id: productionUuid, revision: z.number().int().nonnegative(),
    status: productionProjectSchema.shape.status, title: z.string().max(200), createdAt: timestamp, updatedAt: timestamp }).strict()).max(50),
  workers: z.array(z.object({ id: productionUuid, online: z.boolean(), lastHeartbeat: timestamp.nullable(), models: productionModelsSchema }).strict()).max(64),
}).strict();
const checkSchema = snapshotSchema.extend({ kind: z.enum(['generate', 'scene']), sceneRevision: z.number().int().nonnegative().nullable(), models: productionModelsSchema });
const claimSchema = z.object({ ok: z.literal(true), job: z.object({
  id: productionUuid, projectId: productionUuid, revision: z.number().int().nonnegative(), kind: z.enum(['generate', 'scene']),
  sceneNo: z.number().int().min(1).max(12).nullable(), request: storyboardProductionRequestSchema,
  document: storyboardProductionDocumentSchema.nullable(), leaseToken: productionUuid,
}).strict().nullable() }).strict();
const okSchema = z.object({ ok: z.literal(true) }).strict();
const heartbeatSchema = okSchema.extend({ leaseValid: z.boolean() });
const versionsSchema = z.object({
  ok: z.literal(true),
  versions: z.array(z.object({
    revision: z.number().int().nonnegative(),
    createdAt: timestamp,
    title: z.string().max(200),
    sceneCount: z.number().int().min(0).max(12),
  }).strict()).max(200),
  preview: storyboardProductionDocumentSchema.nullable(),
}).strict();

export const productionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), revision: z.number().int().nonnegative(),
    sceneNo: z.number().int().min(1).max(12), scene: storyboardDraftSceneSchema }).strict(),
  z.object({ action: z.literal('regenerate'), revision: z.number().int().nonnegative(),
    sceneNo: z.number().int().min(1).max(12), requestId: productionUuid }).strict(),
  z.object({ action: z.literal('retry'), revision: z.number().int().nonnegative(), requestId: productionUuid }).strict(),
  z.object({ action: z.literal('cancel'), revision: z.number().int().nonnegative(), jobId: productionUuid }).strict(),
  z.object({ action: z.literal('import-text'), revision: z.number().int().nonnegative(), projectId: productionUuid,
    schema: z.literal(STORYBOARD_WORKFLOW), draft: storyboardDraftSchema }).strict(),
  z.object({ action: z.literal('restore'), revision: z.number().int().nonnegative(),
    targetRevision: z.number().int().nonnegative(), requestId: productionUuid,
    sceneNo: z.number().int().min(1).max(12).optional() }).strict(),
]);
export type ProductionSnapshot = z.infer<typeof snapshotSchema>;
export type ProductionProject = ProductionSnapshot['project'];
export type ProductionAction = z.infer<typeof productionActionSchema>;

type DbResult = { data: unknown; error: { message?: string; code?: string } | null };
export interface ProductionDatabase {
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  asset(ownerId: string, projectId: string, assetId: string): Promise<DbResult>;
}
export interface ProductionStorage {
  upload(path: string, bytes: Buffer, mime: string): Promise<void>;
  download(path: string): Promise<Blob>;
  remove(paths: string[]): Promise<void>;
}

/** Generated Database types are intentionally unchanged in this parallel slice. */
const serverDatabase: ProductionDatabase = {
  async rpc(name, args) {
    return await createSupabaseServiceRoleClient().rpc(name as never, args as never);
  },
  async asset(ownerId, projectId, assetId) {
    return await createSupabaseServiceRoleClient().from('admin_storyboard_production_assets' as never)
      .select('id,project_id,owner_id,scene_no,scene_revision,metadata')
      .eq('owner_id', ownerId).eq('project_id', projectId).eq('id', assetId).maybeSingle();
  },
};

// Local Storage has a different admitted server credential from the DB service role.
const serverStorage: ProductionStorage = {
  async upload(path, bytes, mime) {
    const { error } = await createSupabaseStorageServerClient().from(STORYBOARD_ASSET_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false, cacheControl: '0' });
    if (error) throw new StoryboardProductionError('storage_unavailable');
  },
  async download(path) {
    const { data, error } = await createSupabaseStorageServerClient().from(STORYBOARD_ASSET_BUCKET).download(path);
    if (error || !data) throw new StoryboardProductionError('storage_unavailable');
    return data;
  },
  async remove(paths) {
    const { error } = await createSupabaseStorageServerClient().from(STORYBOARD_ASSET_BUCKET).remove(paths);
    if (error) throw new StoryboardProductionError('storage_unavailable');
  },
};

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StoryboardProductionError('persistence_invalid_data');
  return parsed.data;
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StoryboardProductionError('invalid_request');
  return parsed.data;
}
export function assertProductionDocumentSize(value: unknown): void {
  // Reserve space for jsonb separators and server-added revision/provenance metadata.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_STORYBOARD_DOCUMENT_BYTES - 4096) {
    throw new StoryboardProductionError('document_too_large');
  }
}
export function isManualStoryboardProvider(provider: StoryboardProvider): boolean {
  return ['manual', 'chatgpt-manual', 'grok-manual'].includes(provider.id);
}
export function manualStoryboardProvenance(provider: StoryboardProvider): StoryboardProductionProvenance {
  if (!isManualStoryboardProvider(provider)) throw new StoryboardProductionError('invalid_request');
  return { providerId: provider.id, model: provider.model, verification: 'user-import', generatedAt: new Date().toISOString(),
    requestId: randomUUID(), responseId: null, responseModel: null, modelEvidence: 'unverified' };
}
export function validateLocalStoryboardProvenance(
  value: unknown, request: StoryboardProductionRequest, models: ProductionModel[], modality: 'text' | 'image',
): StoryboardProductionProvenance {
  const result = storyboardProvenanceSchema.safeParse(value);
  if (!result.success) throw new StoryboardProductionError('invalid_provenance');
  const proof = result.data;
  const provider = request.providers[modality];
  if (provider.id !== 'local-mlx' || proof.providerId !== 'local-mlx' || proof.verification !== 'local-worker'
    || proof.model !== provider.model || (proof.responseModel !== null && proof.responseModel !== provider.model)
    || proof.modelEvidence === 'unverified'
    || (proof.modelEvidence === 'response' && proof.responseModel !== provider.model)
    || (proof.modelEvidence === 'installed-catalog-and-request' && proof.responseModel !== null)) {
    throw new StoryboardProductionError('model_identity_mismatch');
  }
  const model = models.find((entry) => entry.id === provider.model && entry.bytes_on_disk > 0);
  if (!model) throw new StoryboardProductionError('model_not_installed');
  if (!model.capabilities.includes(modality === 'text' ? 'chat' : 'image')) {
    throw new StoryboardProductionError('model_capability_mismatch');
  }
  return proof;
}

function assertEditable(snapshot: ProductionSnapshot, revision: number): void {
  if (snapshot.project.revision !== revision) throw new StoryboardProductionError('revision_conflict');
  if (snapshot.job && ['queued', 'claimed'].includes(snapshot.job.status)) throw new StoryboardProductionError('project_busy');
}
function requireScene(project: ProductionProject, sceneNo: number) {
  const scene = project.document?.scenes[sceneNo - 1];
  if (!scene || scene.sceneNo !== sceneNo) throw new StoryboardProductionError('invalid_scene');
  return scene;
}
function previewImageCheckpoint(project: ProductionProject, sceneNo: number, asset: StoryboardProductionAsset) {
  requireScene(project, sceneNo);
  const document = project.document!;
  assertProductionDocumentSize({ ...document, revision: project.revision + 1,
    scenes: document.scenes.map((scene) => scene.sceneNo !== sceneNo ? scene : {
      ...scene, revision: scene.revision + 1, image: asset, imageError: null,
    }) });
}

export class StoryboardProductionStore {
  readonly database: ProductionDatabase;
  readonly storage: ProductionStorage;
  constructor(options: { database?: ProductionDatabase; storage?: ProductionStorage } = {}) {
    this.database = options.database ?? serverDatabase;
    this.storage = options.storage ?? serverStorage;
  }

  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let result: DbResult;
    try { result = await this.database.rpc(name, args); }
    catch { throw new StoryboardProductionError('persistence_unavailable'); }
    if (result.error) {
      const message = result.error.message;
      const code = message && knownErrors.has(message) ? message
        : result.error.code === '23505' ? 'request_conflict'
          : result.error.code === '23514' ? 'invalid_request' : 'persistence_unavailable';
      throw new StoryboardProductionError(code);
    }
    return result.data;
  }
  private admin(ownerId: string, action: string, projectId: string | null = null, revision: number | null = null, payload: unknown = {}) {
    return this.rpc('storyboard_production_admin', { p_owner_id: input(productionUuid, ownerId), p_action: action,
      p_project_id: projectId === null ? null : input(productionUuid, projectId), p_revision: revision, p_payload: payload });
  }
  private worker(workerId: string, action: string, jobId: string | null = null, leaseToken: string | null = null, payload: unknown = {}) {
    return this.rpc('storyboard_production_worker', { p_worker_id: input(productionUuid, workerId), p_action: action,
      p_job_id: jobId === null ? null : input(productionUuid, jobId),
      p_lease_token: leaseToken === null ? null : input(productionUuid, leaseToken), p_payload: payload });
  }
  async list(ownerId: string) {
    const result = decode(listSchema, await this.admin(ownerId, 'list'));
    return { ...result, workers: result.workers.map((worker) => ({ ...worker, models: worker.models.map((model) => ({
      id: model.id, capabilities: model.capabilities, loaded: model.loaded,
      bytes_on_disk: model.bytes_on_disk, bytes_resident: model.bytes_resident,
    })) })) };
  }
  async get(ownerId: string, projectId: string) {
    return decode(readSchema, await this.admin(ownerId, 'read', projectId));
  }
  async versions(ownerId: string, projectId: string, targetRevision?: number) {
    return decode(versionsSchema, await this.admin(ownerId, 'versions', projectId, null,
      targetRevision === undefined ? {} : { targetRevision }));
  }
  async create(ownerId: string, value: unknown) {
    const request = input(storyboardProductionRequestSchema, value);
    assertStoryboardProviderPolicy(request.providers);
    if ([request.providers.text, request.providers.image].some((provider) => ['openai-api', 'xai-api'].includes(provider.id))) {
      throw new StoryboardProductionError('provider_not_configured');
    }
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > 60 * 1024) throw new StoryboardProductionError('request_too_large');
    return decode(snapshotSchema, await this.admin(ownerId, 'create', null, null, request));
  }
  async apply(ownerId: string, projectId: string, value: unknown) {
    const change = input(productionActionSchema, value);
    // Restore CAS, busy checks and request replay are serialized together by the DB.
    // A pre-read revision check would reject a successful request retried after a lost response.
    if (change.action === 'restore') {
      const before = await this.get(ownerId, projectId);
      if (before.project.revision === change.revision && !['queued', 'claimed'].includes(before.job?.status ?? '')) {
        const { preview } = await this.versions(ownerId, projectId, change.targetRevision);
        if (!preview) throw new StoryboardProductionError('version_not_found');
        for (const scene of preview.scenes) {
          if ((change.sceneNo !== undefined && change.sceneNo !== scene.sceneNo) || !scene.image) continue;
          try {
            const row = await this.assetRow(ownerId, projectId, scene.image.id);
            if (!row || row.scene_no !== scene.sceneNo || JSON.stringify(row.asset) !== JSON.stringify(scene.image)) {
              throw new StoryboardProductionError('restore_asset_missing');
            }
            await this.verifiedBytes(row.asset.original);
          } catch (error) {
            if (error instanceof StoryboardProductionError && ['asset_not_found', 'invalid_asset', 'storage_unavailable', 'restore_asset_missing'].includes(error.code)) {
              throw new StoryboardProductionError('restore_asset_missing');
            }
            throw error;
          }
        }
      }
    }
    if (change.action === 'edit' || change.action === 'import-text') {
      const before = await this.get(ownerId, projectId);
      assertEditable(before, change.revision);
      if (change.action === 'edit') {
        const existing = requireScene(before.project, change.sceneNo);
        if (change.scene.sceneNo !== change.sceneNo
          || change.scene.sourceIds.some((id) => !before.project.request.sources.some((source) => source.id === id))) {
          throw new StoryboardProductionError('invalid_scene');
        }
        assertProductionDocumentSize({ ...before.project.document,
          scenes: before.project.document!.scenes.map((scene) => scene.sceneNo === change.sceneNo ? {
            ...change.scene, image: existing.image, imageError: existing.imageError, revision: existing.revision + 1,
          } : scene) });
      } else {
        if (change.projectId !== projectId || before.project.document !== null
          || !isManualStoryboardProvider(before.project.request.providers.text)) throw new StoryboardProductionError('invalid_request');
        parseStoryboardDraft(change.draft, before.project.request);
        assertProductionDocumentSize(change.draft);
      }
    }
    const { action, revision, ...payload } = change;
    return decode(snapshotSchema, await this.admin(ownerId, action, projectId, revision, payload));
  }

  async workerOperation(identity: ProductionWorkerIdentity, value: unknown) {
    const operation = input(workerOperationSchema, value);
    if (operation.action === 'claim') return decode(claimSchema, await this.worker(identity.id, 'claim'));
    if (operation.action === 'heartbeat') return decode(heartbeatSchema, await this.worker(identity.id, 'heartbeat',
      operation.jobId ?? null, operation.leaseToken ?? null, { models: operation.models }));
    const { action, jobId, leaseToken, ...payload } = operation;
    if (action === 'draft') {
      const check = decode(checkSchema, await this.worker(identity.id, 'check', jobId, leaseToken));
      const draft = parseStoryboardDraft(operation.draft, check.project.request);
      const provenance = validateLocalStoryboardProvenance(operation.provenance, check.project.request, check.models, 'text');
      assertProductionDocumentSize({ ...draft, textProvenance: provenance });
      return decode(okSchema, await this.worker(identity.id, action, jobId, leaseToken, { draft, provenance }));
    }
    return decode(okSchema, await this.worker(identity.id, action, jobId, leaseToken, payload));
  }

  private async assetRow(ownerId: string, projectId: string, assetId: string) {
    let result: DbResult;
    try { result = await this.database.asset(input(productionUuid, ownerId), input(productionUuid, projectId), input(productionUuid, assetId)); }
    catch { throw new StoryboardProductionError('persistence_unavailable'); }
    if (result.error) throw new StoryboardProductionError('persistence_unavailable');
    if (result.data === null) return null;
    const row = decode(z.object({ id: productionUuid, project_id: productionUuid, owner_id: productionUuid,
      scene_no: z.number().int().min(1).max(12), scene_revision: z.number().int().nonnegative(), metadata: z.unknown() }).strict(), result.data);
    const asset = trustedStoryboardAsset(row.metadata, projectId);
    if (!asset || row.id !== asset.id || row.id !== assetId || row.project_id !== projectId || row.owner_id !== ownerId) {
      throw new StoryboardProductionError('invalid_asset');
    }
    return { ...row, asset };
  }

  private async uploadAndCheckpoint(
    ownerId: string, projectId: string, prepared: Awaited<ReturnType<typeof prepareStoryboardAsset>>,
    checkpoint: () => Promise<unknown>,
  ): Promise<void> {
    const paths = prepared.files.map((file) => file.path);
    const cleanup = async () => {
      // Best effort only: unreferenced files stay private when Storage is unavailable.
      try { await this.storage.remove(paths); } catch { /* No diagnostics or credentials are logged. */ }
    };
    try {
      for (const file of prepared.files) await this.storage.upload(file.path, file.bytes, file.mime);
    } catch {
      await cleanup();
      throw new StoryboardProductionError('storage_unavailable');
    }
    try { await checkpoint(); }
    catch (error) {
      // An RPC timeout may happen after commit. Read back before removing any referenced files.
      let row: Awaited<ReturnType<StoryboardProductionStore['assetRow']>>;
      try { row = await this.assetRow(ownerId, projectId, prepared.asset.id); }
      catch { throw new StoryboardProductionError('persistence_unavailable'); }
      if (row && JSON.stringify(row.asset) === JSON.stringify(prepared.asset)) return;
      if (row) throw new StoryboardProductionError('invalid_asset');
      await cleanup();
      throw error;
    }
  }

  async importImage(ownerId: string, projectId: string, revision: number, sceneNo: number, bytes: Buffer, mime: string) {
    const before = await this.get(ownerId, projectId);
    assertEditable(before, input(z.number().int().nonnegative(), revision));
    const scene = requireScene(before.project, input(z.number().int().min(1).max(12), sceneNo));
    const proof = manualStoryboardProvenance(before.project.request.providers.image);
    const prepared = await prepareStoryboardAsset(bytes, projectId, proof);
    if (prepared.asset.original.mime !== mime) throw new StoryboardProductionError('invalid_image');
    previewImageCheckpoint(before.project, sceneNo, prepared.asset);
    await this.uploadAndCheckpoint(ownerId, projectId, prepared, async () => decode(snapshotSchema,
      await this.admin(ownerId, 'import-image', projectId, revision,
        { sceneNo, sceneRevision: scene.revision, asset: prepared.asset })));
    const after = await this.get(ownerId, projectId);
    return { ok: true as const, project: after.project, job: after.job };
  }

  async workerImage(identity: ProductionWorkerIdentity, jobId: string, leaseToken: string, sceneNo: number,
    value: unknown, bytes: Buffer, mime: string) {
    input(z.number().int().min(1).max(12), sceneNo);
    const check = decode(checkSchema, await this.worker(identity.id, 'check', jobId, leaseToken, { sceneNo }));
    const proof = validateLocalStoryboardProvenance(value, check.project.request, check.models, 'image');
    const prepared = await prepareStoryboardAsset(bytes, check.project.id, proof);
    if (prepared.asset.original.mime !== mime) throw new StoryboardProductionError('invalid_image');
    previewImageCheckpoint(check.project, sceneNo, prepared.asset);
    await this.uploadAndCheckpoint(identity.ownerId, check.project.id, prepared, async () => decode(okSchema,
      await this.worker(identity.id, 'image', jobId, leaseToken,
        { sceneNo, sceneRevision: check.sceneRevision, provenance: proof, asset: prepared.asset })));
    return { ok: true as const };
  }

  private async verifiedBytes(variant: StoryboardProductionAsset['original']): Promise<Buffer> {
    let blob: Blob;
    try { blob = await this.storage.download(variant.path); }
    catch { throw new StoryboardProductionError('storage_unavailable'); }
    if (blob.size !== variant.bytes || blob.size > MAX_STORYBOARD_IMAGE_BYTES
      || blob.type.split(';')[0].toLowerCase() !== variant.mime) throw new StoryboardProductionError('invalid_asset');
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (storyboardHash(bytes) !== variant.sha256) throw new StoryboardProductionError('invalid_asset');
    return bytes;
  }
  async downloadAsset(ownerId: string, projectId: string, assetId: string, basename: string) {
    await this.get(ownerId, projectId);
    const row = await this.assetRow(ownerId, projectId, assetId);
    if (!row) throw new StoryboardProductionError('asset_not_found');
    const variant = [row.asset.original, ...row.asset.web].find((entry) => entry.path === `${projectId}/${assetId}/${basename}`);
    if (!variant || basename.includes('/') || basename.includes('\\')) throw new StoryboardProductionError('invalid_asset_variant');
    return { bytes: await this.verifiedBytes(variant), mime: variant.mime, basename };
  }
  async exportProject(ownerId: string, projectId: string) {
    const { project } = await this.get(ownerId, projectId);
    const variants = new Map<string, StoryboardProductionAsset['original']>();
    for (const scene of project.document?.scenes ?? []) {
      if (!scene.image) continue;
      const row = await this.assetRow(ownerId, projectId, scene.image.id);
      if (!row || row.scene_no !== scene.sceneNo || JSON.stringify(row.asset) !== JSON.stringify(scene.image)) {
        throw new StoryboardProductionError('invalid_asset');
      }
      for (const variant of [row.asset.original, ...row.asset.web]) variants.set(variant.path, variant);
    }
    const envelope = { schema: 'storyboard-export-v1' as const, project, document: project.document,
      files: [] as Array<{ path: string; sha256: string; mime: string; base64: string }> };
    let budget = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    for (const variant of variants.values()) {
      budget += Math.ceil(variant.bytes / 3) * 4 + Buffer.byteLength(JSON.stringify({
        path: variant.path, sha256: variant.sha256, mime: variant.mime, base64: '',
      }), 'utf8') + 1;
    }
    if (budget > MAX_STORYBOARD_EXPORT_BYTES) throw new StoryboardProductionError('export_too_large');
    for (const variant of variants.values()) envelope.files.push({ path: variant.path, sha256: variant.sha256,
      mime: variant.mime, base64: (await this.verifiedBytes(variant)).toString('base64') });
    const bytes = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (bytes.length > MAX_STORYBOARD_EXPORT_BYTES) throw new StoryboardProductionError('export_too_large');
    return bytes;
  }
}

export type StoryboardExportDocument = StoryboardProductionDocument | null;
