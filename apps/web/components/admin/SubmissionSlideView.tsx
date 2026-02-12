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

    // 네이버 검색 검증 상태
    const [naverSearchLoading, setNaverSearchLoading] = useState(false);
    const [naverSearchResults, setNaverSearchResults] = useState<any[]>([]);
    const [showWarningModal, setShowWarningModal] = useState(false);
    const [verificationDone, setVerificationDone] = useState(false);

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
        setNaverSearchResults([]);
        setVerificationDone(false);
        setShowWarningModal(false);

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

    // 승인 가능 여부 체크 (엄격한 기준 적용)
    const canApprove = useMemo(() => {
        if (!currentSubmission) return false;
        
        // 1. 최소 하나의 아이템이 승인으로 선택되어야 함
        const approvedItems = Object.entries(itemDecisions).filter(([_, d]) => d.approved);
        if (approvedItems.length === 0) return false;

        // 2. 승인된 모든 아이템의 메타데이터가 있어야 함
        const allMetaFetched = approvedItems.every(([_, d]) => d.metaFetched || d.metaData);
        if (!allMetaFetched) return false;

        // 3. 지오코딩 완료 (좌표 및 도로명 주소 존재)
        const hasLocation = approvalData.lat && approvalData.lng && approvalData.road_address;
        if (!hasLocation) return false;

        // 4. 네이버 검색 검증 완료
        if (!verificationDone) return false;

        return true;
    }, [currentSubmission, itemDecisions, approvalData, verificationDone]);

    // 데이터 변경 핸들러 (검증 상태 초기화)
    const handleEditableDataChange = (newData: typeof editableData) => {
        const nameChanged = newData.name !== editableData.name;
        const addressChanged = newData.address !== editableData.address;

        if (nameChanged) {
            setVerificationDone(false);
            setNaverSearchResults([]);
        }

        if (addressChanged) {
            setVerificationDone(false);
            setNaverSearchResults([]);
            // 주소가 바뀌면 지오코딩 결과도 초기화
            setGeocodingResults([]);
            setSelectedGeocodingIndex(null);
            setApprovalData({
                lat: '',
                lng: '',
                road_address: '',
                jibun_address: '',
                english_address: '',
                address_elements: null,
            });
        }

        setEditableData(newData);
    };

    // 지오코딩 결과 선택 핸들러 (원자적 업데이트)
    const handleGeocodingSelect = (result: GeocodingResult, index: number) => {
        // 1. 선택 인덱스 업데이트
        setSelectedGeocodingIndex(index);
        
        // 2. 승인 데이터 업데이트
        setApprovalData({
            lat: result.y,
            lng: result.x,
            road_address: result.road_address,
            jibun_address: result.jibun_address,
            english_address: result.english_address,
            address_elements: result.address_elements,
        });

        // 3. 주소 필드 업데이트 (handleEditableDataChange의 초기화 로직 우회)
        setEditableData(prev => ({ ...prev, address: result.jibun_address }));

        // 4. 검증 상태 초기화 (주소가 바뀌었으므로 재검증 필요)
        // 단, 자동 검증 로직이 useEffect로 실행될 것이므로 여기서는 초기화만 함
        setVerificationDone(false);
        setNaverSearchResults([]);
    };

    // 네이버 검색 API 호출 함수
    const searchNaverPlace = async (query: string, display: number = 5) => {
        try {
            const response = await fetch(`/api/naver-search?query=${encodeURIComponent(query)}&display=${display}`);
            if (!response.ok) throw new Error('Search failed');
            const data = await response.json();
            return data.items || [];
        } catch (error) {
            console.error('Naver search error:', error);
            return [];
        }
    };

    // 주소 정규화 및 비교 함수
    const normalizeAddress = (addr: string) => {
        if (!addr) return "";
        let a = addr.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
        a = a.replace(/\d+/g, ""); 
        a = a.replace(/\s*\S+(원|쇼핑|園)/g, ""); 
        return a.trim();
    };

    const extractCityDistrictGu = (address: string): string | null => {
        const parts = address.trim().split(/\s+/);
        if (parts.length >= 2) {
            let region = `${parts[0]} ${parts[1]}`;
            if (parts.length >= 3) {
                const p3 = parts[2];
                // 시/군/구 까지만 포함 (읍/면/동/로/길 제외)
                // 예: '성남시 분당구' -> 포함, '금산군 제원면' -> 제외
                if (p3.endsWith('구') || p3.endsWith('시') || p3.endsWith('군')) {
                    region += ` ${p3}`;
                }
            }
            return region;
        }
        return null;
    };

    // 네이버 검색 및 검증 실행
    const handleNaverSearchAndVerify = async () => {
        if (!editableData.name) {
            toast.error('맛집명이 필요합니다.');
            return;
        }

        // 지오코딩 선택 여부 확인
        if (!approvalData.road_address && !approvalData.jibun_address) {
            toast.error('지오코딩 결과를 먼저 선택해주세요.');
            return;
        }

        const targetAddress = approvalData.road_address || approvalData.jibun_address;

        setNaverSearchLoading(true);
        setNaverSearchResults([]);

        try {
            const queries = new Set<string>();
            // 지오코딩된 주소 기반 검색
            queries.add(`${editableData.name} ${targetAddress}`);
            
            const region = extractCityDistrictGu(targetAddress);
            if (region) {
                queries.add(`${editableData.name} ${region}`);
            }

            const searchPromises = Array.from(queries).map(q => searchNaverPlace(q, 5));
            const resultsArrays = await Promise.all(searchPromises);
            const allResults = resultsArrays.flat();
            const uniqueResults = Array.from(new Map(allResults.map(item => [item.address, item])).values());

            // 검증 대상: 지오코딩된 주소들
            const targetAddresses = [approvalData.road_address, approvalData.jibun_address].filter(Boolean);
            const normalizedTargets = targetAddresses.map(normalizeAddress).filter(Boolean);

            const verifiedResults = uniqueResults.map(item => {
                const normAddr = normalizeAddress(item.address);
                const normRoad = normalizeAddress(item.roadAddress || '');
                
                const isMatch = normalizedTargets.some(target => {
                    if (!target) return false;
                    return target === normAddr || target === normRoad || 
                           (normAddr && target.includes(normAddr)) || 
                           (normAddr && normAddr.includes(target)) ||
                           (normRoad && target.includes(normRoad)) ||
                           (normRoad && normRoad.includes(target));
                });

                return { ...item, isMatch };
            });

            setNaverSearchResults(verifiedResults);
            
            const hasMatch = verifiedResults.some(r => r.isMatch);
            
            if (hasMatch) {
                setVerificationDone(true);
                toast.success('주소 검증이 완료되었습니다. 승인 버튼을 눌러주세요.');
            } else {
                setVerificationDone(false); // 실패 시 승인 불가
                toast.warning('일치하는 주소를 찾지 못했습니다. 결과를 확인해주세요.');
            }

        } catch (error) {
            console.error('Naver search verification failed', error);
            toast.error('검증 중 오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            setNaverSearchLoading(false);
        }
    };

    // 승인 핸들러
    const handleApprove = useCallback(async () => {
        if (!currentSubmission) return;
        if (!canApprove) {
            toast.error('지오코딩을 완료하고 최소 하나의 항목을 승인으로 선택해주세요');
            return;
        }

        // 이미 검증했거나 강제 승인인 경우 바로 승인
        if (verificationDone || forceApprove) {
            onApprove(currentSubmission, approvalData, itemDecisions, forceApprove);
            return;
        }

        // 검증 실행
        await handleNaverSearchAndVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canApprove, approvalData, currentSubmission, itemDecisions, forceApprove, onApprove, verificationDone, editableData, geocodingResults]);

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
                    <h2 className="text-sm font-semibold line-clamp-2 max-w-full break-words">
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
                    onEditableDataChange={handleEditableDataChange}
                    naverSearchResults={naverSearchResults}
                    naverSearchLoading={naverSearchLoading}
                    onVerifyNaverSearch={handleNaverSearchAndVerify}
                    onGeocodingSelect={handleGeocodingSelect}
                />
            </div>

            {/* 검증 실패 경고 모달 */}
            <Dialog open={showWarningModal} onOpenChange={setShowWarningModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-amber-600 flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" />
                            주소 검증 경고
                        </DialogTitle>
                        <DialogDescription>
                            네이버 검색 결과와 입력된 주소가 일치하지 않습니다.
                            <br />
                            그래도 승인하시겠습니까?
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="py-4 space-y-4">
                        <div className="bg-slate-50 p-3 rounded-md border text-sm">
                            <p className="font-semibold mb-1">입력된 정보:</p>
                            <p>이름: {editableData.name}</p>
                            <p>주소: {editableData.address}</p>
                        </div>

                        {naverSearchResults.length > 0 ? (
                            <div className="space-y-2">
                                <p className="text-sm font-semibold">검색된 유사 결과:</p>
                                <div className="max-h-40 overflow-y-auto space-y-2 border rounded-md p-2">
                                    {naverSearchResults.map((result, idx) => (
                                        <div key={idx} className="text-xs p-2 bg-white border rounded">
                                            <p className="font-medium">{result.title.replace(/<[^>]+>/g, '')}</p>
                                            <p className="text-muted-foreground">{result.address}</p>
                                            {result.roadAddress && <p className="text-muted-foreground">{result.roadAddress}</p>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm text-muted-foreground p-2 border rounded bg-slate-50">
                                검색된 결과가 없습니다.
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowWarningModal(false)}>
                            취소 (수정하기)
                        </Button>
                        <Button 
                            className="bg-amber-600 hover:bg-amber-700"
                            onClick={() => {
                                setShowWarningModal(false);
                                setVerificationDone(true); // 강제 승인 처리
                                onApprove(currentSubmission!, approvalData, itemDecisions, forceApprove);
                            }}
                        >
                            무시하고 승인
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
