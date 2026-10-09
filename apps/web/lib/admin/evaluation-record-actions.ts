import type { ApprovalData, ItemDecision, SubmissionRecord } from '@/components/admin/SubmissionDetailView';
import { normalizeCanonicalYouTubeWatchUrl } from '@/lib/youtube-url';
import { RecordActionClientError, type RecordActionInput } from './record-action-client';
import { parseRecordActionRequest } from './record-action-contract';

const validateInput = (input: unknown): RecordActionInput => {
  const parsed = parseRecordActionRequest({ ...(input as object), phase: 'preview', operationId: '00000000-0000-4000-8000-000000000001' });
  if (!parsed) throw new RecordActionClientError('RECORD_ACTION_INVALID_PAYLOAD');
  return { action: parsed.action, targetIds: parsed.targetIds, payload: parsed.payload };
};
export function submissionApprovalInput({ submission, approvalData, itemDecisions, forceApprove, editableData, adminNote }: {
  submission: SubmissionRecord; approvalData: ApprovalData; itemDecisions: Record<string, ItemDecision>; forceApprove: boolean;
  editableData: { name: string; address: string; phone: string; categories: string[] }; adminNote?: string;
}): RecordActionInput {
  if (submission.submission_type === 'recommend') return validateInput({ action: 'recommendation.approve', targetIds: [submission.id], payload: { note: adminNote?.trim() || undefined } });
  const pending = submission.items.filter(item => item.item_status === 'pending');
  if (new Set(pending.map(item => item.id)).size !== pending.length || !pending.some(item => itemDecisions[item.id]?.approved) || !approvalData.lat.trim() || !approvalData.lng.trim()) throw new RecordActionClientError('RECORD_ACTION_INVALID_PAYLOAD');
  const items = pending.map(item => {
    const decision = itemDecisions[item.id];
    if (!decision?.approved) return { id: item.id, decision: 'reject', reason: decision?.rejectionReason?.trim() || '관리자에 의해 반려됨' };
    if (!decision.tzuyang_review?.trim() || !decision.metaData) throw new RecordActionClientError('RECORD_ACTION_EVIDENCE_REQUIRED');
    const meta = decision.metaData;
    const youtube = normalizeCanonicalYouTubeWatchUrl(decision.youtube_link || item.youtube_link);
    if (!youtube) throw new RecordActionClientError('RECORD_ACTION_INVALID_PAYLOAD');
    return { id: item.id, decision: 'approve', changes: {
      approved_name: editableData.name, phone: editableData.phone || null, categories: editableData.categories,
      tzuyang_review: decision.tzuyang_review, youtube_link: youtube,
      jibun_address: approvalData.jibun_address, road_address: approvalData.road_address, english_address: approvalData.english_address || null,
      address_elements: approvalData.address_elements ?? {}, lat: Number(approvalData.lat), lng: Number(approvalData.lng), geocoding_success: true,
      youtube_meta: { title: meta.title, published_at: meta.publishedAt, duration: meta.duration, is_shorts: meta.is_shorts,
        is_ads: meta.ads_info?.is_ads ?? false, what_ads: Array.isArray(meta.ads_info?.what_ads) ? meta.ads_info.what_ads : typeof meta.ads_info?.what_ads === 'string' ? [meta.ads_info.what_ads] : null },
    } };
  });
  const note = [adminNote?.trim(), forceApprove && !adminNote?.includes('forceApprove=true') ? 'forceApprove=true' : ''].filter(Boolean).join('\n');
  return validateInput({ action: 'submission.approve', targetIds: [submission.id], payload: { items, ...(note ? { note } : {}) } });
}
export function submissionEditInput(submission: SubmissionRecord, data: {
  restaurant_name: string; address: string; phone: string; categories: string[]; youtube_link: string; description: string;
}): RecordActionInput {
  const firstItem = submission.items[0];
  if (submission.submission_type === 'recommend' || (firstItem && firstItem.item_status !== 'pending')) throw new RecordActionClientError('RECORD_ACTION_STATE_CONFLICT');
  const youtube = normalizeCanonicalYouTubeWatchUrl(data.youtube_link);
  if (firstItem && !youtube) throw new RecordActionClientError('RECORD_ACTION_INVALID_PAYLOAD');
  return validateInput({ action: 'submission.edit', targetIds: [submission.id], payload: {
    changes: { restaurant_name: data.restaurant_name, restaurant_address: data.address, restaurant_phone: data.phone || null, restaurant_categories: data.categories },
    itemChanges: firstItem ? [{ id: firstItem.id, youtube_link: youtube, tzuyang_review: data.description || null }] : [],
  } });
}
