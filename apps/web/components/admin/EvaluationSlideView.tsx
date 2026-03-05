import { useCallback, useEffect, useRef } from 'react';
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
import { EvaluationDetailView } from './EvaluationDetailView';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

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
    void onRegisterMissing;
    void onResolveConflict;
    const isMobile = useIsMobile();
    const slideSwipeStartXRef = useRef<number | null>(null);
    const slideSwipeEndXRef = useRef<number | null>(null);
    const slideSwipeStartYRef = useRef<number | null>(null);
    const slideSwipeEndYRef = useRef<number | null>(null);
    const slideSwipeLastHandledAtRef = useRef(0);
    const slideSwipeInputRef = useRef<'pointer' | 'touch' | null>(null);
    const slideSwipePointerIdRef = useRef<number | null>(null);
    const isSlideSwipeActiveRef = useRef(false);
    const SLIDE_SWIPE_DISTANCE = 24;

    const handleSlideTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (isSlideSwipeActiveRef.current || slideSwipeInputRef.current === 'pointer') return;
        slideSwipeInputRef.current = 'touch';
        slideSwipePointerIdRef.current = null;
        slideSwipeStartXRef.current = e.touches[0].clientX;
        slideSwipeStartYRef.current = e.touches[0].clientY;
        slideSwipeEndXRef.current = null;
        slideSwipeEndYRef.current = null;
        isSlideSwipeActiveRef.current = true;
    }, []);

    const handleSlideTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isSlideSwipeActiveRef.current || slideSwipeInputRef.current !== 'touch') return;
        slideSwipeEndXRef.current = e.touches[0].clientX;
        slideSwipeEndYRef.current = e.touches[0].clientY;
    }, []);

    const handleSlideSwipeEndInternal = useCallback((): boolean => {
        const startX = slideSwipeStartXRef.current;
        const endX = slideSwipeEndXRef.current;
        const startY = slideSwipeStartYRef.current;
        const endY = slideSwipeEndYRef.current;

        if (startX === null || endX === null || startY === null || endY === null) return false;

        const distanceX = startX - endX;
        const distanceY = startY - endY;

        if (Math.abs(distanceX) < SLIDE_SWIPE_DISTANCE || Math.abs(distanceX) <= Math.abs(distanceY)) {
            return false;
        }

        const nextIndex = distanceX > 0 ? currentIndex + 1 : currentIndex - 1;

        if (nextIndex >= 0 && nextIndex < records.length) {
            onNavigate(nextIndex);
            return true;
        }

        return false;
    }, [currentIndex, records.length, onNavigate]);

    const handleSlideSwipeEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        if (!isSlideSwipeActiveRef.current || slideSwipeInputRef.current !== 'touch' || slideSwipePointerIdRef.current !== null) return;
        if (Date.now() - slideSwipeLastHandledAtRef.current < 250) {
            isSlideSwipeActiveRef.current = false;
            slideSwipeInputRef.current = null;
            return;
        }

        const didSwipe = handleSlideSwipeEndInternal();
        if (didSwipe) {
            slideSwipeLastHandledAtRef.current = Date.now();
            e.preventDefault();
        }
        isSlideSwipeActiveRef.current = false;
        slideSwipeInputRef.current = null;
    }, [handleSlideSwipeEndInternal]);

    const handleSlidePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (isSlideSwipeActiveRef.current || slideSwipeInputRef.current === 'touch') return;
        slideSwipeInputRef.current = 'pointer';
        slideSwipePointerIdRef.current = e.pointerId;
        isSlideSwipeActiveRef.current = true;
        slideSwipeStartXRef.current = e.clientX;
        slideSwipeStartYRef.current = e.clientY;
        slideSwipeEndXRef.current = null;
        slideSwipeEndYRef.current = null;
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // no-op
        }
    }, []);

    const handleSlidePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isSlideSwipeActiveRef.current || slideSwipeInputRef.current !== 'pointer' || slideSwipePointerIdRef.current !== e.pointerId) return;
        slideSwipeEndXRef.current = e.clientX;
        slideSwipeEndYRef.current = e.clientY;
    }, []);

    const handleSlidePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isSlideSwipeActiveRef.current || slideSwipeInputRef.current !== 'pointer' || slideSwipePointerIdRef.current !== e.pointerId) return;
        if (Date.now() - slideSwipeLastHandledAtRef.current < 250) {
            isSlideSwipeActiveRef.current = false;
            slideSwipeInputRef.current = null;
            slideSwipePointerIdRef.current = null;
            try {
                e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
                // no-op
            }
            return;
        }

        const didSwipe = handleSlideSwipeEndInternal();
        if (didSwipe) {
            slideSwipeLastHandledAtRef.current = Date.now();
            e.preventDefault();
        }
        isSlideSwipeActiveRef.current = false;
        slideSwipeInputRef.current = null;
        slideSwipePointerIdRef.current = null;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
            // no-op
        }
    }, [handleSlideSwipeEndInternal]);

    const handleSlideTouchCancel = useCallback(() => {
        if (!isSlideSwipeActiveRef.current || slideSwipeInputRef.current !== 'touch') return;
        isSlideSwipeActiveRef.current = false;
        slideSwipeInputRef.current = null;
    }, []);

    const handleSlidePointerCancel = useCallback(() => {
        isSlideSwipeActiveRef.current = false;
        slideSwipeInputRef.current = null;
        slideSwipePointerIdRef.current = null;
    }, []);

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

    const canMovePrev = currentIndex > 0;
    const canMoveNext = currentIndex < records.length - 1;
    const isDeleted = currentRecord.status === 'deleted';
    const isApproved = currentRecord.status === 'approved';
    const canApproveCurrent = !isDeleted && !isApproved && currentRecord.geocoding_success;

    const handleApproveAndMoveNext = () => {
        onApprove(currentRecord);
        if (currentIndex < records.length - 1) {
            setTimeout(() => onNavigate(currentIndex + 1), 300);
        }
    };

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
        <div
            className="flex flex-col bg-background"
            style={{ touchAction: 'pan-y' }}
            onTouchStart={handleSlideTouchStart}
            onTouchMove={handleSlideTouchMove}
            onTouchEnd={handleSlideSwipeEnd}
            onTouchCancel={handleSlideTouchCancel}
            onPointerDown={handleSlidePointerDown}
            onPointerMove={handleSlidePointerMove}
            onPointerUp={handleSlidePointerEnd}
            onPointerCancel={handleSlidePointerCancel}
        >
            {/* Top Navigation Bar - Compact */}
            <div className={cn("border-b bg-card shrink-0", isMobile ? "px-3 py-2" : "px-3 py-2 h-14")}>
                <div className={cn("flex items-center justify-between gap-2", isMobile ? "" : "h-full")}>
                    <div className={cn("flex items-center gap-2", isMobile ? "shrink-0" : "overflow-hidden")}>
                        <div className="flex items-center space-x-1 shrink-0">
                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onNavigate(currentIndex - 1)} disabled={!canMovePrev}>
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-xs font-medium w-[60px] text-center">
                                {currentIndex + 1} / {records.length}
                            </span>
                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onNavigate(currentIndex + 1)} disabled={!canMoveNext}>
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                        {getStatusBadge(currentRecord.status)}
                        {!isMobile && (
                            <h2 className="text-sm font-semibold line-clamp-2 max-w-full break-words">
                                {currentRecord.restaurant_name || currentRecord.name}
                            </h2>
                        )}
                    </div>
                    {isMobile && (
                        <h2 className="min-w-0 flex-1 truncate text-right text-xs font-semibold">
                            {currentRecord.restaurant_name || currentRecord.name}
                        </h2>
                    )}

                    {!isMobile && (
                        <div className="flex items-center gap-2 shrink-0">
                            {isDeleted ? (
                                <Button onClick={() => onRestore?.(currentRecord)} disabled={loading} variant="outline" size="sm" className="h-8 bg-blue-50 text-blue-600 border-blue-200">
                                    <Undo2 className="w-3.5 h-3.5 mr-1.5" /> 복원
                                </Button>
                            ) : (
                                <>
                                    <Button onClick={() => onEdit?.(currentRecord)} variant="outline" disabled={loading} size="sm" className="h-8">수정</Button>
                                    <Button onClick={() => onDelete(currentRecord)} variant="destructive" disabled={loading} size="sm" className="h-8">
                                        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> 삭제
                                    </Button>
                                    {!isApproved && (
                                        <Button
                                            onClick={handleApproveAndMoveNext}
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
                    )}
                </div>
            </div>

            {/* Main Content Area - Split View using unified component */}
            <div className="flex-1">
                <EvaluationDetailView record={currentRecord} autoHeight />
            </div>

            {isMobile && (
                <div className="shrink-0 border-t bg-card/95 px-2 py-2 backdrop-blur">
                    {isDeleted ? (
                        <Button
                            onClick={() => onRestore?.(currentRecord)}
                            disabled={loading}
                            variant="outline"
                            size="sm"
                            className="h-9 w-full bg-blue-50 text-blue-600 border-blue-200"
                        >
                            <Undo2 className="w-4 h-4 mr-1.5" />
                            복원
                        </Button>
                    ) : (
                        <div className="grid grid-cols-3 gap-2">
                            <Button onClick={() => onEdit?.(currentRecord)} variant="outline" disabled={loading} size="sm" className="h-9">
                                수정
                            </Button>
                            <Button onClick={() => onDelete(currentRecord)} variant="destructive" disabled={loading} size="sm" className="h-9">
                                삭제
                            </Button>
                            {!isApproved ? (
                                <Button
                                    onClick={handleApproveAndMoveNext}
                                    disabled={loading || !canApproveCurrent}
                                    className="bg-green-600 hover:bg-green-700 h-9"
                                    size="sm"
                                >
                                    승인
                                </Button>
                            ) : (
                                <Button disabled variant="outline" size="sm" className="h-9">
                                    승인완료
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div >
    );
}
