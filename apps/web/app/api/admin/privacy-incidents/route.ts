import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import {
  BOUNDED_JSON_REQUEST_ERROR,
  readBoundedJsonRequest,
} from '@/lib/security/bounded-json-request';
import { isTrustedSameOriginMutation } from '@/lib/security/same-origin-mutation';
import { getIncidentDeadlineReadback } from '@/lib/privacy/incident-deadline';
import type { Database, Json, Tables } from '@/integrations/supabase/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
type PrivacyIncidentStatus = Tables<'privacy_incidents'>['status'];
type PrivacyIncidentSeverity = Tables<'privacy_incidents'>['severity'];

const INCIDENT_STATUSES = [
  'detected',
  'triaged',
  'contained',
  'assessed',
  'notice_drafted',
  'notice_approved',
  'notified',
  'closed',
] as const satisfies readonly PrivacyIncidentStatus[];
const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const satisfies readonly PrivacyIncidentSeverity[];
const MAX_REQUEST_BYTES = 16 * 1024;

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function isJson(value: unknown): value is Json {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJson);

  const record = readRecord(value);
  return record !== null && Object.values(record).every(isJson);
}

function isJsonRecord(value: unknown): value is { [key: string]: Json | undefined } {
  return readRecord(value) !== null && isJson(value);
}

function readRequiredString(value: unknown, maximumLength = 256): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : null;
}
function readExactString(value: unknown, maximumLength = 256): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength ? value : null;
}

function isTimestamp(value: string | null): value is string {
  return value !== null && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isIncidentStatus(value: string | null): value is PrivacyIncidentStatus {
  return value !== null && INCIDENT_STATUSES.some((status) => status === value);
}
function isIncidentSeverity(value: string | null): value is PrivacyIncidentSeverity {
  return value !== null && INCIDENT_SEVERITIES.some((severity) => severity === value);
}

function isUuid(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value);
}

const CREATE_REQUEST_KEYS = [
  'action',
  'incidentId',
  'severity',
  'detectedAt',
  'confirmationText',
  'correlationId',
] as const;
const CREATE_SNAKE_REQUEST_KEYS = [
  'action',
  'incident_id',
  'severity',
  'detected_at',
  'confirmation_text',
  'correlation_id',
] as const;
const PREVIEW_REQUEST_KEYS = [
  'action',
  'incidentId',
  'toStatus',
  'expectedUpdatedAt',
  'reasonCode',
  'input',
  'correlationId',
] as const;
const APPLY_REQUEST_KEYS = [
  'action',
  'operationId',
  'incidentId',
  'toStatus',
  'expectedUpdatedAt',
  'previewHash',
  'confirmationText',
  'reasonCode',
  'input',
  'correlationId',
  'idempotencyKey',
] as const;
const PREVIEW_SNAKE_REQUEST_KEYS = [
  'action',
  'incident_id',
  'to_status',
  'expected_updated_at',
  'reason_code',
  'input',
  'correlation_id',
] as const;
const APPLY_SNAKE_REQUEST_KEYS = [
  'action',
  'operation_id',
  'incident_id',
  'to_status',
  'expected_updated_at',
  'preview_hash',
  'confirmation_text',
  'reason_code',
  'input',
  'correlation_id',
  'idempotency_key',
] as const;

function hasExactKeys(body: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(body).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function isApplyRequest(body: Record<string, unknown>) {
  const usesSnakeCase = hasExactKeys(body, APPLY_SNAKE_REQUEST_KEYS);
  if (
    body.action !== 'apply'
    || (!hasExactKeys(body, APPLY_REQUEST_KEYS) && !usesSnakeCase)
  ) return null;

  const operationId = readRequiredString(usesSnakeCase ? body.operation_id : body.operationId);
  const incidentId = readRequiredString(usesSnakeCase ? body.incident_id : body.incidentId);
  const toStatus = readRequiredString(usesSnakeCase ? body.to_status : body.toStatus, 32);
  const expectedUpdatedAt = readRequiredString(usesSnakeCase ? body.expected_updated_at : body.expectedUpdatedAt, 64);
  const previewHash = readRequiredString(usesSnakeCase ? body.preview_hash : body.previewHash, 64);
  const confirmationText = readRequiredString(usesSnakeCase ? body.confirmation_text : body.confirmationText, 64);
  const reasonCode = readRequiredString(usesSnakeCase ? body.reason_code : body.reasonCode, 64);
  const correlationId = readRequiredString(usesSnakeCase ? body.correlation_id : body.correlationId);
  const idempotencyKey = readRequiredString(usesSnakeCase ? body.idempotency_key : body.idempotencyKey, 128);
  const input = isJsonRecord(body.input) ? body.input : null;

  if (
    !isUuid(operationId)
    || !isUuid(incidentId)
    || !isIncidentStatus(toStatus)
    || !isTimestamp(expectedUpdatedAt)
    || !previewHash
    || !SHA256_PATTERN.test(previewHash)
    || !confirmationText
    || !reasonCode
    || !REASON_CODE_PATTERN.test(reasonCode)
    || !isUuid(correlationId)
    || !idempotencyKey
    || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    || !input
  ) {
    return null;
  }

  return {
    operationId,
    incidentId,
    toStatus,
    expectedUpdatedAt,
    previewHash,
    confirmationText,
    reasonCode,
    input,
    correlationId,
    idempotencyKey,
  };
}

function isPreviewRequest(body: Record<string, unknown>) {
  const usesSnakeCase = hasExactKeys(body, PREVIEW_SNAKE_REQUEST_KEYS);
  if (
    body.action !== 'preview'
    || (!hasExactKeys(body, PREVIEW_REQUEST_KEYS) && !usesSnakeCase)
  ) return null;

  const incidentId = readRequiredString(usesSnakeCase ? body.incident_id : body.incidentId);
  const toStatus = readRequiredString(usesSnakeCase ? body.to_status : body.toStatus, 32);
  const expectedUpdatedAt = readRequiredString(usesSnakeCase ? body.expected_updated_at : body.expectedUpdatedAt, 64);
  const reasonCode = readRequiredString(usesSnakeCase ? body.reason_code : body.reasonCode, 64);
  const correlationId = readRequiredString(usesSnakeCase ? body.correlation_id : body.correlationId);
  const input = isJsonRecord(body.input) ? body.input : null;

  if (
    !isUuid(incidentId)
    || !isIncidentStatus(toStatus)
    || !isTimestamp(expectedUpdatedAt)
    || !reasonCode
    || !REASON_CODE_PATTERN.test(reasonCode)
    || !isUuid(correlationId)
    || !input
  ) {
    return null;
  }

  return { incidentId, toStatus, expectedUpdatedAt, reasonCode, input, correlationId };
}
function isCreateRequest(body: Record<string, unknown>) {
  const usesSnakeCase = hasExactKeys(body, CREATE_SNAKE_REQUEST_KEYS);
  if (
    body.action !== 'create'
    || (!hasExactKeys(body, CREATE_REQUEST_KEYS) && !usesSnakeCase)
  ) return null;

  const incidentId = readRequiredString(usesSnakeCase ? body.incident_id : body.incidentId);
  const severity = readRequiredString(body.severity, 16);
  const detectedAt = readRequiredString(usesSnakeCase ? body.detected_at : body.detectedAt, 64);
  const confirmationText = readExactString(usesSnakeCase ? body.confirmation_text : body.confirmationText, 64);
  const correlationId = readRequiredString(usesSnakeCase ? body.correlation_id : body.correlationId);

  if (
    !isUuid(incidentId)
    || !isIncidentSeverity(severity)
    || !isTimestamp(detectedAt)
    || !confirmationText
    || !isUuid(correlationId)
  ) {
    return null;
  }

  return { incidentId, severity, detectedAt, confirmationText, correlationId };
}

function readRpcErrorCode(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as Record<string, unknown>).message)
    : '';
  const knownCodes = [
    'invalid_privacy_incident_preview_request',
    'invalid_privacy_incident_detection_request',
    'privacy_incident_detection_confirmation_required',
    'privacy_incident_detection_idempotency_conflict',
    'privacy_incident_detection_readback_failed',
    'invalid_privacy_incident_apply_request',
    'invalid_privacy_incident_transition_input',
    'privacy_incident_awareness_confirmation_required',
    'privacy_incident_assessment_required',
    'privacy_incident_notice_draft_required',
    'privacy_incident_notice_approval_required',
    'privacy_incident_external_receipt_required',
    'privacy_incident_closure_readback_required',
    'privacy_incident_confirmation_required',
    'privacy_incident_not_found',
    'privacy_incident_version_stale',
    'privacy_incident_transition_forbidden',
    'privacy_incident_preview_not_found',
    'privacy_incident_preview_stale',
    'privacy_incident_idempotency_conflict',
    'privacy_incident_privacy_admin_required',
    'privacy_incident_service_role_required',
    'privacy_incident_readback_failed',
    'privacy_incident_audit_retention_class_required',
  ];
  return knownCodes.find((code) => message.includes(code)) ?? 'privacy_incident_workflow_failed';
}

function statusForRpcErrorCode(errorCode: string): 400 | 403 | 404 | 409 | 502 {
  if (errorCode === 'privacy_incident_not_found') return 404;
  if (errorCode === 'privacy_incident_privacy_admin_required' || errorCode === 'privacy_incident_service_role_required') return 403;
  if (
    errorCode === 'privacy_incident_version_stale'
    || errorCode === 'privacy_incident_transition_forbidden'
    || errorCode === 'privacy_incident_preview_not_found'
    || errorCode === 'privacy_incident_preview_stale'
    || errorCode === 'privacy_incident_idempotency_conflict'
    || errorCode === 'privacy_incident_readback_failed'
    || errorCode === 'privacy_incident_audit_retention_class_required'
    || errorCode === 'privacy_incident_detection_idempotency_conflict'
    || errorCode === 'privacy_incident_detection_readback_failed'
  ) return 409;
  if (errorCode === 'privacy_incident_workflow_failed') return 502;
  return 400;
}

function mapIncident(
  row: Pick<
    Tables<'privacy_incidents'>,
    | 'id'
    | 'status'
    | 'severity'
    | 'detected_at'
    | 'awareness_at'
    | 'deadline_at'
    | 'affected_count_estimate'
    | 'data_categories'
    | 'sensitive_or_unique_id'
    | 'external_intrusion'
    | 'decision_code'
    | 'assessment_readback_at'
    | 'updated_at'
  >,
  serverNow: Date,
) {
  const deadlineReadback = getIncidentDeadlineReadback(
    typeof row.status === 'string' ? row.status : null,
    typeof row.awareness_at === 'string' ? row.awareness_at : null,
    typeof row.deadline_at === 'string' ? row.deadline_at : null,
    serverNow,
  );

  return {
    id: row.id,
    status: row.status,
    severity: row.severity,
    detectedAt: row.detected_at,
    awarenessAt: row.awareness_at,
    deadlineAt: row.deadline_at,
    deadlineStatus: deadlineReadback.deadlineStatus,
    deadlineRemainingMinutes: deadlineReadback.deadlineRemainingMinutes,
    affectedCountEstimate: row.affected_count_estimate,
    dataCategories: Array.isArray(row.data_categories) ? row.data_categories : [],
    sensitiveOrUniqueId: row.sensitive_or_unique_id,
    externalIntrusion: row.external_intrusion,
    decisionCode: row.decision_code,
    assessmentReadbackAt: row.assessment_readback_at,
    updatedAt: row.updated_at,
  };
}

function mapNotice(
  row: Pick<
    Tables<'privacy_incident_notices'>,
    | 'id'
    | 'incident_id'
    | 'audience'
    | 'status'
    | 'template_version'
    | 'content_sha256'
    | 'approved_by'
    | 'approved_at'
    | 'submitted_by'
    | 'submitted_at'
    | 'external_receipt_ref'
  >,
) {
  return {
    id: row.id,
    incidentId: row.incident_id,
    audience: row.audience,
    status: row.status,
    templateVersion: row.template_version,
    contentSha256: row.content_sha256,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    externalReceiptRef: row.external_receipt_ref,
  };
}

function mapAction(
  row: Pick<
    Tables<'privacy_incident_actions'>,
    | 'id'
    | 'incident_id'
    | 'from_status'
    | 'to_status'
    | 'actor_user_id'
    | 'reason_code'
    | 'result_status'
    | 'readback_status'
    | 'audit_id'
    | 'created_at'
  >,
) {
  return {
    id: row.id,
    incidentId: row.incident_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: row.actor_user_id,
    reasonCode: row.reason_code,
    resultStatus: row.result_status,
    readbackStatus: row.readback_status,
    auditId: row.audit_id,
    createdAt: row.created_at,
  };
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const [incidentsResult, noticesResult, actionsResult] = await Promise.all([
      supabase
        .from('privacy_incidents')
        .select('id, status, severity, detected_at, awareness_at, deadline_at, affected_count_estimate, data_categories, sensitive_or_unique_id, external_intrusion, decision_code, assessment_readback_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('privacy_incident_notices')
        .select('id, incident_id, audience, status, template_version, content_sha256, approved_by, approved_at, submitted_by, submitted_at, external_receipt_ref')
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('privacy_incident_actions')
        .select('id, incident_id, from_status, to_status, actor_user_id, reason_code, result_status, readback_status, audit_id, created_at')
        .order('created_at', { ascending: false })
        .limit(300),
    ]);

    if (incidentsResult.error || noticesResult.error || actionsResult.error) {
      return noStoreJson({ ok: false, error: 'privacy_incident_read_failed' }, { status: 502 });
    }

    const incidents = Array.isArray(incidentsResult.data) ? incidentsResult.data : [];
    const notices = Array.isArray(noticesResult.data) ? noticesResult.data : [];
    const actions = Array.isArray(actionsResult.data) ? actionsResult.data : [];
    const serverNow = new Date();
    const serverNowIso = serverNow.toISOString();
    return noStoreJson({
      ok: true,
      serverNow: serverNowIso,
      incidents: incidents.map((incident) => mapIncident(incident, serverNow)),
      notices: notices.map(mapNotice),
      actions: actions.map(mapAction),
    });
  } catch {
    return noStoreJson({ ok: false, error: 'privacy_incident_read_failed' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ ok: false, error: 'invalid_privacy_incident_preview_request' }, { status: 403 });
  }

  const parsedBody = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    return parsedBody.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge
      ? noStoreJson({ ok: false, error: 'privacy_incident_request_too_large' }, { status: 413 })
      : noStoreJson({ ok: false, error: 'invalid_privacy_incident_preview_request' }, { status: 400 });
  }

  const body = readRecord(parsedBody.value);
  const detection = body ? isCreateRequest(body) : null;
  const preview = body ? isPreviewRequest(body) : null;
  if (!detection && !preview) {
    return noStoreJson(
      { ok: false, error: body?.action === 'create' ? 'invalid_privacy_incident_detection_request' : 'invalid_privacy_incident_preview_request' },
      { status: 400 },
    );
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    let data: unknown;
    let error: unknown;
    if (detection) {
      const args: Database['public']['Functions']['record_privacy_incident_detection']['Args'] = {
        p_actor_user_id: admin.userId,
        p_incident_id: detection.incidentId,
        p_severity: detection.severity,
        p_detected_at: detection.detectedAt,
        p_confirmation_text: detection.confirmationText,
        p_correlation_id: detection.correlationId,
      };
      ({ data, error } = await supabase.rpc('record_privacy_incident_detection', args));
    } else if (preview) {
      const args: Database['public']['Functions']['preview_privacy_incident_transition']['Args'] = {
        p_actor_user_id: admin.userId,
        p_incident_id: preview.incidentId,
        p_to_status: preview.toStatus,
        p_expected_updated_at: preview.expectedUpdatedAt,
        p_reason_code: preview.reasonCode,
        p_transition_input: preview.input,
        p_correlation_id: preview.correlationId,
      };
      ({ data, error } = await supabase.rpc('preview_privacy_incident_transition', args));
    } else {
      return noStoreJson({ ok: false, error: 'invalid_privacy_incident_preview_request' }, { status: 400 });
    }

    if (error) {
      const errorCode = readRpcErrorCode(error);
      return noStoreJson({ ok: false, error: errorCode }, { status: statusForRpcErrorCode(errorCode) });
    }

    return data && typeof data === 'object' && !Array.isArray(data)
      ? noStoreJson(data)
      : noStoreJson({ ok: false, error: 'privacy_incident_workflow_failed' }, { status: 502 });
  } catch {
    return noStoreJson({ ok: false, error: 'privacy_incident_workflow_failed' }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set('Cache-Control', 'no-store');
    return admin.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStoreJson({ ok: false, error: 'invalid_privacy_incident_apply_request' }, { status: 403 });
  }

  const parsedBody = await readBoundedJsonRequest(request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    return parsedBody.code === BOUNDED_JSON_REQUEST_ERROR.bodyTooLarge
      ? noStoreJson({ ok: false, error: 'privacy_incident_request_too_large' }, { status: 413 })
      : noStoreJson({ ok: false, error: 'invalid_privacy_incident_apply_request' }, { status: 400 });
  }

  const body = readRecord(parsedBody.value);
  const apply = body ? isApplyRequest(body) : null;
  if (!apply) {
    return noStoreJson({ ok: false, error: 'invalid_privacy_incident_apply_request' }, { status: 400 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const args: Database['public']['Functions']['apply_privacy_incident_transition']['Args'] = {
      p_actor_user_id: admin.userId,
      p_operation_id: apply.operationId,
      p_incident_id: apply.incidentId,
      p_to_status: apply.toStatus,
      p_expected_updated_at: apply.expectedUpdatedAt,
      p_preview_hash: apply.previewHash,
      p_confirmation_text: apply.confirmationText,
      p_reason_code: apply.reasonCode,
      p_transition_input: apply.input,
      p_correlation_id: apply.correlationId,
      p_idempotency_key: apply.idempotencyKey,
    };
    const { data, error } = await supabase.rpc('apply_privacy_incident_transition', args);

    if (error) {
      const errorCode = readRpcErrorCode(error);
      return noStoreJson({ ok: false, error: errorCode }, { status: statusForRpcErrorCode(errorCode) });
    }

    return data && typeof data === 'object' && !Array.isArray(data)
      ? noStoreJson(data)
      : noStoreJson({ ok: false, error: 'privacy_incident_workflow_failed' }, { status: 502 });
  } catch {
    return noStoreJson({ ok: false, error: 'privacy_incident_workflow_failed' }, { status: 502 });
  }
}
