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

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {children}
      {/* 그룹 1: 전체, 미처리, 승인됨, 삭제 (통계만 표시) */}
      {statCategoriesGroup1.map((category, index) => (
        <div
          key={`g1-${index}`}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/50 text-sm"
        >
          <span className="font-medium text-muted-foreground">
            {category.label}
          </span>
          <span className="font-semibold">
            {category.count}
          </span>
        </div>
      ))}

      {/* 구분선 */}
      <div className="h-6 w-px bg-border" />

      {/* 그룹 2: 통계만 표시 (승인대기, missing, 지오코딩 실패, 평가미대상) */}
      {statCategoriesGroup2.map((category, index) => (
        <div
          key={`g2-${index}`}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-muted/50 text-sm"
        >
          <span className="font-medium text-muted-foreground">
            {category.label}
          </span>
          <span className="font-semibold">
            {category.count}
          </span>
        </div>
      ))}
    </div>
  );
}
