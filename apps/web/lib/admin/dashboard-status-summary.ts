import type { AdminSentryResponse } from '@/types/admin-sentry';

export type AdminDashboardStatusSummaryInput = {
  pendingTotal: number | null;
  totalRestaurants: number | null;
  totalVideos: number | null;
  isLoading: boolean;
  collection: {
    isLoading: boolean;
    hasError: boolean;
    workflowAvailable: boolean;
    latestRunLabel: string | null;
    snapshotLabel: string | null;
  };
  sentry: {
    isLoading: boolean;
    hasError: boolean;
    data?: AdminSentryResponse;
  };
};

export type AdminDashboardStatusItem = {
  id: 'pending' | 'restaurants' | 'videos' | 'collection' | 'sentry';
  label: string;
  value: string;
  detail?: string;
  needsAttention: boolean;
};

const countFormatter = new Intl.NumberFormat('ko-KR');

function countItem(
  id: 'pending' | 'restaurants' | 'videos',
  label: string,
  count: number | null,
  unit: string,
  loading: boolean,
): AdminDashboardStatusItem {
  const known = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  return {
    id,
    label,
    value: known ? `${countFormatter.format(count)}${unit}` : loading ? '조회 중' : '미확인',
    needsAttention: !known && !loading,
  };
}

/** Header values describe the latest reads; missing data is never a known zero. */
export function getAdminDashboardStatusItems(input: AdminDashboardStatusSummaryInput): AdminDashboardStatusItem[] {
  const { collection, sentry } = input;
  const collectionItem: AdminDashboardStatusItem = {
    id: 'collection',
    label: 'KPI 수집',
    value: collection.hasError ? '조회 실패'
      : collection.latestRunLabel ?? (collection.workflowAvailable ? '내역 없음' : collection.isLoading ? '조회 중' : '미확인'),
    detail: collection.hasError ? '수집 기록을 다시 확인해 주세요' : collection.snapshotLabel ?? '저장 상태 미확인',
    needsAttention: collection.hasError || (!collection.latestRunLabel && !collection.workflowAvailable && !collection.isLoading),
  };

  const connected = !sentry.hasError && sentry.data?.state === 'connected';
  const sentryItem: AdminDashboardStatusItem = {
    id: 'sentry',
    label: 'Sentry',
    value: sentry.hasError ? '조회 실패'
      : connected ? `미해결 ${countFormatter.format(sentry.data!.issues.length)}${sentry.data!.nextCursor ? '+' : ''}개`
        : sentry.data?.state === 'not_configured' ? '미연결'
          : sentry.isLoading ? '조회 중' : '미확인',
    detail: connected
      ? sentry.data!.nextCursor
        ? '현재 조회된 미해결 이슈 수입니다. 다음 페이지에 이슈가 더 있습니다'
        : '현재 조회된 미해결 이슈 수입니다. 반복 발생 횟수와 구분합니다'
      : sentry.data?.state === 'not_configured' && !sentry.hasError
        ? 'Sentry 연결이 설정되지 않았습니다' : '미해결 이슈 조회 상태를 확인해 주세요',
    needsAttention: sentry.hasError || (!connected && !sentry.isLoading),
  };

  return [
    countItem('pending', '대기', input.pendingTotal, '건', input.isLoading),
    countItem('restaurants', '맛집', input.totalRestaurants, '곳', input.isLoading),
    countItem('videos', '영상', input.totalVideos, '개', input.isLoading),
    collectionItem,
    sentryItem,
  ];
}
