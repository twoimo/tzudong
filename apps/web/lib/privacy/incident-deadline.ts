const INCIDENT_STATUSES = new Set([
  'detected',
  'triaged',
  'contained',
  'assessed',
  'notice_drafted',
  'notice_approved',
  'notified',
  'closed',
]);
const COMPLETED_INCIDENT_STATUSES = new Set(['notified', 'closed']);
const DEADLINE_WINDOW_MS = 72 * 60 * 60 * 1000;
const DUE_SOON_WINDOW_MS = 12 * 60 * 60 * 1000;

export type IncidentDeadlineStatus = 'not_started' | 'active' | 'due_soon' | 'overdue' | 'completed';

export type IncidentDeadlineReadback = {
  deadlineStatus: IncidentDeadlineStatus;
  deadlineRemainingMinutes: number | null;
};

function readTimestampMilliseconds(value: string | null) {
  if (typeof value !== 'string' || value.length > 64) return null;

  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

export function getIncidentDeadlineReadback(
  statusValue: string | null,
  awarenessAt: string | null,
  deadlineAt: string | null,
  serverNow: Date,
): IncidentDeadlineReadback {
  const status = typeof statusValue === 'string' && INCIDENT_STATUSES.has(statusValue)
    ? statusValue
    : null;
  const awarenessMilliseconds = readTimestampMilliseconds(awarenessAt);
  const deadlineMilliseconds = readTimestampMilliseconds(deadlineAt);
  const serverNowMilliseconds = serverNow.getTime();

  if (
    !status
    || status === 'detected'
    || awarenessMilliseconds === null
    || deadlineMilliseconds === null
    || !Number.isSafeInteger(serverNowMilliseconds)
    || deadlineMilliseconds !== awarenessMilliseconds + DEADLINE_WINDOW_MS
  ) {
    return { deadlineStatus: 'not_started', deadlineRemainingMinutes: null };
  }

  const deadlineRemainingMinutes = Math.floor((deadlineMilliseconds - serverNowMilliseconds) / 60_000);
  if (COMPLETED_INCIDENT_STATUSES.has(status)) {
    return { deadlineStatus: 'completed', deadlineRemainingMinutes };
  }
  if (deadlineMilliseconds <= serverNowMilliseconds) {
    return { deadlineStatus: 'overdue', deadlineRemainingMinutes };
  }
  if (deadlineMilliseconds - serverNowMilliseconds <= DUE_SOON_WINDOW_MS) {
    return { deadlineStatus: 'due_soon', deadlineRemainingMinutes };
  }
  return { deadlineStatus: 'active', deadlineRemainingMinutes };
}
