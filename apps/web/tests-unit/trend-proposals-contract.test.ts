import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildTrendProposalOverlayPreviewPayload,
  buildTrendProposalPreviewConfirmation,
  buildTrendProposalReviewRequestHash,
  encodeTrendProposalCursor,
  normalizeTrendProposalReviewRequest,
  parseTrendProposalListQuery,
  summarizeTrendProposalEvidence,
  type TrendProposalRowInput,
} from '../lib/admin/trend-proposals';

const webRoot = join(import.meta.dir, '..');
const repoRoot = join(webRoot, '..', '..');

function source(path: string) {
  return readFileSync(join(webRoot, path), 'utf8');
}

function repoSource(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

const proposal: TrendProposalRowInput = {
  id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  restaurant_id: '33333333-3333-4333-8333-333333333333',
  overlay_type: 'trend',
  proposal_status: 'pending',
  label: '  여름 냉면 트렌드  ',
  description: null,
  active_from: '2026-07-07T00:00:00.000Z',
  active_until: '2026-07-14T00:00:00.000Z',
  score: 82.5,
  score_breakdown: { web: 80, youtube: 85 },
  evidence: {
    observations: [
      { sourceType: 'youtube_kpi' },
      { source_type: 'web_search' },
    ],
    freshness: 'fresh',
  },
  proposal_hash: 'a'.repeat(64),
  reviewed_by_admin_id: null,
  reviewed_at: null,
  review_reason: null,
  overlay_audit_id: null,
  created_at: '2026-07-07T00:00:00.000Z',
};

describe('admin trend proposals contract', () => {
  test('parses deterministic list cursor and limit contract', () => {
    const cursor = encodeTrendProposalCursor({
      createdAt: '2026-07-07T00:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
    });
    const query = parseTrendProposalListQuery(new URLSearchParams({
      status: 'pending',
      overlayType: 'trend',
      restaurantId: '33333333-3333-4333-8333-333333333333',
      runId: '22222222-2222-4222-8222-222222222222',
      limit: '500',
      cursor,
    }));

    expect(query.status).toBe('pending');
    expect(query.overlayType).toBe('trend');
    expect(query.limit).toBe(100);
    expect(query.cursor).toEqual({
      createdAt: '2026-07-07T00:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
    });
    expect(parseTrendProposalListQuery(new URLSearchParams()).limit).toBe(25);
    expect(() => parseTrendProposalListQuery(new URLSearchParams({ cursor: 'not-base64' }))).toThrow('invalid_trend_proposal_cursor');
    expect(() => parseTrendProposalListQuery(new URLSearchParams({ status: 'deleted' }))).toThrow('invalid_trend_proposal_status');
  });

  test('builds proposal preview and review hashes from canonical inputs', () => {
    const normalized = buildTrendProposalOverlayPreviewPayload(proposal, {
      label: '여름 냉면 트렌드',
      description: '',
    });
    const confirmation = buildTrendProposalPreviewConfirmation({ proposalId: proposal.id, normalized });
    const otherConfirmation = buildTrendProposalPreviewConfirmation({
      proposalId: '44444444-4444-4444-8444-444444444444',
      normalized,
    });
    const review = normalizeTrendProposalReviewRequest({
      transition: 'rejected',
      reason: '근거가 부족하여 보류합니다.',
      expectedProposalHash: proposal.proposal_hash,
      correlationId: '55555555-5555-4555-8555-555555555555',
      idempotencyKey: 'proposal-review-001',
    });

    expect(normalized.label).toBe('여름 냉면 트렌드');
    expect(normalized.description).toBeNull();
    expect(confirmation.requiredText).toBe('오버레이 적용');
    expect(confirmation.previewHash).toHaveLength(64);
    expect(confirmation.payloadHash).toHaveLength(64);
    expect(confirmation.payloadHash).not.toBe(otherConfirmation.payloadHash);
    expect(buildTrendProposalReviewRequestHash({ proposalId: proposal.id, ...review })).toHaveLength(64);
    expect(() => normalizeTrendProposalReviewRequest({ ...review, expectedProposalHash: 'bad' })).toThrow('invalid_trend_proposal_review_request');
  });

  test('summarizes bounded evidence without raw provider content assumptions', () => {
    expect(summarizeTrendProposalEvidence(proposal.evidence)).toEqual({
      sourceTypes: ['web_search', 'youtube_kpi'],
      observationCount: 2,
      freshness: 'fresh',
    });
  });

  test('proposal API routes are guarded, no-store, deterministic, and non-approving', () => {
    const listSource = source('app/api/admin/trend-proposals/route.ts');
    const previewSource = source('app/api/admin/trend-proposals/[proposalId]/preview-overlay/route.ts');
    const rejectSource = source('app/api/admin/trend-proposals/[proposalId]/reject/route.ts');
    const approveSource = source('app/api/admin/trend-proposals/[proposalId]/approve/route.ts');

    for (const routeSource of [listSource, previewSource, rejectSource]) {
      const requireAdminIndex = routeSource.indexOf('const admin = await requireAdmin();');
      expect(requireAdminIndex).toBeGreaterThanOrEqual(0);
      expect(routeSource.indexOf('createSupabaseServiceRoleClient()')).toBeGreaterThan(routeSource.indexOf('if (!admin.ok)'));
      expect(routeSource).toContain("response.headers.set('Cache-Control', 'no-store')");
      expect(routeSource).not.toContain('approve_admin_restaurant_map_overlay_proposal');
      expect(routeSource).not.toContain('/approve');
      expect(routeSource).not.toContain('run_trend_dry_run');
      expect(routeSource).not.toContain('collect_google_cse');
      expect(routeSource).not.toContain('score_trend_candidate');
    }

    expect(listSource).toContain(".order('created_at', { ascending: false })");
    expect(listSource).toContain(".order('id', { ascending: false })");
    expect(listSource).toContain('.limit(query.limit + 1)');
    expect(listSource).toContain('encodeTrendProposalCursor({ createdAt: lastItem.createdAt, id: lastItem.id })');
    expect(listSource).toContain('invalid_trend_proposal_cursor');

    expect(previewSource).toContain('buildTrendProposalOverlayPreviewPayload');
    expect(previewSource).toContain('buildTrendProposalPreviewConfirmation');
    expect(previewSource).toContain("proposal.proposal_status !== 'pending'");
    expect(previewSource).toContain('trend_proposal_not_pending');
    expect(previewSource).not.toContain('.rpc(');
    expect(previewSource).not.toContain('.update(');
    expect(previewSource).not.toContain('.insert(');

    expect(rejectSource).toContain('buildTrendProposalReviewRequestHash');
    expect(rejectSource).toContain("'review_admin_restaurant_map_overlay_proposal' as never");
    expect(rejectSource.match(/\.rpc\(/g) ?? []).toHaveLength(1);
    expect(rejectSource).toContain('trend_proposal_hash_stale');
    expect(rejectSource).not.toContain('.update(');
    expect(rejectSource).not.toContain('.insert(');

    const approveRequireAdminIndex = approveSource.indexOf('const admin = await requireAdmin();');
    expect(approveRequireAdminIndex).toBeGreaterThanOrEqual(0);
    expect(approveSource.indexOf('createSupabaseServiceRoleClient()')).toBeGreaterThan(approveSource.indexOf('if (!admin.ok)'));
    expect(approveSource).toContain('buildTrendProposalPreviewHash');
    expect(approveSource).toContain('buildTrendProposalPreviewPayloadHash');
    expect(approveSource).toContain('!isSha256(suppliedPayloadHash)');
    expect(approveSource).toContain('expectedProposalHash');
    expect(approveSource).toContain('suppliedPayloadHash !== payloadHash');
    expect(approveSource).toContain('trend_proposal_hash_stale');
    expect(approveSource).toContain("'approve_admin_restaurant_map_overlay_proposal' as never");
    expect(approveSource.match(/\.rpc\(/g) ?? []).toHaveLength(1);
    expect(approveSource).not.toContain('.update(');
    expect(approveSource).not.toContain('.insert(');
  });

  test('proposal review RPC is service-role only, replay-safe, stale-aware, and transactional', () => {
    const migration = repoSource('backend/supabase/migrations/20260707000500_admin_trend_proposal_review_rpc.sql');
    const replaySelectIndex = migration.indexOf('from public.admin_restaurant_map_overlay_proposal_review_events');
    const lockProposalIndex = migration.indexOf('for update');
    const updateIndex = migration.indexOf('update public.admin_restaurant_map_overlay_proposals');
    const insertEventIndex = migration.indexOf('insert into public.admin_restaurant_map_overlay_proposal_review_events');

    expect(migration).toContain('public.review_admin_restaurant_map_overlay_proposal(');
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(replaySelectIndex).toBeGreaterThanOrEqual(0);
    expect(lockProposalIndex).toBeGreaterThan(replaySelectIndex);
    expect(migration).toContain('trend_proposal_review_idempotency_conflict');
    expect(migration).toContain('trend_proposal_hash_stale');
    expect(migration).toContain('trend_proposal_not_pending');
    expect(updateIndex).toBeGreaterThan(lockProposalIndex);
    expect(insertEventIndex).toBeGreaterThan(updateIndex);
    expect(migration).toContain('when unique_violation then');
    expect(migration).toContain('revoke all on function public.review_admin_restaurant_map_overlay_proposal');
    expect(migration).toContain('grant execute on function public.review_admin_restaurant_map_overlay_proposal');
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain('to authenticated;');
    expect(migration).not.toContain('to anon;');
  });

  test('proposal approval RPC is atomic, replay-safe, stale-aware, and service-role only', () => {
    const migration = repoSource('backend/supabase/migrations/20260707000600_admin_trend_proposal_approval_rpc.sql');
    const replayAuditIndex = migration.indexOf('from public.admin_restaurant_map_overlay_audit_events');
    const lockProposalIndex = migration.indexOf('for update');
    const overlayWriteIndex = migration.indexOf('update public.admin_restaurant_map_overlays');
    const auditInsertIndex = migration.indexOf('insert into public.admin_restaurant_map_overlay_audit_events');
    const proposalUpdateIndex = migration.indexOf('update public.admin_restaurant_map_overlay_proposals');

    expect(migration).toContain('public.approve_admin_restaurant_map_overlay_proposal(');
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain('approve_proposal_overlay');
    expect(migration).not.toContain('to_jsonb(v_audit)');
    expect(migration).not.toContain('to_jsonb(v_existing_audit)');
    expect(migration).toContain("v_existing_audit.request_metadata ->> 'expectedProposalHash' = p_expected_proposal_hash");
    expect(migration).toContain('trend_proposal_idempotency_conflict');
    expect(migration).toContain('trend_proposal_hash_stale');
    expect(migration).toContain('trend_proposal_preview_stale');
    expect(migration).toContain('trend_proposal_not_pending');
    expect(replayAuditIndex).toBeGreaterThanOrEqual(0);
    expect(lockProposalIndex).toBeGreaterThan(replayAuditIndex);
    expect(overlayWriteIndex).toBeGreaterThan(lockProposalIndex);
    expect(auditInsertIndex).toBeGreaterThan(overlayWriteIndex);
    expect(proposalUpdateIndex).toBeGreaterThan(auditInsertIndex);
    expect(migration).toContain('overlay_audit_id = v_audit.id');
    expect(migration).toContain("'auditId', v_audit.id");
    expect(migration).toContain("'payloadHash', v_audit.payload_hash");
    expect(migration).toContain('when unique_violation then');
    expect(migration).toContain('revoke all on function public.approve_admin_restaurant_map_overlay_proposal');
    expect(migration).toContain('grant execute on function public.approve_admin_restaurant_map_overlay_proposal');
    expect(migration).toContain('to service_role');
    expect(migration).not.toContain('to authenticated;');
    expect(migration).not.toContain('to anon;');
  });

  test('admin proposal queue UI exposes preview/reject/approval readback', () => {
    const queueSource = source('components/admin/TrendProposalQueue.tsx');
    const dashboardSource = source('components/admin/AdminOverviewDashboard.tsx');
    const typesSource = source('integrations/supabase/types.ts');

    expect(queueSource).toContain('data-layout-primitives="list-detail card-grid cluster stack"');
    expect(queueSource).toContain('data-scroll-owner="trend-proposal-queue"');
    expect(queueSource).toContain('data-admin-trend-proposal-queue="true"');
    expect(queueSource).toContain('data-admin-trend-proposal-readback="true"');
    expect(queueSource).toContain('data-trend-proposal-preview="true"');
    expect(queueSource).toContain('data-trend-proposal-review-readback="true"');
    expect(queueSource).toContain('data-trend-proposal-approve-action="true"');
    expect(queueSource).toContain('data-trend-proposal-confirmation-input="true"');
    expect(queueSource).toContain('data-trend-proposal-approval-readback="true"');
    expect(queueSource).toContain('승인하려면 정확히 “오버레이 적용”을 입력합니다.');
    expect(queueSource).toContain('/approve');
    expect(dashboardSource).toContain('import { TrendProposalQueue }');
    expect(dashboardSource).toContain('<TrendProposalQueue />');
    expect(typesSource).toContain('review_admin_restaurant_map_overlay_proposal');
    expect(typesSource).toContain('approve_admin_restaurant_map_overlay_proposal');
    expect(typesSource).toContain("p_transition: 'rejected' | 'superseded' | 'expired'");
    expect(typesSource).toContain('p_expected_proposal_hash: string');
  });
});
