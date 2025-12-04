'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect, forwardRef } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
    User,
    RefreshCw,
    X,
    ChevronRight,
    ChevronLeft,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface RestaurantSubmission {
    id: string;
    user_id: string;
    restaurant_name: string;
    address: string;
    phone: string | null;
    category: string[] | string;
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

interface AdminSubmissionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
}

export default function AdminSubmissionPanel({ isOpen, onClose, onToggleCollapse, isCollapsed }: AdminSubmissionPanelProps) {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [selectedSubmission, setSelectedSubmission] = useState<SubmissionWithUser | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
    const [rejectionReason, setRejectionReason] = useState("");
    const [approvalData, setApprovalData] = useState({
        lat: "",
        lng: "",
        road_address: "",
        jibun_address: "",
        english_address: "",
        address_elements: null as any,
    });

    const [geocoding, setGeocoding] = useState(false);
    const [geocodingResults, setGeocodingResults] = useState<Array<{
        road_address: string;
        jibun_address: string;
        english_address: string;
        address_elements: any;
        x: string;
        y: string;
    }>>([]);
    const [selectedGeocodingIndex, setSelectedGeocodingIndex] = useState<number | null>(null);

    const [showRestoreDialog, setShowRestoreDialog] = useState(false);
    const [deletedRecordInfo, setDeletedRecordInfo] = useState<{
        id: string;
        name: string;
        road_address: string;
    } | null>(null);
    const [pendingSubmissionData, setPendingSubmissionData] = useState<{
        submissionId: string;
        submission: SubmissionWithUser;
    } | null>(null);

    const {
        data: submissionsPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['admin-submissions', isAdmin],
        queryFn: async ({ pageParam = 0 }) => {
            if (!user || !isAdmin) return { submissions: [], nextCursor: null };

            const { data: submissionsData, error: submissionsError } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19);

            if (submissionsError) throw submissionsError;

            if (!submissionsData || submissionsData.length === 0) {
                return { submissions: [], nextCursor: null };
            }

            const typedSubmissionsData = submissionsData as any[];
            const userIds = [...new Set(typedSubmissionsData.map(s => s.user_id))];

            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id, nickname')
                .in('user_id', userIds);

            const typedProfilesData = (profilesData || []) as any[];
            const profilesMap = new Map(
                typedProfilesData.map(p => [p.user_id, p.nickname])
            );

            const submissions = typedSubmissionsData.map(submission => ({
                ...submission,
                profiles: {
                    nickname: profilesMap.get(submission.user_id) || '탈퇴한 사용자'
                }
            })) as SubmissionWithUser[];

            const nextCursor = submissionsData.length === 20 ? pageParam + 20 : null;

            return { submissions, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
        initialPageParam: 0,
        enabled: !!user && isOpen,
    });

    const submissions = submissionsPages?.pages.flatMap(page => page.submissions) || [];

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

    const approveMutation = useMutation({
        mutationFn: async ({ submissionId, submission }: { submissionId: string; submission: SubmissionWithUser }) => {
            if (!user) throw new Error('로그인이 필요합니다');

            let restaurantId: string;
            const isUpdateRequest = submission.submission_type === 'update' && submission.original_restaurant_id;

            if (isUpdateRequest) {
                const lat = parseFloat(approvalData.lat);
                const lng = parseFloat(approvalData.lng);

                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error('올바른 좌표를 입력해주세요');
                }

                const { error: updateError } = await (supabase
                    .from('restaurants') as any)
                    .update({
                        name: submission.restaurant_name,
                        road_address: submission.address,
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
                restaurantId = submission.original_restaurant_id!;
            } else {
                const { data: existingRestaurants, error: checkError } = await supabase
                    .from('restaurants')
                    .select('id, name, jibun_address, status')
                    .eq('name', submission.restaurant_name)
                    .eq('jibun_address', approvalData.jibun_address);

                if (checkError) throw checkError;

                const typedExistingRestaurants = (existingRestaurants || []) as any[];

                if (typedExistingRestaurants.length > 0) {
                    const deletedRecord = typedExistingRestaurants.find(r => r.status === 'deleted');
                    const activeRecord = typedExistingRestaurants.find(r => r.status !== 'deleted');

                    if (activeRecord) {
                        throw new Error(`이미 등록된 맛집입니다: "${submission.restaurant_name}" (${submission.address})`);
                    }

                    if (deletedRecord) {
                        throw new Error(`DELETED_RECORD_FOUND:${deletedRecord.id}`);
                    }
                }

                const lat = parseFloat(approvalData.lat);
                const lng = parseFloat(approvalData.lng);

                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error('올바른 좌표를 입력해주세요');
                }

                const { data: restaurant, error: restaurantError } = await (supabase
                    .from('restaurants') as any)
                    .insert({
                        name: submission.restaurant_name,
                        road_address: approvalData.road_address,
                        jibun_address: approvalData.jibun_address,
                        english_address: approvalData.english_address,
                        address_elements: approvalData.address_elements,
                        phone: submission.phone,
                        categories: Array.isArray(submission.category) ? submission.category : [submission.category],
                        youtube_link: submission.youtube_link,
                        description: submission.description,
                        lat,
                        lng,
                        geocoding_success: true,
                        status: 'approved',
                    })
                    .select()
                    .single();

                if (restaurantError) throw restaurantError;
                restaurantId = restaurant.id;
            }

            const { error: updateError } = await (supabase
                .from('restaurant_submissions') as any)
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
            createNewRestaurantNotification(submission.restaurant_name, submission.address, {
                category: submission.category,
                submissionId: submission.id
            });
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });
            setIsReviewModalOpen(false);
            resetApprovalData();
        },
        onError: (error: any, variables) => {
            if (error.message && error.message.startsWith('DELETED_RECORD_FOUND:')) {
                const deletedId = error.message.split(':')[1];
                setDeletedRecordInfo({
                    id: deletedId,
                    name: variables.submission.restaurant_name,
                    road_address: variables.submission.address,
                });
                setPendingSubmissionData({
                    submissionId: variables.submissionId,
                    submission: variables.submission,
                });
                setShowRestoreDialog(true);
                setIsReviewModalOpen(false);
            } else {
                toast.error(error.message || '승인에 실패했습니다');
            }
        },
    });

    const rejectMutation = useMutation({
        mutationFn: async (submissionId: string) => {
            if (!user) throw new Error('로그인이 필요합니다');
            if (!rejectionReason.trim()) throw new Error('거부 사유를 입력해주세요');

            const { error } = await (supabase
                .from('restaurant_submissions') as any)
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
            road_address: "",
            jibun_address: "",
            english_address: "",
            address_elements: null,
        });
        setGeocodingResults([]);
        setSelectedGeocodingIndex(null);
    };

    const extractCityDistrictGu = (address: string): string | null => {
        const regex = /(.*?[시도]\s+.*?[시군구])/;
        const match = address.match(regex);
        return match ? match[1] : null;
    };

    const removeDuplicateAddresses = (addresses: Array<{
        road_address: string;
        jibun_address: string;
        english_address: string;
        address_elements: any;
        x: string;
        y: string;
    }>) => {
        const seen = new Set<string>();
        return addresses.filter(addr => {
            if (seen.has(addr.jibun_address)) {
                return false;
            }
            seen.add(addr.jibun_address);
            return true;
        });
    };

    const geocodeAddressMultiple = async (name: string, address: string, limit: number = 3) => {
        try {
            const combinedQuery = `${name} ${address}`;
            const { data, error } = await supabase.functions.invoke('naver-geocode', {
                body: { query: combinedQuery, count: limit }
            });

            if (error) throw new Error(error.message);
            if (!data || !data.addresses || data.addresses.length === 0) return [];

            return data.addresses.slice(0, limit).map((addr: any) => ({
                road_address: addr.roadAddress,
                jibun_address: addr.jibunAddress,
                english_address: addr.englishAddress,
                address_elements: addr.addressElements,
                x: addr.x,
                y: addr.y,
            }));
        } catch (error: any) {
            console.error('지오코딩 에러:', error);
            return [];
        }
    };

    const handleReGeocode = async () => {
        if (!selectedSubmission) return;

        const trimmedName = selectedSubmission.restaurant_name.trim();
        const trimmedAddress = selectedSubmission.address.trim();

        if (!trimmedName || !trimmedAddress) {
            toast.error('맛집명과 주소가 필요합니다');
            return;
        }

        try {
            setGeocoding(true);
            setGeocodingResults([]);
            setSelectedGeocodingIndex(null);

            const fullAddressResults = await geocodeAddressMultiple(trimmedName, trimmedAddress, 3);
            const shortAddress = extractCityDistrictGu(trimmedAddress);
            const shortAddressResults = shortAddress
                ? await geocodeAddressMultiple(trimmedName, shortAddress, 3)
                : [];

            const allResults = [...fullAddressResults, ...shortAddressResults];
            const uniqueResults = removeDuplicateAddresses(allResults);

            if (uniqueResults.length > 0) {
                setGeocodingResults(uniqueResults);
                toast.success(`${uniqueResults.length}개의 주소 후보를 찾았습니다.`);
            } else {
                toast.error('주소를 찾을 수 없습니다.');
            }
        } catch (error: any) {
            toast.error(error.message || '지오코딩에 실패했습니다');
        } finally {
            setGeocoding(false);
        }
    };

    const handleSelectGeocodingResult = (index: number) => {
        setSelectedGeocodingIndex(index);
        const selected = geocodingResults[index];
        setApprovalData({
            lat: selected.y,
            lng: selected.x,
            road_address: selected.road_address,
            jibun_address: selected.jibun_address,
            english_address: selected.english_address,
            address_elements: selected.address_elements,
        });
    };

    const handleRestoreAndUpdate = async () => {
        if (!deletedRecordInfo || !pendingSubmissionData || !user) return;

        try {
            const { submission, submissionId } = pendingSubmissionData;
            const lat = parseFloat(approvalData.lat);
            const lng = parseFloat(approvalData.lng);

            if (isNaN(lat) || isNaN(lng)) {
                toast.error('올바른 좌표를 입력해주세요');
                return;
            }

            const { error: updateError } = await (supabase
                .from('restaurants') as any)
                .update({
                    name: submission.restaurant_name,
                    road_address: approvalData.road_address,
                    jibun_address: approvalData.jibun_address,
                    english_address: approvalData.english_address,
                    address_elements: approvalData.address_elements,
                    phone: submission.phone,
                    categories: Array.isArray(submission.category) ? submission.category : [submission.category],
                    youtube_link: submission.youtube_link,
                    description: submission.description,
                    lat,
                    lng,
                    geocoding_success: true,
                    status: 'approved',
                    updated_at: new Date().toISOString(),
                    updated_by_admin_id: user.id,
                })
                .eq('id', deletedRecordInfo.id);

            if (updateError) throw updateError;

            const { error: submissionError } = await (supabase
                .from('restaurant_submissions') as any)
                .update({
                    status: 'approved',
                    reviewed_by_admin_id: user.id,
                    reviewed_at: new Date().toISOString(),
                    approved_restaurant_id: deletedRecordInfo.id,
                })
                .eq('id', submissionId);

            if (submissionError) throw submissionError;

            toast.success('삭제된 레코드가 복원되었습니다!');
            createNewRestaurantNotification(submission.restaurant_name, submission.address, {
                category: submission.category,
                submissionId: submission.id
            });

            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });

            setShowRestoreDialog(false);
            setDeletedRecordInfo(null);
            setPendingSubmissionData(null);
            resetApprovalData();
        } catch (error: any) {
            toast.error(error.message || '복원에 실패했습니다');
        }
    };

    const handleCreateNew = async () => {
        if (!pendingSubmissionData || !user) return;

        try {
            const { submission, submissionId } = pendingSubmissionData;
            const lat = parseFloat(approvalData.lat);
            const lng = parseFloat(approvalData.lng);

            if (isNaN(lat) || isNaN(lng)) {
                toast.error('올바른 좌표를 입력해주세요');
                return;
            }

            const { data: restaurant, error: restaurantError } = await (supabase
                .from('restaurants') as any)
                .insert({
                    name: submission.restaurant_name,
                    road_address: approvalData.road_address,
                    jibun_address: approvalData.jibun_address,
                    english_address: approvalData.english_address,
                    address_elements: approvalData.address_elements,
                    phone: submission.phone,
                    categories: Array.isArray(submission.category) ? submission.category : [submission.category],
                    youtube_link: submission.youtube_link,
                    description: submission.description,
                    lat,
                    lng,
                    geocoding_success: true,
                    status: 'approved',
                })
                .select()
                .single();

            if (restaurantError) throw restaurantError;

            const { error: submissionError } = await (supabase
                .from('restaurant_submissions') as any)
                .update({
                    status: 'approved',
                    reviewed_by_admin_id: user.id,
                    reviewed_at: new Date().toISOString(),
                    approved_restaurant_id: restaurant.id,
                })
                .eq('id', submissionId);

            if (submissionError) throw submissionError;

            toast.success('새로운 맛집이 생성되었습니다!');
            createNewRestaurantNotification(submission.restaurant_name, submission.address, {
                category: submission.category,
                submissionId: submission.id
            });

            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });

            setShowRestoreDialog(false);
            setDeletedRecordInfo(null);
            setPendingSubmissionData(null);
            resetApprovalData();
        } catch (error: any) {
            toast.error(error.message || '맛집 생성에 실패했습니다');
        }
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

    const pendingSubmissions = submissions.filter(s => s.status === 'pending');
    const approvedSubmissions = submissions.filter(s => s.status === 'approved');
    const rejectedSubmissions = submissions.filter(s => s.status === 'rejected');

    if (!user || !isAdmin) {
        return (
            <div className="h-full flex flex-col bg-background">
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-lg font-bold">제보관리</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-5 w-5" />
                    </Button>
                </div>
                <div className="flex-1 flex items-center justify-center p-8">
                    <Card className="p-8 text-center">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-semibold mb-2">접근 권한 없음</h3>
                        <p className="text-sm text-muted-foreground">관리자만 접근할 수 있습니다.</p>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background border-l border-border relative">
            {/* 플로팅 접기/펼치기 버튼 - 패널 좌측 가장자리 */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                >
                    {!isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    )}
                </button>
            )}

            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                <div>
                    <h2 className="text-lg font-bold">제보관리</h2>
                    <p className="text-sm text-muted-foreground">맛집 제보 승인/거부</p>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-5 w-5" />
                </Button>
            </div>

            {/* 통계 */}
            <div className="grid grid-cols-3 gap-2 p-3 border-b border-border">
                <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded">
                    <p className="text-xs text-muted-foreground">대기</p>
                    <p className="text-lg font-bold">{pendingSubmissions.length}</p>
                </div>
                <div className="text-center p-2 bg-green-50 dark:bg-green-950/20 rounded">
                    <p className="text-xs text-muted-foreground">승인</p>
                    <p className="text-lg font-bold">{approvedSubmissions.length}</p>
                </div>
                <div className="text-center p-2 bg-red-50 dark:bg-red-950/20 rounded">
                    <p className="text-xs text-muted-foreground">거부</p>
                    <p className="text-lg font-bold">{rejectedSubmissions.length}</p>
                </div>
            </div>

            {/* 탭 및 목록 */}
            <div className="flex-1 overflow-auto p-3">
                <Tabs defaultValue="pending" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-3">
                        <TabsTrigger value="pending" className="text-xs">
                            대기 ({pendingSubmissions.length})
                        </TabsTrigger>
                        <TabsTrigger value="approved" className="text-xs">
                            승인 ({approvedSubmissions.length})
                        </TabsTrigger>
                        <TabsTrigger value="rejected" className="text-xs">
                            거부 ({rejectedSubmissions.length})
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pending" className="space-y-2">
                        {isLoading ? (
                            <div className="space-y-2">
                                {[1, 2, 3].map(i => (
                                    <Card key={i} className="p-3">
                                        <div className="h-4 bg-muted rounded animate-pulse w-32 mb-2" />
                                        <div className="h-3 bg-muted rounded animate-pulse w-48" />
                                    </Card>
                                ))}
                            </div>
                        ) : pendingSubmissions.length === 0 ? (
                            <Card className="p-6 text-center">
                                <div className="text-3xl mb-2">✅</div>
                                <p className="text-sm text-muted-foreground">대기 중인 제보가 없습니다</p>
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
                                {isFetchingNextPage && (
                                    <div className="text-center py-4">
                                        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                                    </div>
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="approved" className="space-y-2">
                        {approvedSubmissions.length === 0 ? (
                            <Card className="p-6 text-center">
                                <div className="text-3xl mb-2">📋</div>
                                <p className="text-sm text-muted-foreground">승인된 제보가 없습니다</p>
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

                    <TabsContent value="rejected" className="space-y-2">
                        {rejectedSubmissions.length === 0 ? (
                            <Card className="p-6 text-center">
                                <div className="text-3xl mb-2">📋</div>
                                <p className="text-sm text-muted-foreground">거부된 제보가 없습니다</p>
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
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {reviewAction === 'approve' ? '✅ 제보 승인' : '❌ 제보 거부'}
                        </DialogTitle>
                        <DialogDescription>
                            {reviewAction === 'approve'
                                ? '레스토랑 정보를 확인하고 등록합니다'
                                : '거부 사유를 입력해주세요'}
                        </DialogDescription>
                    </DialogHeader>

                    {selectedSubmission && (
                        <div className="space-y-4 mt-4">
                            <Card className="p-3 bg-muted/50">
                                <div className="space-y-1 text-sm">
                                    <p><strong>맛집:</strong> {selectedSubmission.restaurant_name}</p>
                                    <p><strong>주소:</strong> {selectedSubmission.address}</p>
                                    <a
                                        href={selectedSubmission.youtube_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline flex items-center gap-1"
                                    >
                                        <Youtube className="h-4 w-4" />
                                        유튜브 영상
                                    </a>
                                </div>
                            </Card>

                            {reviewAction === 'approve' ? (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label>주소 지오코딩</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleReGeocode}
                                            disabled={geocoding}
                                        >
                                            {geocoding && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                            {!geocoding && <RefreshCw className="mr-1 h-3 w-3" />}
                                            검색
                                        </Button>
                                    </div>

                                    {geocodingResults.length > 0 && (
                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                            {geocodingResults.map((result, index) => (
                                                <div
                                                    key={index}
                                                    onClick={() => handleSelectGeocodingResult(index)}
                                                    className={`p-2 rounded border cursor-pointer text-xs ${selectedGeocodingIndex === index
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-gray-200 hover:border-gray-300'
                                                        }`}
                                                >
                                                    <p><strong>도로명:</strong> {result.road_address}</p>
                                                    <p><strong>지번:</strong> {result.jibun_address}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {approvalData.jibun_address && (
                                        <div className="p-2 bg-green-50 dark:bg-green-950 border border-green-200 rounded text-xs">
                                            <p className="font-semibold text-green-800 dark:text-green-200">✅ 선택됨</p>
                                            <p>{approvalData.road_address}</p>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-xs">위도</Label>
                                            <Input
                                                type="number"
                                                step="0.00000001"
                                                value={approvalData.lat}
                                                disabled
                                                className="text-xs"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-xs">경도</Label>
                                            <Input
                                                type="number"
                                                step="0.00000001"
                                                value={approvalData.lng}
                                                disabled
                                                className="text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label>거부 사유 *</Label>
                                    <Textarea
                                        value={rejectionReason}
                                        onChange={(e) => setRejectionReason(e.target.value)}
                                        placeholder="거부 사유를 입력해주세요..."
                                        rows={3}
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
                                    disabled={
                                        approveMutation.isPending ||
                                        rejectMutation.isPending ||
                                        (reviewAction === 'approve' && selectedGeocodingIndex === null)
                                    }
                                    className={reviewAction === 'approve' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}
                                >
                                    {approveMutation.isPending || rejectMutation.isPending ? (
                                        <><Loader2 className="mr-1 h-4 w-4 animate-spin" />처리 중</>
                                    ) : reviewAction === 'approve' ? '승인' : '거부'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 복원 다이얼로그 */}
            <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>🔄 삭제된 레코드 발견</AlertDialogTitle>
                        <AlertDialogDescription>
                            같은 이름과 주소의 삭제된 맛집이 있습니다. 복원하시겠습니까?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => {
                            setShowRestoreDialog(false);
                            setDeletedRecordInfo(null);
                            setPendingSubmissionData(null);
                        }}>
                            취소
                        </AlertDialogCancel>
                        <Button variant="outline" onClick={handleCreateNew}>
                            새로 생성
                        </Button>
                        <AlertDialogAction
                            onClick={handleRestoreAndUpdate}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            복원 (권장)
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

// 제보 카드 컴포넌트
const SubmissionCard = forwardRef<HTMLDivElement, {
    submission: SubmissionWithUser;
    onApprove?: () => void;
    onReject?: () => void;
    onDelete: () => void;
}>(({ submission, onApprove, onReject, onDelete }, ref) => {
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending':
                return <Badge variant="secondary" className="gap-1 text-xs"><Clock className="h-3 w-3" />대기</Badge>;
            case 'approved':
                return <Badge className="bg-green-500 gap-1 text-xs"><CheckCircle2 className="h-3 w-3" />승인</Badge>;
            case 'rejected':
                return <Badge variant="destructive" className="gap-1 text-xs"><XCircle className="h-3 w-3" />거부</Badge>;
            default:
                return null;
        }
    };

    return (
        <Card ref={ref} className="p-3">
            <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap mb-1">
                            <h3 className="text-sm font-semibold truncate">{submission.restaurant_name}</h3>
                            {getStatusBadge(submission.status)}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">📍 {submission.address}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="h-3 w-3" />
                            <span>{submission.profiles?.nickname || '알 수 없음'}</span>
                        </div>
                    </div>
                </div>

                {submission.youtube_link && (
                    <a
                        href={submission.youtube_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                        <Youtube className="h-3 w-3" />
                        유튜브
                    </a>
                )}

                {submission.status === 'rejected' && submission.rejection_reason && (
                    <div className="p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 rounded text-xs">
                        <strong>거부 사유:</strong> {submission.rejection_reason}
                    </div>
                )}

                {submission.status === 'pending' && (
                    <div className="flex gap-1">
                        <Button onClick={onApprove} size="sm" className="flex-1 bg-green-500 hover:bg-green-600 text-xs h-7">
                            승인
                        </Button>
                        <Button onClick={onReject} size="sm" variant="destructive" className="flex-1 text-xs h-7">
                            거부
                        </Button>
                        <Button onClick={onDelete} size="sm" variant="outline" className="h-7 w-7 p-0">
                            <Trash2 className="h-3 w-3" />
                        </Button>
                    </div>
                )}

                {submission.status !== 'pending' && (
                    <div className="flex justify-end">
                        <Button onClick={onDelete} size="sm" variant="ghost" className="text-destructive text-xs h-7">
                            <Trash2 className="h-3 w-3 mr-1" />
                            삭제
                        </Button>
                    </div>
                )}
            </div>
        </Card>
    );
});

SubmissionCard.displayName = 'SubmissionCard';
