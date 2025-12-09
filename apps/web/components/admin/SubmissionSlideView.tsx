'use client';

import { useEffect, useState } from 'react';
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
} from './SubmissionDetailView';

interface SubmissionSlideViewProps {
    submissions: SubmissionRecord[];
    currentIndex: number;
    onNavigate: (index: number) => void;
    onApprove: (submission: SubmissionRecord, approvalData: ApprovalData) => void;
    onReject: (submission: SubmissionRecord, reason: string) => void;
    onDelete: (submission: SubmissionRecord) => void;
    onEdit?: (submission: SubmissionRecord) => void;
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
    }, [currentIndex]);

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

    // 빈 데이터 처리
    if (!currentSubmission) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                <AlertCircle className="w-12 h-12 mb-4" />
                <p className="text-lg">검토할 제보가 없습니다.</p>
            </div>
        );
    }

    // 상태 배지
    const getStatusBadge = (status: string) => {
        const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
            pending: { label: '검토 대기', variant: 'secondary', icon: <Clock className="w-3 h-3" /> },
            approved: { label: '승인됨', variant: 'default', icon: <CheckCircle2 className="w-3 h-3" /> },
            rejected: { label: '거부됨', variant: 'destructive', icon: <XCircle className="w-3 h-3" /> },
        };
        const config = variants[status] || { label: status, variant: 'default', icon: null };
        return (
            <Badge variant={config.variant} className="text-xs px-2 py-0.5 gap-1">
                {config.icon}
                {config.label}
            </Badge>
        );
    };

    // 승인 핸들러
    const handleApprove = () => {
        if (!approvalData.lat || !approvalData.lng) {
            toast.error('먼저 주소를 검색하고 선택해주세요');
            return;
        }
        onApprove(currentSubmission, approvalData);
    };

    // 거부 핸들러
    const handleReject = () => {
        if (!rejectionReason.trim()) {
            toast.error('거부 사유를 입력해주세요');
            return;
        }
        onReject(currentSubmission, rejectionReason.trim());
        setShowRejectModal(false);
        setRejectionReason('');
    };

    // 삭제 핸들러
    const handleDelete = () => {
        if (confirm('정말 이 제보를 삭제하시겠습니까?')) {
            onDelete(currentSubmission);
        }
    };

    // 수정 핸들러
    const handleEdit = () => {
        if (onEdit) {
            onEdit(currentSubmission);
        }
    };

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
                    {getStatusBadge(currentSubmission.status)}

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

                    {/* 맛집명 */}
                    <h2 className="text-sm font-semibold truncate max-w-[400px]">
                        {currentSubmission.restaurant_name}
                    </h2>
                </div>

                {/* 액션 버튼 */}
                <div className="flex items-center gap-2 shrink-0">
                    {currentSubmission.status === 'pending' && (
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
                                거부
                            </Button>
                            <Button
                                onClick={handleApprove}
                                disabled={loading || !approvalData.lat || !approvalData.lng}
                                className="bg-green-600 hover:bg-green-700 h-8"
                                size="sm"
                            >
                                {loading ? (
                                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                ) : (
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                                )}
                                승인
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
                />
            </div>

            {/* 거부 사유 모달 */}
            <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>제보 거부</DialogTitle>
                        <DialogDescription>
                            거부 사유를 입력해주세요. 제보자에게 전달됩니다.
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
                            거부
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
