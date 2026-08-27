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

  // 그룹 2: 승인대기, missing, 평가미대상 (통계만 표시)
  const statCategoriesGroup2 = [
    { label: '승인 대기', count: stats.ready_for_approval },
    { label: '미확정 좌표', count: stats.unconfirmed_map },
    { label: 'Missing', count: stats.missing },
    { label: '평가 미대상', count: stats.not_selected },
  ];
  const statCategoriesDesktop = [...statCategoriesGroup1, ...statCategoriesGroup2];

  const renderStatChip = (label: string, count: number | undefined, key: string) => (
    <div
      key={key}
      className="inline-flex shrink-0 items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-0.5 text-xs whitespace-nowrap sm:px-3 sm:py-1 sm:text-sm"
    >
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="font-semibold">{count ?? 0}</span>
    </div>
  );

  return (
    <div className="flex w-full items-center justify-end gap-1.5 lg:ml-auto lg:w-auto lg:gap-2">
      {children && (
        <div className="flex w-full justify-end overflow-x-auto py-0.5 scrollbar-hide [scrollbar-width:none] lg:w-auto lg:flex-none lg:overflow-visible lg:py-0 [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max items-center justify-end gap-2 lg:min-w-0 lg:gap-1">{children}</div>
        </div>
      )}

      <div className="hidden lg:flex lg:w-auto lg:items-center lg:justify-end lg:gap-2 lg:overflow-x-auto lg:pb-0">
        {statCategoriesDesktop.map((category, index) =>
          renderStatChip(category.label, category.count, `desktop-${index}`)
        )}
      </div>

    </div>
  );
}
