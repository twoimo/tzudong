"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';

type IncidentStatus =
  | 'detected'
  | 'triaged'
  | 'contained'
  | 'assessed'
  | 'notice_drafted'
  | 'notice_approved'
  | 'notified'
  | 'closed';
type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
type DeadlineStatus = 'not_started' | 'active' | 'due_soon' | 'overdue' | 'completed';

type Incident = {
  id: string;
  status: IncidentStatus;
  severity: string;
  detectedAt: string;
  awarenessAt: string | null;
  deadlineAt: string | null;
  deadlineStatus: DeadlineStatus;
  deadlineRemainingMinutes: number | null;
  affectedCountEstimate: number | null;
  dataCategories: string[];
  sensitiveOrUniqueId: boolean | null;
  externalIntrusion: boolean | null;
  decisionCode: string | null;
  assessmentReadbackAt: string | null;
  updatedAt: string;
};

type Notice = {
  id: string;
  incidentId: string;
  audience: 'data_subjects' | 'pipc' | 'kisa';
  status: 'draft' | 'approved' | 'submitted' | 'failed';
  templateVersion: string;
  contentSha256: string;
  approvedBy: string | null;
  approvedAt: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  externalReceiptRef: string | null;
};

type Action = {
  id: string;
  incidentId: string;
  fromStatus: IncidentStatus;
  toStatus: IncidentStatus;
  actorUserId: string;
  reasonCode: string;
  resultStatus: 'applied';
  readbackStatus: 'passed' | 'failed';
  auditId: string;
  createdAt: string;
};

type DecisionPrompt = {
  code: string;
  messageKo: string;
};

type Preview = {
  operationId: string;
  previewHash: string;
  expiresAt: string;
  requiredConfirmation: string;
  correlationId: string;
  idempotencyKey: string;
  toStatus: IncidentStatus;
  input: Record<string, unknown>;
  reasonCode: string;
  decisionPrompts: DecisionPrompt[];
};

type ReadbackReceipt = {
  status: string;
  replayed: boolean;
  auditId: string;
  readback: { passed: boolean; checks: Record<string, boolean> };
};
type DetectionReceipt = ReadbackReceipt & {
  operationId: string;
  incidentId: string;
};

const NEXT_STATUS: Record<IncidentStatus, IncidentStatus | null> = {
  detected: 'triaged',
  triaged: 'contained',
  contained: 'assessed',
  assessed: 'notice_drafted',
  notice_drafted: 'notice_approved',
  notice_approved: 'notified',
  notified: 'closed',
  closed: null,
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  detected: '탐지됨',
  triaged: '초기 분류됨',
  contained: '차단/격리됨',
  assessed: '사람 검토 평가됨',
  notice_drafted: '통지 초안',
  notice_approved: '통지 승인됨',
  notified: '사람 제출 기록됨',
  closed: '종결됨',
};

const REASON_CODE: Record<IncidentStatus, string> = {
  detected: 'incident_detected',
  triaged: 'awareness_confirmed',
  contained: 'containment_recorded',
  assessed: 'human_assessment_recorded',
  notice_drafted: 'notice_draft_recorded',
  notice_approved: 'notice_human_approval_recorded',
  notified: 'external_receipt_recorded',
  closed: 'closure_readback_reviewed',
};
const REASON_LABEL: Record<IncidentStatus, string> = {
  detected: '사고 탐지 기록',
  triaged: '인지 확정 시각 확인',
  contained: '차단·격리 조치 기록',
  assessed: '사람 평가 기록',
  notice_drafted: '통지 초안 기록',
  notice_approved: '사람 승인 기록',
  notified: '사람 제출 접수 참조 기록',
  closed: '종결 읽기검증 검토',
};

const DATA_CATEGORIES = [
  ['account', '계정'],
  ['contact', '연락처'],
  ['authentication', '인증'],
  ['device', '기기'],
  ['usage', '이용기록'],
  ['location', '위치 관련 분류'],
  ['financial', '결제/금융'],
  ['sensitive', '민감정보'],
  ['unique_identifier', '고유식별정보'],
  ['other', '기타'],
] as const;
const DETECTION_CONFIRMATION = '개인정보 사고 탐지 등록';
const INCIDENT_STATUS_VALUES = new Set<IncidentStatus>([
  'detected',
  'triaged',
  'contained',
  'assessed',
  'notice_drafted',
  'notice_approved',
  'notified',
  'closed',
]);
const INCIDENT_SEVERITY_VALUES = new Set<IncidentSeverity>(['low', 'medium', 'high', 'critical']);
const DEADLINE_STATUS_VALUES = new Set<DeadlineStatus>(['not_started', 'active', 'due_soon', 'overdue', 'completed']);
const NOTICE_AUDIENCE_VALUES = new Set<Notice['audience']>(['data_subjects', 'pipc', 'kisa']);
const NOTICE_STATUS_VALUES = new Set<Notice['status']>(['draft', 'approved', 'submitted', 'failed']);
const READBACK_STATUS_VALUES = new Set<Action['readbackStatus']>(['passed', 'failed']);
const DATA_CATEGORY_VALUES = new Set<string>(DATA_CATEGORIES.map(([value]) => value));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DEADLINE_WINDOW_MS = 72 * 60 * 60 * 1000;
const DUE_SOON_WINDOW_MS = 12 * 60 * 60 * 1000;

const DEADLINE_STATUS_LABEL: Record<DeadlineStatus, string> = {
  not_started: '인지 시각 미확정',
  active: '운영 검토 진행',
  due_soon: '12시간 이내',
  overdue: '운영 기한 경과',
  completed: '운영 완료 기록',
};

const DEADLINE_STATUS_PRIORITY: Record<DeadlineStatus, number> = {
  overdue: 0,
  due_soon: 1,
  active: 2,
  not_started: 3,
  completed: 4,
};

function formatTime(value: string | null) {
  if (!value) return '미확정';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '미확정' : date.toLocaleString('ko-KR', { hour12: false });
}

function localDateTimeValue() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function readBooleanRecord(value: unknown): Record<string, boolean> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).filter(([, entry]) => typeof entry === 'boolean')) as Record<string, boolean>;
}
function isValueOf<T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T {
  return typeof value === 'string' && allowed.has(value as T);
}

function readBoundedString(value: unknown, maximumLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength ? value : null;
}

function readUuid(value: unknown): string | null {
  const id = readBoundedString(value, 36);
  return id && UUID_PATTERN.test(id) ? id : null;
}

function readTimestamp(value: unknown): string | null {
  const timestamp = readBoundedString(value, 64);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function readNullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : readTimestamp(value) ?? undefined;
}

function readNullableBoundedString(value: unknown, maximumLength: number): string | null | undefined {
  return value === null ? null : readBoundedString(value, maximumLength) ?? undefined;
}

function readStringArray(value: unknown, allowed: ReadonlySet<string>, maximumEntries: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumEntries) return null;
  const entries = value.every((entry) => typeof entry === 'string' && allowed.has(entry)) ? value as string[] : null;
  return entries && new Set(entries).size === entries.length ? entries : null;
}

function expectedDeadlineStatus(status: IncidentStatus, awarenessAt: string, deadlineAt: string, serverNow: string): DeadlineStatus | null {
  const awarenessMilliseconds = Date.parse(awarenessAt);
  const deadlineMilliseconds = Date.parse(deadlineAt);
  const serverNowMilliseconds = Date.parse(serverNow);
  if (
    status === 'detected'
    || !Number.isSafeInteger(awarenessMilliseconds)
    || !Number.isSafeInteger(deadlineMilliseconds)
    || !Number.isSafeInteger(serverNowMilliseconds)
    || deadlineMilliseconds !== awarenessMilliseconds + DEADLINE_WINDOW_MS
  ) return 'not_started';
  if (status === 'notified' || status === 'closed') return 'completed';
  if (deadlineMilliseconds <= serverNowMilliseconds) return 'overdue';
  if (deadlineMilliseconds - serverNowMilliseconds <= DUE_SOON_WINDOW_MS) return 'due_soon';
  return 'active';
}

function readIncident(value: unknown, serverNow: string): Incident | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readUuid(record.id);
  const status = isValueOf(record.status, INCIDENT_STATUS_VALUES) ? record.status : null;
  const severity = isValueOf(record.severity, INCIDENT_SEVERITY_VALUES) ? record.severity : null;
  const detectedAt = readTimestamp(record.detectedAt);
  const awarenessAt = readNullableTimestamp(record.awarenessAt);
  const deadlineAt = readNullableTimestamp(record.deadlineAt);
  const affectedCountEstimate = record.affectedCountEstimate === null
    ? null
    : typeof record.affectedCountEstimate === 'number'
      && Number.isSafeInteger(record.affectedCountEstimate)
      && record.affectedCountEstimate >= 0
      && record.affectedCountEstimate <= 1_000_000_000
      ? record.affectedCountEstimate
      : undefined;
  const dataCategories = readStringArray(record.dataCategories, DATA_CATEGORY_VALUES, 10);
  const sensitiveOrUniqueId = record.sensitiveOrUniqueId === null || typeof record.sensitiveOrUniqueId === 'boolean'
    ? record.sensitiveOrUniqueId
    : undefined;
  const externalIntrusion = record.externalIntrusion === null || typeof record.externalIntrusion === 'boolean'
    ? record.externalIntrusion
    : undefined;
  const decisionCode = readNullableBoundedString(record.decisionCode, 64);
  const assessmentReadbackAt = readNullableTimestamp(record.assessmentReadbackAt);
  const updatedAt = readTimestamp(record.updatedAt);
  const deadlineStatus = isValueOf(record.deadlineStatus, DEADLINE_STATUS_VALUES) ? record.deadlineStatus : null;
  const deadlineRemainingMinutes = record.deadlineRemainingMinutes === null
    ? null
    : typeof record.deadlineRemainingMinutes === 'number' && Number.isSafeInteger(record.deadlineRemainingMinutes)
      ? record.deadlineRemainingMinutes
      : undefined;

  if (
    !id
    || !status
    || !severity
    || !detectedAt
    || awarenessAt === undefined
    || deadlineAt === undefined
    || affectedCountEstimate === undefined
    || !dataCategories
    || sensitiveOrUniqueId === undefined
    || externalIntrusion === undefined
    || decisionCode === undefined
    || assessmentReadbackAt === undefined
    || !updatedAt
    || !deadlineStatus
    || deadlineRemainingMinutes === undefined
  ) return null;

  if (awarenessAt === null || deadlineAt === null) {
    return deadlineStatus === 'not_started' && deadlineRemainingMinutes === null
      ? {
        id,
        status,
        severity,
        detectedAt,
        awarenessAt,
        deadlineAt,
        deadlineStatus,
        deadlineRemainingMinutes,
        affectedCountEstimate,
        dataCategories,
        sensitiveOrUniqueId,
        externalIntrusion,
        decisionCode,
        assessmentReadbackAt,
        updatedAt,
      }
      : null;
  }

  const expectedStatus = expectedDeadlineStatus(status, awarenessAt, deadlineAt, serverNow);
  const expectedRemainingMinutes = Math.floor((Date.parse(deadlineAt) - Date.parse(serverNow)) / 60_000);
  if (
    !expectedStatus
    || deadlineStatus !== expectedStatus
    || deadlineRemainingMinutes !== expectedRemainingMinutes
  ) return null;

  return {
    id,
    status,
    severity,
    detectedAt,
    awarenessAt,
    deadlineAt,
    deadlineStatus,
    deadlineRemainingMinutes,
    affectedCountEstimate,
    dataCategories,
    sensitiveOrUniqueId,
    externalIntrusion,
    decisionCode,
    assessmentReadbackAt,
    updatedAt,
  };
}

function readNotice(value: unknown): Notice | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readUuid(record.id);
  const incidentId = readUuid(record.incidentId);
  const audience = isValueOf(record.audience, NOTICE_AUDIENCE_VALUES) ? record.audience : null;
  const status = isValueOf(record.status, NOTICE_STATUS_VALUES) ? record.status : null;
  const templateVersion = readBoundedString(record.templateVersion, 64);
  const contentSha256 = readBoundedString(record.contentSha256, 64);
  const approvedBy = record.approvedBy === null ? null : readUuid(record.approvedBy) ?? undefined;
  const approvedAt = readNullableTimestamp(record.approvedAt);
  const submittedBy = record.submittedBy === null ? null : readUuid(record.submittedBy) ?? undefined;
  const submittedAt = readNullableTimestamp(record.submittedAt);
  const externalReceiptRef = readNullableBoundedString(record.externalReceiptRef, 160);

  if (
    !id
    || !incidentId
    || !audience
    || !status
    || !templateVersion
    || !contentSha256
    || !SHA256_PATTERN.test(contentSha256)
    || approvedBy === undefined
    || approvedAt === undefined
    || submittedBy === undefined
    || submittedAt === undefined
    || externalReceiptRef === undefined
  ) return null;

  return {
    id,
    incidentId,
    audience,
    status,
    templateVersion,
    contentSha256,
    approvedBy,
    approvedAt,
    submittedBy,
    submittedAt,
    externalReceiptRef,
  };
}

function readAction(value: unknown): Action | null {
  const record = asRecord(value);
  if (!record) return null;

  const id = readUuid(record.id);
  const incidentId = readUuid(record.incidentId);
  const fromStatus = isValueOf(record.fromStatus, INCIDENT_STATUS_VALUES) ? record.fromStatus : null;
  const toStatus = isValueOf(record.toStatus, INCIDENT_STATUS_VALUES) ? record.toStatus : null;
  const actorUserId = readUuid(record.actorUserId);
  const reasonCode = readBoundedString(record.reasonCode, 64);
  const resultStatus = record.resultStatus === 'applied' ? 'applied' : null;
  const readbackStatus = isValueOf(record.readbackStatus, READBACK_STATUS_VALUES) ? record.readbackStatus : null;
  const auditId = readUuid(record.auditId);
  const createdAt = readTimestamp(record.createdAt);

  return id && incidentId && fromStatus && toStatus && actorUserId && reasonCode && resultStatus && readbackStatus && auditId && createdAt
    ? { id, incidentId, fromStatus, toStatus, actorUserId, reasonCode, resultStatus, readbackStatus, auditId, createdAt }
    : null;
}

function readExactList<T>(value: unknown, parser: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const entries = value.map(parser);
  return entries.every((entry): entry is T => entry !== null) ? entries : null;
}

function sortIncidents(incidents: Incident[]): Incident[] {
  return [...incidents].sort((left, right) => {
    const priority = DEADLINE_STATUS_PRIORITY[left.deadlineStatus] - DEADLINE_STATUS_PRIORITY[right.deadlineStatus];
    if (priority !== 0) return priority;

    const updatedAt = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return updatedAt !== 0 ? updatedAt : left.id.localeCompare(right.id);
  });
}

function formatDeadlineRemaining(status: DeadlineStatus, minutes: number | null) {
  if (minutes === null) return '인지 시각 확인 필요';
  if (status === 'overdue') return `${Math.abs(minutes)}분 경과`;
  if (status === 'completed') return '완료 상태';
  return `${minutes}분 남음`;
}

function DeadlineBadge({ status, minutes }: { status: DeadlineStatus; minutes: number | null }) {
  const className = status === 'overdue'
    ? 'border-destructive/50 bg-destructive/10 text-destructive'
    : status === 'due_soon'
      ? 'border-amber-400 bg-amber-50 text-amber-950'
      : 'border-muted bg-muted text-muted-foreground';

  return (
    <span className={`rounded border px-2 py-1 text-xs ${className}`} data-privacy-incident-deadline-status={status}>
      {DEADLINE_STATUS_LABEL[status]} · {formatDeadlineRemaining(status, minutes)}
    </span>
  );
}

function DeadlineEscalationAlert({ incident }: { incident: Incident }) {
  if (incident.deadlineStatus !== 'overdue' && incident.deadlineStatus !== 'due_soon') return null;

  const overdue = incident.deadlineStatus === 'overdue';
  return (
    <div
      role="alert"
      className={`rounded border p-3 text-sm ${overdue ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-amber-400 bg-amber-50 text-amber-950'}`}
      data-privacy-incident-deadline-escalation={incident.deadlineStatus}
    >
      <strong>{overdue ? '운영 에스컬레이션: 72시간 운영 검토 창이 경과했습니다.' : '운영 에스컬레이션: 72시간 운영 검토 창이 12시간 이내입니다.'}</strong>
      <p className="mt-1">
        사람이 사실관계를 다시 확인하고 필요한 외부 조치를 직접 수행해야 합니다. 이 표시는 신고·접수·법적 판단이나 외부 수리 결과가 아니며, 시스템은 자동 제출하지 않습니다.
      </p>
    </div>
  );
}


function uuid() {
  return typeof window !== 'undefined' && window.crypto?.randomUUID ? window.crypto.randomUUID() : null;
}

function errorMessage(error: unknown) {
  const code = asRecord(error)?.error;
  const messages: Record<string, string> = {
    privacy_incident_awareness_confirmation_required: '인지 확정 시각을 입력해야 합니다.',
    privacy_incident_assessment_required: '영향 인원·항목·민감/고유식별·외부침입 판단 입력이 모두 필요합니다.',
    privacy_incident_notice_draft_required: '통지 수신자, 템플릿 버전, 내용 해시가 필요합니다.',
    privacy_incident_notice_approval_required: '승인 가능한 통지 초안을 선택해야 합니다.',
    privacy_incident_external_receipt_required: '사람이 입력한 외부 접수 참조가 필요합니다.',
    privacy_incident_closure_readback_required: '평가 및 통지 읽기검증이 완료되지 않아 종결할 수 없습니다.',
    privacy_incident_version_stale: '다른 변경이 반영되었습니다. 목록을 새로고침하고 다시 미리보기를 생성하세요.',
    privacy_incident_preview_stale: '미리보기의 유효기간이 지났거나 현재 상태와 다릅니다. 다시 생성하세요.',
    privacy_incident_transition_forbidden: '현재 상태에서는 이 전환을 수행할 수 없습니다.',
    privacy_incident_confirmation_required: '확인 문구가 일치하지 않습니다.',
    privacy_incident_idempotency_conflict: '같은 멱등성 키가 다른 요청에 사용되었습니다.',
    privacy_incident_audit_retention_class_required: '승인된 사고 감사 보존 클래스가 활성화되지 않아 작업을 중단했습니다.',
    invalid_privacy_incident_detection_request: '탐지 등록 입력이 올바르지 않습니다.',
    privacy_incident_detection_confirmation_required: '탐지 등록 확인 문구가 일치하지 않습니다.',
    privacy_incident_detection_idempotency_conflict: '같은 사고 식별자가 다른 탐지 등록에 사용되었습니다.',
    privacy_incident_detection_readback_failed: '탐지 등록 읽기검증이 완료되지 않아 작업을 중단했습니다.',
  };
  return typeof code === 'string' && messages[code] ? messages[code] : '개인정보 사고 작업을 완료하지 못했습니다. 원문 오류는 표시하지 않습니다.';
}

export default function PrivacyIncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [awarenessAt, setAwarenessAt] = useState(localDateTimeValue);
  const [affectedCountEstimate, setAffectedCountEstimate] = useState('');
  const [dataCategories, setDataCategories] = useState<string[]>([]);
  const [sensitiveOrUniqueId, setSensitiveOrUniqueId] = useState(false);
  const [externalIntrusion, setExternalIntrusion] = useState(false);
  const [decisionCode, setDecisionCode] = useState('human_assessment_recorded');
  const [noticeAudience, setNoticeAudience] = useState<Notice['audience']>('data_subjects');
  const [templateVersion, setTemplateVersion] = useState('ko-v1');
  const [contentSha256, setContentSha256] = useState('');
  const [noticeId, setNoticeId] = useState('');
  const [externalReceiptRef, setExternalReceiptRef] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [receipt, setReceipt] = useState<ReadbackReceipt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detectionSeverity, setDetectionSeverity] = useState<IncidentSeverity>('medium');
  const [detectedAt, setDetectedAt] = useState(localDateTimeValue);
  const [detectionConfirmationText, setDetectionConfirmationText] = useState('');
  const [detectionAttempt, setDetectionAttempt] = useState<{ incidentId: string; correlationId: string; severity: IncidentSeverity; detectedAt: string } | null>(null);
  const [detectionReceipt, setDetectionReceipt] = useState<DetectionReceipt | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/privacy-incidents', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const payload = asRecord(await response.json());
      const serverNow = payload ? readTimestamp(payload.serverNow) : null;
      const nextIncidents = serverNow && payload ? readExactList(payload.incidents, (incident) => readIncident(incident, serverNow)) : null;
      const nextNotices = payload ? readExactList(payload.notices, readNotice) : null;
      const nextActions = payload ? readExactList(payload.actions, readAction) : null;
      if (!response.ok || payload?.ok !== true || !serverNow || !nextIncidents || !nextNotices || !nextActions) throw payload;

      const sortedIncidents = sortIncidents(nextIncidents);
      setIncidents(sortedIncidents);
      setNotices(nextNotices);
      setActions(nextActions);
      setSelectedIncidentId((current) => current && sortedIncidents.some((incident) => incident.id === current)
        ? current
        : sortedIncidents[0]?.id ?? null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.id === selectedIncidentId) ?? null,
    [incidents, selectedIncidentId],
  );
  const nextStatus = selectedIncident ? NEXT_STATUS[selectedIncident.status] : null;
  const selectedNotices = useMemo(
    () => notices.filter((notice) => notice.incidentId === selectedIncident?.id),
    [notices, selectedIncident?.id],
  );
  const selectedActions = useMemo(
    () => actions.filter((action) => action.incidentId === selectedIncident?.id),
    [actions, selectedIncident?.id],
  );

  const transitionInput = useMemo((): Record<string, unknown> | null => {
    if (!nextStatus) return null;
    if (nextStatus === 'triaged') {
      const parsed = new Date(awarenessAt);
      return Number.isNaN(parsed.getTime()) ? null : { awarenessAt: parsed.toISOString() };
    }
    if (nextStatus === 'contained' || nextStatus === 'closed') return {};
    if (nextStatus === 'assessed') {
      const count = Number(affectedCountEstimate);
      return Number.isInteger(count) && count >= 0 && dataCategories.length > 0
        ? {
          affectedCountEstimate: count,
          dataCategories,
          sensitiveOrUniqueId,
          externalIntrusion,
          decisionCode,
        }
        : null;
    }
    if (nextStatus === 'notice_drafted') {
      return contentSha256.trim().match(/^[0-9a-f]{64}$/)
        ? { noticeAudience, templateVersion: templateVersion.trim(), contentSha256: contentSha256.trim() }
        : null;
    }
    if (nextStatus === 'notice_approved') return noticeId ? { noticeId } : null;
    if (nextStatus === 'notified') {
      const receiptReference = externalReceiptRef.trim();
      return noticeId && /^[A-Za-z][A-Za-z0-9._:/-]{5,159}$/.test(receiptReference)
        ? { noticeId, externalReceiptRef: receiptReference }
        : null;
    }
    return null;
  }, [affectedCountEstimate, awarenessAt, contentSha256, dataCategories, decisionCode, externalIntrusion, nextStatus, noticeAudience, noticeId, sensitiveOrUniqueId, templateVersion, externalReceiptRef]);

  const toggleDataCategory = (category: string) => {
    setDataCategories((current) => current.includes(category)
      ? current.filter((value) => value !== category)
      : [...current, category]);
  };

  const createDetection = async () => {
    const parsedDetectedAt = new Date(detectedAt);
    if (Number.isNaN(parsedDetectedAt.getTime())) {
      setMessage('탐지 시각을 확인하세요.');
      return;
    }

    const incidentId = detectionAttempt?.incidentId ?? uuid();
    const correlationId = detectionAttempt?.correlationId ?? uuid();
    if (!incidentId || !correlationId) {
      setMessage('안전한 사고 식별자를 만들 수 없어 등록을 중단했습니다.');
      return;
    }

    const attempt = detectionAttempt ?? {
      incidentId,
      correlationId,
      severity: detectionSeverity,
      detectedAt: parsedDetectedAt.toISOString(),
    };
    if (!detectionAttempt) setDetectionReceipt(null);
    setDetectionAttempt(attempt);
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/privacy-incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          action: 'create',
          incidentId: attempt.incidentId,
          severity: attempt.severity,
          detectedAt: attempt.detectedAt,
          confirmationText: detectionConfirmationText,
          correlationId: attempt.correlationId,
        }),
      });
      const payload = await response.json();
      const readback = asRecord(payload.readback);
      if (
        !response.ok
        || !payload?.ok
        || typeof payload.operationId !== 'string'
        || typeof payload.incidentId !== 'string'
        || typeof payload.status !== 'string'
        || typeof payload.auditId !== 'string'
        || !readback
      ) {
        throw payload;
      }

      setDetectionReceipt({
        operationId: payload.operationId,
        incidentId: payload.incidentId,
        status: payload.status,
        replayed: payload.replayed === true,
        auditId: payload.auditId,
        readback: {
          passed: readback.passed === true,
          checks: readBooleanRecord(readback.checks),
        },
      });
      setDetectionAttempt(null);
      setDetectionConfirmationText('');
      setSelectedIncidentId(payload.incidentId);
      await load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const createPreview = async () => {
    if (!selectedIncident || !nextStatus || !transitionInput) {
      setMessage('현재 전환에 필요한 운영자 판단 입력을 모두 채우세요.');
      return;
    }
    const correlationId = uuid();
    const idempotencyId = uuid();
    if (!correlationId || !idempotencyId) {
      setMessage('안전한 작업 식별자를 만들 수 없어 적용을 중단했습니다.');
      return;
    }

    setLoading(true);
    setMessage(null);
    setReceipt(null);
    setPreview(null);
    try {
      const response = await fetch('/api/admin/privacy-incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          action: 'preview',
          incidentId: selectedIncident.id,
          toStatus: nextStatus,
          expectedUpdatedAt: selectedIncident.updatedAt,
          reasonCode: REASON_CODE[nextStatus],
          input: transitionInput,
          correlationId,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok || typeof payload.operationId !== 'string' || typeof payload.previewHash !== 'string' || typeof payload.expiresAt !== 'string' || typeof payload.requiredConfirmation !== 'string') {
        throw payload;
      }
      const summary = asRecord(payload.summary);
      const decisionPrompts = Array.isArray(summary?.decisionPrompts)
        ? summary.decisionPrompts.flatMap((value) => {
          const prompt = asRecord(value);
          return prompt && typeof prompt.code === 'string' && typeof prompt.messageKo === 'string'
            ? [{ code: prompt.code, messageKo: prompt.messageKo }]
            : [];
        })
        : [];
      setPreview({
        operationId: payload.operationId,
        previewHash: payload.previewHash,
        expiresAt: payload.expiresAt,
        requiredConfirmation: payload.requiredConfirmation,
        correlationId,
        toStatus: nextStatus,
        input: transitionInput,
        reasonCode: REASON_CODE[nextStatus],
        idempotencyKey: `incident-${idempotencyId}`,
        decisionPrompts,
      });
      setConfirmationText('');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const applyPreview = async () => {
    if (!selectedIncident || !preview) return;


    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/privacy-incidents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          action: 'apply',
          operationId: preview.operationId,
          incidentId: selectedIncident.id,
          toStatus: preview.toStatus,
          expectedUpdatedAt: selectedIncident.updatedAt,
          previewHash: preview.previewHash,
          confirmationText,
          reasonCode: preview.reasonCode,
          input: preview.input,
          correlationId: preview.correlationId,
          idempotencyKey: preview.idempotencyKey,
        }),
      });
      const payload = await response.json();
      const readback = asRecord(payload.readback);
      if (!response.ok || !payload?.ok || !readback || typeof payload.auditId !== 'string') throw payload;
      setReceipt({
        status: typeof payload.status === 'string' ? payload.status : 'failed',
        replayed: payload.replayed === true,
        auditId: payload.auditId,
        readback: {
          passed: readback.passed === true,
          checks: readBooleanRecord(readback.checks),
        },
      });
      setPreview(null);
      setConfirmationText('');
      await load();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8" data-privacy-incident-workflow="true">
      <header className="space-y-2">
        <p className="text-sm font-medium text-amber-700">개인정보 사고 담당 관리자 전용</p>
        <h1 className="text-2xl font-bold">개인정보 사고 대응</h1>
        <p className="max-w-4xl text-sm text-muted-foreground">
          이 화면은 사실관계와 운영자 결정을 기록하는 도구입니다. 신고 대상, 법적 적용, 외부 수리·승인은 사람이 결정합니다.
          외부 제출은 자동으로 수행되지 않습니다.
        </p>
      </header>

      {message ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{message}</p> : null}

      <section className="space-y-4 rounded-lg border p-4" aria-label="사고 탐지 등록" data-privacy-incident-detection-intake="true">
        <div>
          <h2 className="font-semibold">사고 탐지 등록</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            탐지 등록은 규제기관 신고·제출이 아니며, 인지 시각 또는 72시간 기준을 결정하지 않습니다. 그 판단은 이후 사람이 확인합니다.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">심각도</span>
            <select value={detectionSeverity} onChange={(event) => setDetectionSeverity(event.target.value as IncidentSeverity)} disabled={Boolean(detectionAttempt)} className="w-full rounded border p-2">
              <option value="low">낮음</option>
              <option value="medium">보통</option>
              <option value="high">높음</option>
              <option value="critical">긴급</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">탐지 시각</span>
            <input type="datetime-local" value={detectedAt} onChange={(event) => setDetectedAt(event.target.value)} disabled={Boolean(detectionAttempt)} className="w-full rounded border p-2" />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">등록하려면 정확히 “{DETECTION_CONFIRMATION}”을 입력합니다.</span>
          <input value={detectionConfirmationText} onChange={(event) => setDetectionConfirmationText(event.target.value)} maxLength={64} className="w-full rounded border p-2" />
        </label>
        <p className="text-xs text-muted-foreground">설명, 증거 원문, 위치, 자격 증명은 이 등록에서 입력하거나 저장하지 않습니다.</p>
        <button type="button" className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={loading || detectionConfirmationText !== DETECTION_CONFIRMATION} onClick={() => void createDetection()}>탐지 등록</button>
        {detectionAttempt ? <p className="text-xs text-muted-foreground">같은 사고 식별자로 동일 요청만 재시도합니다.</p> : null}
        {detectionReceipt ? (
          <div className="rounded border border-emerald-400 bg-emerald-50 p-3 text-sm" data-privacy-incident-detection-readback="true">
            <strong>탐지 등록 읽기검증 및 변경불가 감사 완료</strong>
            <p>상태: {detectionReceipt.status} · 재시도 응답: {detectionReceipt.replayed ? '예' : '아니오'} · 감사 ID: {detectionReceipt.auditId}</p>
            <p>읽기검증: {detectionReceipt.readback.passed ? '통과' : '실패'}</p>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border p-4" aria-label="사고 목록">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">사고 목록</h2>
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={() => void load()} disabled={loading}>새로고침</button>
        </div>
        {incidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">표시할 사고가 없습니다. 위 탐지 등록으로 첫 사고를 기록한 뒤 상태 전환을 진행하세요.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {incidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => { setSelectedIncidentId(incident.id); setPreview(null); setReceipt(null); }}
                className={`rounded border p-3 text-left ${selectedIncidentId === incident.id ? 'border-primary ring-1 ring-primary' : ''}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{STATUS_LABEL[incident.status]}</span>
                  <DeadlineBadge status={incident.deadlineStatus} minutes={incident.deadlineRemainingMinutes} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">심각도: {incident.severity}</p>
                <p className="mt-1 text-xs text-muted-foreground">인지 기준 72시간 운영 검토 시한: {formatTime(incident.deadlineAt)}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedIncident ? (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <div className="space-y-5 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">현재 상태: {STATUS_LABEL[selectedIncident.status]}</h2>
                <p className="text-sm text-muted-foreground">탐지: {formatTime(selectedIncident.detectedAt)} · 인지 확정: {formatTime(selectedIncident.awarenessAt)}</p>
              </div>
              <div className="space-y-1 text-right">
                <DeadlineBadge status={selectedIncident.deadlineStatus} minutes={selectedIncident.deadlineRemainingMinutes} />
                <p className="text-xs text-muted-foreground">72시간 운영 검토 시한: {formatTime(selectedIncident.deadlineAt)}</p>
              </div>
            </div>

            <DeadlineEscalationAlert incident={selectedIncident} />
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-privacy-incident-human-decision="true">
              <strong>운영자 결정 입력</strong>
              <p>영향 인원, 항목, 민감/고유식별 여부, 외부 침입 여부는 판단을 돕는 입력일 뿐 법적 결론을 자동으로 만들지 않습니다.</p>
            </div>

            {nextStatus === 'triaged' ? (
              <label className="block space-y-1">
                <span className="text-sm font-medium">인지 확정 시각 (사람이 확인)</span>
                <input type="datetime-local" value={awarenessAt} onChange={(event) => setAwarenessAt(event.target.value)} className="w-full rounded border p-2" />
                <span className="text-xs text-muted-foreground">마감은 이 시각 + 72시간으로만 계산됩니다. 탐지 시각은 사용하지 않습니다.</span>
              </label>
            ) : null}

            {nextStatus === 'assessed' ? (
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-sm font-medium">영향 인원 추정</span>
                  <input inputMode="numeric" min="0" type="number" value={affectedCountEstimate} onChange={(event) => setAffectedCountEstimate(event.target.value)} className="w-full rounded border p-2" />
                </label>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">데이터 항목 분류</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {DATA_CATEGORIES.map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={dataCategories.includes(value)} onChange={() => toggleDataCategory(value)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sensitiveOrUniqueId} onChange={(event) => setSensitiveOrUniqueId(event.target.checked)} />민감정보 또는 고유식별정보 관련으로 사람이 판단함</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={externalIntrusion} onChange={(event) => setExternalIntrusion(event.target.checked)} />외부 침입 관련으로 사람이 판단함</label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium">판단 기록 코드</span>
                  <select value={decisionCode} onChange={(event) => setDecisionCode(event.target.value)} className="w-full rounded border p-2">
                    <option value="human_assessment_recorded">사람 평가 기록</option>
                    <option value="human_review_pending">사람 검토 대기</option>
                    <option value="human_escalation_requested">사람 에스컬레이션 요청</option>
                  </select>
                </label>
              </div>
            ) : null}

            {nextStatus === 'notice_drafted' ? (
              <div className="space-y-3" data-privacy-incident-notice-draft="true">
                <p className="text-sm text-muted-foreground">통지 초안은 외부 제출이 아닙니다. 내용 원문 대신 승인된 템플릿 버전과 내용 SHA-256만 기록합니다.</p>
                <label className="block space-y-1"><span className="text-sm font-medium">수신자 분류</span><select value={noticeAudience} onChange={(event) => setNoticeAudience(event.target.value as Notice['audience'])} className="w-full rounded border p-2"><option value="data_subjects">정보주체</option><option value="pipc">PIPC</option><option value="kisa">KISA</option></select></label>
                <label className="block space-y-1"><span className="text-sm font-medium">템플릿 버전</span><input value={templateVersion} maxLength={64} onChange={(event) => setTemplateVersion(event.target.value)} className="w-full rounded border p-2" /></label>
                <label className="block space-y-1"><span className="text-sm font-medium">내용 SHA-256</span><input value={contentSha256} maxLength={64} onChange={(event) => setContentSha256(event.target.value.toLowerCase())} className="w-full rounded border p-2 font-mono" /></label>
              </div>
            ) : null}

            {nextStatus === 'notice_approved' ? (
              <label className="block space-y-1"><span className="text-sm font-medium">승인할 통지 초안</span><select value={noticeId} onChange={(event) => setNoticeId(event.target.value)} className="w-full rounded border p-2"><option value="">선택</option>{selectedNotices.filter((notice) => notice.status === 'draft').map((notice) => <option key={notice.id} value={notice.id}>{notice.audience} · {notice.templateVersion}</option>)}</select></label>
            ) : null}

            {nextStatus === 'notified' ? (
              <div className="space-y-3" data-privacy-incident-external-receipt="true">
                <p className="text-sm text-muted-foreground">외부 제출은 이 화면에서 자동 실행되지 않습니다. 권한 있는 사람이 별도로 제출한 뒤 접수 참조만 기록합니다. 이 참조는 규제기관의 수리·승인 의미가 아닙니다.</p>
                <label className="block space-y-1"><span className="text-sm font-medium">제출할 승인 통지</span><select value={noticeId} onChange={(event) => setNoticeId(event.target.value)} className="w-full rounded border p-2"><option value="">선택</option>{selectedNotices.filter((notice) => notice.status === 'approved').map((notice) => <option key={notice.id} value={notice.id}>{notice.audience} · 승인 담당자 기록됨</option>)}</select></label>
                <label className="block space-y-1"><span className="text-sm font-medium">외부 접수 참조</span><input value={externalReceiptRef} maxLength={160} placeholder="PIPC-REFERENCE-123" onChange={(event) => setExternalReceiptRef(event.target.value)} className="w-full rounded border p-2" /><span className="text-xs text-muted-foreground">영문 접두사가 있는 참조만 기록합니다. 원문·증거·개인정보를 입력하지 마세요.</span></label>
              </div>
            ) : null}

            {nextStatus === 'closed' ? <p className="text-sm text-muted-foreground">종결 전 독립 읽기검증으로 평가 입력과 통지 기록을 다시 확인합니다. 하나라도 없으면 실패 폐쇄합니다.</p> : null}

            {nextStatus ? (
              <div className="space-y-3 border-t pt-4" data-privacy-incident-preview-confirm-apply="true">
                <p className="text-sm">다음 상태: <strong>{STATUS_LABEL[nextStatus]}</strong></p>
                <button type="button" className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={loading || !transitionInput} onClick={() => void createPreview()}>1. 미리보기 생성</button>
                {preview ? (
                  <div className="space-y-3 rounded border bg-muted/30 p-3" data-privacy-incident-confirmation="true">
                    <p className="text-sm">미리보기 만료: {formatTime(preview.expiresAt)}. 상태·버전·담당자·입력 해시에 묶여 있습니다.</p>
                    <p className="text-sm">선택된 사유: {REASON_LABEL[preview.toStatus]}</p>
                    {preview.decisionPrompts.length > 0 ? (
                      <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm" data-privacy-incident-decision-prompts="true">
                        <strong>사람 검토 알림</strong>
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {preview.decisionPrompts.map((prompt) => <li key={prompt.code}>{prompt.messageKo}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    <label className="block space-y-1"><span className="text-sm font-medium">적용하려면 정확히 “{preview.requiredConfirmation}”을 입력합니다.</span><input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} className="w-full rounded border p-2" /></label>
                    <button type="button" className="rounded bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-50" disabled={loading || confirmationText !== preview.requiredConfirmation} onClick={() => void applyPreview()}>2. 확인 후 적용</button>
                  </div>
                ) : null}
              </div>
            ) : <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">종결된 사고입니다. 새로운 전환은 허용되지 않습니다.</p>}

            {receipt ? (
              <div className="rounded border border-emerald-400 bg-emerald-50 p-3 text-sm" data-privacy-incident-readback="true">
                <strong>3. 독립 읽기검증 및 변경불가 감사 완료</strong>
                <p>상태: {receipt.status} · 재시도 응답: {receipt.replayed ? '예' : '아니오'} · 감사 ID: {receipt.auditId}</p>
                <p>읽기검증: {receipt.readback.passed ? '통과' : '실패'}</p>
              </div>
            ) : null}
          </div>

          <aside className="space-y-4 rounded-lg border p-4">
            <div>
              <h2 className="font-semibold">통지 상태</h2>
              <div className="mt-2 space-y-2">
                {selectedNotices.length === 0 ? <p className="text-sm text-muted-foreground">기록된 통지 없음</p> : selectedNotices.map((notice) => (
                  <div key={notice.id} className="rounded border p-2 text-xs">
                    <p><strong>{notice.audience}</strong> · {notice.status}</p>
                    <p>승인 담당자: {notice.approvedBy ? '기록됨' : '미기록'}</p>
                    <p>제출 담당자: {notice.submittedBy ? '기록됨' : '미기록'}</p>
                    <p>외부 접수 참조: {notice.externalReceiptRef ? '기록됨 (수리·승인 아님)' : '미기록'}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 className="font-semibold">변경 이력</h2>
              <div className="mt-2 space-y-2">
                {selectedActions.length === 0 ? <p className="text-sm text-muted-foreground">적용된 변경 이력 없음</p> : selectedActions.map((action) => (
                  <div key={action.id} className="rounded border p-2 text-xs">
                    <p>{STATUS_LABEL[action.fromStatus]} → {STATUS_LABEL[action.toStatus]}</p>
                    <p>담당자 식별자 기록 · 읽기검증 {action.readbackStatus === 'passed' ? '통과' : '실패'}</p>
                    <p>감사: {action.auditId}</p>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </section>
      ) : null}
    </main>
  );
}
