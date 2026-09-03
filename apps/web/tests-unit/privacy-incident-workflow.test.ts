import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getIncidentDeadlineReadback } from '../lib/privacy/incident-deadline';

const webRoot = join(import.meta.dir, '..');
const repoRoot = join(webRoot, '..', '..');

function source(path: string) {
  return readFileSync(join(webRoot, path), 'utf8');
}

function repoSource(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('privacy incident workflow contract', () => {
  test('migration defines the exact fail-closed incident state chain', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');
    const allowedTransitions = [
      "('detected'::public.privacy_incident_status, 'triaged'::public.privacy_incident_status)",
      "('triaged'::public.privacy_incident_status, 'contained'::public.privacy_incident_status)",
      "('contained'::public.privacy_incident_status, 'assessed'::public.privacy_incident_status)",
      "('assessed'::public.privacy_incident_status, 'notice_drafted'::public.privacy_incident_status)",
      "('notice_drafted'::public.privacy_incident_status, 'notice_approved'::public.privacy_incident_status)",
      "('notice_approved'::public.privacy_incident_status, 'notified'::public.privacy_incident_status)",
      "('notified'::public.privacy_incident_status, 'closed'::public.privacy_incident_status)",
    ];

    expect(migration).toContain('public.privacy_incident_transition_is_allowed');
    for (const transition of allowedTransitions) expect(migration).toContain(transition);
    expect(migration).not.toContain("('detected'::public.privacy_incident_status, 'assessed'::public.privacy_incident_status)");
    expect(migration).toContain('privacy_incident_transition_forbidden');
  });

  test('deadline is awareness-only and assessment signals remain human decision prompts', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');

    expect(migration).toContain('deadline_at = awareness_at + interval \'72 hours\'');
    expect(migration).toContain("'awarenessAt')::timestamptz + interval '72 hours'");
    expect(migration).not.toContain('deadline_at = detected_at');
    expect(migration).toContain("coalesce(p_affected_count, 0) >= 1000");
    expect(migration).toContain("'count_1000_or_more_human_review'");
    expect(migration).toContain("'sensitive_or_unique_id_human_review'");
    expect(migration).toContain("'external_intrusion_human_review'");
    expect(migration).not.toContain("'reportable'");
    expect(migration).not.toContain("'regulator_accepted'");
    expect(migration).toContain('pg_catalog.clock_timestamp()');
    expect(migration).not.toContain("timezone('utc'");
  });

  test('preview, exact confirmation, version, idempotency, independent readback, and audit are mandatory', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');
    const previewIndex = migration.indexOf('public.preview_privacy_incident_transition(');
    const applyIndex = migration.indexOf('public.apply_privacy_incident_transition(');

    expect(previewIndex).toBeGreaterThanOrEqual(0);
    expect(applyIndex).toBeGreaterThan(previewIndex);
    expect(migration).toContain("p_confirmation_text <> '개인정보 사고 조치 적용'");
    expect(migration).toContain('v_incident.updated_at <> p_expected_updated_at');
    expect(migration).toContain('privacy_incident_idempotency_conflict');
    expect(migration).toContain('privacy_incident_transition_previews');
    expect(migration).toContain("'readback_passed'");
    expect(migration).toContain("'privacy_incident_transition'");
    expect(migration).toContain('privacy_incident_actions_are_immutable');
    expect(migration).toContain('privacy_incident_readback_failed');
    expect(migration).toContain('v_action.input_hash = v_input_hash');
    expect(migration).toContain('v_action.correlation_id = p_correlation_id');
    expect(migration).toContain("'confirmed'");
    expect(migration).toContain("'applied'");
    expect(migration).toContain("public.privacy_resolve_audit_retention_until(\n      'privacy_incident_audit',");
    expect(migration).toContain('privacy_incident_audit_retention_class_required');
    expect(migration).toContain('retention_until');
    expect(migration).toContain('upper(p_reason_code)');
    expect(migration).toContain("'requested', p_affected_count");
    expect(migration).toContain("'updated', p_category_count");
  });
  test('idempotent transition replay returns the immutable operation readback after a later transition', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');
    const rls = repoSource('backend/supabase/tests/g010_incident_rls.sql');
    const applyIndex = migration.indexOf('public.apply_privacy_incident_transition(');
    const replayStart = migration.indexOf('IF FOUND THEN', applyIndex);
    const replayEnd = migration.indexOf("RAISE EXCEPTION 'privacy_incident_idempotency_conflict';", replayStart);
    const replay = migration.slice(replayStart, replayEnd);

    expect(replayStart).toBeGreaterThan(applyIndex);
    expect(replayEnd).toBeGreaterThan(replayStart);
    expect(replay).toContain('v_action.id = p_operation_id');
    expect(replay).toContain('v_action.input_hash = v_input_hash');
    expect(replay).toContain('v_action.correlation_id = p_correlation_id');
    expect(replay).toContain("v_action.readback_status = 'passed'");
    expect(replay).toContain("'passed', v_action.readback_status = 'passed'");
    expect(replay).not.toContain('FROM public.privacy_incidents');
    expect(replay).not.toContain('v_readback_incident.status = p_to_status');

    expect(rls).toContain("v_after_containment.status <> 'contained'");
    expect(rls).toContain('replayed triaged transition did not preserve the stored passed readback');
    expect(rls).toContain("'00000000-0000-0000-0000-000000001017'");
    expect(rls).toContain('privacy_incident_idempotency_conflict');
  });

  test('notice receipt and closure cannot be advanced without named human records', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');

    expect(migration).toContain('approved_by uuid REFERENCES auth.users(id)');
    expect(migration).toContain('submitted_by uuid REFERENCES auth.users(id)');
    expect(migration).toContain('submitted_at timestamptz');
    expect(migration).toContain('external_receipt_ref text');
    expect(migration).toContain('privacy_incident_external_receipt_required');
    expect(migration).toContain('privacy_incident_closure_readback_required');
    expect(migration).toContain("to_status = 'notified'");
    expect(migration).toContain("readback_status = 'passed'");
    expect(migration).toContain('External notices are recorded only after a named operator enters a bounded receipt reference.');
    expect(migration).toContain('privacy_incident_enforce_state_invariants');
    expect(migration).toContain("status = 'submitted'");
  });

  test('incident tables and RPCs are service-role only while the API gates early with requireAdmin', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');
    const route = source('app/api/admin/privacy-incidents/route.ts');

    for (const table of ['privacy_incidents', 'privacy_incident_transition_previews', 'privacy_incident_notices', 'privacy_incident_actions']) {
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`);
      expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
    }
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain("role::text = 'admin'");
    expect(migration).toContain('TO service_role;');
    expect(migration).not.toContain('TO authenticated;');
    expect(migration).not.toContain('TO anon;');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.record_privacy_incident_detection(uuid, uuid, text, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.record_privacy_incident_detection(uuid, uuid, text, timestamptz, text, uuid) TO service_role;');

    for (const handler of ['export async function GET()', 'export async function POST(', 'export async function PATCH(']) {
      const handlerIndex = route.indexOf(handler);
      const requireAdminIndex = route.indexOf('const admin = await requireAdmin();', handlerIndex);
      expect(handlerIndex).toBeGreaterThanOrEqual(0);
      expect(requireAdminIndex).toBeGreaterThan(handlerIndex);
    }
    expect(route).toContain('createSupabaseServiceRoleClient()');
    expect(route).toContain("response.headers.set('Cache-Control', 'no-store')");
    expect(route).not.toContain('.insert(');
    expect(route).not.toContain('.update(');
  });
  test('bounds authorized incident JSON by declared and chunked UTF-8 bytes before shape validation', async () => {
    const route = source('app/api/admin/privacy-incidents/route.ts');
    const postIndex = route.indexOf('export async function POST(');
    const patchIndex = route.indexOf('export async function PATCH(');
    const postHandler = route.slice(postIndex, patchIndex);
    const patchHandler = route.slice(patchIndex);

    for (const handler of [postHandler, patchHandler]) {
      expect(handler.indexOf('const admin = await requireAdmin();')).toBeGreaterThanOrEqual(0);
      expect(handler.indexOf('const parsedBody = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);'))
        .toBeGreaterThan(handler.indexOf('const admin = await requireAdmin();'));
    }

    expect(route).toContain('const MAX_REQUEST_BYTES = 16 * 1024;');
    expect(route).toContain('readBoundedJsonRequest(request, MAX_REQUEST_BYTES)');
    expect(route).toContain('BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge');
    expect(route).not.toContain('readBoundedJsonBody');
    expect(route).toContain("error: 'privacy_incident_request_too_large'");
    expect(route).toContain('function hasExactKeys');
    expect(route).toContain('PREVIEW_SNAKE_REQUEST_KEYS');
    expect(route).toContain('APPLY_SNAKE_REQUEST_KEYS');
    expect(route).toContain("body.action !== 'preview'");
    expect(route).toContain("body.action !== 'apply'");
    expect(route).toContain('CREATE_SNAKE_REQUEST_KEYS');
    expect(route).toContain("body.action !== 'create'");
    expect(route).toContain('record_privacy_incident_detection');
    expect(route).toContain('p_actor_user_id: admin.userId');
    expect(route).not.toContain('request.json()');

    const oversizedChunkedBody = JSON.stringify({ action: 'preview', padding: '가'.repeat(6_000) });
    const chunkedRequest = new Request('https://example.test/api/admin/privacy-incidents', {
      method: 'POST',
      body: oversizedChunkedBody,
    });

    expect(chunkedRequest.headers.get('content-length')).toBeNull();
    expect(Buffer.byteLength(await chunkedRequest.text(), 'utf8')).toBeGreaterThan(16 * 1024);
  });

  test('detection intake preserves auth-before-parser ordering and rejects filing, awareness, and raw-evidence claims', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');
    const route = source('app/api/admin/privacy-incidents/route.ts');
    const page = source('app/admin/privacy-incidents/page.tsx');
    const post = route.slice(route.indexOf('export async function POST('), route.indexOf('export async function PATCH('));
    const detectionStart = migration.indexOf('public.record_privacy_incident_detection(');
    const detectionEnd = migration.indexOf('ALTER TABLE public.privacy_incidents', detectionStart);
    const detection = migration.slice(detectionStart, detectionEnd);

    expect(post.indexOf('const admin = await requireAdmin();')).toBeGreaterThanOrEqual(0);
    expect(post.indexOf('const parsedBody = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);'))
      .toBeGreaterThan(post.indexOf('const admin = await requireAdmin();'));
    expect(route).toContain("const CREATE_REQUEST_KEYS = [");
    expect(route).toContain("'confirmationText'");
    expect(route).toContain('p_confirmation_text: detection.confirmationText');
    expect(detection).toContain("p_confirmation_text IS DISTINCT FROM '개인정보 사고 탐지 등록'");
    expect(route).toContain("'privacy_incident_detection_confirmation_required'");

    expect(detection).toContain('SECURITY DEFINER');
    expect(detection).toContain('SET search_path = public, pg_temp');
    expect(detection).toContain("p_severity NOT IN ('low', 'medium', 'high', 'critical')");
    expect(detection).toContain("p_detected_at < v_now - interval '10 years'");
    expect(detection).toContain('privacy_incident_audit_retention_until(v_now)');
    expect(detection).toContain("jsonb_build_object('created', 1)");
    expect(detection).not.toContain('description');
    expect(detection).not.toContain('evidence');
    expect(detection).not.toContain('credential');
    expect(detection).not.toContain('precise_location');

    expect(page).toContain("const DETECTION_CONFIRMATION = '개인정보 사고 탐지 등록';");
    expect(page).toContain("action: 'create'");
    expect(page).toContain('data-privacy-incident-detection-intake="true"');
    expect(page).toContain('data-privacy-incident-detection-readback="true"');
    expect(page).toContain('탐지 등록은 규제기관 신고·제출이 아니며, 인지 시각 또는 72시간 기준을 결정하지 않습니다.');
    expect(page).toContain('설명, 증거 원문, 위치, 자격 증명은 이 등록에서 입력하거나 저장하지 않습니다.');
    expect(page).not.toContain('<textarea');
  });

  test('Korean operator UI distinguishes drafts, decisions, deadline, and unverified external receipts', () => {
    const page = source('app/admin/privacy-incidents/page.tsx');
    const adminOverview =
      source('components/admin/AdminConsoleOverview.tsx') +
      '\n' +
      source('components/admin/console/AdminAuditEventsPanel.tsx');

    expect(page).toContain('개인정보 사고 담당 관리자 전용');
    expect(page).toContain('운영자 결정 입력');
    expect(page).toContain('마감은 이 시각 + 72시간으로만 계산됩니다. 탐지 시각은 사용하지 않습니다.');
    expect(page).toContain('통지 초안은 외부 제출이 아닙니다.');
    expect(page).toContain('외부 제출은 이 화면에서 자동 실행되지 않습니다.');
    expect(page).toContain('규제기관의 수리·승인 의미가 아닙니다.');
    expect(page).toContain('1. 미리보기 생성');
    expect(page).toContain('2. 확인 후 적용');
    expect(page).toContain('3. 독립 읽기검증 및 변경불가 감사 완료');
    expect(page).toContain('data-privacy-incident-workflow="true"');
    expect(page).toContain('data-privacy-incident-readback="true"');
    expect(page).toContain('data-privacy-incident-decision-prompts="true"');
    expect(page).toContain('data-privacy-incident-detection-intake="true"');
    expect(page).toContain('data-privacy-incident-detection-readback="true"');
    expect(page).toContain('idempotencyKey: preview.idempotencyKey');
    expect(adminOverview).toContain('href="/admin/privacy-incidents"');
    expect(adminOverview).toContain('data-admin-privacy-incidents-link="true"');
    expect(adminOverview).toContain('자동 신고나 수리 완료를 주장하지 않습니다.');
  });
  test('server-derived deadline readback handles boundaries, terminal states, and invalid timestamps fail-closed', () => {
    const awarenessAt = '2026-07-01T00:00:00.000Z';
    const deadlineAt = '2026-07-04T00:00:00.000Z';

    expect(getIncidentDeadlineReadback('triaged', awarenessAt, deadlineAt, new Date('2026-07-03T11:59:00.000Z')))
      .toEqual({ deadlineStatus: 'active', deadlineRemainingMinutes: 721 });
    expect(getIncidentDeadlineReadback('triaged', awarenessAt, deadlineAt, new Date('2026-07-03T12:00:00.000Z')))
      .toEqual({ deadlineStatus: 'due_soon', deadlineRemainingMinutes: 720 });
    expect(getIncidentDeadlineReadback('triaged', awarenessAt, deadlineAt, new Date('2026-07-04T00:00:00.000Z')))
      .toEqual({ deadlineStatus: 'overdue', deadlineRemainingMinutes: 0 });
    expect(getIncidentDeadlineReadback('triaged', awarenessAt, deadlineAt, new Date('2026-07-04T00:00:00.001Z')))
      .toEqual({ deadlineStatus: 'overdue', deadlineRemainingMinutes: -1 });
    expect(getIncidentDeadlineReadback('triaged', null, deadlineAt, new Date('2026-07-03T12:00:00.000Z')))
      .toEqual({ deadlineStatus: 'not_started', deadlineRemainingMinutes: null });
    expect(getIncidentDeadlineReadback('notified', awarenessAt, deadlineAt, new Date('2026-07-04T01:00:00.000Z')))
      .toEqual({ deadlineStatus: 'completed', deadlineRemainingMinutes: -60 });
    expect(getIncidentDeadlineReadback('closed', awarenessAt, deadlineAt, new Date('2026-07-04T01:00:00.000Z')))
      .toEqual({ deadlineStatus: 'completed', deadlineRemainingMinutes: -60 });
    expect(getIncidentDeadlineReadback('triaged', awarenessAt, 'invalid-timestamp', new Date('2026-07-03T12:00:00.000Z')))
      .toEqual({ deadlineStatus: 'not_started', deadlineRemainingMinutes: null });
    expect(getIncidentDeadlineReadback('triaged', awarenessAt, deadlineAt, new Date('invalid-timestamp')))
      .toEqual({ deadlineStatus: 'not_started', deadlineRemainingMinutes: null });
  });

  test('list contract sends one server timestamp and the UI fail-closes malformed deadline readback', () => {
    const route = source('app/api/admin/privacy-incidents/route.ts');
    const page = source('app/admin/privacy-incidents/page.tsx');
    const deadline = source('lib/privacy/incident-deadline.ts');

    expect(deadline).toContain("export type IncidentDeadlineStatus = 'not_started' | 'active' | 'due_soon' | 'overdue' | 'completed';");
    expect(route).toContain('const serverNow = new Date();');
    expect(route).toContain('serverNow: serverNowIso,');
    expect(route).toContain('deadlineStatus: deadlineReadback.deadlineStatus,');
    expect(route).toContain('deadlineRemainingMinutes: deadlineReadback.deadlineRemainingMinutes,');
    expect(page).toContain('const serverNow = payload ? readTimestamp(payload.serverNow) : null;');
    expect(page).toContain('readIncident(incident, serverNow)');
    expect(page).toContain('deadlineStatus !== expectedStatus');
    expect(page).toContain('deadlineRemainingMinutes !== expectedRemainingMinutes');
    expect(page).not.toContain('payload.incidents as Incident[]');
  });

  test('deadline escalation is operational only and preserves human review prompts at 999/1000 and sensitive/intrusion boundaries', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');
    const page = source('app/admin/privacy-incidents/page.tsx');
    const countThreshold = Number(migration.match(/coalesce\(p_affected_count, 0\) >= (\d+)/)?.[1]);

    expect(countThreshold).toBe(1000);
    expect(999 >= countThreshold).toBeFalse();
    expect(1000 >= countThreshold).toBeTrue();
    expect(migration).toContain("'count_1000_or_more_human_review'");
    expect(migration).toContain("'sensitive_or_unique_id_human_review'");
    expect(migration).toContain("'external_intrusion_human_review'");
    expect(migration).toContain("IF p_sensitive_or_unique_id IS TRUE THEN");
    expect(migration).toContain("IF p_external_intrusion IS TRUE THEN");
    expect(page).toContain('data-privacy-incident-deadline-escalation={incident.deadlineStatus}');
    expect(page).toContain('사람이 사실관계를 다시 확인하고 필요한 외부 조치를 직접 수행해야 합니다.');
    expect(page).toContain('이 표시는 신고·접수·법적 판단이나 외부 수리 결과가 아니며, 시스템은 자동 제출하지 않습니다.');
    expect(page).not.toContain('신고 완료');
    expect(page).not.toContain('외부 수리 완료');
  });

  test('durable schema does not provide raw evidence, credential, RRN, or precise-location fields', () => {
    const migration = repoSource('backend/supabase/migrations/20260712000500_g010_incident_workflow.sql');

    expect(migration).not.toContain('raw_evidence');
    expect(migration).not.toContain('evidence_metadata');
    expect(migration).not.toContain('password text');
    expect(migration).not.toContain('rrn text');
    expect(migration).not.toContain('precise_location');
    expect(migration).toContain('content_sha256 text');
    expect(migration).toContain('input_hash text');
  });
});
