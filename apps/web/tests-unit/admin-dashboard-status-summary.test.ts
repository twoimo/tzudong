import { describe, expect, test } from 'bun:test';
import { getAdminDashboardStatusItems, type AdminDashboardStatusSummaryInput } from '../lib/admin/dashboard-status-summary';

function input(): AdminDashboardStatusSummaryInput {
  return {
    pendingTotal: 0, totalRestaurants: 1200, totalVideos: 42, isLoading: false,
    collection: { isLoading: false, hasError: false, workflowAvailable: true, latestRunLabel: '완료', snapshotLabel: '저장 확인' },
    sentry: { isLoading: false, hasError: false, data: { state: 'connected', collection: { browser: true, server: true },
      dashboardUrl: null, issues: [], nextCursor: null, fetchedAt: null } },
  };
}

describe('dashboard status summary read semantics', () => {
  test('keeps known zero and known totals while another read is loading', () => {
    const value = input(); value.isLoading = true; value.totalVideos = null;
    expect(getAdminDashboardStatusItems(value).slice(0, 3).map((item) => item.value)).toEqual(['0건', '1,200곳', '조회 중']);
  });

  test('unknown or invalid totals never appear as zero or a numeric count', () => {
    for (const count of [null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      const value = input(); value.pendingTotal = count;
      const item = getAdminDashboardStatusItems(value)[0];
      expect(item.value).toBe('미확인'); expect(item.needsAttention).toBe(true);
    }
  });

  test('failed collection reads suppress stale workflow and storage claims', () => {
    const value = input(); value.collection.hasError = true;
    const item = getAdminDashboardStatusItems(value)[3];
    expect(item.value).toBe('조회 실패'); expect(item.detail).not.toContain('저장 확인');
    value.collection.hasError = false; value.collection.latestRunLabel = null;
    expect(getAdminDashboardStatusItems(value)[3].value).toBe('내역 없음');
    value.collection.workflowAvailable = false;
    expect(getAdminDashboardStatusItems(value)[3].value).toBe('미확인');
    value.collection.isLoading = true;
    expect(getAdminDashboardStatusItems(value)[3].value).toBe('조회 중');
  });

  test('counts returned Sentry issues rather than occurrences, and discloses another page', () => {
    const value = input(); const data = value.sentry.data!;
    data.issues = [2, 900].map((count, index) => ({ id: String(index), shortId: String(index), type: 'Error',
      status: 'unresolved', level: 'error', count, lastSeen: null, href: '' }));
    expect(getAdminDashboardStatusItems(value)[4].value).toBe('미해결 2개');
    data.nextCursor = '1:1:0';
    const item = getAdminDashboardStatusItems(value)[4];
    expect(item.value).toBe('미해결 2+개'); expect(item.detail).toContain('다음 페이지');
    value.sentry.hasError = true;
    expect(getAdminDashboardStatusItems(value)[4].value).toBe('조회 실패');
  });

  test('distinguishes unconfigured, unavailable, initial loading and an empty successful read', () => {
    const value = input();
    expect(getAdminDashboardStatusItems(value)[4].value).toBe('미해결 0개');
    value.sentry.data!.state = 'not_configured';
    expect(getAdminDashboardStatusItems(value)[4].value).toBe('미연결');
    value.sentry.data!.state = 'unavailable';
    expect(getAdminDashboardStatusItems(value)[4].value).toBe('미확인');
    value.sentry.data = undefined; value.sentry.isLoading = true;
    expect(getAdminDashboardStatusItems(value)[4].value).toBe('조회 중');
  });
});
