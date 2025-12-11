'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    XCircle,
    Trash2,
    Loader2,
    Clock,
    AlertCircle,
    Edit,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    SubmissionDetailView,
    SubmissionRecord,
    ApprovalData,
    GeocodingResult,
    ItemDecision,
} from './SubmissionDetailView';

interface SubmissionSlideViewProps {
    submissions: SubmissionRecord[];
    currentIndex: number;
    onNavigate: (index: number) => void;
    onApprove: (submission: SubmissionRecord, approvalData: ApprovalData, itemDecisions: Record<string, ItemDecision>, forceApprove: boolean) => void;
    onReject: (submission: SubmissionRecord, reason: string) => void;
    onDelete: (submission: SubmissionRecord) => void;
    onEdit?: (submission: SubmissionRecord) => void;
    onApprovalDataUpdate?: (data: ApprovalData) => void;
    externalApprovalData?: ApprovalData | null;
    loading?: boolean;
}

export function SubmissionSlideView({
    submissions,
    currentIndex,
    onNavigate,
    onApprove,
    onReject,
    onDelete,
    onEdit,
    onApprovalDataUpdate,
    externalApprovalData,
    loading = false,
}: SubmissionSlideViewProps) {
    const currentSubmission = submissions[currentIndex];

    // 지오코딩 관련 상태
    const [approvalData, setApprovalData] = useState<ApprovalData>({
        lat: '',
        lng: '',
        road_address: '',
        jibun_address: '',
        english_address: '',
        address_elements: null,
    });
    const [geocodingResults, setGeocodingResults] = useState<GeocodingResult[]>([]);
    const [selectedGeocodingIndex, setSelectedGeocodingIndex] = useState<number | null>(null);

    // 아이템별 결정 상태 (새 테이블 구조)
    const [itemDecisions, setItemDecisions] = useState<Record<string, ItemDecision>>({});
    const [forceApprove, setForceApprove] = useState(false);

    // 관리자 수정 가능 데이터
    const [editableData, setEditableData] = useState({
        name: '',
        address: '',
        phone: '',
        categories: [] as string[],
    });

    // 거부 모달 상태
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');

    // 슬라이드 변경 시 상태 초기화
    useEffect(() => {
        setApprovalData({
            lat: '',
            lng: '',
            road_address: '',
            jibun_address: '',
            english_address: '',
            address_elements: null,
        });
        setGeocodingResults([]);
        setSelectedGeocodingIndex(null);
        setRejectionReason('');
        setForceApprove(false);

        // 대기 중인 아이템에 대한 초기 결정 상태 설정
        if (currentSubmission) {
            const initialDecisions: Record<string, ItemDecision> = {};
            currentSubmission.items
                .filter(item => item.item_status === 'pending')
                .forEach(item => {
                    initialDecisions[item.id] = {
                        approved: true,
                        rejectionReason: '',
                        youtube_link: item.youtube_link,
                        tzuyang_review: item.tzuyang_review || '',
                    };
                });
            setItemDecisions(initialDecisions);

            // 관리자 수정 가능 데이터 초기화
            setEditableData({
                name: currentSubmission.restaurant_name,
                address: currentSubmission.restaurant_address || '',
                phone: currentSubmission.restaurant_phone || '',
                categories: currentSubmission.restaurant_categories || [],
            });
        }
    }, [currentIndex, currentSubmission?.id]);

    // 외부에서 전달된 approvalData 동기화 (수정 모달에서 저장 시)
    useEffect(() => {
        if (externalApprovalData) {
            setApprovalData(externalApprovalData);
        }
    }, [externalApprovalData]);

    // 키보드 네비게이션
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
            if (e.key === 'ArrowLeft') {
                if (currentIndex > 0) onNavigate(currentIndex - 1);
            } else if (e.key === 'ArrowRight') {
                if (currentIndex < submissions.length - 1) onNavigate(currentIndex + 1);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentIndex, submissions.length, onNavigate]);

    // 대기 중인 아이템 수 (currentSubmission이 없으면 0)
    const pendingItemsCount = currentSubmission?.items.filter(item => item.item_status === 'pending').length ?? 0;
    const approvedDecisionsCount = Object.values(itemDecisions).filter(d => d.approved).length;

    // 상태 배지 (useMemo로 최적화 - hooks는 조건부 return 전에 호출되어야 함)
    const statusBadge = useMemo(() => {
        if (!currentSubmission) return null;
        const status = currentSubmission.status;
        const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
            pending: { label: '검토 대기', variant: 'secondary', icon: <Clock className="w-3 h-3" /> },
            approved: { label: '승인됨', variant: 'default', icon: <CheckCircle2 className="w-3 h-3" /> },
            partially_approved: { label: '부분 승인', variant: 'outline', icon: <AlertCircle className="w-3 h-3" /> },
            rejected: { label: '거부됨', variant: 'destructive', icon: <XCircle className="w-3 h-3" /> },
        };
        const config = variants[status] || { label: status, variant: 'default', icon: null };
        return (
            <Badge variant={config.variant} className="text-xs px-2 py-0.5 gap-1">
                {config.icon}
                {config.label}
            </Badge>
        );
    }, [currentSubmission?.status]);

    // 승인 가능 여부 체크
    const canApprove = useMemo(() => {
        if (!currentSubmission) return false;
        // 최소 하나의 아이템이 승인으로 선택되어야 함
        const hasApprovedItem = Object.values(itemDecisions).some(d => d.approved);
        // 지오코딩 완료 필요
        const hasLocation = approvalData.lat && approvalData.lng && approvalData.road_address;
        return hasApprovedItem && hasLocation;
    }, [currentSubmission, itemDecisions, approvalData]);

    // 승인 핸들러
    const handleApprove = useCallback(() => {
        if (!currentSubmission) return;
        if (!canApprove) {
            toast.error('지오코딩을 완료하고 최소 하나의 항목을 승인으로 선택해주세요');
            return;
        }
        onApprove(currentSubmission, approvalData, itemDecisions, forceApprove);
    }, [canApprove, approvalData, currentSubmission, itemDecisions, forceApprove, onApprove]);

    // 거부 핸들러
    const handleReject = useCallback(() => {
        if (!currentSubmission) return;
        if (!rejectionReason.trim()) {
            toast.error('거부 사유를 입력해주세요');
            return;
        }
        onReject(currentSubmission, rejectionReason.trim());
        setShowRejectModal(false);
        setRejectionReason('');
    }, [currentSubmission, onReject, rejectionReason]);

    // 삭제 핸들러
    const handleDelete = useCallback(() => {
        if (!currentSubmission) return;
        if (confirm('정말 이 제보를 삭제하시겠습니까?')) {
            onDelete(currentSubmission);
        }
    }, [currentSubmission, onDelete]);

    // 수정 핸들러
    const handleEdit = useCallback(() => {
        if (onEdit && currentSubmission) {
            onEdit(currentSubmission);
        }
    }, [currentSubmission, onEdit]);

    // 빈 데이터 처리 (모든 hooks 호출 후에 return)
    if (!currentSubmission) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                <AlertCircle className="w-12 h-12 mb-4" />
                <p className="text-lg">검토할 제보가 없습니다.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-background overflow-hidden">
            {/* Top Navigation Bar */}
            <div className="flex items-center justify-between px-3 py-2 border-b shrink-0 h-14">
                <div className="flex items-center gap-3 overflow-hidden">
                    {/* 네비게이션 버튼 */}
                    <div className="flex items-center space-x-1 shrink-0">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => onNavigate(currentIndex - 1)}
                            disabled={currentIndex <= 0}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-xs font-medium w-[60px] text-center">
                            {currentIndex + 1} / {submissions.length}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => onNavigate(currentIndex + 1)}
                            disabled={currentIndex >= submissions.length - 1}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* 상태 배지 */}
                    {statusBadge}

                    {/* 제보 유형 배지 */}
                    <Badge
                        variant="outline"
                        className={
                            currentSubmission.submission_type === 'edit'
                                ? 'bg-amber-100 text-amber-700 border-amber-300'
                                : 'bg-blue-100 text-blue-700 border-blue-300'
                        }
                    >
                        {currentSubmission.submission_type === 'edit' ? '수정 요청' : '신규 제보'}
                    </Badge>

                    {/* 아이템 카운트 */}
                    <Badge variant="outline" className="text-xs">
                        {approvedDecisionsCount}/{pendingItemsCount} 승인 선택
                    </Badge>

                    {/* 맛집명 */}
                    <h2 className="text-sm font-semibold truncate max-w-[300px]">
                        {currentSubmission.restaurant_name}
                    </h2>
                </div>

                {/* 액션 버튼 */}
                <div className="flex items-center gap-2 shrink-0">
                    {(currentSubmission.status === 'pending' || currentSubmission.status === 'partially_approved') && (
                        <>
                            {/* 수정 버튼 */}
                            {onEdit && (
                                <Button
                                    onClick={handleEdit}
                                    variant="outline"
                                    disabled={loading}
                                    size="sm"
                                    className="h-8"
                                >
                                    <Edit className="w-3.5 h-3.5 mr-1.5" />
                                    수정
                                </Button>
                            )}
                            <Button
                                onClick={() => setShowRejectModal(true)}
                                variant="outline"
                                disabled={loading}
                                size="sm"
                                className="h-8 text-red-600 border-red-200 hover:bg-red-50"
                            >
                                <XCircle className="w-3.5 h-3.5 mr-1.5" />
                                전체 거부
                            </Button>
                            <Button
                                onClick={handleApprove}
                                disabled={loading || !canApprove}
                                className="bg-green-600 hover:bg-green-700 h-8"
                                size="sm"
                                title={!canApprove ? '지오코딩 완료 및 항목 선택이 필요합니다' : '선택 항목 처리'}
                            >
                                {loading ? (
                                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                                )}
                                처리
                            </Button>
                        </>
                    )}
                    <Button
                        onClick={handleDelete}
                        variant="destructive"
                        disabled={loading}
                        size="sm"
                        className="h-8"
                    >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        삭제
                    </Button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden">
                <SubmissionDetailView
                    submission={currentSubmission}
                    approvalData={approvalData}
                    onApprovalDataChange={setApprovalData}
                    geocodingResults={geocodingResults}
                    onGeocodingResultsChange={setGeocodingResults}
                    selectedGeocodingIndex={selectedGeocodingIndex}
                    onSelectedGeocodingIndexChange={setSelectedGeocodingIndex}
                    itemDecisions={itemDecisions}
                    onItemDecisionsChange={setItemDecisions}
                    forceApprove={forceApprove}
                    onForceApproveChange={setForceApprove}
                    editableData={editableData}
                    onEditableDataChange={setEditableData}
                />
            </div>

            {/* 거부 사유 모달 */}
            <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>제보 전체 거부</DialogTitle>
                        <DialogDescription>
                            거부 사유를 입력해주세요. 모든 항목이 거부됩니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="rejection-reason">거부 사유</Label>
                            <Textarea
                                id="rejection-reason"
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                placeholder="예: 이미 등록된 맛집입니다 / 정보가 정확하지 않습니다"
                                rows={4}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowRejectModal(false)}>
                            취소
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleReject}
                            disabled={!rejectionReason.trim() || loading}
                        >
                            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            전체 거부
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
