'use client';

import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
    CheckCircle2,
    XCircle,
    Trash2,
    Loader2,
    Clock,
    AlertCircle,
    User,
    Youtube,
    Edit,
    Search,
    X,
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
import {
    TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// YouTube 비디오 ID 추출
function getYoutubeVideoId(url: string | undefined): string | null {
    if (!url) return null;
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&].*)?/,
        /(?:youtube\.com\/(?:embed|v)\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

interface SubmissionListViewProps {
    submissions: SubmissionRecord[];
    onApprove: (submission: SubmissionRecord, approvalData: ApprovalData, itemDecisions: Record<string, ItemDecision>, forceApprove: boolean, editableData: { name: string; address: string; phone: string; categories: string[] }) => void;
    onReject: (submission: SubmissionRecord, reason: string) => void;
    onDelete: (submission: SubmissionRecord) => void;
    onRefresh?: () => void;
    loading?: boolean;
}

export function SubmissionListView({
    submissions,
    onApprove,
    onReject,
    onDelete,
    loading = false,
}: SubmissionListViewProps) {
    // 탭 상태
    const [activeTab, setActiveTab] = useState<'new' | 'edit'>('new');
    
    // 검색어
    const [searchQuery, setSearchQuery] = useState('');
    
    // 선택된 제보
    const [selectedSubmission, setSelectedSubmission] = useState<SubmissionRecord | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

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

    // 항목별 결정 상태
    const [itemDecisions, setItemDecisions] = useState<Record<string, ItemDecision>>({});
    const [forceApprove, setForceApprove] = useState(false);
    
    // 수정 가능한 데이터
    const [editableData, setEditableData] = useState({
        name: '',
        address: '',
        phone: '',
        categories: [] as string[],
    });

    // 거부 모달
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');

    // 필터링
    const filteredSubmissions = useMemo(() => {
        let filtered = submissions.filter(s =>
            activeTab === 'new' ? s.submission_type === 'new' : s.submission_type === 'edit'
        );

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(s =>
                s.restaurant_name.toLowerCase().includes(query) ||
                s.restaurant_address?.toLowerCase().includes(query) ||
                s.profiles?.nickname?.toLowerCase().includes(query)
            );
        }

        return filtered;
    }, [submissions, activeTab, searchQuery]);

    // 통계
    const newCount = useMemo(() =>
        submissions.filter(s => s.submission_type === 'new' && (s.status === 'pending' || s.status === 'partially_approved')).length
    , [submissions]);

    const editCount = useMemo(() =>
        submissions.filter(s => s.submission_type === 'edit' && (s.status === 'pending' || s.status === 'partially_approved')).length
    , [submissions]);

    // 상태 뱃지
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved':
                return <Badge className="bg-green-600 text-xs">승인</Badge>;
            case 'partially_approved':
                return <Badge className="bg-amber-500 text-xs">부분승인</Badge>;
            case 'rejected':
                return <Badge variant="destructive" className="text-xs">거부</Badge>;
            default:
                return <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 mr-1" />대기</Badge>;
        }
    };

    // 모달 열기
    const openDetailModal = useCallback((submission: SubmissionRecord) => {
        setSelectedSubmission(submission);
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
        setForceApprove(false);
        setRejectionReason('');

        setEditableData({
            name: submission.restaurant_name,
            address: submission.restaurant_address || '',
            phone: submission.restaurant_phone || '',
            categories: submission.restaurant_categories || [],
        });

        const initialDecisions: Record<string, ItemDecision> = {};
        submission.items
            .filter(item => item.item_status === 'pending')
            .forEach(item => {
                initialDecisions[item.id] = {
                    approved: false,
                    rejectionReason: '',
                    youtube_link: item.youtube_link,
                    tzuyang_review: item.tzuyang_review || '',
                };
            });
        setItemDecisions(initialDecisions);
        setIsDetailModalOpen(true);
    }, []);

    // 모달 닫기
    const closeDetailModal = useCallback(() => {
        setIsDetailModalOpen(false);
        setSelectedSubmission(null);
    }, []);

    // 승인 가능 여부 체크
    const canApprove = useMemo(() => {
        if (!selectedSubmission) return false;
        
        const geocodingDone = !!approvalData.lat && !!approvalData.lng && !!approvalData.road_address;
        const hasSelectedItem = Object.values(itemDecisions).some(d => d.approved);
        
        const selectedItemsMetaFetched = Object.entries(itemDecisions)
            .filter(([, d]) => d.approved)
            .every(([, d]) => d.metaFetched);
        
        const hasName = !!editableData.name.trim();
        
        return geocodingDone && hasSelectedItem && selectedItemsMetaFetched && hasName;
    }, [approvalData, selectedSubmission, itemDecisions, editableData.name]);

    // 승인 핸들러
    const handleApprove = useCallback(() => {
        if (!selectedSubmission) return;
        
        if (!approvalData.lat || !approvalData.lng || !approvalData.road_address) {
            toast.error('지오코딩을 완료하고 주소를 선택해주세요');
            return;
        }
        
        const selectedWithoutMeta = Object.entries(itemDecisions)
            .filter(([, d]) => d.approved && !d.metaFetched);
        
        if (selectedWithoutMeta.length > 0) {
            toast.error('선택된 모든 항목의 메타데이터를 가져와주세요');
            return;
        }
        
        if (!canApprove) {
            toast.error('모든 필수 항목을 완료해주세요');
            return;
        }
        
        onApprove(selectedSubmission, approvalData, itemDecisions, forceApprove, editableData);
        closeDetailModal();
    }, [canApprove, approvalData, selectedSubmission, itemDecisions, forceApprove, editableData, onApprove, closeDetailModal]);

    // 거부 핸들러
    const handleReject = useCallback(() => {
        if (!selectedSubmission) return;
        if (!rejectionReason.trim()) {
            toast.error('거부 사유를 입력해주세요');
            return;
        }
        onReject(selectedSubmission, rejectionReason.trim());
        setShowRejectModal(false);
        setRejectionReason('');
        closeDetailModal();
    }, [selectedSubmission, onReject, rejectionReason, closeDetailModal]);

    // 삭제 핸들러
    const handleDelete = useCallback((submission: SubmissionRecord, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (confirm('정말 이 제보를 삭제하시겠습니까?')) {
            onDelete(submission);
        }
    }, [onDelete]);

    return (
        <TooltipProvider>
            <div className="flex flex-col h-full">
                {/* 탭 헤더 */}
                <div className="shrink-0 border-b pb-3 mb-3 mx-4">
                    <div className="flex items-center justify-end gap-2 mt-2">
                            <Button
                                variant={activeTab === 'new' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setActiveTab('new')}
                                className="gap-2"
                            >
                                <Youtube className="h-4 w-4" />
                                신규 제보
                                {newCount > 0 && (
                                    <Badge variant="secondary" className="ml-1 bg-yellow-100 text-yellow-700">
                                        {newCount}
                                    </Badge>
                                )}
                            </Button>
                            <Button
                                variant={activeTab === 'edit' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setActiveTab('edit')}
                                className="gap-2"
                            >
                                <Edit className="h-4 w-4" />
                                수정 요청
                                {editCount > 0 && (
                                    <Badge variant="secondary" className="ml-1 bg-yellow-100 text-yellow-700">
                                        {editCount}
                                    </Badge>
                                )}
                            </Button>
                        </div>
                </div>

                {/* 테이블 */}
                <div className="flex-1 overflow-auto border rounded-lg mx-4">
                    {filteredSubmissions.length === 0 && !searchQuery ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <AlertCircle className="w-10 h-10 mb-3" />
                            <p>{activeTab === 'new' ? '신규 제보가 없습니다.' : '수정 요청이 없습니다.'}</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-20">
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="w-[200px] sticky left-0 bg-background z-10">
                                        <div className="relative">
                                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                type="text"
                                                placeholder="맛집명, 주소, 제보자..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="pl-8 pr-8 h-8 text-sm"
                                            />
                                            {searchQuery && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="absolute right-0 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                                                    onClick={() => setSearchQuery('')}
                                                >
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            )}
                                        </div>
                                    </TableHead>
                                    <TableHead className="w-[100px]">전화번호</TableHead>
                                    <TableHead className="w-[80px]">카테고리</TableHead>
                                    <TableHead className="w-[300px]">리뷰</TableHead>
                                    <TableHead className="w-[70px]">제보자</TableHead>
                                    <TableHead className="w-[50px] text-center sticky right-[100px] bg-background z-10">상태</TableHead>
                                    <TableHead className="w-[100px] text-center sticky right-0 bg-background z-10">액션</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSubmissions.length === 0 && searchQuery ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                                            검색 결과가 없습니다
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredSubmissions.map((submission) => {
                                        const isPending = submission.status === 'pending' || submission.status === 'partially_approved';
                                        
                                        return (
                                            <TableRow
                                                key={submission.id}
                                                className="hover:bg-muted/50 transition-colors cursor-pointer"
                                                onClick={() => openDetailModal(submission)}
                                            >
                                                {/* 맛집명 + 주소 (썸네일 삭제) */}
                                                <TableCell className="sticky left-0 bg-background">
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-sm truncate">{submission.restaurant_name}</p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {submission.restaurant_address || '-'}
                                                        </p>
                                                    </div>
                                                </TableCell>
                                                
                                                {/* 전화번호 */}
                                                <TableCell className="text-xs">
                                                    {submission.restaurant_phone || '-'}
                                                </TableCell>
                                                
                                                {/* 카테고리 */}
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-0.5">
                                                        {submission.restaurant_categories?.slice(0, 2).map((cat, idx) => (
                                                            <Badge key={idx} variant="outline" className="text-[10px] px-1">
                                                                {cat}
                                                            </Badge>
                                                        ))}
                                                        {(submission.restaurant_categories?.length || 0) > 2 && (
                                                            <Badge variant="outline" className="text-[10px] px-1">
                                                                +{(submission.restaurant_categories?.length || 0) - 2}
                                                            </Badge>
                                                        )}
                                                        {!submission.restaurant_categories?.length && (
                                                            <span className="text-xs text-muted-foreground">-</span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                
                                                {/* 리뷰 */}
                                                <TableCell className="max-w-[300px]">
                                                    <div className="space-y-0.5">
                                                        {submission.items.slice(0, 2).map((item) => {
                                                            const videoId = getYoutubeVideoId(item.youtube_link);
                                                            return (
                                                                <div key={item.id} className="flex items-center gap-1 text-xs">
                                                                    <span className="text-muted-foreground truncate max-w-[250px]">
                                                                        {item.tzuyang_review?.slice(0, 50) || '리뷰없음'}
                                                                        {(item.tzuyang_review?.length || 0) > 50 && '...'}
                                                                    </span>
                                                                    {videoId && (
                                                                        <a
                                                                            href={item.youtube_link}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-blue-500 hover:underline flex-shrink-0"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                        >
                                                                            <Youtube className="h-3 w-3" />
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                        {submission.items.length > 2 && (
                                                            <span className="text-[10px] text-muted-foreground">
                                                                +{submission.items.length - 2}개
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                
                                                {/* 제보자 */}
                                                <TableCell>
                                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <User className="h-3 w-3" />
                                                        <span className="truncate max-w-[60px]">
                                                            {submission.profiles?.nickname || '?'}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                
                                                {/* 상태 */}
                                                <TableCell className="text-center sticky right-[100px] bg-background">
                                                    {getStatusBadge(submission.status)}
                                                </TableCell>
                                                
                                                {/* 액션 */}
                                                <TableCell className="sticky right-0 bg-background">
                                                    <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                        {isPending && (
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-7 px-2 text-xs"
                                                                onClick={() => openDetailModal(submission)}
                                                            >
                                                                <Edit className="h-3 w-3 mr-1" />
                                                                수정
                                                            </Button>
                                                        )}
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            className="h-7 w-7 p-0"
                                                            onClick={(e) => handleDelete(submission, e)}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    )}
                </div>

                {/* 상세/승인 모달 */}
                <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                        {selectedSubmission && (
                            <>
                                <DialogHeader className="shrink-0">
                                    <div className="flex items-center gap-2">
                                        <DialogTitle className="text-lg font-semibold">
                                            {selectedSubmission.restaurant_name}
                                        </DialogTitle>
                                        <Badge variant="outline" className="text-xs">
                                            {selectedSubmission.submission_type === 'new' ? '신규' : '수정'}
                                        </Badge>
                                        {getStatusBadge(selectedSubmission.status)}
                                    </div>
                                    <DialogDescription className="text-sm text-muted-foreground">
                                        제보 내용을 검토하고 승인 또는 거부를 결정하세요.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="flex-1 overflow-auto -mx-6 px-6">
                                    <SubmissionDetailView
                                        submission={selectedSubmission}
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

                                {/* 푸터 */}
                                {(selectedSubmission.status === 'pending' || selectedSubmission.status === 'partially_approved') && (
                                    <DialogFooter className="shrink-0 pt-4 border-t">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setIsDetailModalOpen(false)}
                                            disabled={loading}
                                        >
                                            취소
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setShowRejectModal(true)}
                                            disabled={loading}
                                            className="text-red-600 border-red-200 hover:bg-red-50"
                                        >
                                            <XCircle className="w-4 h-4 mr-2" />
                                            전체 거부
                                        </Button>
                                        <Button
                                            onClick={handleApprove}
                                            disabled={loading || !canApprove}
                                            title={!canApprove ? '지오코딩 완료 및 선택된 항목의 메타데이터를 가져와주세요' : '승인'}
                                        >
                                            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                            승인
                                        </Button>
                                    </DialogFooter>
                                )}
                            </>
                        )}
                    </DialogContent>
                </Dialog>

                {/* 거부 모달 */}
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
        </TooltipProvider>
    );
}
