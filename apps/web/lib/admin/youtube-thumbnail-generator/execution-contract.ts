import { z } from 'zod';
import { THUMBNAIL_CHAT_MODEL, thumbnailChatProvenance, thumbnailChatStartReceipt } from './chat-contract';
import { thumbnailHash, thumbnailJob, thumbnailJobBase, thumbnailStartReceipt, thumbnailUuid,
  validThumbnailExecutionState } from './queue-contract';

export const THUMBNAIL_CHAT_DOCUMENT_BYTES = 65_536;
export const THUMBNAIL_CHAT_RESULT_BYTES = 48_000;
const jsonAsset = (maximum: number) => z.object({ path: z.string().max(256), sha256: thumbnailHash,
  bytes: z.number().int().min(16).max(maximum), mimeType: z.literal('application/json') }).strict();
export const thumbnailChatInput = z.object({ contract: z.literal('thumbnail-gemini-chat-v1'),
  model: z.literal(THUMBNAIL_CHAT_MODEL), document: jsonAsset(THUMBNAIL_CHAT_DOCUMENT_BYTES) }).strict();
export const thumbnailChatResult = z.object({ content: jsonAsset(THUMBNAIL_CHAT_RESULT_BYTES),
  provenance: thumbnailChatProvenance }).strict();
export const thumbnailChatJob = thumbnailJobBase.extend({ model: z.literal(THUMBNAIL_CHAT_MODEL),
  input: thumbnailChatInput, result: thumbnailChatResult.nullable() }).superRefine((job, ctx) => {
  const valid = validThumbnailExecutionState(job)
    && job.input.document.path === `${job.ownerId}/${job.requestId}/input/chat.json`
    && (!job.result || (job.result.content.path === `${job.ownerId}/${job.id}/${job.attemptId}/response.json`
      && job.result.provenance.attemptId === job.attemptId && job.result.provenance.inputSha256 === job.inputSha256));
  if (!valid) ctx.addIssue({ code: 'custom', message: 'invalid_job' });
});
export const thumbnailExecutionJob = z.union([thumbnailJob, thumbnailChatJob]);
export const thumbnailExecutionStartReceipt = z.union([thumbnailStartReceipt, thumbnailChatStartReceipt]);
export const thumbnailExecutionIdentity = thumbnailStartReceipt.omit({ model: true, state: true, permission: true })
  .extend({ workerId: thumbnailUuid, model: z.union([thumbnailJob.shape.model, z.literal(THUMBNAIL_CHAT_MODEL)]) }).strict();
export type ThumbnailChatJob = z.infer<typeof thumbnailChatJob>;
export type ThumbnailChatInput = z.infer<typeof thumbnailChatInput>;
export type ThumbnailChatResult = z.infer<typeof thumbnailChatResult>;
export type ThumbnailExecutionJob = z.infer<typeof thumbnailExecutionJob>;
