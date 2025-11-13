import { CategoryStats, EvaluationRecordStatus } from '@/types/evaluation';
import { Button } from '@/components/ui/button';

interface CategorySidebarProps {
  stats: CategoryStats;
  selectedStatuses: EvaluationRecordStatus[];
  onSelectStatuses: (statuses: EvaluationRecordStatus[]) => void;
}

export function CategorySidebar({
  stats,
  selectedStatuses,
  onSelectStatuses,
}: CategorySidebarProps) {
  // 통계 표시만 (클릭 불가)
  const statCategories = [
    { label: '미처리', count: stats.pending },
    { label: '승인됨', count: stats.approved },
    { label: '승인 대기', count: stats.ready_for_approval },
    { label: 'Missing', count: stats.missing },
    { label: '지오코딩 실패', count: stats.geocoding_failed },
    { label: '평가 미대상', count: stats.not_selected },
  ];

  const isAllActive = selectedStatuses.length === 0;
  const isDeletedActive = selectedStatuses.includes('deleted' as EvaluationRecordStatus);

  const handleAllClick = () => {
    onSelectStatuses([]); // 전체 = 빈 배열
  };

  const handleDeletedClick = () => {
    if (isDeletedActive) {
      onSelectStatuses([]); // 비활성화 -> 전체로
    } else {
      onSelectStatuses(['deleted' as EvaluationRecordStatus]); // 활성화
    }
  };

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* 전체 탭 - 클릭 가능 */}
      <Button
        variant={isAllActive ? 'default' : 'outline'}
        size="sm"
        onClick={handleAllClick}
        className="gap-2"
      >
        <span className="text-sm font-medium">
          전체
        </span>
        <span className="text-sm font-semibold">
          {stats.total}
        </span>
      </Button>

      {/* 통계 표시만 (클릭 불가) */}
      {statCategories.map((category, index) => (
        <div
          key={index}
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

      {/* 삭제 탭 - 클릭 가능 */}
      <Button
        variant={isDeletedActive ? 'default' : 'outline'}
        size="sm"
        onClick={handleDeletedClick}
        className="gap-2"
      >
        <span className="text-sm font-medium">
          삭제
        </span>
        <span className="text-sm font-semibold">
          {stats.deleted || 0}
        </span>
      </Button>
    </div>
  );
}
