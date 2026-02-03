import { useEffect } from 'react';
import { EvaluationRecord } from '@/types/evaluation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    Undo2,
    Trash2,
    AlertCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { EvaluationDetailView } from './EvaluationDetailView';

interface EvaluationSlideViewProps {
    records: EvaluationRecord[];
    currentIndex: number;
    onNavigate: (index: number) => void;
    onApprove: (record: EvaluationRecord) => void;
    onDelete: (record: EvaluationRecord) => void;
    onRestore?: (record: EvaluationRecord) => void;
    onRegisterMissing?: (record: EvaluationRecord) => void;
    onResolveConflict?: (record: EvaluationRecord) => void;
    onEdit?: (record: EvaluationRecord) => void;
    loading?: boolean;
}

export function EvaluationSlideView({
    records,
    currentIndex,
    onNavigate,
    onApprove,
    onDelete,
    onRestore,
    onRegisterMissing,
    onResolveConflict,
    onEdit,
    loading
}: EvaluationSlideViewProps) {
    const currentRecord = records[currentIndex];
    const { toast } = useToast();

    // 키보드 네비게이션
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
            if (e.key === 'ArrowLeft') {
                if (currentIndex > 0) onNavigate(currentIndex - 1);
            } else if (e.key === 'ArrowRight') {
                if (currentIndex < records.length - 1) onNavigate(currentIndex + 1);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentIndex, records.length, onNavigate]);

    if (!currentRecord) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                <AlertCircle className="w-12 h-12 mb-4" />
                <p className="text-lg">표시할 데이터가 없습니다.</p>
            </div>
        );
    }

    const getStatusBadge = (status: string) => {
        const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
            pending: { label: '미처리', variant: 'secondary' },
            approved: { label: '승인됨', variant: 'default' },
            hold: { label: '보류', variant: 'outline' },
            missing: { label: 'Missing', variant: 'destructive' },
            geocoding_failed: { label: '지오코딩 실패', variant: 'destructive' },
            not_selected: { label: '평가 미대상', variant: 'outline' },
            deleted: { label: '삭제됨', variant: 'destructive' },
        };
        const config = variants[status] || { label: status, variant: 'default' };
        return <Badge variant={config.variant} className="text-xs px-2 py-0.5">{config.label}</Badge>;
    };

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* Top Navigation Bar - Compact */}
            <div className="flex items-center justify-between px-3 py-2 border-b shrink-0 h-14">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex items-center space-x-1 shrink-0">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onNavigate(currentIndex - 1)} disabled={currentIndex <= 0}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs font-medium w-[60px] text-center">
                            {currentIndex + 1} / {records.length}
                        </span>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onNavigate(currentIndex + 1)} disabled={currentIndex >= records.length - 1}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                    {getStatusBadge(currentRecord.status)}
                    <h2 className="text-sm font-semibold truncate max-w-[400px]">
                        {currentRecord.restaurant_name || currentRecord.name}
                    </h2>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {currentRecord.status === 'deleted' ? (
                        <Button onClick={() => onRestore?.(currentRecord)} disabled={loading} variant="outline" size="sm" className="h-8 bg-blue-50 text-blue-600 border-blue-200">
                            <Undo2 className="w-3.5 h-3.5 mr-1.5" /> 복원
                        </Button>
                    ) : (
                        <>
                            <Button onClick={() => onEdit?.(currentRecord)} variant="outline" disabled={loading} size="sm" className="h-8">수정</Button>
                            <Button onClick={() => onDelete(currentRecord)} variant="destructive" disabled={loading} size="sm" className="h-8">
                                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> 삭제
                            </Button>
                            {currentRecord.status !== 'approved' && (
                                <Button
                                    onClick={() => {
                                        onApprove(currentRecord);
                                        if (currentIndex < records.length - 1) setTimeout(() => onNavigate(currentIndex + 1), 300);
                                    }}
                                    disabled={loading || !currentRecord.geocoding_success}
                                    className="bg-green-600 hover:bg-green-700 h-8"
                                    size="sm"
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> 승인
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Main Content Area - Split View using unified component */}
            <div className="flex-1 overflow-hidden">
                <EvaluationDetailView record={currentRecord} />
            </div>
        </div >
    );
}

