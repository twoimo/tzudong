import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createNewRestaurantNotification } from "@/contexts/NotificationContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    Clock,
    Trash2,
    Youtube,
    Shield,
    User,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface RestaurantSubmission {
    id: string;
    user_id: string;
    restaurant_name: string;
    address: string;
    phone: string | null;
    category: string[] | string; // 다중 카테고리 지원
    youtube_link: string;
    description: string | null;
    status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by_admin_id: string | null;
    approved_restaurant_id: string | null;
    submission_type?: 'new' | 'update';
    original_restaurant_id?: string;
    changes_requested?: any;
}

interface SubmissionWithUser extends RestaurantSubmission {
    profiles: {
        nickname: string;
    } | null;
}

export default function AdminSubmissionsPage() {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [selectedSubmission, setSelectedSubmission] = useState<SubmissionWithUser | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
    const [rejectionReason, setRejectionReason] = useState("");
    const [approvalData, setApprovalData] = useState({
        lat: "",
        lng: "",
    });

    // 모든 제보 조회 (관리자만) - 무한 스크롤 방식
    const {
        data: submissionsPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
        error: queryError
    } = useInfiniteQuery({
        queryKey: ['admin-submissions', isAdmin],
        queryFn: async ({ pageParam = 0 }) => {
            if (!user || !isAdmin) return { submissions: [], nextCursor: null };

            console.log('🔍 제보 데이터 조회 시작... 페이지:', pageParam);

            // 1. 제보 데이터 가져오기 (페이지별)
            const { data: submissionsData, error: submissionsError } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19); // 한 페이지당 20개씩

            if (submissionsError) {
                console.error('❌ 제보 조회 실패:', submissionsError);
                throw submissionsError;
            }

            if (!submissionsData || submissionsData.length === 0) {
                console.log('✅ 제보 데이터 없음');
                return { submissions: [], nextCursor: null };
            }

            // 2. user_id 목록 추출
            const userIds = [...new Set(submissionsData.map(s => s.user_id))];

            // 3. profiles 데이터 가져오기
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id, nickname')
                .in('user_id', userIds);

            // 4. Map으로 변환 (빠른 조회)
            const profilesMap = new Map(
                (profilesData || []).map(p => [p.user_id, p.nickname])
            );

            // 5. 데이터 매핑
            const submissions = submissionsData.map(submission => ({
                ...submission,
                profiles: {
                    nickname: profilesMap.get(submission.user_id) || '탈퇴한 사용자'
                }
            })) as SubmissionWithUser[];

            // 다음 페이지 커서 계산
            const nextCursor = submissionsData.length === 20 ? pageParam + 20 : null;

            console.log('✅ 제보 데이터 조회 성공:', submissions.length, '개 (다음 커서:', nextCursor, ')');
            return {
                submissions,
                nextCursor,
            };
        },
        getNextPageParam: (lastPage) => {
            if (!lastPage) return undefined;
            return lastPage.nextCursor ?? undefined;
        },
        initialPageParam: 0,
        enabled: !!user,
    });

    // 모든 페이지를 평탄화하여 하나의 배열로 만들기
    const submissions = submissionsPages?.pages.flatMap(page => page.submissions) || [];

    // 제보 무한 스크롤을 위한 Intersection Observer
    const loadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreSubmissions = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreSubmissions();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreSubmissions]);

    // 제보 승인 (레스토랑 테이블에 추가)
    const approveMutation = useMutation({
        mutationFn: async ({ submissionId, submission }: { submissionId: string; submission: SubmissionWithUser }) => {
            if (!user) throw new Error('로그인이 필요합니다');

            let restaurantId: string;

            // 수정 요청인지 확인 (컬럼이 존재하는 경우에만)
            const isUpdateRequest = submission.submission_type === 'update' && submission.original_restaurant_id;

            if (isUpdateRequest) {
                // 수정 요청: 기존 맛집 데이터 업데이트
                const lat = parseFloat(approvalData.lat);
                const lng = parseFloat(approvalData.lng);

                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error('올바른 좌표를 입력해주세요');
                }

                const { error: updateError } = await supabase
                    .from('restaurants')
                    .update({
                        name: submission.restaurant_name,
                        address: submission.address,
                        phone: submission.phone,
                        category: Array.isArray(submission.category) ? submission.category : [submission.category],
                        youtube_link: submission.youtube_link,
                        description: submission.description,
                        lat,
                        lng,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', submission.original_restaurant_id);

                if (updateError) throw updateError;
                restaurantId = submission.original_restaurant_id;
            } else {
                // 신규 제보: 새로운 맛집 생성
                const lat = parseFloat(approvalData.lat);
                const lng = parseFloat(approvalData.lng);

                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error('올바른 좌표를 입력해주세요');
                }

                const { data: restaurant, error: restaurantError } = await supabase
                    .from('restaurants')
                    .insert({
                        name: submission.restaurant_name,
                        address: submission.address,
                        phone: submission.phone,
                        category: Array.isArray(submission.category) ? submission.category : [submission.category],
                        youtube_link: submission.youtube_link,
                        description: submission.description,
                        lat,
                        lng,
                    })
                    .select()
                    .single();

                if (restaurantError) throw restaurantError;
                restaurantId = restaurant.id;
            }

            // 제보 상태 업데이트
            const { error: updateError } = await supabase
                .from('restaurant_submissions')
                .update({
                    status: 'approved',
                    reviewed_by_admin_id: user.id,
                    reviewed_at: new Date().toISOString(),
                    approved_restaurant_id: restaurantId,
                })
                .eq('id', submissionId);

            if (updateError) throw updateError;
        },
        onSuccess: (_, { submission }) => {
            toast.success('제보가 승인되었습니다!');

            // 신규 맛집 등록 알림 생성 (모든 사용자에게)
            createNewRestaurantNotification(submission.restaurant_name, submission.address, {
                category: submission.category,
                submissionId: submission.id
            });

            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });
            setIsReviewModalOpen(false);
            resetApprovalData();
        },
        onError: (error: any) => {
            toast.error(error.message || '승인에 실패했습니다');
        },
    });

    // 제보 거부
    const rejectMutation = useMutation({
        mutationFn: async (submissionId: string) => {
            if (!user) throw new Error('로그인이 필요합니다');
            if (!rejectionReason.trim()) throw new Error('거부 사유를 입력해주세요');

            const { error } = await supabase
                .from('restaurant_submissions')
                .update({
                    status: 'rejected',
                    rejection_reason: rejectionReason.trim(),
                    reviewed_by_admin_id: user.id,
                    reviewed_at: new Date().toISOString(),
                })
                .eq('id', submissionId);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('제보가 거부되었습니다');
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            setIsReviewModalOpen(false);
            setRejectionReason("");
        },
        onError: (error: any) => {
            toast.error(error.message || '거부에 실패했습니다');
        },
    });

    // 제보 삭제
    const deleteMutation = useMutation({
        mutationFn: async (submissionId: string) => {
            const { error } = await supabase
                .from('restaurant_submissions')
                .delete()
                .eq('id', submissionId);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('제보가 삭제되었습니다');
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
        },
        onError: (error: any) => {
            toast.error(error.message || '삭제에 실패했습니다');
        },
    });

    const resetApprovalData = () => {
        setApprovalData({
            lat: "",
            lng: "",
        });
    };

    const openReviewModal = (submission: SubmissionWithUser, action: 'approve' | 'reject') => {
        setSelectedSubmission(submission);
        setReviewAction(action);
        setIsReviewModalOpen(true);
    };

    const handleReview = () => {
        if (!selectedSubmission) return;

        if (reviewAction === 'approve') {
            approveMutation.mutate({ submissionId: selectedSubmission.id, submission: selectedSubmission });
        } else if (reviewAction === 'reject') {
            rejectMutation.mutate(selectedSubmission.id);
        }
    };

    const handleDelete = (submissionId: string) => {
        if (confirm('정말 이 제보를 삭제하시겠습니까?')) {
            deleteMutation.mutate(submissionId);
        }
    };

    const geocodeAddress = async (address: string) => {
        try {
            toast.info("주소로 좌표를 검색 중...");

            // 외부 프록시 서버를 통해 네이버 Geocoding API 호출
            const response = await fetch(
                `http://www.moamodu.com/develop/naver_map_new_proxy.php?query=${encodeURIComponent(address)}`
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            console.log('Geocoding 응답:', data);

            if (data.status === 'OK' && data.addresses && data.addresses.length > 0) {
                const item = data.addresses[0];
                const lat = item.y; // 위도
                const lng = item.x; // 경도

                setApprovalData({
                    ...approvalData,
                    lat: String(lat),
                    lng: String(lng),
                });
                toast.success(`✅ 좌표가 입력되었습니다!\n📍 위도: ${lat}\n📍 경도: ${lng}`);
            } else {
                console.warn('Geocoding 결과 없음:', data);
                toast.error("주소에서 좌표를 찾을 수 없습니다. 더 자세한 주소를 입력해주세요.");
            }
        } catch (error) {
            console.error("Geocoding error:", error);
            toast.error("주소 검색 중 오류가 발생했습니다. 수동으로 좌표를 입력해주세요.");
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending':
                return (
                    <Badge variant="secondary" className="gap-1">
                        <Clock className="h-3 w-3" />
                        검토 대기 중
                    </Badge>
                );
            case 'approved':
                return (
                    <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        승인됨
                    </Badge>
                );
            case 'rejected':
                return (
                    <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        거부됨
                    </Badge>
                );
            default:
                return null;
        }
    };

    if (!user || !isAdmin) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="p-8 max-w-md text-center">
                    <div className="text-6xl mb-4">🔒</div>
                    <h2 className="text-2xl font-bold mb-2">접근 권한 없음</h2>
                    <p className="text-muted-foreground">
                        이 페이지는 관리자만 접근할 수 있습니다.
                    </p>
                </Card>
            </div>
        );
    }

    const pendingSubmissions = submissions.filter(s => s.status === 'pending');
    const approvedSubmissions = submissions.filter(s => s.status === 'approved');
    const rejectedSubmissions = submissions.filter(s => s.status === 'rejected');

    console.log('📊 제보 통계:', {
        total: submissions.length,
        pending: pendingSubmissions.length,
        approved: approvedSubmissions.length,
        rejected: rejectedSubmissions.length,
        isAdmin: isAdmin,
        userId: user?.id,
    });

    return (
        <div className="flex flex-col h-full bg-background">
            {/* 헤더 */}
            <div className="border-b border-border bg-card p-6">
                <div className="mb-4">
                    <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent flex items-center gap-2">
                        <Shield className="h-6 w-6 text-primary" />
                        관리자 제보 관리
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        쯔양 팬들이 제보한 맛집을 검토하고 승인/거부할 수 있습니다
                    </p>
                    {queryError && (
                        <p className="text-sm text-red-500 mt-2">
                            ⚠️ 데이터 로드 실패: {(queryError as Error).message}
                        </p>
                    )}
                </div>

                {/* 통계 카드 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">검토 대기</p>
                                <p className="text-2xl font-bold">{pendingSubmissions.length}</p>
                            </div>
                            <Clock className="h-8 w-8 text-yellow-500" />
                        </div>
                    </Card>
                    <Card className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">승인됨</p>
                                <p className="text-2xl font-bold">{approvedSubmissions.length}</p>
                            </div>
                            <CheckCircle2 className="h-8 w-8 text-green-500" />
                        </div>
                    </Card>
                    <Card className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-muted-foreground">거부됨</p>
                                <p className="text-2xl font-bold">{rejectedSubmissions.length}</p>
                            </div>
                            <XCircle className="h-8 w-8 text-red-500" />
                        </div>
                    </Card>
                </div>
            </div>

            {/* 제보 목록 */}
            <div className="flex-1 overflow-auto p-6">
                <Tabs defaultValue="pending" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="pending">
                            검토 대기 ({pendingSubmissions.length})
                        </TabsTrigger>
                        <TabsTrigger value="approved">
                            승인됨 ({approvedSubmissions.length})
                        </TabsTrigger>
                        <TabsTrigger value="rejected">
                            거부됨 ({rejectedSubmissions.length})
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pending" className="space-y-4 mt-4">
                        {isLoading ? (
                            // Loading skeleton
                            <div className="space-y-4">
                                {Array.from({ length: 3 }).map((_, index) => (
                                    <Card key={index} className="p-4">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex-1 space-y-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-6 bg-muted rounded animate-pulse w-48"></div>
                                                    <div className="h-5 bg-muted rounded animate-pulse w-16"></div>
                                                    <div className="h-5 bg-muted rounded animate-pulse w-20"></div>
                                                    <div className="h-5 bg-muted rounded animate-pulse w-24"></div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="h-4 bg-muted rounded animate-pulse w-56"></div>
                                                    <div className="h-4 bg-muted rounded animate-pulse w-40"></div>
                                                </div>
                                                <div className="flex items-center gap-4 text-sm">
                                                    <div className="h-4 bg-muted rounded animate-pulse w-28"></div>
                                                    <div className="h-4 bg-muted rounded animate-pulse w-24"></div>
                                                </div>
                                                <div className="h-16 bg-muted rounded animate-pulse w-full"></div>
                                            </div>
                                            <div className="flex gap-2 ml-4">
                                                <div className="h-9 bg-muted rounded animate-pulse w-20"></div>
                                                <div className="h-9 bg-muted rounded animate-pulse w-20"></div>
                                                <div className="h-9 bg-muted rounded animate-pulse w-16"></div>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        ) : pendingSubmissions.length === 0 ? (
                            <Card className="p-12 text-center">
                                <div className="text-6xl mb-4">✅</div>
                                <h3 className="text-xl font-semibold mb-2">검토 대기 중인 제보가 없습니다</h3>
                                <p className="text-muted-foreground">모든 제보를 처리했습니다!</p>
                            </Card>
                        ) : (
                            <>
                                {pendingSubmissions.map((submission, index) => (
                                    <SubmissionCard
                                        key={`${submission.id}-${index}`}
                                        ref={index === pendingSubmissions.length - 1 ? loadMoreRef : null}
                                        submission={submission}
                                        onApprove={() => openReviewModal(submission, 'approve')}
                                        onReject={() => openReviewModal(submission, 'reject')}
                                        onDelete={() => handleDelete(submission.id)}
                                    />
                                ))}

                                {/* 추가 로딩 표시 */}
                                {isFetchingNextPage && (
                                    <div className="text-center py-8">
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full"></div>
                                            <span className="text-sm text-muted-foreground">더 많은 제보를 불러오는 중...</span>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="approved" className="space-y-4 mt-4">
                        {approvedSubmissions.length === 0 ? (
                            <Card className="p-12 text-center">
                                <div className="text-6xl mb-4">📋</div>
                                <h3 className="text-xl font-semibold mb-2">승인된 제보가 없습니다</h3>
                            </Card>
                        ) : (
                            approvedSubmissions.map((submission) => (
                                <SubmissionCard
                                    key={submission.id}
                                    submission={submission}
                                    onDelete={() => handleDelete(submission.id)}
                                />
                            ))
                        )}
                    </TabsContent>

                    <TabsContent value="rejected" className="space-y-4 mt-4">
                        {rejectedSubmissions.length === 0 ? (
                            <Card className="p-12 text-center">
                                <div className="text-6xl mb-4">📋</div>
                                <h3 className="text-xl font-semibold mb-2">거부된 제보가 없습니다</h3>
                            </Card>
                        ) : (
                            rejectedSubmissions.map((submission) => (
                                <SubmissionCard
                                    key={submission.id}
                                    submission={submission}
                                    onDelete={() => handleDelete(submission.id)}
                                />
                            ))
                        )}
                    </TabsContent>
                </Tabs>
            </div>

            {/* 검토 모달 */}
            <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-2xl">
                            {reviewAction === 'approve' ? '✅ 제보 승인' : '❌ 제보 거부'}
                        </DialogTitle>
                        <DialogDescription>
                            {reviewAction === 'approve'
                                ? '레스토랑 정보를 확인하고 지도에 추가합니다'
                                : '제보를 거부하는 사유를 입력해주세요'}
                        </DialogDescription>
                    </DialogHeader>

                    {selectedSubmission && (
                        <div className="space-y-4 mt-4">
                            <Card className="p-4 bg-muted/50">
                                <h3 className="font-semibold mb-2">제보 정보</h3>
                                <div className="space-y-1 text-sm">
                                    <p><strong>맛집 이름:</strong> {selectedSubmission.restaurant_name}</p>
                                    <p><strong>카테고리:</strong> {selectedSubmission.category}</p>
                                    <p><strong>주소:</strong> {selectedSubmission.address}</p>
                                    {selectedSubmission.phone && (
                                        <p><strong>전화번호:</strong> {selectedSubmission.phone}</p>
                                    )}
                                    {selectedSubmission.description && (
                                        <p><strong>설명:</strong> {selectedSubmission.description}</p>
                                    )}
                                    <p><strong>제보자:</strong> {selectedSubmission.profiles?.nickname || '알 수 없음'}</p>
                                    <a
                                        href={selectedSubmission.youtube_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline flex items-center gap-1"
                                    >
                                        <Youtube className="h-4 w-4" />
                                        유튜브 영상 보기
                                    </a>
                                </div>
                            </Card>

                            {reviewAction === 'approve' ? (
                                <div className="space-y-4">
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => geocodeAddress(selectedSubmission.address)}
                                            className="flex-1"
                                        >
                                            📍 주소로 좌표 자동 입력
                                        </Button>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between mb-2">
                                            <Label>좌표 입력 *</Label>
                                            <a
                                                href={`https://map.naver.com/p/search/${encodeURIComponent(selectedSubmission.address)}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-500 hover:underline"
                                            >
                                                네이버 지도에서 확인 →
                                            </a>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="lat">위도</Label>
                                                <Input
                                                    id="lat"
                                                    type="number"
                                                    step="0.00000001"
                                                    value={approvalData.lat}
                                                    onChange={(e) => setApprovalData({ ...approvalData, lat: e.target.value })}
                                                    placeholder="37.5665"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <Label htmlFor="lng">경도</Label>
                                                <Input
                                                    id="lng"
                                                    type="number"
                                                    step="0.00000001"
                                                    value={approvalData.lng}
                                                    onChange={(e) => setApprovalData({ ...approvalData, lng: e.target.value })}
                                                    placeholder="126.9780"
                                                />
                                            </div>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            💡 위 버튼으로 자동 입력하거나, 네이버 지도에서 직접 확인하여 입력하세요
                                        </p>
                                    </div>

                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label htmlFor="rejection_reason">거부 사유 *</Label>
                                    <Textarea
                                        id="rejection_reason"
                                        value={rejectionReason}
                                        onChange={(e) => setRejectionReason(e.target.value)}
                                        placeholder="제보를 거부하는 사유를 입력해주세요..."
                                        rows={4}
                                    />
                                </div>
                            )}

                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setIsReviewModalOpen(false);
                                        setRejectionReason("");
                                        resetApprovalData();
                                    }}
                                    disabled={approveMutation.isPending || rejectMutation.isPending}
                                >
                                    취소
                                </Button>
                                <Button
                                    onClick={handleReview}
                                    disabled={approveMutation.isPending || rejectMutation.isPending}
                                    className={
                                        reviewAction === 'approve'
                                            ? 'bg-green-500 hover:bg-green-600'
                                            : 'bg-red-500 hover:bg-red-600'
                                    }
                                >
                                    {approveMutation.isPending || rejectMutation.isPending ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            처리 중...
                                        </>
                                    ) : reviewAction === 'approve' ? (
                                        '승인'
                                    ) : (
                                        '거부'
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

// 제보 카드 컴포넌트
function SubmissionCard({
    submission,
    onApprove,
    onReject,
    onDelete,
}: {
    submission: SubmissionWithUser;
    onApprove?: () => void;
    onReject?: () => void;
    onDelete: () => void;
}) {
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending':
                return (
                    <Badge variant="secondary" className="gap-1">
                        <Clock className="h-3 w-3" />
                        검토 대기 중
                    </Badge>
                );
            case 'approved':
                return (
                    <Badge className="bg-green-500 hover:bg-green-600 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        승인됨
                    </Badge>
                );
            case 'rejected':
                return (
                    <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        거부됨
                    </Badge>
                );
            default:
                return null;
        }
    };

    return (
        <Card className="p-4">
            <div className="space-y-3">
                <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-semibold">{submission.restaurant_name}</h3>
                            {getStatusBadge(submission.status)}
                            <div className="flex flex-wrap gap-1">
                                {Array.isArray(submission.category) ? (
                                    submission.category.map((cat, index) => (
                                        <Badge key={index} variant="outline" className="text-xs">{cat}</Badge>
                                    ))
                                ) : (
                                    <Badge variant="outline" className="text-xs">{submission.category}</Badge>
                                )}
                            </div>
                            <Badge variant={submission.original_restaurant_id ? 'secondary' : 'default'}>
                                {submission.original_restaurant_id ? '수정 요청' : '신규 제보'}
                            </Badge>
                        </div>

                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <User className="h-4 w-4" />
                            <span>{submission.profiles?.nickname || '알 수 없음'}</span>
                        </div>

                        <p className="text-sm text-muted-foreground">📍 {submission.address}</p>

                        {submission.phone && (
                            <p className="text-sm text-muted-foreground">📞 {submission.phone}</p>
                        )}

                        {submission.description && (
                            <p className="text-sm text-muted-foreground">💭 {submission.description}</p>
                        )}

                        <a
                            href={submission.youtube_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline flex items-center gap-1"
                        >
                            <Youtube className="h-4 w-4" />
                            유튜브 영상 보기
                        </a>

                        {/* 수정 요청 변경사항 표시 */}
                        {submission.original_restaurant_id && submission.changes_requested && (
                            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded">
                                <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                                    🔄 요청된 변경사항:
                                </p>
                                <div className="space-y-1">
                                    {Object.entries(submission.changes_requested).map(([field, change]: [string, any]) => (
                                        <div key={field} className="text-xs">
                                            <span className="font-medium text-blue-700 dark:text-blue-300">
                                                {field === 'restaurant_name' ? '이름' :
                                                    field === 'address' ? '주소' :
                                                        field === 'phone' ? '전화번호' :
                                                            (field === 'category' || field === 'categories') ? '카테고리' :
                                                                field === 'youtube_link' ? '유튜브 링크' :
                                                                    field === 'description' ? '설명' : field}:
                                            </span>
                                            <span className="text-muted-foreground ml-1">
                                                {(field === 'category' || field === 'categories') ? (
                                                    <>
                                                        {change.from ? (Array.isArray(change.from) ? change.from.join(', ') : change.from) : '(없음)'} →
                                                        {change.to ? (Array.isArray(change.to) ? change.to.join(', ') : change.to) : '(없음)'}
                                                    </>
                                                ) : (
                                                    <>
                                                        {change.from || '(없음)'} → {change.to || '(없음)'}
                                                    </>
                                                )}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {submission.status === 'rejected' && submission.rejection_reason && (
                            <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded">
                                <p className="text-sm text-red-700 dark:text-red-300">
                                    <strong>거부 사유:</strong> {submission.rejection_reason}
                                </p>
                            </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                            제보일: {new Date(submission.created_at).toLocaleString('ko-KR')}
                        </p>
                    </div>
                </div>

                {submission.status === 'pending' && (
                    <div className="flex gap-2">
                        <Button
                            onClick={onApprove}
                            className="flex-1 bg-green-500 hover:bg-green-600"
                        >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            승인
                        </Button>
                        <Button
                            onClick={onReject}
                            variant="destructive"
                            className="flex-1"
                        >
                            <XCircle className="mr-2 h-4 w-4" />
                            거부
                        </Button>
                        <Button
                            onClick={onDelete}
                            variant="outline"
                            size="icon"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                )}

                {submission.status !== 'pending' && (
                    <div className="flex justify-end">
                        <Button
                            onClick={onDelete}
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            삭제
                        </Button>
                    </div>
                )}
            </div>
        </Card>
    );
}

