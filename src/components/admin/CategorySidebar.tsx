import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CategoryStats, EvaluationRecordStatus } from '@/types/evaluation';
import { cn } from '@/lib/utils';

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
  const categories = [
    { label: '전체', status: [] as EvaluationRecordStatus[], count: stats.total },
    { label: '미처리', status: ['pending'] as EvaluationRecordStatus[], count: stats.pending },
    { label: '승인됨', status: ['approved'] as EvaluationRecordStatus[], count: stats.approved },
    { label: '보류', status: ['hold'] as EvaluationRecordStatus[], count: stats.hold },
    { 
      label: 'Missing 음식점', 
      status: ['missing'] as EvaluationRecordStatus[], 
      count: stats.missing,
      badge: stats.missing > 0 
    },
    {
      label: 'DB 등록 오류',
      status: ['db_conflict'] as EvaluationRecordStatus[],
      count: stats.db_conflict,
      badge: stats.db_conflict > 0,
      badgeVariant: 'destructive' as const,
    },
    {
      label: '지오코딩 실패',
      status: ['geocoding_failed'] as EvaluationRecordStatus[],
      count: stats.geocoding_failed,
    },
  ];

  const handleClick = (status: EvaluationRecordStatus[]) => {
    onSelectStatuses(status);
  };

  const isSelected = (status: EvaluationRecordStatus[]) => {
    if (status.length === 0 && selectedStatuses.length === 0) return true;
    if (status.length === 0 && selectedStatuses.length > 0) return false;
    return selectedStatuses.length === status.length && 
           selectedStatuses.every(s => status.includes(s));
  };

  return (
    <Card className="w-64 p-4 h-fit sticky top-6">
      <h2 className="font-bold text-lg mb-4">카테고리</h2>
      
      <div className="space-y-2">
        {categories.map((category, index) => (
          <button
            key={index}
            onClick={() => handleClick(category.status)}
            className={cn(
              'w-full flex items-center justify-between p-3 rounded-lg transition-colors',
              'hover:bg-accent',
              isSelected(category.status) && 'bg-accent font-medium'
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  isSelected(category.status) ? 'bg-primary' : 'bg-muted-foreground'
                )}
              />
              <span>{category.label}</span>
              {category.badge && (
                <Badge 
                  variant={category.badgeVariant || 'default'}
                  className="ml-1"
                >
                  {category.count}
                </Badge>
              )}
            </div>
            <span className="text-sm text-muted-foreground">
              {category.count}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
