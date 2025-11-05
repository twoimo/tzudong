import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      label: 'Missing', 
      status: ['missing'] as EvaluationRecordStatus[], 
      count: stats.missing,
    },
    {
      label: 'DB충돌',
      status: ['db_conflict'] as EvaluationRecordStatus[],
      count: stats.db_conflict,
    },
    {
      label: '지오코딩실패',
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
    <div className="flex flex-wrap gap-2">
      {categories.map((category, index) => (
        <Button
          key={index}
          variant={isSelected(category.status) ? 'default' : 'outline'}
          onClick={() => handleClick(category.status)}
          className="h-auto py-2 px-4"
        >
          <span className="font-medium">{category.label}</span>
          <Badge 
            variant={isSelected(category.status) ? 'secondary' : 'outline'}
            className="ml-2"
          >
            {category.count}
          </Badge>
        </Button>
      ))}
    </div>
  );
}
