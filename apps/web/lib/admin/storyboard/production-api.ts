import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/require-admin';
import { BOUNDED_JSON_REQUEST_ERROR, readBoundedJsonRequest } from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import {
  MAX_STORYBOARD_DOCUMENT_BYTES, MAX_STORYBOARD_IMAGE_BYTES, STORYBOARD_WORKFLOW,
  StoryboardProductionError, storyboardProvenanceSchema,
} from './production-contract';
import { PRODUCTION_FAILURE_STATUSES, StoryboardProductionStore } from './production-store';
import { authenticateStoryboardWorker, productionUuid, type ProductionWorkerIdentity } from './production-worker-auth';

if (typeof window !== 'undefined') throw new Error('Storyboard API handlers are server-only.');

const responseHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie, Authorization' };
const multipartLimit = MAX_STORYBOARD_IMAGE_BYTES + 32 * 1024;
const imageMimes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function productionApiFailure(error: unknown): Response {
  const requested = error instanceof StoryboardProductionError ? error.code : 'provider_failed';
  const code = Object.hasOwn(PRODUCTION_FAILURE_STATUSES, requested) ? requested : 'provider_failed';
  return Response.json({ ok: false, error: code }, { status: PRODUCTION_FAILURE_STATUSES[code], headers: responseHeaders });
}
function json(value: unknown) { return Response.json(value, { headers: responseHeaders }); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new StoryboardProductionError('invalid_request');
  return result.data;
}
async function boundedJson(request: Request) {
  const result = await readBoundedJsonRequest(request, MAX_STORYBOARD_DOCUMENT_BYTES);
  if (!result.ok) throw new StoryboardProductionError(
    result.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge ? 'request_too_large' : 'invalid_request');
  return result.value;
}
function requireSameOrigin(request: Request) {
  // Admin APIs always use session auth. Do not take the helper's bearer-only CSRF exemption.
  const headers = new Headers(request.headers);
  headers.delete('authorization');
  if (!isTrustedSameOriginMutation(new Request(request.url, { method: request.method, headers }))) {
    throw new StoryboardProductionError('origin_forbidden');
  }
}

/** Bound the actual stream before formData() buffers/parses it; Content-Length is not trusted. */
export async function readStoryboardMultipart(request: Request, fields: readonly string[]): Promise<FormData> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.length > 200 || !/^multipart\/form-data;\s*boundary=/i.test(contentType) || !request.body) {
    throw new StoryboardProductionError('invalid_request');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new StoryboardProductionError('invalid_request');
    if (!Number.isSafeInteger(Number(declared)) || Number(declared) > multipartLimit) {
      throw new StoryboardProductionError('request_too_large');
    }
  }
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let completed = false;
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new StoryboardProductionError('invalid_request'));
    request.signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(abort, 15_000);
    if (request.signal.aborted) abort();
  });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) { completed = true; break; }
      length += chunk.value.byteLength;
      if (length > multipartLimit) throw new StoryboardProductionError('request_too_large');
      chunks.push(chunk.value);
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) request.signal.removeEventListener('abort', abort);
    if (!completed) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let form: FormData;
  try {
    const body = new Blob([new Uint8Array(Buffer.concat(chunks))]);
    form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': contentType }, body }).formData();
  } catch { throw new StoryboardProductionError('invalid_request'); }
  const keys = [...form.keys()];
  if (keys.length !== fields.length || new Set(keys).size !== keys.length || keys.some((key) => !fields.includes(key))) {
    throw new StoryboardProductionError('invalid_request');
  }
  return form;
}
function field(form: FormData, name: string, maxLength = 200): string {
  const value = form.get(name);
  if (typeof value !== 'string' || value.length > maxLength) throw new StoryboardProductionError('invalid_request');
  return value;
}
function integerField(form: FormData, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = field(form, name, 16);
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new StoryboardProductionError('invalid_request');
  return parse(z.number().int().min(min).max(max), Number(value));
}
async function imageFile(form: FormData) {
  const file = form.get('file');
  if (!file || typeof file === 'string' || !imageMimes.has(file.type)) throw new StoryboardProductionError('invalid_image');
  if (file.size > MAX_STORYBOARD_IMAGE_BYTES) throw new StoryboardProductionError('image_too_large');
  if (file.size < 16) throw new StoryboardProductionError('invalid_image');
  return { bytes: Buffer.from(await file.arrayBuffer()), mime: file.type };
}

type RouteContext = { params: Promise<{ id: string }> };
type AssetContext = { params: Promise<{ id: string; assetId: string }> };
type AdminAuth = () => Promise<{ ok: true; userId: string } | { ok: false; response: Response }>;
type StoreApi = Pick<StoryboardProductionStore, 'list' | 'get' | 'create' | 'apply' | 'importImage'
  | 'downloadAsset' | 'exportProject' | 'workerOperation' | 'workerImage'>;

/** Dependency injection is restricted to tests; route files use the authenticated server defaults. */
export function createStoryboardProductionApi(options: {
  store?: StoreApi; requireAdmin?: AdminAuth; authenticateWorker?: (request: Request) => Promise<ProductionWorkerIdentity>;
} = {}) {
  const store = options.store ?? new StoryboardProductionStore();
  const adminAuth = options.requireAdmin ?? requireAdmin;
  const workerAuth = options.authenticateWorker ?? authenticateStoryboardWorker;
  async function admin(request: Request, run: (ownerId: string) => Promise<Response>) {
    try {
      const auth = await adminAuth();
      if (!auth.ok) throw new StoryboardProductionError(auth.response.status === 403 ? 'owner_forbidden' : 'unauthorized');
      const owner = productionUuid.safeParse(auth.userId);
      if (!owner.success) throw new StoryboardProductionError('owner_forbidden');
      if (!['GET', 'HEAD'].includes(request.method)) requireSameOrigin(request);
      return await run(owner.data);
    } catch (error) { return productionApiFailure(error); }
  }
  async function worker(request: Request, run: (identity: ProductionWorkerIdentity) => Promise<Response>) {
    try { return await run(await workerAuth(request)); }
    catch (error) { return productionApiFailure(error); }
  }
  return {
    listGET: (request: Request) => admin(request, async (owner) => json(await store.list(owner))),
    listPOST: (request: Request) => admin(request, async (owner) => json(await store.create(owner, await boundedJson(request)))),
    projectGET: (request: Request, context: RouteContext) => admin(request, async (owner) =>
      json(await store.get(owner, parse(productionUuid, (await context.params).id)))),
    projectPOST: (request: Request, context: RouteContext) => admin(request, async (owner) => {
      const id = parse(productionUuid, (await context.params).id);
      return json(await store.apply(owner, id, await boundedJson(request)));
    }),
    imagePOST: (request: Request, context: RouteContext) => admin(request, async (owner) => {
      const id = parse(productionUuid, (await context.params).id);
      const form = await readStoryboardMultipart(request, ['revision', 'sceneNo', 'projectId', 'schema', 'file']);
      if (parse(productionUuid, field(form, 'projectId')) !== id || field(form, 'schema') !== STORYBOARD_WORKFLOW) {
        throw new StoryboardProductionError('invalid_request');
      }
      const revision = integerField(form, 'revision', 0);
      const sceneNo = integerField(form, 'sceneNo', 1, 12);
      const file = await imageFile(form);
      return json(await store.importImage(owner, id, revision, sceneNo, file.bytes, file.mime));
    }),
    assetGET: (request: Request, context: AssetContext) => admin(request, async (owner) => {
      const params = await context.params;
      const id = parse(productionUuid, params.id);
      const assetId = parse(productionUuid, params.assetId);
      const query = new URL(request.url).searchParams;
      if (query.size !== 1 || query.getAll('variant').length !== 1) throw new StoryboardProductionError('invalid_asset_variant');
      const variant = query.get('variant')!;
      if (!/^(?:original\.(?:png|jpeg|webp)|web-\d{2,4}\.webp)$/.test(variant)) throw new StoryboardProductionError('invalid_asset_variant');
      const file = await store.downloadAsset(owner, id, assetId, variant);
      return new Response(new Uint8Array(file.bytes), { headers: { ...responseHeaders, 'Content-Type': file.mime,
        'Content-Length': String(file.bytes.length), 'Content-Disposition': `inline; filename="${file.basename}"` } });
    }),
    exportGET: (request: Request, context: RouteContext) => admin(request, async (owner) => {
      const id = parse(productionUuid, (await context.params).id);
      const bytes = await store.exportProject(owner, id);
      return new Response(new Uint8Array(bytes), { headers: { ...responseHeaders, 'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="storyboard-${id}.json"` } });
    }),
    workerPOST: (request: Request) => worker(request, async (identity) =>
      json(await store.workerOperation(identity, await boundedJson(request)))),
    workerImagePOST: (request: Request) => worker(request, async (identity) => {
      const form = await readStoryboardMultipart(request, ['jobId', 'leaseToken', 'sceneNo', 'provenance', 'file']);
      const jobId = parse(productionUuid, field(form, 'jobId'));
      const leaseToken = parse(productionUuid, field(form, 'leaseToken'));
      const sceneNo = integerField(form, 'sceneNo', 1, 12);
      let provenance: unknown;
      try { provenance = JSON.parse(field(form, 'provenance', 4096)); }
      catch { throw new StoryboardProductionError('invalid_provenance'); }
      const proof = parse(storyboardProvenanceSchema, provenance);
      const file = await imageFile(form);
      return json(await store.workerImage(identity, jobId, leaseToken, sceneNo, proof, file.bytes, file.mime));
    }),
  };
}

export const storyboardProductionApi = createStoryboardProductionApi();
