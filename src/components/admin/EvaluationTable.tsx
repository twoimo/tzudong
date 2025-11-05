import { useState } from 'react';
import { EvaluationRecord } from '@/types/evaluation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Check, Pause, Trash2, AlertCircle, Edit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EvaluationRowDetails } from './EvaluationRowDetails';

interface EvaluationTableProps {
  records: EvaluationRecord[];
  onApprove: (record: EvaluationRecord) => void;
  onHold: (record: EvaluationRecord) => void;
  onDelete: (record: EvaluationRecord) => void;
  onRegisterMissing?: (record: EvaluationRecord) => void;
  onResolveConflict?: (record: EvaluationRecord) => void;
  onEdit?: (record: EvaluationRecord) => void;
  loading?: boolean;
}

export function EvaluationTable({
  records,
  onApprove,
  onHold,
  onDelete,
  onRegisterMissing,
  onResolveConflict,
  onEdit,
  loading,
}: EvaluationTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: any }> = {
      pending: { label: '미처리', variant: 'secondary' },
      approved: { label: '승인됨', variant: 'default' },
      hold: { label: '보류', variant: 'outline' },
      missing: { label: 'Missing', variant: 'destructive' },
      db_conflict: { label: 'DB 충돌', variant: 'destructive' },
      geocoding_failed: { label: '지오코딩 실패', variant: 'destructive' },
    };

    const config = variants[status] || { label: status, variant: 'default' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getEvaluationSummary = (record: EvaluationRecord) => {
    if (!record.evaluation_results) return '-/-/-';
    
    const va = record.evaluation_results.visit_authenticity?.eval_value ?? '-';
    const rb = record.evaluation_results.rb_grounding_TF?.eval_value ? 'T' : 'F';
    const lm = record.evaluation_results.location_match_TF?.eval_value ? 'T' : 'F';
    
    return `${va}/${rb}/${lm}`;
  };

  const canApprove = (record: EvaluationRecord) => {
    return record.geocoding_success && 
           record.status !== 'missing' && 
           record.status !== 'approved';
  };

  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        표시할 데이터가 없습니다
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12"></TableHead>
            <TableHead className="w-[300px]">영상 제목</TableHead>
            <TableHead>음식점명</TableHead>
            <TableHead>주소</TableHead>
            <TableHead>카테고리</TableHead>
            <TableHead className="text-center">평가</TableHead>
            <TableHead className="text-center">상태</TableHead>
            <TableHead className="text-center w-[200px]">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <>
              {/* 메인 행 */}
              <TableRow key={record.id} className="hover:bg-muted/50">
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpand(record.id)}
                  >
                    {expandedId === record.id ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </Button>
                </TableCell>
                
                <TableCell className="max-w-[300px]">
                  <div className="truncate text-sm">
                    {record.youtube_meta?.title || record.youtube_link}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {new Date(record.youtube_meta?.publishedAt || record.created_at).toLocaleDateString('ko-KR')}
                  </div>
                </TableCell>
                
                <TableCell className="font-medium">
                  {record.restaurant_name}
                </TableCell>
                
                <TableCell className="max-w-[200px]">
                  <div className="truncate text-sm">
                    {record.restaurant_info?.naver_address_info?.jibun_address ||
                     record.restaurant_info?.origin_address ||
                     '-'}
                  </div>
                </TableCell>
                
                <TableCell>
                  {record.restaurant_info?.category || '-'}
                </TableCell>
                
                <TableCell className="text-center text-sm">
                  {getEvaluationSummary(record)}
                </TableCell>
                
                <TableCell className="text-center">
                  {getStatusBadge(record.status)}
                </TableCell>
                
                <TableCell>
                  <div className="flex gap-2 justify-center">
                    {record.status === 'missing' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => onRegisterMissing?.(record)}
                          disabled={loading}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          수동 등록
                        </Button>
                        
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDelete(record)}
                          disabled={loading}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    ) : record.status === 'db_conflict' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => onResolveConflict?.(record)}
                          disabled={loading}
                          className="bg-yellow-600 hover:bg-yellow-700"
                        >
                          충돌 해결
                        </Button>
                        
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDelete(record)}
                          disabled={loading}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    ) : record.status === 'hold' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => onEdit?.(record)}
                          disabled={loading}
                          variant="outline"
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          편집
                        </Button>
                        
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDelete(record)}
                          disabled={loading}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => onApprove(record)}
                          disabled={!canApprove(record) || loading}
                          className={cn(!canApprove(record) && 'opacity-50')}
                        >
                          <Check className="w-4 h-4 mr-1" />
                          승인
                        </Button>
                        
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onHold(record)}
                          disabled={loading}
                        >
                          <Pause className="w-4 h-4 mr-1" />
                          보류
                        </Button>
                        
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDelete(record)}
                          disabled={loading}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  
                  {!record.geocoding_success && record.status !== 'missing' && (
                    <div className="text-xs text-destructive mt-1 text-center flex items-center justify-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      지오코딩 실패
                    </div>
                  )}
                </TableCell>
              </TableRow>

              {/* 확장된 상세 정보 */}
              {expandedId === record.id && (
                <TableRow>
                  <TableCell colSpan={8} className="bg-muted/30">
                    <EvaluationRowDetails record={record} />
                  </TableCell>
                </TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
