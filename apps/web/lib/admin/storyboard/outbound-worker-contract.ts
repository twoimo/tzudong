import { z } from 'zod';
import {
  StoryboardProductionError,
  storyboardProductionDocumentSchema,
  storyboardProductionRequestSchema,
} from './production-contract.ts';

export const claimedStoryboardJobSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  revision: z.number().int().nonnegative(),
  kind: z.enum(['generate', 'scene']),
  sceneNo: z.number().int().min(1).max(12).nullable(),
  request: storyboardProductionRequestSchema,
  document: storyboardProductionDocumentSchema.nullable(),
  leaseToken: z.uuid(),
});
export type ClaimedStoryboardJob = z.infer<typeof claimedStoryboardJobSchema>;
export type WorkerResult = 'idle' | 'completed' | 'failed' | 'lease_lost';
export type WorkerDestination = {
  protocol: 'http:' | 'https:';
  host: string;
  port: string;
  path: string;
  connected: boolean;
};
export type WorkerEvent = {
  event: string;
  jobId?: string;
  sceneNo?: number;
  code?: string;
  elapsedMs?: number;
};

/** Worker credentials can travel only to this app or a literal local socket. */
export function validateStoryboardWorkerOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new StoryboardProductionError('invalid_worker_origin'); }
  const local = ['127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:';
  const hosted = url.hostname === 'tzudong.app' && url.protocol === 'https:' && !url.port;
  if ((!local && !hosted) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new StoryboardProductionError('invalid_worker_origin');
  }
  return url;
}
