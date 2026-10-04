export type SentryIssueStatus = 'unresolved' | 'resolved' | 'ignored';
export type AdminSentryIssue = {
  id: string;
  shortId: string;
  type: string;
  status: SentryIssueStatus;
  level: 'fatal' | 'error' | 'warning' | 'info';
  count: number;
  lastSeen: string | null;
  href: string;
};
export type AdminSentryResponse = {
  state: 'connected' | 'not_configured' | 'unavailable';
  collection: { browser: boolean; server: boolean };
  dashboardUrl: string | null;
  issues: AdminSentryIssue[];
  nextCursor: string | null;
  fetchedAt: string | null;
};

export function isAdminSentryResponse(value: unknown): value is AdminSentryResponse {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AdminSentryResponse>;
  return ['connected', 'not_configured', 'unavailable'].includes(String(row.state))
    && typeof row.collection?.browser === 'boolean' && typeof row.collection?.server === 'boolean'
    && Array.isArray(row.issues) && row.issues.length <= 50
    && (row.nextCursor === null || (typeof row.nextCursor === 'string' && /^\d{1,20}:\d{1,10}:[01]$/.test(row.nextCursor)))
    && (row.dashboardUrl === null || typeof row.dashboardUrl === 'string')
    && (row.fetchedAt === null || typeof row.fetchedAt === 'string')
    && row.issues.every((issue) => issue && typeof issue.id === 'string'
      && typeof issue.shortId === 'string' && typeof issue.type === 'string'
      && typeof issue.href === 'string' && Number.isSafeInteger(issue.count) && issue.count >= 0
      && ['unresolved', 'resolved', 'ignored'].includes(issue.status)
      && ['fatal', 'error', 'warning', 'info'].includes(issue.level)
      && (issue.lastSeen === null || (typeof issue.lastSeen === 'string' && Number.isFinite(Date.parse(issue.lastSeen)))));
}
