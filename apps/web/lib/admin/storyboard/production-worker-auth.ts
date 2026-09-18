import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  StoryboardProductionError, storyboardDraftSchema, storyboardProvenanceSchema,
} from './production-contract';

if (typeof window !== 'undefined') throw new Error('Storyboard worker authentication is server-only.');

export const productionUuid = z.uuid().transform((value) => value.toLowerCase());
export const productionModelSchema = z.object({
  id: z.string().min(1).max(200),
  owned_by: z.literal('mlx-serve').optional(),
  capabilities: z.array(z.string().min(1).max(80)).max(32),
  loaded: z.boolean(),
  bytes_on_disk: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  bytes_resident: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export const productionModelsSchema = z.array(productionModelSchema).max(64)
  .refine((models) => new Set(models.map((model) => model.id)).size === models.length);
export type ProductionModel = z.infer<typeof productionModelSchema>;

export const workerFailureSchema = z.enum([
  'worker_lease_lost', 'generation_cancelled', 'revision_conflict', 'model_not_installed',
  'model_capability_mismatch', 'local_model_unavailable', 'model_timeout', 'invalid_structured_response',
  'bge_dependency_unavailable', 'model_response_too_large', 'invalid_image_response', 'invalid_image',
  'image_too_large', 'provider_auth_failed', 'provider_forbidden', 'provider_rate_limited', 'provider_failed',
  'provider_not_configured', 'model_identity_mismatch', 'invalid_local_endpoint', 'invalid_model_request',
  'invalid_model_response', 'image_missing',
]);
export type WorkerFailureCode = z.infer<typeof workerFailureSchema>;

const leaseFields = { jobId: productionUuid, leaseToken: productionUuid };
export const workerOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('heartbeat'), models: productionModelsSchema,
    jobId: productionUuid.optional(), leaseToken: productionUuid.optional() }).strict()
    .refine((value) => Boolean(value.jobId) === Boolean(value.leaseToken)),
  z.object({ action: z.literal('claim') }).strict(),
  z.object({ action: z.literal('draft'), ...leaseFields, draft: storyboardDraftSchema,
    provenance: storyboardProvenanceSchema }).strict(),
  z.object({ action: z.literal('scene-error'), ...leaseFields, sceneNo: z.number().int().min(1).max(12),
    errorCode: workerFailureSchema }).strict(),
  z.object({ action: z.literal('finish'), ...leaseFields, errorCode: workerFailureSchema.optional() }).strict(),
]);

const workerIdentitySchema = z.object({ id: productionUuid, ownerId: productionUuid, models: productionModelsSchema }).strict();
export type ProductionWorkerIdentity = z.infer<typeof workerIdentitySchema>;

/** Hash the token text, not its decoded random bytes. Never return or persist plaintext. */
export function storyboardWorkerTokenHash(authorization: string | null): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/i.exec(authorization ?? '');
  if (!match) throw new StoryboardProductionError('worker_unauthorized');
  const token = match[1];
  const decoded = Buffer.from(token, 'base64url');
  if (decoded.length < 32 || decoded.length > 96 || decoded.toString('base64url') !== token) {
    throw new StoryboardProductionError('worker_unauthorized');
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function authenticateStoryboardWorker(
  request: Request,
  lookup: (hash: string) => Promise<unknown> = async (hash) => {
    const { data, error } = await createSupabaseServiceRoleClient()
      .rpc('storyboard_production_auth_worker' as never, { p_token_sha256: hash } as never);
    if (error) {
      if (error.message === 'worker_unauthorized' || error.message === 'owner_forbidden') {
        throw new StoryboardProductionError('worker_unauthorized');
      }
      throw new StoryboardProductionError('persistence_unavailable');
    }
    return data;
  },
): Promise<ProductionWorkerIdentity> {
  const hash = storyboardWorkerTokenHash(request.headers.get('authorization'));
  try {
    const identity = workerIdentitySchema.safeParse(await lookup(hash));
    if (!identity.success) throw new StoryboardProductionError('worker_unauthorized');
    return identity.data;
  } catch (error) {
    if (error instanceof StoryboardProductionError) throw error;
    throw new StoryboardProductionError('persistence_unavailable');
  }
}
