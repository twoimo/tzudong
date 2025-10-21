import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
    category: string;
    youtube_link: string;
    description: string | null;
    status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    created_at: string;
    reviewed_at: string | null;
    reviewed_by_admin_id: string | null;
    approved_restaurant_id: string | null;
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
        ai_rating: "",
        jjyang_visit_count: "1",
    });

    // 모든 제보 조회 (관리자만)
    const { data: submissions = [], isLoading, error: queryError } = useQuery({
        queryKey: ['admin-submissions'],
        queryFn: async () => {
            console.log('🔍 제보 데이터 조회 시작...');

            // 1. 제보 데이터 가져오기
            const { data: submissionsData, error: submissionsError } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .order('created_at', { ascending: false });

            if (submissionsError) {
                console.error('❌ 제보 조회 실패:', submissionsError);
                throw submissionsError;
            }

            if (!submissionsData || submissionsData.length === 0) {
                console.log('✅ 제보 데이터 없음');
                return [];
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
            const result = submissionsData.map(submission => ({
                ...submission,
                profiles: {
                    nickname: profilesMap.get(submission.user_id) || '알 수 없음'
                }
            })) as SubmissionWithUser[];

            console.log('✅ 제보 데이터 조회 성공:', result.length, '개');
            return result;
        },
        enabled: !!user && !!isAdmin,
    });

    // 제보 승인 (레스토랑 테이블에 추가)
    const approveMutation = useMutation({
        mutationFn: async ({ submissionId, submission }: { submissionId: string; submission: SubmissionWithUser }) => {
            if (!user) throw new Error('로그인이 필요합니다');

            const lat = parseFloat(approvalData.lat);
            const lng = parseFloat(approvalData.lng);

            if (isNaN(lat) || isNaN(lng)) {
                throw new Error('올바른 좌표를 입력해주세요');
            }

            // 1. 레스토랑 테이블에 추가
            const { data: restaurant, error: restaurantError } = await supabase
                .from('restaurants')
                .insert({
                    name: submission.restaurant_name,
                    address: submission.address,
                    phone: submission.phone,
                    category: submission.category,
                    youtube_link: submission.youtube_link,
                    description: submission.description,
                    lat,
                    lng,
                    ai_rating: approvalData.ai_rating ? parseFloat(approvalData.ai_rating) : null,
                    jjyang_visit_count: parseInt(approvalData.jjyang_visit_count) || 1,
                })
                .select()
                .single();

            if (restaurantError) throw restaurantError;

            // 2. 제보 상태 업데이트
            const { error: updateError } = await supabase
                .from('restaurant_submissions')
                .update({
                    status: 'approved',
                    reviewed_by_admin_id: user.id,
                    reviewed_at: new Date().toISOString(),
                    approved_restaurant_id: restaurant.id,
                })
                .eq('id', submissionId);

            if (updateError) throw updateError;
        },
        onSuccess: () => {
            toast.success('제보가 승인되었습니다!');
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
            ai_rating: "",
            jjyang_visit_count: "1",
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
            const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
            const response = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
                    address
                )}&key=${apiKey}`
            );
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                const location = data.results[0].geometry.location;
                setApprovalData({
                    ...approvalData,
                    lat: String(location.lat),
                    lng: String(location.lng),
                });
                toast.success("좌표가 자동으로 입력되었습니다");
            } else {
                toast.error("주소에서 좌표를 찾을 수 없습니다");
            }
        } catch (error) {
            console.error("Geocoding error:", error);
            toast.error("주소 검색 중 오류가 발생했습니다");
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
                        맛집 제보 관리
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
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            </div>
                        ) : pendingSubmissions.length === 0 ? (
                            <Card className="p-12 text-center">
                                <div className="text-6xl mb-4">✅</div>
                                <h3 className="text-xl font-semibold mb-2">검토 대기 중인 제보가 없습니다</h3>
                                <p className="text-muted-foreground">모든 제보를 처리했습니다!</p>
                            </Card>
                        ) : (
                            pendingSubmissions.map((submission) => (
                                <SubmissionCard
                                    key={submission.id}
                                    submission={submission}
                                    onApprove={() => openReviewModal(submission, 'approve')}
                                    onReject={() => openReviewModal(submission, 'reject')}
                                    onDelete={() => handleDelete(submission.id)}
                                />
                            ))
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
                                            주소로 좌표 자동 입력
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="lat">위도 *</Label>
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
                                            <Label htmlFor="lng">경도 *</Label>
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

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="ai_rating">AI 별점 (1-10)</Label>
                                            <Input
                                                id="ai_rating"
                                                type="number"
                                                step="0.1"
                                                min="1"
                                                max="10"
                                                value={approvalData.ai_rating}
                                                onChange={(e) => setApprovalData({ ...approvalData, ai_rating: e.target.value })}
                                                placeholder="8.5"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="jjyang_visit_count">쯔양 방문횟수</Label>
                                            <Input
                                                id="jjyang_visit_count"
                                                type="number"
                                                min="1"
                                                value={approvalData.jjyang_visit_count}
                                                onChange={(e) => setApprovalData({ ...approvalData, jjyang_visit_count: e.target.value })}
                                                placeholder="1"
                                            />
                                        </div>
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
                            <Badge variant="outline">{submission.category}</Badge>
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

