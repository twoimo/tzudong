'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
    MapPin,
    Calendar,
    MessageSquare,
    AlertTriangle,
    ScanSearch,
    RefreshCw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { supabase } from '@/integrations/supabase/client';

// Supabase Storage에서 리뷰 사진 public URL 생성
function getReviewPhotoUrl(path: string): string {
    // 이미 full URL인 경우 그대로 반환
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    // 상대 경로인 경우 Supabase Storage에서 public URL 생성
    return supabase.storage.from('review-photos').getPublicUrl(path).data.publicUrl;
}

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

// 리뷰 타입 정의
export interface Review {
    id: string;
    user_id: string;
    restaurant_id: string;
    title: string;
    content: string;
    visited_at: string;
    verification_photo: string;
    food_photos: string[];
    category: string;
    is_verified: boolean;
    admin_note: string | null;
    is_pinned: boolean;
    is_edited_by_admin: boolean;
    created_at: string;
    updated_at: string;
    // OCR 중복 검사 관련 필드
    is_duplicate?: boolean;
    receipt_data?: {
        store_name?: string;
        date?: string;
        time?: string;
        total_amount?: number;
        items?: string[] | { name: string; price: number | null }[];
        confidence?: number;
        error?: string;
        duplicate_of?: string; // 중복 원본 리뷰 ID
    } | null;
    ocr_processed_at?: string | null;
    profiles: {
        nickname: string;
    } | null;
    restaurants: {
        name: string;
        address: string;
    } | null;
}

// 리뷰 사진 아이템 컴포넌트 (로딩 스피너 포함)
function ReviewPhotoItem({
    src,
    alt,
    label,
    labelVariant,
    onClick,
}: {
    src: string;
    alt: string;
    label: string;
    labelVariant: 'receipt' | 'food';
    onClick: () => void;
}) {
    const [isLoading, setIsLoading] = useState(true);

    return (
        <div
            className="flex-shrink-0 border rounded-lg overflow-hidden relative cursor-pointer hover:ring-2 hover:ring-primary transition-all h-32 min-w-24"
            onClick={onClick}
        >
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            )}
            <img
                src={src}
                alt={alt}
                className={cn(
                    "h-32 w-auto max-w-48 object-cover transition-opacity",
                    isLoading ? "opacity-0" : "opacity-100"
                )}
                onLoad={() => setIsLoading(false)}
            />
            <Badge
                variant={labelVariant === 'receipt' ? 'default' : 'secondary'}
                className={cn(
                    "absolute top-1 left-1 text-[10px] px-1",
                    labelVariant === 'receipt' && "bg-yellow-600"
                )}
            >
                {label}
            </Badge>
        </div>
    );
}

interface SubmissionListViewProps {
    submissions: SubmissionRecord[];
    onApprove: (submission: SubmissionRecord, approvalData: ApprovalData, itemDecisions: Record<string, ItemDecision>, forceApprove: boolean, editableData: { name: string; address: string; phone: string; categories: string[] }) => void;
    onReject: (submission: SubmissionRecord, reason: string) => void;
    onDelete: (submission: SubmissionRecord) => void;
    onRefresh?: () => void;
    loading?: boolean;
    // 리뷰 관련 props
    reviews?: Review[];
    onApproveReview?: (review: Review, adminNote: string) => void;
    onRejectReview?: (review: Review, adminNote: string) => void;
    onDeleteReview?: (review: Review) => void;
    reviewsLoading?: boolean;
    // 초기 탭 설정
    initialTab?: 'new' | 'edit' | 'reviews';
}

export function SubmissionListView({
    submissions,
    onApprove,
    onReject,
    onDelete,
    loading = false,
    // 리뷰 관련 props
    reviews = [],
    onApproveReview,
    onRejectReview,
    onDeleteReview,
    reviewsLoading = false,
    initialTab = 'new',
}: SubmissionListViewProps) {
    // 탭 상태 (초기 탭 지정 가능)
    const [activeTab, setActiveTab] = useState<'new' | 'edit' | 'reviews'>(initialTab);

    // 검색어
    const [searchQuery, setSearchQuery] = useState('');
    const [reviewSearchQuery, setReviewSearchQuery] = useState('');

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

    // 네이버 검색 검증 상태
    const [naverSearchLoading, setNaverSearchLoading] = useState(false);
    const [naverSearchResults, setNaverSearchResults] = useState<any[]>([]);
    const [showWarningModal, setShowWarningModal] = useState(false);
    const [verificationDone, setVerificationDone] = useState(false);

    // 리뷰 관련 상태
    const [selectedReview, setSelectedReview] = useState<Review | null>(null);
    const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
    const [reviewAdminNote, setReviewAdminNote] = useState('');
    const [showReviewModal, setShowReviewModal] = useState(false);

    // OCR 관련 상태
    const [ocrStatus, setOcrStatus] = useState<{ pending: number; duplicate: number; processed: number } | null>(null);
    const [isOcrRunning, setIsOcrRunning] = useState(false);
    const [ocrRerunningIds, setOcrRerunningIds] = useState<Set<string>>(new Set());
    const ocrPollingRef = useRef<NodeJS.Timeout | null>(null);
    const ocrRealtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    // 이미지 확대 모달 상태
    const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);

    // OCR 상태 조회
    const fetchOcrStatus = useCallback(async () => {
        try {
            const response = await fetch('/api/admin/ocr-receipts');
            if (response.ok) {
                const data = await response.json();
                setOcrStatus(data);
            }
        } catch (error) {
            console.error('OCR 상태 조회 실패:', error);
        }
    }, []);

    // OCR 실행
    const handleRunOcr = useCallback(async () => {
        setIsOcrRunning(true);
        try {
            const response = await fetch('/api/admin/ocr-receipts', { method: 'POST' });
            const data = await response.json();
            if (response.ok && data.success) {
                toast.success(data.message || 'OCR 처리가 시작되었습니다.');
                // GitHub Actions가 완료되면 상태가 갱신되므로 잠시 후 다시 조회
                setTimeout(() => fetchOcrStatus(), 3000);
            } else {
                toast.error(`OCR 처리 실패: ${data.error || '알 수 없는 오류'}`);
            }
        } catch (error) {
            toast.error('OCR 처리 중 오류가 발생했습니다.');
        } finally {
            setIsOcrRunning(false);
        }
    }, [fetchOcrStatus]);

    // 리뷰 탭 활성화 시 OCR 상태 조회 + 주기적 갱신
    useEffect(() => {
        if (activeTab === 'reviews') {
            fetchOcrStatus();
            // 30초마다 자동 갱신
            const interval = setInterval(fetchOcrStatus, 30000);
            return () => clearInterval(interval);
        }
    }, [activeTab, fetchOcrStatus]);

    // 단일 리뷰 OCR 재실행
    const handleRerunOcr = useCallback(async (reviewId: string) => {
        // 해당 리뷰 ID를 재실행 중 상태로 추가
        setOcrRerunningIds(prev => new Set(prev).add(reviewId));
        try {
            const response = await fetch('/api/admin/ocr-receipts/rerun', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reviewId }),
            });
            const data = await response.json();
            if (response.ok && data.success) {
                toast.success(data.message || 'OCR 재실행이 시작되었습니다.');

                // 선택된 리뷰 OCR 상태 초기화 (UI 즉시 반영)
                if (selectedReview && selectedReview.id === reviewId) {
                    setSelectedReview(prev => prev ? {
                        ...prev,
                        ocr_processed_at: null,
                        receipt_data: null,
                        is_duplicate: false,
                    } : null);
                }
            } else {
                toast.error(`OCR 재실행 실패: ${data.error || '알 수 없는 오류'}`);
                // 실패 시 해당 ID 제거
                setOcrRerunningIds(prev => {
                    const next = new Set(prev);
                    next.delete(reviewId);
                    return next;
                });
            }
        } catch (error) {
            toast.error('OCR 재실행 중 오류가 발생했습니다.');
            setOcrRerunningIds(prev => {
                const next = new Set(prev);
                next.delete(reviewId);
                return next;
            });
        }
    }, [selectedReview]);

    // 리뷰 모달 열릴 때 Supabase Realtime 구독 + 폴링 시작
    useEffect(() => {
        if (!showReviewModal || !selectedReview?.id) {
            // 모달 닫힐 때 정리
            if (ocrPollingRef.current) {
                clearInterval(ocrPollingRef.current);
                ocrPollingRef.current = null;
            }
            if (ocrRealtimeChannelRef.current) {
                supabase.removeChannel(ocrRealtimeChannelRef.current);
                ocrRealtimeChannelRef.current = null;
            }
            return;
        }

        const reviewId = selectedReview.id;
        const originalOcrProcessedAt = selectedReview.ocr_processed_at;

        // Supabase Realtime 구독 (reviews 테이블 변경 감지)
        const channel = supabase
            .channel(`review-ocr-${reviewId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'reviews',
                    filter: `id=eq.${reviewId}`,
                },
                (payload) => {
                    const updated = payload.new as Review;
                    // OCR 처리가 완료된 경우 (ocr_processed_at가 갱신됨)
                    if (updated.ocr_processed_at && updated.ocr_processed_at !== originalOcrProcessedAt) {
                        setSelectedReview(prev => prev ? {
                            ...prev,
                            ocr_processed_at: updated.ocr_processed_at,
                            receipt_data: updated.receipt_data,
                            is_duplicate: updated.is_duplicate,
                        } : null);
                        // 완료된 리뷰 ID를 재실행 중 상태에서 제거
                        setOcrRerunningIds(prev => {
                            const next = new Set(prev);
                            next.delete(reviewId);
                            return next;
                        });
                        toast.success('OCR 처리가 완료되었습니다.');

                        // 폴링 중단
                        if (ocrPollingRef.current) {
                            clearInterval(ocrPollingRef.current);
                            ocrPollingRef.current = null;
                        }
                    }
                }
            )
            .subscribe();

        ocrRealtimeChannelRef.current = channel;

        // 폴링 fallback (Realtime이 작동하지 않는 환경용, 5초 간격, 최대 60초)
        let pollCount = 0;
        const maxPolls = 12; // 12 * 5초 = 60초

        const pollReviewOcr = async () => {
            pollCount++;
            if (pollCount > maxPolls) {
                // 60초 초과 시 폴링 중단
                if (ocrPollingRef.current) {
                    clearInterval(ocrPollingRef.current);
                    ocrPollingRef.current = null;
                }
                setOcrRerunningIds(prev => {
                    const next = new Set(prev);
                    next.delete(reviewId);
                    return next;
                });
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('reviews')
                    .select('ocr_processed_at, receipt_data, is_duplicate')
                    .eq('id', reviewId)
                    .single();

                // 타입 추론을 위한 캐스팅
                const ocrData = data as { ocr_processed_at: string | null; receipt_data: Review['receipt_data']; is_duplicate: boolean | null } | null;

                if (!error && ocrData?.ocr_processed_at && ocrData.ocr_processed_at !== originalOcrProcessedAt) {
                    setSelectedReview(prev => prev ? {
                        ...prev,
                        ocr_processed_at: ocrData.ocr_processed_at,
                        receipt_data: ocrData.receipt_data,
                        is_duplicate: ocrData.is_duplicate ?? false,
                    } : null);
                    setOcrRerunningIds(prev => {
                        const next = new Set(prev);
                        next.delete(reviewId);
                        return next;
                    });
                    toast.success('OCR 처리가 완료되었습니다.');

                    // 폴링 중단
                    if (ocrPollingRef.current) {
                        clearInterval(ocrPollingRef.current);
                        ocrPollingRef.current = null;
                    }
                }
            } catch (err) {
                console.error('OCR 상태 폴링 오류:', err);
            }
        };

        // OCR 재실행 중일 때만 폴링 시작
        const isRerunning = ocrRerunningIds.has(reviewId);
        if (isRerunning) {
            ocrPollingRef.current = setInterval(pollReviewOcr, 5000);
        }

        return () => {
            if (ocrPollingRef.current) {
                clearInterval(ocrPollingRef.current);
                ocrPollingRef.current = null;
            }
            supabase.removeChannel(channel);
        };
    }, [showReviewModal, selectedReview?.id, selectedReview?.ocr_processed_at, ocrRerunningIds]);

    // 필터링 (제보)
    const filteredSubmissions = useMemo(() => {
        if (activeTab === 'reviews') return [];

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

    // 리뷰 필터링 및 분류 (검색어 적용)
    const filteredReviews = useMemo(() => {
        let filtered = reviews;
        if (reviewSearchQuery.trim()) {
            const query = reviewSearchQuery.toLowerCase();
            filtered = filtered.filter(r =>
                r.title?.toLowerCase().includes(query) ||
                r.content?.toLowerCase().includes(query) ||
                r.restaurants?.name?.toLowerCase().includes(query) ||
                r.profiles?.nickname?.toLowerCase().includes(query)
            );
        }
        return filtered;
    }, [reviews, reviewSearchQuery]);

    const pendingReviews = useMemo(() =>
        filteredReviews.filter(r => !r.is_verified && (!r.admin_note || !r.admin_note.includes('거부')))
        , [filteredReviews]);

    const approvedReviews = useMemo(() =>
        filteredReviews.filter(r => r.is_verified)
        , [filteredReviews]);

    const rejectedReviews = useMemo(() =>
        filteredReviews.filter(r => !r.is_verified && r.admin_note?.includes('거부'))
        , [filteredReviews]);

    // 제보 상태별 분류
    const newSubmissions = useMemo(() =>
        submissions.filter(s => s.submission_type === 'new'), [submissions]);
    const editSubmissions = useMemo(() =>
        submissions.filter(s => s.submission_type === 'edit'), [submissions]);

    const newPendingCount = useMemo(() =>
        newSubmissions.filter(s => s.status === 'pending' || s.status === 'partially_approved').length, [newSubmissions]);
    const newApprovedCount = useMemo(() =>
        newSubmissions.filter(s => s.status === 'approved').length, [newSubmissions]);
    const newRejectedCount = useMemo(() =>
        newSubmissions.filter(s => s.status === 'rejected').length, [newSubmissions]);

    const editPendingCount = useMemo(() =>
        editSubmissions.filter(s => s.status === 'pending' || s.status === 'partially_approved').length, [editSubmissions]);
    const editApprovedCount = useMemo(() =>
        editSubmissions.filter(s => s.status === 'approved').length, [editSubmissions]);
    const editRejectedCount = useMemo(() =>
        editSubmissions.filter(s => s.status === 'rejected').length, [editSubmissions]);

    // 통계 (탭 버튼 배지용)
    const newCount = useMemo(() =>
        submissions.filter(s => s.submission_type === 'new' && (s.status === 'pending' || s.status === 'partially_approved')).length
        , [submissions]);

    const editCount = useMemo(() =>
        submissions.filter(s => s.submission_type === 'edit' && (s.status === 'pending' || s.status === 'partially_approved')).length
        , [submissions]);

    const reviewPendingCount = useMemo(() => pendingReviews.length, [pendingReviews]);

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
        setNaverSearchResults([]);
        setVerificationDone(false);
        setShowWarningModal(false);
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
                setVerificationDone(false);
                toast.warning('일치하는 주소를 찾지 못했습니다. 결과를 확인해주세요.');
            }

        } catch (error) {
            console.error('Naver search verification failed', error);
            toast.error('검증 중 오류가 발생했습니다. 다시 시도해주세요.');
        } finally {
            setNaverSearchLoading(false);
        }
    };

    // 승인 가능 여부 체크 (엄격한 기준 적용)
    const canApprove = useMemo(() => {
        if (!selectedSubmission) return false;

        // 1. 지오코딩 완료
        const geocodingDone = !!approvalData.lat && !!approvalData.lng && !!approvalData.road_address;

        // 2. 최소 하나의 아이템 승인
        const hasSelectedItem = Object.values(itemDecisions).some(d => d.approved);

        // 3. 승인된 아이템의 메타데이터 존재
        const selectedItemsMetaFetched = Object.entries(itemDecisions)
            .filter(([, d]) => d.approved)
            .every(([, d]) => d.metaFetched || d.metaData);

        // 4. 이름 존재
        const hasName = !!editableData.name.trim();

        // 5. 네이버 검색 검증 완료
        const isVerified = verificationDone;

        return geocodingDone && hasSelectedItem && selectedItemsMetaFetched && hasName && isVerified;
    }, [approvalData, selectedSubmission, itemDecisions, editableData.name, verificationDone]);

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

        // 4. 검증 상태 초기화
        setVerificationDone(false);
        setNaverSearchResults([]);
    };

    // 승인 핸들러
    const handleApprove = useCallback(async () => {
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

        // 이미 검증했거나 강제 승인인 경우 바로 승인
        if (verificationDone || forceApprove) {
            onApprove(selectedSubmission, approvalData, itemDecisions, forceApprove, editableData);
            closeDetailModal();
            return;
        }

        // 검증 실행
        await handleNaverSearchAndVerify();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canApprove, approvalData, selectedSubmission, itemDecisions, forceApprove, editableData, onApprove, closeDetailModal, verificationDone, geocodingResults]);

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

    // 리뷰 액션 핸들러
    const handleReviewAction = useCallback((action: 'approve' | 'reject', review: Review) => {
        setSelectedReview(review);
        setReviewAction(action);
        setReviewAdminNote(review.admin_note || '');
        setShowReviewModal(true);
    }, []);

    const handleConfirmReviewAction = useCallback(() => {
        if (!selectedReview || !reviewAction) return;

        if (reviewAction === 'approve' && onApproveReview) {
            onApproveReview(selectedReview, reviewAdminNote.trim());
        } else if (reviewAction === 'reject' && onRejectReview) {
            onRejectReview(selectedReview, reviewAdminNote.trim());
        }

        setShowReviewModal(false);
        setSelectedReview(null);
        setReviewAdminNote('');
    }, [selectedReview, reviewAction, reviewAdminNote, onApproveReview, onRejectReview]);

    const handleDeleteReview = useCallback((review: Review) => {
        if (confirm('정말 이 리뷰를 삭제하시겠습니까?')) {
            onDeleteReview?.(review);
        }
    }, [onDeleteReview]);

    return (
        <TooltipProvider>
            <div className="flex flex-col h-full">
                {/* 탭 헤더 */}
                <div className="shrink-0 border-b pb-3 mb-3 mx-4">
                    <div className="flex items-center justify-between gap-2 mt-2">
                        {/* 왼쪽: 현재 탭 상태 카운트 */}
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                            {activeTab === 'new' && (
                                <>
                                    <span className="text-muted-foreground text-xs">신규:</span>
                                    <Badge variant="secondary" className="text-xs gap-1">
                                        <Clock className="h-3 w-3" /> 대기 {newPendingCount}
                                    </Badge>
                                    <Badge className="bg-green-500 text-xs gap-1">
                                        <CheckCircle2 className="h-3 w-3" /> 승인 {newApprovedCount}
                                    </Badge>
                                    <Badge variant="destructive" className="text-xs gap-1">
                                        <XCircle className="h-3 w-3" /> 거부 {newRejectedCount}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                        전체 {newSubmissions.length}
                                    </Badge>
                                </>
                            )}
                            {activeTab === 'edit' && (
                                <>
                                    <span className="text-muted-foreground text-xs">수정:</span>
                                    <Badge variant="secondary" className="text-xs gap-1">
                                        <Clock className="h-3 w-3" /> 대기 {editPendingCount}
                                    </Badge>
                                    <Badge className="bg-green-500 text-xs gap-1">
                                        <CheckCircle2 className="h-3 w-3" /> 승인 {editApprovedCount}
                                    </Badge>
                                    <Badge variant="destructive" className="text-xs gap-1">
                                        <XCircle className="h-3 w-3" /> 거부 {editRejectedCount}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                        전체 {editSubmissions.length}
                                    </Badge>
                                </>
                            )}
                            {activeTab === 'reviews' && (
                                <>
                                    <span className="text-muted-foreground text-xs">리뷰:</span>
                                    <Badge variant="secondary" className="text-xs gap-1">
                                        <Clock className="h-3 w-3" /> 대기 {pendingReviews.length}
                                    </Badge>
                                    <Badge className="bg-green-500 text-xs gap-1">
                                        <CheckCircle2 className="h-3 w-3" /> 승인 {approvedReviews.length}
                                    </Badge>
                                    <Badge variant="destructive" className="text-xs gap-1">
                                        <XCircle className="h-3 w-3" /> 거부 {rejectedReviews.length}
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                        전체 {reviews.length}
                                    </Badge>
                                    <span className="text-muted-foreground text-xs ml-2">OCR:</span>
                                    {ocrStatus && (
                                        <>
                                            <Badge variant="outline" className="text-xs">대기 {ocrStatus.pending}</Badge>
                                            <Badge variant="destructive" className="text-xs gap-1">
                                                <AlertTriangle className="h-3 w-3" />
                                                중복 {ocrStatus.duplicate}
                                            </Badge>
                                        </>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleRunOcr}
                                        disabled={isOcrRunning || (ocrStatus?.pending === 0)}
                                        className="gap-1 h-7 text-xs"
                                    >
                                        {isOcrRunning ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <ScanSearch className="h-3 w-3" />
                                        )}
                                        {isOcrRunning ? '처리중...' : 'OCR 실행'}
                                    </Button>
                                </>
                            )}
                        </div>
                        {/* 오른쪽: 탭 버튼들 */}
                        <div className="flex items-center gap-2">
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
                            <Button
                                variant={activeTab === 'reviews' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setActiveTab('reviews')}
                                className="gap-2"
                            >
                                <MessageSquare className="h-4 w-4" />
                                리뷰 검수
                                {reviewPendingCount > 0 && (
                                    <Badge variant="secondary" className="ml-1 bg-yellow-100 text-yellow-700">
                                        {reviewPendingCount}
                                    </Badge>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* 테이블 또는 리뷰 목록 */}
                {activeTab === 'reviews' ? (
                    /* 리뷰 검수 뷰 - 테이블 형식 */
                    <div className="flex-1 overflow-auto border rounded-lg mx-4">
                        {reviewsLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-8 h-8 animate-spin" />
                            </div>
                        ) : filteredReviews.length === 0 && !reviewSearchQuery ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                <MessageSquare className="w-10 h-10 mb-3" />
                                <p>검수할 리뷰가 없습니다.</p>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader className="sticky top-0 bg-background z-20">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="w-[140px]">
                                            <div className="relative">
                                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                                <Input
                                                    type="text"
                                                    placeholder="맛집명..."
                                                    value={reviewSearchQuery}
                                                    onChange={(e) => setReviewSearchQuery(e.target.value)}
                                                    className="pl-8 pr-8 h-8 text-sm"
                                                />
                                                {reviewSearchQuery && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="absolute right-0 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                                                        onClick={() => setReviewSearchQuery('')}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableHead>
                                        <TableHead className="w-[200px]">리뷰 내용</TableHead>
                                        <TableHead className="w-[80px]">방문일</TableHead>
                                        <TableHead className="w-[80px]">작성자</TableHead>
                                        <TableHead className="w-[50px] text-center sticky right-[100px] bg-background z-10">상태</TableHead>
                                        <TableHead className="w-[100px] text-center sticky right-0 bg-background z-10">액션</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredReviews.length === 0 && reviewSearchQuery ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                                                검색 결과가 없습니다
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        [...pendingReviews, ...approvedReviews, ...rejectedReviews].map((review) => {
                                            const isPending = !review.is_verified && (!review.admin_note || !review.admin_note.includes('거부'));
                                            const isApproved = review.is_verified;
                                            const isRejected = !review.is_verified && review.admin_note?.includes('거부');

                                            return (
                                                <TableRow
                                                    key={review.id}
                                                    className={cn(
                                                        "group hover:bg-muted/50 transition-colors cursor-pointer",
                                                        review.is_duplicate && "bg-red-100/70 dark:bg-red-950/40 hover:bg-red-200/70 dark:hover:bg-red-900/40",
                                                        !review.is_duplicate && isApproved && "bg-green-50/50 dark:bg-green-950/20",
                                                        !review.is_duplicate && isRejected && "bg-red-50/50 dark:bg-red-950/20"
                                                    )}
                                                    onClick={() => handleReviewAction('approve', review)}
                                                >
                                                    {/* 맛집 */}
                                                    <TableCell className="text-xs">
                                                        <div className="flex items-center gap-1">
                                                            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                                                            <span className="truncate max-w-[100px]">{review.restaurants?.name || '알 수 없음'}</span>
                                                        </div>
                                                    </TableCell>

                                                    {/* 리뷰 내용 미리보기 */}
                                                    <TableCell>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-sm text-muted-foreground truncate max-w-[180px]">
                                                                    {review.content?.slice(0, 50) || '내용 없음'}{(review.content?.length || 0) > 50 && '...'}
                                                                </p>
                                                                {review.is_duplicate && (
                                                                    <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">
                                                                        중복
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </TableCell>

                                                    {/* 방문일 */}
                                                    <TableCell className="text-xs text-muted-foreground">
                                                        {new Date(review.visited_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                                                    </TableCell>

                                                    {/* 작성자 */}
                                                    <TableCell>
                                                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                            <Avatar className="h-4 w-4">
                                                                <AvatarFallback className="text-[10px]">
                                                                    {review.profiles?.nickname?.[0] || '?'}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <span className="truncate max-w-[60px]">
                                                                {review.profiles?.nickname || '익명'}
                                                            </span>
                                                        </div>
                                                    </TableCell>

                                                    {/* 상태 */}
                                                    <TableCell className="text-center sticky right-[100px]">
                                                        {isPending && (
                                                            <Badge variant="secondary" className="text-xs gap-1">
                                                                <Clock className="h-3 w-3" /> 대기
                                                            </Badge>
                                                        )}
                                                        {isApproved && (
                                                            <Badge className="bg-green-500 text-xs gap-1">
                                                                <CheckCircle2 className="h-3 w-3" /> 승인
                                                            </Badge>
                                                        )}
                                                        {isRejected && (
                                                            <Badge variant="destructive" className="text-xs gap-1">
                                                                <XCircle className="h-3 w-3" /> 거부
                                                            </Badge>
                                                        )}
                                                    </TableCell>

                                                    {/* 액션 */}
                                                    <TableCell className="sticky right-0">
                                                        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                                            {isPending && (
                                                                <>
                                                                    <Button
                                                                        size="sm"
                                                                        className="bg-green-500 hover:bg-green-600 text-xs h-7 px-2 disabled:opacity-50"
                                                                        onClick={() => handleReviewAction('approve', review)}
                                                                        disabled={review.is_duplicate}
                                                                        title={review.is_duplicate ? '중복 영수증은 승인할 수 없습니다' : ''}
                                                                    >
                                                                        승인
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="destructive"
                                                                        className="text-xs h-7 px-2"
                                                                        onClick={() => handleReviewAction('reject', review)}
                                                                    >
                                                                        거부
                                                                    </Button>
                                                                </>
                                                            )}
                                                            {isApproved && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="destructive"
                                                                    className="text-xs h-7"
                                                                    onClick={() => handleReviewAction('reject', review)}
                                                                >
                                                                    취소
                                                                </Button>
                                                            )}
                                                            {isRejected && (
                                                                <Button
                                                                    size="sm"
                                                                    className="bg-green-500 hover:bg-green-600 text-xs h-7 disabled:opacity-50"
                                                                    onClick={() => handleReviewAction('approve', review)}
                                                                    disabled={review.is_duplicate}
                                                                    title={review.is_duplicate ? '중복 영수증은 승인할 수 없습니다' : ''}
                                                                >
                                                                    재승인
                                                                </Button>
                                                            )}
                                                            <Button
                                                                size="sm"
                                                                variant="outline"
                                                                className="h-7 w-7 p-0"
                                                                onClick={() => handleDeleteReview(review)}
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
                ) : (
                    /* 제보 테이블 */
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
                                                    className="group hover:bg-muted/50 transition-colors cursor-pointer"
                                                    onClick={() => openDetailModal(submission)}
                                                >
                                                    {/* 맛집명 + 주소 (썸네일 삭제) */}
                                                    <TableCell className="sticky left-0">
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
                                                    <TableCell className="text-center sticky right-[100px]">
                                                        {getStatusBadge(submission.status)}
                                                    </TableCell>

                                                    {/* 액션 */}
                                                    <TableCell className="sticky right-0">
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
                )}

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
                                                    onApprove(selectedSubmission!, approvalData, itemDecisions, forceApprove, editableData);
                                                    closeDetailModal();
                                                }}
                                            >
                                                무시하고 승인
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>

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
                                    onApprove(selectedSubmission!, approvalData, itemDecisions, forceApprove, editableData);
                                    closeDetailModal();
                                }}
                            >
                                무시하고 승인
                            </Button>
                        </DialogFooter>
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

                {/* 리뷰 승인/거부 모달 */}
                <Dialog open={showReviewModal} onOpenChange={setShowReviewModal}>
                    <DialogContent className="max-w-lg">
                        <DialogHeader>
                            <DialogTitle>
                                {reviewAction === 'approve' ? '✅ 리뷰 승인' : '❌ 리뷰 거부'}
                            </DialogTitle>
                            <DialogDescription>
                                리뷰를 {reviewAction === 'approve' ? '승인' : '거부'}합니다
                            </DialogDescription>
                        </DialogHeader>

                        {selectedReview && (
                            <div className="space-y-4 mt-4 max-h-[60vh] overflow-y-auto">
                                {/* 리뷰 기본 정보 */}
                                <Card className="p-3 bg-muted/50">
                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-semibold">{selectedReview.title}</h3>
                                            <div className="flex items-center gap-1">
                                                {selectedReview.is_duplicate && (
                                                    <Badge variant="destructive" className="text-xs gap-0.5">
                                                        <AlertTriangle className="h-3 w-3" /> 중복
                                                    </Badge>
                                                )}
                                                <Badge variant={selectedReview.is_verified ? 'default' : 'secondary'} className="text-xs">
                                                    {selectedReview.is_verified ? '승인' : '대기'}
                                                </Badge>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1">
                                                <Avatar className="h-4 w-4">
                                                    <AvatarFallback className="text-[10px]">
                                                        {selectedReview.profiles?.nickname?.[0] || '?'}
                                                    </AvatarFallback>
                                                </Avatar>
                                                {selectedReview.profiles?.nickname || '익명'}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <MapPin className="h-3 w-3" />
                                                {selectedReview.restaurants?.name || '알 수 없음'}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-3 w-3" />
                                                {new Date(selectedReview.visited_at).toLocaleDateString('ko-KR')}
                                            </span>
                                        </div>
                                        <p className="text-muted-foreground">{selectedReview.content}</p>
                                    </div>
                                </Card>

                                {/* 사진 (영수증 + 음식 사진 통합) */}
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">📷 제출된 사진</Label>
                                    {(!selectedReview.verification_photo && (!selectedReview.food_photos || selectedReview.food_photos.length === 0)) ? (
                                        <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-lg">
                                            제출된 사진이 없습니다
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 overflow-x-auto pb-2">
                                            {/* 영수증 사진 */}
                                            {selectedReview.verification_photo && (
                                                <ReviewPhotoItem
                                                    src={getReviewPhotoUrl(selectedReview.verification_photo)}
                                                    alt="영수증"
                                                    label="🧾 영수증"
                                                    labelVariant="receipt"
                                                    onClick={() => setPreviewImage({ url: getReviewPhotoUrl(selectedReview.verification_photo), alt: '영수증' })}
                                                />
                                            )}
                                            {/* 음식 사진들 */}
                                            {selectedReview.food_photos?.map((photo, idx) => (
                                                <ReviewPhotoItem
                                                    key={idx}
                                                    src={getReviewPhotoUrl(photo)}
                                                    alt={`음식 ${idx + 1}`}
                                                    label={`음식 ${idx + 1}`}
                                                    labelVariant="food"
                                                    onClick={() => setPreviewImage({ url: getReviewPhotoUrl(photo), alt: `음식 ${idx + 1}` })}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* OCR 결과 */}
                                {selectedReview.verification_photo && (
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium flex items-center gap-1">
                                            <ScanSearch className="h-4 w-4" /> OCR 분석 결과
                                            {selectedReview.ocr_processed_at && (
                                                <span className="text-xs text-muted-foreground font-normal ml-1">
                                                    {new Date(selectedReview.ocr_processed_at).toLocaleDateString('ko-KR')}
                                                </span>
                                            )}
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleRerunOcr(selectedReview.id)}
                                                disabled={ocrRerunningIds.has(selectedReview.id)}
                                                className="ml-auto gap-1 h-6 text-xs"
                                            >
                                                {ocrRerunningIds.has(selectedReview.id) ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    <RefreshCw className="h-3 w-3" />
                                                )}
                                                {ocrRerunningIds.has(selectedReview.id) ? '처리중...' : 'OCR 다시 실행'}
                                            </Button>
                                        </Label>

                                        {/* OCR 재실행 중 상태 표시 */}
                                        {ocrRerunningIds.has(selectedReview.id) && !selectedReview.ocr_processed_at && (
                                            <Card className="p-3 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
                                                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    <span>OCR 처리 중입니다. 약 30~40초 후 결과가 자동으로 반영됩니다.</span>
                                                </div>
                                            </Card>
                                        )}

                                        {/* OCR 미처리 상태 */}
                                        {!ocrRerunningIds.has(selectedReview.id) && !selectedReview.ocr_processed_at && (
                                            <Card className="p-3 bg-muted/50">
                                                <span className="text-sm text-muted-foreground">OCR 미처리 - 위 버튼을 눌러 OCR을 실행하세요</span>
                                            </Card>
                                        )}

                                        {/* OCR 처리 완료 상태 */}
                                        {selectedReview.ocr_processed_at && (
                                            <>
                                                {selectedReview.receipt_data ? (
                                                    selectedReview.receipt_data.error ? (
                                                        <Card className="p-3 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800">
                                                            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
                                                                <AlertCircle className="h-4 w-4" />
                                                                <span>OCR 오류: {selectedReview.receipt_data.error}</span>
                                                            </div>
                                                        </Card>
                                                    ) : (
                                                        <Card className="p-3 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                                                            <div className="space-y-2 text-sm">
                                                                {selectedReview.receipt_data.store_name && (
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-muted-foreground">가게명</span>
                                                                        <span className="font-medium">{selectedReview.receipt_data.store_name}</span>
                                                                    </div>
                                                                )}
                                                                {selectedReview.receipt_data.date && (
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-muted-foreground">날짜</span>
                                                                        <span>{selectedReview.receipt_data.date}</span>
                                                                    </div>
                                                                )}
                                                                {selectedReview.receipt_data.time && (
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-muted-foreground">시간</span>
                                                                        <span>{selectedReview.receipt_data.time}</span>
                                                                    </div>
                                                                )}
                                                                {selectedReview.receipt_data.total_amount && (
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-muted-foreground">결제 금액</span>
                                                                        <span className="font-medium text-green-600">
                                                                            {selectedReview.receipt_data.total_amount.toLocaleString()}원
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                {selectedReview.receipt_data.items && selectedReview.receipt_data.items.length > 0 && (
                                                                    <div className="pt-2 border-t">
                                                                        <span className="text-muted-foreground text-xs">주문 항목</span>
                                                                        <ul className="mt-1 text-xs space-y-0.5">
                                                                            {selectedReview.receipt_data.items.map((item, idx) => {
                                                                                // 문자열 또는 객체 형식 모두 지원
                                                                                const isObject = typeof item === 'object' && item !== null;
                                                                                const name = isObject ? item.name : item;
                                                                                const price = isObject ? item.price : null;
                                                                                return (
                                                                                    <li key={idx} className="text-muted-foreground flex justify-between">
                                                                                        <span>• {name}</span>
                                                                                        {price !== null && price !== undefined && (
                                                                                            <span className="text-primary">{price.toLocaleString()}원</span>
                                                                                        )}
                                                                                    </li>
                                                                                );
                                                                            })}
                                                                        </ul>
                                                                    </div>
                                                                )}
                                                                {selectedReview.receipt_data.confidence !== undefined && (
                                                                    <div className="flex items-center justify-between pt-2 border-t">
                                                                        <span className="text-muted-foreground text-xs">OCR 신뢰도</span>
                                                                        <Badge
                                                                            variant={selectedReview.receipt_data.confidence >= 0.8 ? 'default' : 'secondary'}
                                                                            className="text-xs"
                                                                        >
                                                                            {(selectedReview.receipt_data.confidence * 100).toFixed(0)}%
                                                                        </Badge>
                                                                    </div>
                                                                )}
                                                                {/* 중복 영수증 경고 */}
                                                                {selectedReview.is_duplicate && selectedReview.receipt_data.duplicate_of && (
                                                                    <div className="pt-2 border-t">
                                                                        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                                                                            <AlertTriangle className="h-4 w-4" />
                                                                            <span className="text-sm font-medium">중복 영수증 감지!</span>
                                                                        </div>
                                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                                            원본 리뷰 ID: <code className="bg-muted px-1 rounded">{selectedReview.receipt_data.duplicate_of.slice(0, 8)}...</code>
                                                                        </p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </Card>
                                                    )
                                                ) : (
                                                    <Card className="p-3 bg-muted/50">
                                                        <span className="text-sm text-muted-foreground">OCR 데이터 없음</span>
                                                    </Card>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label>관리자 메모{reviewAction === 'reject' && ' (필수)'}</Label>
                                    <Textarea
                                        value={reviewAdminNote}
                                        onChange={(e) => setReviewAdminNote(e.target.value)}
                                        placeholder={reviewAction === 'approve' ? '승인 사유 (선택)' : '거부 사유를 입력해주세요'}
                                        rows={3}
                                    />
                                </div>

                                <DialogFooter className="gap-2 sm:gap-0">
                                    <Button variant="outline" onClick={() => setShowReviewModal(false)}>
                                        취소
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        onClick={() => {
                                            setReviewAction('reject');
                                            if (reviewAdminNote.trim()) {
                                                handleConfirmReviewAction();
                                            } else {
                                                toast.error('거부 시 관리자 메모를 입력해주세요');
                                            }
                                        }}
                                        disabled={!reviewAdminNote.trim()}
                                    >
                                        거부
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            setReviewAction('approve');
                                            setTimeout(() => handleConfirmReviewAction(), 0);
                                        }}
                                        disabled={selectedReview?.is_duplicate}
                                        className="bg-green-500 hover:bg-green-600 disabled:opacity-50"
                                    >
                                        {selectedReview?.is_duplicate ? '중복 - 승인불가' : '승인'}
                                    </Button>
                                </DialogFooter>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>

                {/* 이미지 확대 모달 */}
                <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
                    <DialogContent className="max-w-fit max-h-[90vh] p-0 border-none bg-transparent shadow-none [&>button]:hidden">
                        <DialogHeader className="sr-only">
                            <DialogTitle>{previewImage?.alt}</DialogTitle>
                        </DialogHeader>
                        {previewImage && (
                            <div className="relative">
                                <img
                                    src={previewImage.url}
                                    alt={previewImage.alt}
                                    className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                                />
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    className="absolute top-2 right-2 h-8 w-8 rounded-full bg-white/90 hover:bg-white shadow-md"
                                    onClick={() => setPreviewImage(null)}
                                >
                                    <X className="h-4 w-4 text-gray-700" />
                                </Button>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </TooltipProvider>
    );
}
