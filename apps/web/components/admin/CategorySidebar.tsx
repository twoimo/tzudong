import { CategoryStats, EvaluationRecordStatus } from '@/types/evaluation';

interface CategorySidebarProps {
  stats: CategoryStats;
  selectedStatuses: EvaluationRecordStatus[];
  onSelectStatuses: (statuses: EvaluationRecordStatus[]) => void;
  children?: React.ReactNode;
}

export function CategorySidebar({
  stats,
  children,
}: CategorySidebarProps) {
  // 그룹 1: 전체, 미처리, 승인됨, 삭제 (통계만 표시)
  const statCategoriesGroup1 = [
    { label: '전체', count: stats.total },
    { label: '미처리', count: stats.pending },
    { label: '승인됨', count: stats.approved },
    { label: '삭제됨', count: stats.deleted || 0 },
  ];

  // 그룹 2: 승인대기, missing, 지오코딩 실패, 평가미대상 (통계만 표시)
  const statCategoriesGroup2 = [
    { label: '승인 대기', count: stats.ready_for_approval },
    { label: 'Missing', count: stats.missing },
    { label: '평가 미대상', count: stats.not_selected },
    { label: '지오코딩 실패', count: stats.geocoding_failed },
  ];
  const statCategoriesDesktop = [...statCategoriesGroup1, ...statCategoriesGroup2];

  const renderStatChip = (label: string, count: number | undefined, key: string) => (
    <div
      key={key}
      className="inline-flex shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-sm"
    >
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="font-semibold">{count ?? 0}</span>
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-3 xl:ml-auto xl:w-auto xl:flex-row xl:items-center xl:justify-end xl:gap-2">
      {children && (
        <div className="w-full overflow-x-auto pb-1 pt-1 xl:w-auto xl:flex-none xl:overflow-visible xl:pb-0 xl:pt-0">
          <div className="flex min-w-max items-center gap-2 xl:min-w-0 xl:gap-1">{children}</div>
        </div>
      )}

      <div className="hidden xl:flex xl:w-auto xl:items-center xl:justify-end xl:gap-2 xl:overflow-x-auto xl:pb-1">
        {statCategoriesDesktop.map((category, index) =>
          renderStatChip(category.label, category.count, `desktop-${index}`)
        )}
      </div>

      <div className="xl:hidden">
        <details className="rounded-md border border-border bg-muted/20 p-2">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
            <span>통계 펼치기</span>
            <span>총 {stats.total}</span>
          </summary>

          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {statCategoriesGroup1.map((category, index) =>
                renderStatChip(category.label, category.count, `g1-${index}`)
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {statCategoriesGroup2.map((category, index) =>
                renderStatChip(category.label, category.count, `g2-${index}`)
              )}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
